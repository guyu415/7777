const message = "cron 已运行";

console.log(message);
$notification.post("小G cron 测试", "", message);
$done();
