#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <poll.h>
#include <pwd.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

static volatile sig_atomic_t stopping = 0;

static void on_signal(int sig) {
  (void)sig;
  stopping = 1;
}

static int write_all(int fd, const char *buf, size_t len) {
  while (len) {
    ssize_t n = write(fd, buf, len);
    if (n > 0) { buf += n; len -= (size_t)n; continue; }
    if (n < 0 && errno == EINTR) continue;
    return -1;
  }
  return 0;
}

static int connect_socket(const char *path) {
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  struct sockaddr_un addr = { .sun_family = AF_UNIX };
  if (strlen(path) >= sizeof(addr.sun_path)) { errno = ENAMETOOLONG; close(fd); return -1; }
  strcpy(addr.sun_path, path);
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) { close(fd); return -1; }
  return fd;
}

static int client_mode(const char *path) {
  int peer = connect_socket(path);
  if (peer < 0) { perror("codex bridge connect"); return 1; }
  char buf[65536];
  while (!stopping) {
    struct pollfd fds[2] = {{.fd = STDIN_FILENO, .events = POLLIN}, {.fd = peer, .events = POLLIN}};
    int ready = poll(fds, 2, -1);
    if (ready < 0) { if (errno == EINTR) continue; perror("codex bridge client poll"); break; }
    if (fds[0].revents & (POLLIN | POLLHUP)) {
      ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
      if (n <= 0 || write_all(peer, buf, (size_t)n) < 0) break;
    }
    if (fds[1].revents & (POLLIN | POLLHUP)) {
      ssize_t n = read(peer, buf, sizeof(buf));
      if (n <= 0 || write_all(STDOUT_FILENO, buf, (size_t)n) < 0) break;
    }
    if (fds[0].revents & (POLLERR | POLLNVAL)) break;
    if (fds[1].revents & (POLLERR | POLLNVAL)) break;
  }
  close(peer);
  return 0;
}

static int duplicated_fd(int pidfd, int source_fd) {
  return (int)syscall(SYS_pidfd_getfd, pidfd, source_fd, 0);
}

static int make_listener(const char *path) {
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  struct sockaddr_un addr = { .sun_family = AF_UNIX };
  if (strlen(path) >= sizeof(addr.sun_path)) { errno = ENAMETOOLONG; close(fd); return -1; }
  strcpy(addr.sun_path, path);
  unlink(path);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0 || listen(fd, 4) < 0) {
    close(fd);
    return -1;
  }
  struct passwd *user = getpwnam("companion");
  struct group *group = getgrnam("companion");
  if (!user || !group || chown(path, user->pw_uid, group->gr_gid) < 0 || chmod(path, 0660) < 0) {
    close(fd);
    unlink(path);
    return -1;
  }
  return fd;
}

static void drain_stderr(int fd) {
  char buf[8192];
  while (read(fd, buf, sizeof(buf)) > 0) {}
}

static int relay_client(int client, int app_in, int app_out, int app_err) {
  char buf[65536];
  while (!stopping) {
    struct pollfd fds[3] = {
      {.fd = client, .events = POLLIN},
      {.fd = app_out, .events = POLLIN},
      {.fd = app_err, .events = POLLIN},
    };
    int ready = poll(fds, 3, -1);
    if (ready < 0) { if (errno == EINTR) continue; return -1; }
    if (fds[0].revents & (POLLIN | POLLHUP)) {
      ssize_t n = read(client, buf, sizeof(buf));
      if (n <= 0 || write_all(app_in, buf, (size_t)n) < 0) return -1;
    }
    if (fds[1].revents & (POLLIN | POLLHUP)) {
      ssize_t n = read(app_out, buf, sizeof(buf));
      if (n <= 0) return -2;
      if (write_all(client, buf, (size_t)n) < 0) return -1;
    }
    if (fds[2].revents & POLLIN) drain_stderr(app_err);
    if (fds[0].revents & (POLLERR | POLLNVAL)) return -1;
    if (fds[1].revents & (POLLERR | POLLNVAL)) return -2;
  }
  return 0;
}

static int adopt_mode(pid_t parent_pid, int stdin_fd, int stdout_fd, int stderr_fd, const char *path) {
  int pidfd = (int)syscall(SYS_pidfd_open, parent_pid, 0);
  if (pidfd < 0) { perror("pidfd_open"); return 1; }
  int app_in = duplicated_fd(pidfd, stdin_fd);
  int app_out = duplicated_fd(pidfd, stdout_fd);
  int app_err = duplicated_fd(pidfd, stderr_fd);
  close(pidfd);
  if (app_in < 0 || app_out < 0 || app_err < 0) { perror("pidfd_getfd"); return 1; }
  int err_flags = fcntl(app_err, F_GETFL, 0);
  if (err_flags >= 0) (void)fcntl(app_err, F_SETFL, err_flags | O_NONBLOCK);
  int listener = make_listener(path);
  if (listener < 0) { perror("codex bridge listen"); return 1; }
  fprintf(stderr, "codex-fd-bridge: adopted pid=%d fds=%d,%d,%d socket=%s\n", parent_pid, stdin_fd, stdout_fd, stderr_fd, path);
  while (!stopping) {
    struct pollfd fds[2] = {{.fd = listener, .events = POLLIN}, {.fd = app_err, .events = POLLIN}};
    int ready = poll(fds, 2, -1);
    if (ready < 0) { if (errno == EINTR) continue; break; }
    if (fds[1].revents & POLLIN) drain_stderr(app_err);
    if (!(fds[0].revents & POLLIN)) continue;
    int client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
    if (client < 0) { if (errno == EINTR) continue; break; }
    int result = relay_client(client, app_in, app_out, app_err);
    close(client);
    if (result == -2) { fprintf(stderr, "codex-fd-bridge: app-server stream closed\n"); break; }
  }
  close(listener); close(app_in); close(app_out); close(app_err); unlink(path);
  return stopping ? 0 : 1;
}

int main(int argc, char **argv) {
  signal(SIGINT, on_signal); signal(SIGTERM, on_signal); signal(SIGPIPE, SIG_IGN);
  if (argc == 3 && strcmp(argv[1], "client") == 0) return client_mode(argv[2]);
  if (argc == 7 && strcmp(argv[1], "adopt") == 0) {
    return adopt_mode((pid_t)atoi(argv[2]), atoi(argv[3]), atoi(argv[4]), atoi(argv[5]), argv[6]);
  }
  fprintf(stderr, "usage: %s client SOCKET | adopt PARENT_PID STDIN_FD STDOUT_FD STDERR_FD SOCKET\n", argv[0]);
  return 2;
}
