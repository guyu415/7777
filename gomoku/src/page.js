// 棋盘网页。注意：下面是一个模板字符串，里面的脚本不要用反引号和 ${}。
export const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#2b2326">
<title>五子棋</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; min-height: 100vh; background: #2b2326; color: #f1e6e8; font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; display: flex; flex-direction: column; align-items: center; padding: 12px 8px calc(16px + env(safe-area-inset-bottom)); }
  h1 { font-size: 17px; font-weight: 600; margin: 4px 0 8px; letter-spacing: 1px; }
  #status { min-height: 24px; font-size: 15px; margin-bottom: 8px; text-align: center; }
  #status b { color: #ffb3c7; }
  #wrap { width: 100%; max-width: 560px; }
  canvas { display: block; width: 100%; border-radius: 10px; touch-action: manipulation; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
  .bar { display: flex; gap: 8px; margin-top: 10px; width: 100%; max-width: 560px; }
  button { flex: 1; padding: 11px 6px; border: 0; border-radius: 10px; background: #4a3a40; color: #f1e6e8; font-size: 15px; }
  button:active { background: #5d4a52; }
  button.primary { background: #c2587a; color: #fff; font-weight: 600; }
  button:disabled { opacity: .4; }
  #info { margin-top: 10px; font-size: 13px; color: #b9a8ad; text-align: center; min-height: 18px; }
  #newpanel { display: none; margin-top: 10px; width: 100%; max-width: 560px; padding: 12px; background: #382c31; border-radius: 12px; }
  #newpanel p { margin: 0 0 8px; font-size: 14px; text-align: center; }
</style>
</head>
<body>
<h1>五子棋 · 15×15</h1>
<div id="status">加载中…</div>
<div id="wrap"><canvas id="board"></canvas></div>
<div class="bar">
  <button id="confirm" class="primary" disabled>确认落子</button>
  <button id="undo">悔棋</button>
  <button id="new">新局</button>
</div>
<div id="newpanel">
  <p>新开一局，你想执：</p>
  <div class="bar" style="margin-top:0">
    <button data-color="black">黑棋（先手）</button>
    <button data-color="white">白棋（后手）</button>
    <button id="cancelnew">取消</button>
  </div>
</div>
<div id="info"></div>
<script>
(function () {
  var KEY = new URLSearchParams(location.search).get('key') || '';
  var COLS = 'ABCDEFGHIJKLMNO';
  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var infoEl = document.getElementById('info');
  var confirmBtn = document.getElementById('confirm');
  var undoBtn = document.getElementById('undo');
  var game = null;
  var pending = null; // {r,c}
  var busy = false;

  function url(path) { return path + (KEY ? '?key=' + encodeURIComponent(KEY) : ''); }
  function api(path, body) {
    var opt = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(url(path), opt).then(function (r) { return r.json(); });
  }
  function name(r, c) { return COLS[c] + (r + 1); }
  function colorName(p) { return p === 1 ? '黑' : '白'; }

  // ---------- 绘制 ----------
  var cssW = 0, cell = 0, pad = 0;
  function layout() {
    var w = canvas.parentElement.clientWidth;
    var dpr = window.devicePixelRatio || 1;
    cssW = w;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pad = w / 16;
    cell = (w - pad * 2) / 14;
  }
  function px(i) { return pad + i * cell; }

  function stone(x, y, p, ghost) {
    var rad = cell * 0.44;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.5;
    var g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.1, x, y, rad);
    if (p === 1) { g.addColorStop(0, '#6b6b6b'); g.addColorStop(1, '#0d0d0d'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cfc7c9'); }
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = ghost ? 0 : 3; ctx.shadowOffsetY = 1;
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!game) return;
    ctx.clearRect(0, 0, cssW, cssW);
    ctx.fillStyle = '#dcb67a';
    ctx.fillRect(0, 0, cssW, cssW);
    ctx.strokeStyle = '#6b4f2a'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < 15; i++) {
      ctx.moveTo(px(0), px(i)); ctx.lineTo(px(14), px(i));
      ctx.moveTo(px(i), px(0)); ctx.lineTo(px(i), px(14));
    }
    ctx.stroke();
    ctx.fillStyle = '#6b4f2a';
    [[3,3],[3,11],[11,3],[11,11],[7,7]].forEach(function (s) {
      ctx.beginPath(); ctx.arc(px(s[1]), px(s[0]), cell * 0.1, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#7a5d35'; ctx.font = Math.round(cell * 0.38) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var k = 0; k < 15; k++) {
      ctx.fillText(COLS[k], px(k), pad * 0.45);
      ctx.fillText(String(k + 1), pad * 0.4, px(k));
    }
    for (var r = 0; r < 15; r++) for (var c = 0; c < 15; c++) {
      if (game.board[r][c]) stone(px(c), px(r), game.board[r][c], false);
    }
    if (game.last) {
      ctx.fillStyle = '#e0245e';
      ctx.beginPath(); ctx.arc(px(game.last.c), px(game.last.r), cell * 0.11, 0, Math.PI * 2); ctx.fill();
    }
    if (game.winLine) {
      var a = game.winLine, xs = a.map(function (z) { return z[1]; }), ys = a.map(function (z) { return z[0]; });
      var first = a.reduce(function (m, z) { return (z[0] < m[0] || (z[0] === m[0] && z[1] < m[1])) ? z : m; }, a[0]);
      var lastc = a.reduce(function (m, z) { return (z[0] > m[0] || (z[0] === m[0] && z[1] > m[1])) ? z : m; }, a[0]);
      ctx.strokeStyle = '#e0245e'; ctx.lineWidth = Math.max(3, cell * 0.12); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px(first[1]), px(first[0])); ctx.lineTo(px(lastc[1]), px(lastc[0])); ctx.stroke();
    }
    if (pending && game.board[pending.r][pending.c] === 0) {
      stone(px(pending.c), px(pending.r), game.human, true);
      ctx.strokeStyle = '#e0245e'; ctx.lineWidth = 2;
      var s = cell * 0.5, x0 = px(pending.c), y0 = px(pending.r);
      ctx.strokeRect(x0 - s, y0 - s, s * 2, s * 2);
    }
  }

  function render() {
    if (!game) return;
    var over = game.winner || game.draw;
    if (game.winner) {
      statusEl.innerHTML = '<b>' + colorName(game.winner) + '棋获胜</b>（' + (game.winner === game.human ? '你赢了 🎉' : 'AI 赢了') + '）';
    } else if (game.draw) {
      statusEl.textContent = '棋盘已满，和棋';
    } else if (game.turn === game.human) {
      statusEl.innerHTML = '轮到<b>你</b>（' + colorName(game.human) + '棋）' + (pending ? ' · 已选 <b>' + name(pending.r, pending.c) + '</b>' : ' · 点一下棋盘选位置');
    } else {
      statusEl.innerHTML = '等 <b>AI</b> 落子（' + colorName(game.ai) + '棋）· 回对话里叫它一声';
    }
    confirmBtn.disabled = !pending || over || game.turn !== game.human || busy;
    undoBtn.disabled = game.moveCount === 0 || busy;
    infoEl.textContent = game.last ? ('最后一手：' + colorName(game.last.p) + ' ' + game.last.name + ' · 共 ' + game.moveCount + ' 手') : '还没有落子';
    draw();
  }

  function applyState(s) {
    if (!s || !s.board) return;
    var changed = !game || game.version !== s.version;
    game = s;
    if (changed) {
      if (pending && (game.board[pending.r][pending.c] !== 0 || game.turn !== game.human)) pending = null;
      render();
    }
  }

  // ---------- 交互 ----------
  function pick(ev) {
    if (!game || game.winner || game.draw || game.turn !== game.human || busy) return;
    var rect = canvas.getBoundingClientRect();
    var t = ev.touches && ev.touches[0] ? ev.touches[0] : (ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0] : ev);
    var x = (t.clientX - rect.left) * (cssW / rect.width);
    var y = (t.clientY - rect.top) * (cssW / rect.width);
    var c = Math.round((x - pad) / cell), r = Math.round((y - pad) / cell);
    if (r < 0 || r > 14 || c < 0 || c > 14) return;
    if (game.board[r][c] !== 0) return;
    if (pending && pending.r === r && pending.c === c) { submit(); return; }
    pending = { r: r, c: c };
    render();
  }
  canvas.addEventListener('click', pick);

  function submit() {
    if (!pending || busy) return;
    busy = true; render();
    api('/api/move', { pos: name(pending.r, pending.c) }).then(function (res) {
      busy = false;
      if (res.error) { infoEl.textContent = '⚠️ ' + res.error; }
      else pending = null;
      if (res.game) applyState(res.game);
      render();
    }).catch(function () { busy = false; infoEl.textContent = '⚠️ 网络出错，再试一次'; render(); });
  }
  confirmBtn.addEventListener('click', submit);

  undoBtn.addEventListener('click', function () {
    if (busy) return;
    if (!confirm('悔棋：撤回你上一步（连同 AI 之后的那一手）？')) return;
    busy = true; render();
    api('/api/undo', {}).then(function (res) {
      busy = false; pending = null;
      if (res.error) infoEl.textContent = '⚠️ ' + res.error;
      if (res.game) applyState(res.game);
      render();
    }).catch(function () { busy = false; render(); });
  });

  var panel = document.getElementById('newpanel');
  document.getElementById('new').addEventListener('click', function () { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; });
  document.getElementById('cancelnew').addEventListener('click', function () { panel.style.display = 'none'; });
  Array.prototype.forEach.call(panel.querySelectorAll('button[data-color]'), function (b) {
    b.addEventListener('click', function () {
      if (game && game.moveCount > 0 && !game.winner && !game.draw && !confirm('当前这局还没下完，确定要开新局吗？')) return;
      api('/api/new', { human_color: b.getAttribute('data-color') }).then(function (res) {
        pending = null; panel.style.display = 'none';
        if (res.game) { game = null; applyState(res.game); }
      });
    });
  });

  function poll() {
    api('/api/state').then(function (res) {
      if (res.error) { statusEl.textContent = res.error; return; }
      applyState(res.game);
    }).catch(function () {});
  }
  window.addEventListener('resize', function () { layout(); draw(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  layout(); poll(); setInterval(poll, 2000);
})();
</script>
</body>
</html>`
