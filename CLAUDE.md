# Stream Overlay — contexto para Claude Code

Reemplazo self-hosted de TriggerFyre para disparar videos en un overlay de OBS
cuando viewers canjean Channel Points en Twitch.

## Arquitectura (MVP local)

```
Twitch → Streamer.bot → WebSocket (8080) → overlay.html (OBS Browser Source)
                                                  ↓
                                           config.json + videos/
```

- **overlay.html** — todo el código vive acá (HTML + CSS + JS inline). Sin build step.
- **config.json** — mapeo `rewardName → { videos, width, height, volume, ... }`.
- **videos/** — archivos .mp4 / .webm locales. Ignorados en git.
- **mock-ws-server.js** — servidor WS de prueba (requiere `npm install ws`).

## Convenciones

- Código en inglés (identifiers, comments, logs).
- Docs/comments en español neutro.
- Logs con prefijo `[Overlay]` o `[WS]`.
- Sin dependencias externas. Single-file mientras quepa <500 líneas.
- Commits: Conventional Commits en inglés.

## WebSocket protocol (Streamer.bot)

Mensajes de entrada:
```json
{
  "event": { "source": "General", "type": "Custom" },
  "data":  { "action": "playVideo", "reward": "<name>", "user": "<name>" }
}
```
Subscribe on connect:
```json
{ "request": "Subscribe", "id": "overlay-sub-1", "events": { "General": ["Custom"] } }
```

## Testing manual

Consola de DevTools (Browser Source → Interact → F12):
- `spawnVideo("nombre del reward")` — spawnea sin Streamer.bot ni Twitch.
- Tecla `R` — hot-reload de config.json sin refrescar el Browser Source.

Servidor mock: `npm install ws && node mock-ws-server.js`

## Non-goals del MVP

- Dashboard admin, backend, persistencia, autenticación.
- Cola con prioridades, combos, efectos de raid.
- Cloudflare / D1 / R2 (eso es Etapa 2).
