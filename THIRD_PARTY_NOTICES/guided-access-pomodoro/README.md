# Guided Access Pomodoro — third-party source

The Eunoia "专注" (Focus) feature's timer logic (real `endAt`-based
countdown, pause/resume, `localStorage` persistence, per-day completion
counts, and the iOS Guided Access single-app-lock guidance) is adapted from:

> **Guided Access Pomodoro**
> Source by **NYRA**
> https://github.com/NyraSeithhh/guided-access-pomodoro
> MIT License

Files in this directory (`LICENSE`, `NOTICE.md`, and a verbatim copy of the
original source as `original-guided-access-pomodoro.js`) are kept exactly as
published in the upstream repository, per the MIT License's requirement to
retain the copyright/permission notice, and per the upstream author's own
request in their README to keep the "Source by NYRA" credit when the source
is reused or reshared.

**What Eunoia actually ships** is a rewrite of the same underlying state
machine as React code, restyled for Eunoia's own pink-purple crystal theme
and wired into Eunoia's chat UI (bottom-sheet setup panel from the "+" menu,
a full-screen countdown, a "交给小漫管理" mode, etc.) — see:

- `src/services/pomodoroCore.js` — the ported state engine (credits NYRA in
  its own header comment)
- `src/hooks/usePomodoro.js`
- `src/components/Focus/*`

This attribution covers only the reused source code; it does not assert any
claim over iOS, "Guided Access", Apple's platform/API names, or any other
third-party material — same scope the upstream `NOTICE.md` itself states.
