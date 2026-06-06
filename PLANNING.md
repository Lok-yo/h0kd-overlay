# StreamOverlay — Planning Doc

> Sistema custom para reproducir videos en overlay de OBS disparados por canjes
> de Channel Points de Twitch. Reemplazo self-hosted de TriggerFyre.

---

## 1. Contexto y problema

TriggerFyre cumple bien la función básica pero tiene limitaciones:

- Límite de cantidad de videos en su plan free/paid.
- No permite múltiples instancias simultáneas del mismo video (spam).
- Sin control sobre layout, animaciones o safe zones.
- Producto propietario, sin extensibilidad.

**Objetivo del MVP**: tener un overlay propio funcionando localmente que supere
TriggerFyre en flexibilidad, sin dependencia de servicios externos. Se diseña
pensando en una migración futura a Cloudflare/Next.js, pero el MVP es 100% local.

---

## 2. Goals & Non-Goals

### Goals (MVP)

- Overlay HTML que se carga como Browser Source en OBS.
- Recibe canjes de Twitch vía Streamer.bot (WebSocket interno).
- Soporta múltiples instancias simultáneas del mismo video (spam ilimitado).
- Posicionamiento random dentro del canvas, respetando safe zones.
- Mapeo `reward → video(s)` configurable vía `config.json` sin tocar código.
- Random pick cuando un reward tiene varios videos asociados.
- Animaciones simples de entrada/salida.
- Hot-reload de config para iteración rápida.
- Logs claros para debug vía DevTools del browser source.

### Non-Goals (por ahora)

- Dashboard web de administración.
- Backend/persistencia.
- Multi-streamer / SaaS.
- Autenticación.
- Cloudflare / D1 / R2 (etapa 2).
- Cola con prioridades, combos, raid effects.
- Sonidos sueltos sin video (solo videos).

---

## 3. Arquitectura

```
┌─────────────┐   canje    ┌──────────────┐   broadcast   ┌─────────────┐
│   Twitch    │ ─────────► │ Streamer.bot │ ───WebSocket► │ overlay.html│
└─────────────┘            └──────────────┘   ws://:8080  │ (en OBS BS) │
                                                          └──────┬──────┘
                                                                 │
                                                                 │ lee
                                                                 ▼
                                                          ┌─────────────┐
                                                          │ config.json │
                                                          │   videos/   │
                                                          └─────────────┘
```

**Componentes**:

1. **Streamer.bot** (config externa, no es código del proyecto)
   Recibe el evento de Twitch, ejecuta una action que hace broadcast vía WS.

2. **`overlay.html`** (single-file vanilla JS)
   Cargado por OBS como Browser Source local. Se conecta al WS de Streamer.bot,
   recibe eventos custom, lee `config.json`, y spawnea elementos `<video>` en el DOM.

3. **`config.json`**
   Define mapeo `rewardName → { videos, dimensiones, volumen, etc }` y safe zones.

4. **`videos/`**
   Carpeta con los archivos `.mp4` / `.webm`.

---

## 4. Tech Stack

- **JS vanilla** (sin frameworks). El overlay es un single-file HTML que se
  carga directo en CEF/Chromium dentro de OBS. Sin build step.
- **CSS animations** para entrada/salida (sin libs).
- **Formato de video**: `.mp4` (H.264 + AAC) o `.webm` (VP9 + Opus).
  CEF soporta ambos. `.webm` es más liviano si necesitás transparencia.
- **Sin dependencias npm**. Cero build, cero bundle.

**Justificación**: el MVP debe ser editable con un text editor y refrescable con
F5. Cualquier framework agrega fricción innecesaria en esta etapa.

---

## 5. Estructura de archivos

```
stream-overlay/
├── overlay.html          # single-page con todo el JS inline
├── config.json           # mapeo rewards y safe zones
├── videos/               # archivos locales
│   ├── pop.mp4
│   ├── laugh.mp4
│   └── ...
├── CLAUDE.md             # contexto del proyecto para Claude Code
├── README.md             # instrucciones para usuario
└── .gitignore            # ignorar videos/ pesados si querés
```

**Decisión**: `overlay.html` mantiene CSS y JS inline en un solo archivo para
simplicidad. Si supera ~500 líneas, se separa en `overlay.css` y `overlay.js`.

---

## 6. Data contracts

### 6.1 `config.json` schema

```jsonc
{
  "rewards": {
    "<nombre exacto del reward de Twitch>": {
      "videos": ["videos/file1.mp4", "videos/file2.mp4"],  // 1+ paths relativos
      "width": 480,           // px en canvas
      "height": 270,          // px en canvas
      "volume": 1.0,          // 0.0 - 1.0
      "maxDuration": 8000,    // ms, safety net si el evento `ended` no dispara
      "respectSafeZones": true // opcional, default true
    }
  },
  "safeZones": {
    "exclude": [
      {
        "x": 1500, "y": 800,
        "width": 420, "height": 280,
        "name": "webcam"      // solo informativo
      }
    ]
  },
  "canvas": {
    "width": 1920,
    "height": 1080
  }
}
```

**Reglas**:

- Las claves de `rewards` deben coincidir exactamente con el `rewardName` de Twitch.
- `videos` siempre es array. Si tiene 1 elemento, ese se reproduce; si tiene
  varios, se elige random.
- Paths relativos a `overlay.html`.
- `safeZones.exclude` define rectángulos donde el video NO debe aparecer.
  El algoritmo intenta hasta 30 posiciones random; si no encuentra spot limpio,
  spawnea igual en cualquier lado (no se bloquea el canje).
- `canvas` define las dimensiones que el overlay debe asumir. Default `1920x1080`
  si está ausente.

### 6.2 WebSocket message format (Streamer.bot → overlay)

Streamer.bot emite eventos custom con esta estructura (los campos que importan):

```json
{
  "event": {
    "source": "General",
    "type": "Custom"
  },
  "data": {
    "action": "playVideo",
    "reward": "<rewardName>",
    "user": "<viewerName>"
  }
}
```

El overlay filtra por `event.source === "General"` y `event.type === "Custom"`,
y solo procesa si `data.action === "playVideo"`.

**Extensible**: futuros tipos (`playSound`, `triggerCombo`, etc) se agregan
como nuevos valores de `data.action` sin romper compat.

---

## 7. Componentes — responsabilidades

### 7.1 `overlay.html`

Responsable de:

- Conectarse al WS de Streamer.bot (con reconnect automático cada 3s).
- Suscribirse a custom events.
- Cargar `config.json` al iniciar y on-demand (tecla `R`).
- Para cada evento válido: elegir video, calcular posición, spawnear `<video>`,
  cleanup al `ended` o por timeout.
- Loguear todo a `console` (visible en DevTools del browser source).

NO responsable de:

- Hablar con Twitch directamente.
- Persistir nada.
- Validar el config exhaustivamente (warn + skip si está mal, no crashear).

### 7.2 `config.json`

Source of truth de qué se reproduce con cada reward. Editable a mano por
el streamer. **No requiere reiniciar OBS**: refresh de la Browser Source
basta, o tecla `R` mientras DevTools está abierto.

### 7.3 Streamer.bot (configuración manual, fuera del repo)

Una sola action: `Play Video Overlay`. Sub-actions:

1. Set Argument: `action` = `playVideo`
2. Set Argument: `reward` = `%rewardTitle%` (o `%rewardName%` según versión)
3. Set Argument: `user` = `%userName%`
4. WebSocket Server → Broadcast

Trigger: Twitch → Channel Point Reward Redemption (sin filtro de reward).

**Por qué sin filtro**: agregar un nuevo video debe ser solo editar
`config.json`. Si filtramos por reward en Streamer.bot, se vuelve a tocar dos
lugares por cada video nuevo.

---

## 8. Flujos clave

### 8.1 Viewer canjea un reward

1. Viewer redime "Reproducir Video Pop" en Twitch.
2. Streamer.bot recibe el evento, ejecuta action.
3. Action setea args y hace WS broadcast.
4. Overlay recibe el mensaje, parsea, busca `config.rewards["Reproducir Video Pop"]`.
5. Encuentra config → elige video random → calcula posición → spawnea `<video>`.
6. Video se reproduce, animación de entrada.
7. Al `ended` → animación de salida → `video.remove()`.

### 8.2 Streamer agrega un video nuevo

1. Copia el archivo a `videos/`.
2. Edita `config.json` agregando una entry nueva.
3. Crea el reward en Twitch con ese nombre exacto.
4. Click derecho en la Browser Source de OBS → Refresh.
5. Listo. **Sin tocar Streamer.bot ni código.**

### 8.3 Streamer debuggea

1. Click derecho en Browser Source → Interact → DevTools (F12).
2. Ve los `console.log` con cada evento.
3. Puede ejecutar `spawnVideo("nombre del reward")` manual en la consola para
   probar sin canjes reales.
4. Tecla `R` para recargar config sin refresh completo.

---

## 9. Setup externo (documentar en README)

### 9.1 Streamer.bot

- Habilitar WebSocket Server en puerto `8080` (default).
- Crear action `Play Video Overlay` con sub-actions del punto 7.3.
- Crear trigger Channel Point Reward Redemption sin filtro.

### 9.2 OBS

- Agregar Browser Source.
- Marcar **Local file** → apuntar a `overlay.html`.
- Width / Height = canvas resolution (1920×1080).
- **Desmarcar** "Shutdown source when not visible" (mantener WS abierto).
- **Desmarcar** "Refresh browser when scene becomes active".
- Colocar encima de todo lo demás en la escena.

---

## 10. Edge cases & error handling

| Situación | Comportamiento esperado |
|---|---|
| WS desconectado | Reintenta cada 3s indefinidamente, log a consola. |
| `config.json` malformado | Log error, usar `{ rewards: {} }` como fallback. NO crashear. |
| Reward sin mapeo en config | Log "Sin mapeo para reward X", ignorar. |
| Archivo de video no existe | `video.onerror` → remover elemento, log error. |
| `ended` no dispara (raro) | Safety timeout en `maxDuration` borra el elemento. |
| Sin espacio libre por safe zones | Tras 30 intentos, spawnea en cualquier posición (no bloquea el canje). |
| Múltiples canjes simultáneos | Cada uno crea su propio `<video>` independiente. Sin colas. |
| OBS recarga la source | WS reconecta solo, no se pierde estado (no hay estado). |

---

## 11. Plan de implementación (Claude Code)

### Fase 1 — Scaffolding (~15 min)
- Crear estructura de carpetas.
- `.gitignore`.
- `CLAUDE.md` con resumen del proyecto y convenciones.
- `README.md` con instrucciones de setup (Streamer.bot + OBS).
- `config.example.json` con ejemplo + un par de safe zones placeholder.

### Fase 2 — Overlay funcional (~30 min)
- `overlay.html` con todo lo del punto 7.1.
- Manejo de WS con reconnect.
- Función `spawnVideo(rewardName)` expuesta en `window` para testing manual.
- Logs claros con prefijo `[Overlay]`.

### Fase 3 — Testing local (~15 min)
- Probar conexión WS sin Streamer.bot usando un mock (puede ser un snippet
  inline o un script Node simple que abra un WS server en 8080).
- Probar `spawnVideo` desde consola.
- Verificar safe zones funcionan.

### Fase 4 — Documentación (~15 min)
- README con screenshots / pasos numerados de setup en Streamer.bot y OBS.
- Sección de troubleshooting (WS no conecta, video no aparece, sin audio, etc).

### Definition of Done para MVP

- [ ] `overlay.html` carga sin errores en OBS Browser Source.
- [ ] Se conecta al WS de Streamer.bot y se mantiene conectado.
- [ ] Reconecta solo si Streamer.bot reinicia.
- [ ] `spawnVideo()` desde consola muestra un video en posición random.
- [ ] Múltiples llamadas seguidas spawnean videos independientes (no se reemplazan).
- [ ] Videos se autoborran al terminar.
- [ ] Safe zones se respetan.
- [ ] Editar `config.json` + refresh source aplica cambios sin reiniciar OBS.
- [ ] Un canje real desde Twitch dispara el video correcto.

---

## 12. Out of scope (Etapa 2 — Cloudflare)

Cuando este MVP esté pulido y haya rodado un tiempo en stream, la evolución es:

- Dashboard Next.js (App Router) en `h0kd.art/tools/overlay` o subdominio.
- Subida de videos a R2.
- Mapeo `reward → video` en D1 con Drizzle.
- WebSocket via Durable Objects, overlay apunta a `wss://...` en lugar de localhost.
- Auth con magic link (reutilizar el de `h0kd.art`).
- Streamer.bot → HTTP POST al Worker, en lugar de WS local.
- Histórico de canjes / analytics.

**Diseñar el MVP de forma que el contrato de mensajes WS sea idéntico** entre
local (Streamer.bot WS server) y remoto (Worker WS). Así migrar es cambiar
`WS_URL` y nada más en el overlay.

---

## 13. Convenciones (para `CLAUDE.md`)

- Idioma de código: inglés (identifiers, comments, logs).
- Idioma de documentación: español neutro.
- Logs siempre con prefijo `[Overlay]` o `[WS]`.
- Sin dependencias externas. Si hace falta una util chica, se inlinea.
- Single-file mientras el código quepa razonable. Split solo si >500 líneas.
- Commits en inglés, formato Conventional Commits.

---

## 14. Preguntas abiertas (para resolver con el streamer)

- [ ] Nombre definitivo del proyecto (placeholder: `stream-overlay`).
- [ ] ¿Repo público desde el inicio o privado hasta que esté pulido?
- [ ] ¿Animaciones de entrada/salida — `pop`, `slide`, `fade`, o configurable por reward?
- [ ] ¿Sonido del video respeta volumen master del Audio Mixer de OBS o se pasa por param?
- [ ] ¿Cap máximo de videos simultáneos (defensa contra raid spam) o sin límite?
