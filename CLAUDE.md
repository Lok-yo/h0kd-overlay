# Stream Overlay — contexto para Claude Code

App de escritorio self-hosted para disparar videos en un overlay de OBS
cuando viewers canjean Channel Points en Twitch.

## Arquitectura (standalone — Tauri)

```
Twitch EventSub ─┐
                 ├─► app Rust (src-tauri) ─► WebSocket :3001 ─► overlay.html (OBS Browser Source)
panel "Probar" ──┘            │
                              └─► config.json + videos/  (dir de datos del usuario)
```

La app se conecta **directo a Twitch** vía EventSub (OAuth Device Code Flow, ver `twitch.rs`).
No hay Streamer.bot ni dependencias de programas externos.

- **src-tauri/src/lib.rs** — comandos Tauri + arranque + `find_data_dir`.
- **src-tauri/src/server.rs** — server axum (HTTP + WebSocket) en `:3001`.
- **src-tauri/src/twitch.rs** — Device Code Flow + cliente EventSub. Client ID compartido embebido.
- **src/control.html** — panel de control nativo (HTML+CSS+JS inline, sin build step).
- **src/overlay.html** — overlay servido en `/overlay` (embebido vía `include_str!`).
- **config.json + videos/** — en el dir de datos del SO (`%APPDATA%` / `~/Library/Application Support`),
  auto-creados en el primer arranque. En dev usa el `config.json` del repo. Ignorados en git.

## Convenciones

- Código en inglés (identifiers, comments, logs).
- Docs/comments en español neutro.
- Logs con prefijo `[Overlay]` o `[WS]`.
- Sin dependencias externas. Single-file mientras quepa <500 líneas.
- Commits: Conventional Commits en inglés.

## WebSocket protocol (overlay)

El backend emite a cada overlay conectado (mismo contrato que produce `broadcast_play_video`):
```json
{
  "event": { "source": "General", "type": "Custom" },
  "data":  { "action": "playVideo", "reward": "<name>", "user": "<name>" }
}
```
También `{ "data": { "action": "reloadConfig" } }` para recargar config en caliente al guardar.

## Testing manual

Consola de DevTools del overlay (Browser Source → Interact → F12):
- `spawnVideo("nombre del reward")` — spawnea sin Twitch.
- Botón **Probar** en el panel — dispara un reward al overlay conectado.
