/**
 * Mock WebSocket server para testear el overlay sin Streamer.bot.
 * Requiere Node.js + el paquete "ws".
 *
 * Setup:
 *   npm install ws
 *   node mock-ws-server.js
 *
 * Luego escribí el nombre exacto del reward cuando te lo pida y
 * el overlay va a recibir el evento y spawnear el video.
 */

const { WebSocketServer } = require('ws');
const readline = require('readline');

const PORT = 8080;
const wss  = new WebSocketServer({ port: PORT });
const clients = new Set();

console.log(`[MockWS] Escuchando en ws://localhost:${PORT}`);
console.log('[MockWS] Abrí overlay.html en OBS o en el navegador, luego escribí un reward name.');

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[MockWS] Overlay conectado (${clients.size} total)`);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.request === 'Subscribe') {
        // Responder al subscribe de Streamer.bot protocol
        ws.send(JSON.stringify({ id: msg.id, status: 'ok', events: msg.events }));
        console.log('[MockWS] Subscripción OK:', JSON.stringify(msg.events));
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('[MockWS] Overlay desconectado');
  });
});

function broadcast(reward, user = 'TestViewer') {
  const msg = JSON.stringify({
    timeStamp: new Date().toISOString(),
    event: { source: 'General', type: 'Custom' },
    data:  { action: 'playVideo', reward, user }
  });
  let sent = 0;
  for (const client of clients) {
    if (client.readyState === 1) { client.send(msg); sent++; }
  }
  console.log(`[MockWS] Enviado a ${sent} cliente(s): playVideo → "${reward}"`);
}

// Expose for scripting if you require() this file
module.exports = { broadcast };

// Interactive CLI
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
  rl.question('\nReward name (o "quit"): ', (input) => {
    input = input.trim();
    if (input === 'quit' || input === 'exit') {
      rl.close();
      wss.close();
      process.exit(0);
    }
    if (input) broadcast(input);
    prompt();
  });
}

prompt();
