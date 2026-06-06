'use strict';
/**
 * Stream Overlay — Admin UI
 * Corre: node admin.js
 * Abre:  http://localhost:3001
 *
 * Sin dependencias externas. Solo Node.js built-ins.
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT        = 3001;
const CONFIG_PATH = path.join(__dirname, 'config.json');

// ── WebSocket hub (overlay se conecta acá, Streamer.bot hace POST /api/trigger) ──
const wsClients = new Set();

function wsSend(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  const len     = payload.length;
  const header  = len < 126
    ? Buffer.from([0x81, len])
    : Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
  try { socket.write(Buffer.concat([header, payload])); } catch (_) { wsClients.delete(socket); }
}

function wsBroadcast(text) {
  for (const s of wsClients) wsSend(s, text);
}

function wsDecodeFrame(buf) {
  try {
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f, offset = 2;
    if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
    const mask    = masked ? buf.slice(offset, offset + 4) : null;
    if (masked) offset += 4;
    const payload = Buffer.from(buf.slice(offset, offset + len));
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    return payload.toString('utf8');
  } catch (_) { return null; }
}
const VIDEOS_DIR  = path.join(__dirname, 'videos');

// ── Helpers ──────────────────────────────────────────────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {
    return { rewards: {}, safeZones: { exclude: [] }, canvas: { width: 1920, height: 1080 } };
  }
}

function listVideos() {
  try {
    if (!fs.existsSync(VIDEOS_DIR)) return [];
    return fs.readdirSync(VIDEOS_DIR).filter(f => /\.(mp4|webm|mov)$/i.test(f));
  } catch (_) { return []; }
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const method = req.method;
  const url    = req.url.split('?')[0];

  if (method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (method === 'GET' && url === '/api/config') {
    return json(res, 200, readConfig());
  }

  if (method === 'POST' && url === '/api/config') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2), 'utf8');
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    });
    return;
  }

  if (method === 'GET' && url === '/api/videos') {
    return json(res, 200, listVideos());
  }

  // Streamer.bot llama esto con Fetch URL — acepta GET (?reward=...&user=...) y POST (JSON body)
  if ((method === 'GET' || method === 'POST') && req.url.split('?')[0] === '/api/trigger') {
    const trigger = (reward, user) => {
      if (!reward) { json(res, 400, { error: 'missing reward' }); return; }
      wsBroadcast(JSON.stringify({
        event: { source: 'General', type: 'Custom' },
        data:  { action: 'playVideo', reward, user: user || '' }
      }));
      console.log('[Trigger] playVideo →', reward, '| clientes:', wsClients.size);
      json(res, 200, { ok: true, clients: wsClients.size });
    };
    if (method === 'GET') {
      const qs     = new URL('http://x' + req.url).searchParams;
      const reward = qs.get('reward') || '';
      const user   = qs.get('user')   || '';
      trigger(reward, user);
    } else {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try { const d = JSON.parse(body); trigger(d.reward, d.user); }
        catch (e) { json(res, 400, { error: e.message }); }
      });
    }
    return;
  }

  // Serve overlay.html via HTTP (solves file:// fetch restrictions in regular browsers)
  if (method === 'GET' && url === '/overlay') {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'overlay.html'), 'utf8'));
    } catch (_) { res.writeHead(404); res.end('overlay.html not found'); }
    return;
  }

  // config.json for the overlay fetched via relative path
  if (method === 'GET' && url === '/config.json') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (_) { res.writeHead(404); res.end('{}'); }
    return;
  }

  // Video files with HTTP Range support (required for browser video seeking)
  if (method === 'GET' && url.startsWith('/videos/')) {
    const filename = path.basename(decodeURIComponent(url.slice(8)));
    const filepath = path.join(VIDEOS_DIR, filename);
    if (!fs.existsSync(filepath)) { res.writeHead(404); res.end('Video not found'); return; }

    const stat     = fs.statSync(filepath);
    const ext      = path.extname(filename).toLowerCase();
    const mime     = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
    const type     = mime[ext] || 'application/octet-stream';
    const range    = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range':  'bytes ' + start + '-' + end + '/' + stat.size,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   type
      });
      fs.createReadStream(filepath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(filepath).pipe(res);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Overlay se conecta a ws://localhost:3001 como WebSocket
server.on('upgrade', (req, socket) => {
  const key    = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  wsClients.add(socket);
  wsSend(socket, JSON.stringify({ event: { source: 'System', type: 'Connected' }, data: { clients: wsClients.size } }));
  console.log('[WS] Overlay conectado. Total:', wsClients.size);
  socket.on('data',  (d) => wsDecodeFrame(d));
  socket.on('close', () => { wsClients.delete(socket); console.log('[WS] Overlay desconectado. Total:', wsClients.size); });
  socket.on('error', () => wsClients.delete(socket));
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('[Admin] Ya hay un servidor corriendo en el puerto ' + PORT + '.');
    console.log('[Admin] Abrí:  http://localhost:' + PORT);
    require('child_process').exec('start http://localhost:' + PORT);
  } else {
    throw e;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[Admin] Config UI    →  http://localhost:' + PORT);
  console.log('[Admin] Overlay test →  http://localhost:' + PORT + '/overlay');
  console.log('[Admin] Cerrá esta ventana para detener el servidor.');
  require('child_process').exec('start http://localhost:' + PORT);
});

// ── HTML (todo inline) ───────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Stream Overlay — Config</title>
<style>
  :root {
    --bg:      #0e0e10;
    --s1:      #18181b;
    --s2:      #1f1f23;
    --border:  #2a2a2d;
    --accent:  #9147ff;
    --accentH: #772ce8;
    --text:    #efeff1;
    --muted:   #adadb8;
    --danger:  #c0392b;
    --green:   #00ba6c;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, system-ui, sans-serif;
    font-size: 13px;
    background: var(--bg);
    color: var(--text);
    display: grid;
    grid-template-rows: 52px 1fr;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Header ── */
  header {
    background: var(--s1);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 20px;
    gap: 12px;
  }
  header h1 { font-size: 15px; font-weight: 700; flex: 1; }
  header h1 span { color: var(--accent); }
  #statusBadge {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 4px;
    background: var(--s2);
    color: var(--muted);
    transition: all .2s;
  }
  #statusBadge.dirty  { background: #3a2a00; color: #f0a000; }
  #statusBadge.saved  { background: #003a1a; color: var(--green); }
  #saveBtn {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 7px 18px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }
  #saveBtn:hover { background: var(--accentH); }
  #saveBtn:disabled { opacity: .4; cursor: default; }

  /* ── Layout ── */
  main {
    display: grid;
    grid-template-columns: 270px 1fr;
    overflow: hidden;
  }

  /* ── Sidebar ── */
  aside {
    background: var(--s1);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .sidebar-section { padding: 14px 14px 8px; }
  .sidebar-section + .sidebar-section { border-top: 1px solid var(--border); }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .sidebar-header h2 {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--muted);
  }
  .mini-btn {
    background: var(--s2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .mini-btn:hover { background: var(--border); }

  .reward-item {
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background .1s;
  }
  .reward-item:hover { background: var(--s2); }
  .reward-item.active { background: var(--accent); color: #fff; }
  .reward-item .ri-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reward-item .ri-count { font-size: 11px; color: var(--muted); }
  .reward-item.active .ri-count { color: rgba(255,255,255,.65); }

  .zone-item {
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--s2);
    margin-bottom: 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .zone-item .z-name { font-weight: 600; }
  .zone-item .z-coords { font-size: 11px; color: var(--muted); }

  .canvas-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
  .canvas-row label { color: var(--muted); font-size: 12px; display: flex; align-items: center; gap: 5px; }

  /* ── Editor panel ── */
  #editor {
    overflow-y: auto;
    padding: 24px 28px;
  }
  #emptyState {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    gap: 8px;
  }
  #emptyState .arrow { font-size: 28px; }
  #emptyState p { font-size: 14px; }

  /* ── Form elements ── */
  .field { margin-bottom: 20px; }
  .field label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  input[type=text], input[type=number] {
    background: var(--s2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    padding: 8px 12px;
    width: 100%;
    outline: none;
    transition: border-color .15s;
  }
  input[type=text]:focus, input[type=number]:focus {
    border-color: var(--accent);
  }
  .inline-row { display: flex; gap: 12px; }
  .inline-row .field { flex: 1; }

  /* Volume slider */
  .vol-row { display: flex; align-items: center; gap: 12px; }
  input[type=range] {
    -webkit-appearance: none;
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--border);
    outline: none;
    cursor: pointer;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }
  .vol-value {
    min-width: 34px;
    text-align: right;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  /* Videos list */
  .video-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .video-chip {
    background: var(--s2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .video-chip .vc-path { flex: 1; font-family: monospace; font-size: 12px; color: var(--text); word-break: break-all; }
  .video-chip .vc-missing { color: #c0392b; font-size: 11px; margin-left: 4px; }
  .video-chip .vc-ok { color: var(--green); font-size: 11px; margin-left: 4px; }
  .del-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
  }
  .del-btn:hover { color: var(--danger); }

  .add-video-row { display: flex; gap: 8px; align-items: center; }
  .add-video-row select {
    flex: 1;
    background: var(--s2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    padding: 7px 10px;
    outline: none;
    cursor: pointer;
  }
  .add-video-row select:focus { border-color: var(--accent); }
  .add-btn {
    background: var(--s2);
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .add-btn:hover { background: var(--accent); color: #fff; }

  /* Checkbox */
  .check-row { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .check-row input[type=checkbox] { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; }
  .check-row span { font-size: 13px; }

  /* Danger zone */
  .danger-zone {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
  }
  .danger-btn {
    background: none;
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: 6px;
    padding: 7px 16px;
    font-size: 13px;
    cursor: pointer;
    transition: all .15s;
  }
  .danger-btn:hover { background: var(--danger); color: #fff; }

  /* Safe zone form */
  .zone-form {
    background: var(--s2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    margin-top: 8px;
    display: none;
  }
  .zone-form.open { display: block; }
  .zone-form .zf-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }
  .zone-form label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 3px; }
  .zone-form input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    padding: 5px 8px;
    width: 100%;
    outline: none;
  }
  .zone-form input:focus { border-color: var(--accent); }
  .zone-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .zf-save {
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: 4px;
    padding: 5px 14px;
    font-size: 12px;
    cursor: pointer;
  }
  .zf-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 4px;
    padding: 5px 14px;
    font-size: 12px;
    cursor: pointer;
  }
  .zf-cancel:hover { background: var(--border); }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>

<header>
  <h1>Stream <span>Overlay</span></h1>
  <span id="statusBadge">Sin cambios</span>
  <a href="/overlay" target="_blank" style="background:var(--s2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 14px;font-size:13px;text-decoration:none;white-space:nowrap">&#9654; Abrir overlay</a>
  <select id="testRewardSel" style="background:var(--s2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 10px;font-size:13px;max-width:200px;"></select>
  <button id="testBtn" style="background:var(--green);color:#000;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">&#9654; Probar</button>
  <button id="saveBtn" disabled>Guardar config.json</button>
</header>

<main>
  <aside id="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-header">
        <h2>Rewards</h2>
        <button class="mini-btn" id="addRewardBtn">+ Nuevo</button>
      </div>
      <div id="rewardsList"></div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-header">
        <h2>Safe Zones</h2>
        <button class="mini-btn" id="addZoneBtn">+ Nueva</button>
      </div>
      <div id="zonesList"></div>
      <div class="zone-form" id="zoneForm">
        <div class="zf-grid">
          <div><label>Nombre</label><input id="zfName" type="text" placeholder="webcam" /></div>
          <div><label>X</label><input id="zfX" type="number" placeholder="1500" /></div>
          <div><label>Y</label><input id="zfY" type="number" placeholder="800" /></div>
          <div><label>Ancho</label><input id="zfW" type="number" placeholder="420" /></div>
          <div><label>Alto</label><input id="zfH" type="number" placeholder="280" /></div>
        </div>
        <div class="zone-form-actions">
          <button class="zf-cancel" id="zfCancel">Cancelar</button>
          <button class="zf-save" id="zfSave">Agregar</button>
        </div>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-header"><h2>Canvas</h2></div>
      <div class="canvas-row">
        <label>W <input type="number" id="canvasW" style="width:80px" /></label>
        <span style="color:var(--muted)">×</span>
        <label>H <input type="number" id="canvasH" style="width:80px" /></label>
        <span style="color:var(--muted);font-size:11px">px</span>
      </div>
    </div>
  </aside>

  <section id="editor">
    <div id="emptyState">
      <span class="arrow">&#8592;</span>
      <p>Seleccioná un reward para editarlo</p>
    </div>
    <div id="editorForm" style="display:none"></div>
  </section>
</main>

<script>
(function() {
  'use strict';

  var cfg     = {};
  var videos  = [];
  var sel     = null;   // reward name currently selected
  var dirty   = false;

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function init() {
    var [c, v] = await Promise.all([
      fetch('/api/config').then(function(r){ return r.json(); }),
      fetch('/api/videos').then(function(r){ return r.json(); })
    ]);
    cfg    = c;
    videos = v;
    renderAll();
    document.getElementById('saveBtn').addEventListener('click', saveConfig);
    document.getElementById('testBtn').addEventListener('click', testReward);
    document.getElementById('addRewardBtn').addEventListener('click', addReward);
    document.getElementById('addZoneBtn').addEventListener('click', function(){ toggleZoneForm(true); });
    document.getElementById('zfCancel').addEventListener('click', function(){ toggleZoneForm(false); });
    document.getElementById('zfSave').addEventListener('click', addZone);
    document.getElementById('canvasW').addEventListener('input', function(){ cfg.canvas.width = parseInt(this.value)||1920; markDirty(); });
    document.getElementById('canvasH').addEventListener('input', function(){ cfg.canvas.height = parseInt(this.value)||1080; markDirty(); });
  }

  // ── Dirty tracking ────────────────────────────────────────────────────────

  function markDirty() {
    dirty = true;
    var badge = document.getElementById('statusBadge');
    badge.textContent = 'Cambios sin guardar';
    badge.className = 'dirty';
    document.getElementById('saveBtn').disabled = false;
  }

  function markSaved() {
    dirty = false;
    var badge = document.getElementById('statusBadge');
    badge.textContent = 'Guardado';
    badge.className = 'saved';
    document.getElementById('saveBtn').disabled = true;
    setTimeout(function(){
      if (!dirty) { badge.textContent = 'Sin cambios'; badge.className = ''; }
    }, 2000);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderAll() {
    renderRewardsList();
    renderTestSelect();
    renderZonesList();
    renderCanvas();
    if (sel !== null) {
      if (cfg.rewards[sel]) renderEditor(sel);
      else { sel = null; showEmpty(); }
    }
  }

  function renderTestSelect() {
    var sel2 = document.getElementById('testRewardSel');
    var names = Object.keys(cfg.rewards || {});
    sel2.innerHTML = names.length
      ? names.map(function(n){ return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('')
      : '<option value="">— sin rewards —</option>';
  }

  async function testReward() {
    var reward = document.getElementById('testRewardSel').value;
    if (!reward) return;
    var btn = document.getElementById('testBtn');
    btn.textContent = '...';
    try {
      var r = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reward: reward, user: 'AdminTest' })
      });
      var d = await r.json();
      btn.textContent = d.clients === 0 ? '⚠ Sin overlay conectado' : '✓ Enviado';
    } catch(e) { btn.textContent = '✗ Error'; }
    setTimeout(function(){ btn.textContent = '▶ Probar'; }, 2000);
  }

  function renderRewardsList() {
    var container = document.getElementById('rewardsList');
    var names = Object.keys(cfg.rewards || {});
    if (names.length === 0) {
      container.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:4px 0">Sin rewards. Hacé click en + Nuevo.</p>';
      return;
    }
    container.innerHTML = names.map(function(name) {
      var rc = cfg.rewards[name];
      var count = (rc.videos || []).length;
      var active = name === sel ? ' active' : '';
      return '<div class="reward-item' + active + '" data-name="' + esc(name) + '">'
        + '<span class="ri-name">' + esc(name) + '</span>'
        + '<span class="ri-count">' + count + ' video' + (count !== 1 ? 's' : '') + '</span>'
        + '</div>';
    }).join('');
    container.querySelectorAll('.reward-item').forEach(function(el) {
      el.addEventListener('click', function(){ selectReward(this.dataset.name); });
    });
  }

  function renderZonesList() {
    var container = document.getElementById('zonesList');
    var zones = (cfg.safeZones && cfg.safeZones.exclude) || [];
    if (zones.length === 0) {
      container.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:4px 0">Sin zonas.</p>';
      return;
    }
    container.innerHTML = zones.map(function(z, i) {
      return '<div class="zone-item">'
        + '<div><div class="z-name">' + esc(z.name || 'zona ' + (i+1)) + '</div>'
        + '<div class="z-coords">' + z.x + ', ' + z.y + '  ' + z.width + '×' + z.height + '</div></div>'
        + '<button class="del-btn" data-idx="' + i + '" title="Eliminar zona">&#x2715;</button>'
        + '</div>';
    }).join('');
    container.querySelectorAll('.del-btn').forEach(function(btn) {
      btn.addEventListener('click', function(){ removeZone(parseInt(this.dataset.idx)); });
    });
  }

  function renderCanvas() {
    var c = cfg.canvas || {};
    document.getElementById('canvasW').value = c.width  || 1920;
    document.getElementById('canvasH').value = c.height || 1080;
  }

  // ── Reward selection & editor ─────────────────────────────────────────────

  function selectReward(name) {
    sel = name;
    renderRewardsList();
    renderEditor(name);
  }

  function showEmpty() {
    document.getElementById('emptyState').style.display = '';
    document.getElementById('editorForm').style.display = 'none';
  }

  function renderEditor(name) {
    var rc = cfg.rewards[name];
    document.getElementById('emptyState').style.display = 'none';
    var form = document.getElementById('editorForm');
    form.style.display = '';

    var volVal = rc.volume !== undefined ? parseFloat(rc.volume).toFixed(2) : '1.00';
    var vidItems = (rc.videos || []).map(function(vpath, i) {
      var exists = videos.indexOf(vpath.replace('videos/', '')) !== -1;
      var statusMark = exists
        ? '<span class="vc-ok" title="Archivo encontrado">&#10003;</span>'
        : '<span class="vc-missing" title="Archivo no encontrado en videos/">&#9888;</span>';
      return '<div class="video-chip">'
        + '<span class="vc-path">' + esc(vpath) + statusMark + '</span>'
        + '<button class="del-btn" data-vi="' + i + '" title="Quitar video">&#x2715;</button>'
        + '</div>';
    }).join('');

    var videoOptions = videos.map(function(f) {
      var fullPath = 'videos/' + f;
      var used = (rc.videos || []).indexOf(fullPath) !== -1;
      return '<option value="' + esc(fullPath) + '"' + (used ? ' disabled' : '') + '>' + esc(f) + (used ? ' (ya agregado)' : '') + '</option>';
    }).join('');
    if (!videoOptions) videoOptions = '<option value="">— Carpeta videos/ vacía —</option>';

    form.innerHTML =
      '<div class="field">'
        + '<label>Nombre del reward (debe coincidir exactamente con Twitch)</label>'
        + '<input type="text" id="ri-name" value="' + esc(name) + '" />'
      + '</div>'

      + '<div class="field">'
        + '<label>Videos</label>'
        + '<div class="video-list" id="videoList">' + vidItems + '</div>'
        + '<div class="add-video-row">'
          + '<select id="videoSelect"><option value="">— Elegir de videos/ —</option>' + videoOptions + '</select>'
          + '<button class="add-btn" id="addVideoBtn">+ Agregar</button>'
        + '</div>'
      + '</div>'

      + '<div class="field">'
        + '<label>Volumen</label>'
        + '<div class="vol-row">'
          + '<input type="range" id="ri-vol" min="0" max="1" step="0.01" value="' + volVal + '" />'
          + '<span class="vol-value" id="volDisplay">' + volVal + '</span>'
        + '</div>'
      + '</div>'

      + '<div class="inline-row">'
        + '<div class="field"><label>Ancho (px)</label><input type="number" id="ri-w" value="' + (rc.width||480) + '" /></div>'
        + '<div class="field"><label>Alto (px)</label><input type="number" id="ri-h" value="' + (rc.height||270) + '" /></div>'
      + '</div>'

      + '<div class="field">'
        + '<label>Duración máxima (ms)</label>'
        + '<input type="number" id="ri-dur" value="' + (rc.maxDuration||10000) + '" />'
      + '</div>'

      + '<div class="field">'
        + '<label class="check-row">'
          + '<input type="checkbox" id="ri-zones"' + (rc.respectSafeZones !== false ? ' checked' : '') + ' />'
          + '<span>Respetar safe zones (el video no aparece sobre la webcam u otras zonas)</span>'
        + '</label>'
      + '</div>'

      + '<div class="danger-zone">'
        + '<button class="danger-btn" id="deleteRewardBtn">Eliminar reward</button>'
      + '</div>';

    // Wire up events
    document.getElementById('ri-name').addEventListener('change', function() {
      var newName = this.value.trim();
      if (!newName || newName === name) return;
      renameReward(name, newName);
    });

    document.getElementById('ri-vol').addEventListener('input', function() {
      var v = parseFloat(this.value);
      document.getElementById('volDisplay').textContent = v.toFixed(2);
      cfg.rewards[name].volume = v;
      markDirty();
    });

    document.getElementById('ri-w').addEventListener('input', function() {
      cfg.rewards[name].width = parseInt(this.value) || 480;
      markDirty();
    });

    document.getElementById('ri-h').addEventListener('input', function() {
      cfg.rewards[name].height = parseInt(this.value) || 270;
      markDirty();
    });

    document.getElementById('ri-dur').addEventListener('input', function() {
      cfg.rewards[name].maxDuration = parseInt(this.value) || 10000;
      markDirty();
    });

    document.getElementById('ri-zones').addEventListener('change', function() {
      cfg.rewards[name].respectSafeZones = this.checked;
      markDirty();
    });

    document.querySelectorAll('#videoList .del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var i = parseInt(this.dataset.vi);
        cfg.rewards[name].videos.splice(i, 1);
        markDirty();
        renderEditor(name);
      });
    });

    document.getElementById('addVideoBtn').addEventListener('click', function() {
      var sel2 = document.getElementById('videoSelect').value;
      if (!sel2) return;
      if (!cfg.rewards[name].videos) cfg.rewards[name].videos = [];
      if (cfg.rewards[name].videos.indexOf(sel2) === -1) {
        cfg.rewards[name].videos.push(sel2);
        markDirty();
        renderEditor(name);
      }
    });

    document.getElementById('deleteRewardBtn').addEventListener('click', function() {
      if (!confirm('Eliminar el reward "' + name + '"?')) return;
      delete cfg.rewards[name];
      sel = null;
      markDirty();
      renderAll();
      showEmpty();
    });
  }

  // ── Reward actions ────────────────────────────────────────────────────────

  function addReward() {
    var base = 'Nuevo Reward';
    var name = base;
    var n = 1;
    while (cfg.rewards[name]) name = base + ' ' + (++n);
    cfg.rewards[name] = { videos: [], width: 480, height: 270, volume: 0.8, maxDuration: 10000, respectSafeZones: true };
    markDirty();
    renderRewardsList();
    selectReward(name);
    // Focus the name field so user can rename immediately
    setTimeout(function(){ var el = document.getElementById('ri-name'); if(el) el.select(); }, 50);
  }

  function renameReward(oldName, newName) {
    if (cfg.rewards[newName]) {
      alert('Ya existe un reward con ese nombre.');
      renderEditor(oldName);
      return;
    }
    var data = cfg.rewards[oldName];
    var newRewards = {};
    Object.keys(cfg.rewards).forEach(function(k) {
      newRewards[k === oldName ? newName : k] = cfg.rewards[k];
    });
    cfg.rewards = newRewards;
    sel = newName;
    markDirty();
    renderAll();
  }

  // ── Safe zones ────────────────────────────────────────────────────────────

  function toggleZoneForm(open) {
    document.getElementById('zoneForm').className = 'zone-form' + (open ? ' open' : '');
    if (open) {
      document.getElementById('zfName').value = '';
      document.getElementById('zfX').value = '';
      document.getElementById('zfY').value = '';
      document.getElementById('zfW').value = '';
      document.getElementById('zfH').value = '';
    }
  }

  function addZone() {
    var name = document.getElementById('zfName').value.trim() || 'zona';
    var x = parseInt(document.getElementById('zfX').value) || 0;
    var y = parseInt(document.getElementById('zfY').value) || 0;
    var w = parseInt(document.getElementById('zfW').value) || 100;
    var h = parseInt(document.getElementById('zfH').value) || 100;
    if (!cfg.safeZones) cfg.safeZones = { exclude: [] };
    if (!cfg.safeZones.exclude) cfg.safeZones.exclude = [];
    cfg.safeZones.exclude.push({ x: x, y: y, width: w, height: h, name: name });
    markDirty();
    renderZonesList();
    toggleZoneForm(false);
  }

  function removeZone(idx) {
    if (!confirm('Eliminar esta safe zone?')) return;
    cfg.safeZones.exclude.splice(idx, 1);
    markDirty();
    renderZonesList();
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function saveConfig() {
    var btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      var res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg, null, 2)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      markSaved();
    } catch(e) {
      alert('Error al guardar: ' + e.message);
      btn.disabled = false;
    }
    btn.textContent = 'Guardar config.json';
  }

  // ── Util ──────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  init();
})();
</script>
</body>
</html>`;
