# Stream Overlay

Overlay para OBS que reproduce videos cuando viewers canjean Channel Points en Twitch.
Reemplazo self-hosted de TriggerFyre — sin límite de videos, posición random, volumen por video.

---

## Requisitos

- **OBS Studio** (con Browser Source)
- **Streamer.bot** v0.1.x o superior
- Videos en formato `.mp4` (H.264 + AAC) o `.webm`

---

## Setup rápido

### 1. Archivos

```
TriggerFyreReplaceAPP/
├── overlay.html      ← cargás esto en OBS
├── config.json       ← editás esto para agregar rewards/videos
└── videos/           ← ponés tus videos acá
    ├── pop.mp4
    └── ...
```

Copiá tus videos a la carpeta `videos/`.

---

### 2. `config.json`

Editá `config.json` para mapear cada reward a sus videos:

```jsonc
{
  "rewards": {
    "Nombre exacto del reward en Twitch": {
      "videos": ["videos/mi-video.mp4"],
      "width": 480,       // ancho en px (canvas 1920×1080)
      "height": 270,      // alto en px
      "volume": 0.8,      // 0.0 a 1.0
      "maxDuration": 10000  // timeout de seguridad en ms
    }
  },
  "safeZones": {
    "exclude": [
      {
        "x": 1500, "y": 800,
        "width": 420, "height": 280,
        "name": "webcam"
      }
    ]
  },
  "canvas": { "width": 1920, "height": 1080 }
}
```

**El nombre del reward debe ser exactamente igual al de Twitch** (mayúsculas incluidas).

Si ponés varios videos en el array, se elige uno al azar en cada canje.

`safeZones.exclude` define zonas donde los videos no aparecen (ej: tu webcam).
Usá las coordenadas del canvas 1920×1080.

---

### 3. Streamer.bot

1. En Streamer.bot → **Servers/Clients** → **WebSocket Server** → habilitá en puerto `8080`.
2. Creá una nueva **Action** llamada `Play Video Overlay`.
3. Agregá estas sub-actions:
   | Tipo | Nombre | Valor |
   |------|--------|-------|
   | Set Argument | `action` | `playVideo` |
   | Set Argument | `reward` | `%rewardTitle%` |
   | Set Argument | `user`   | `%userName%` |
   | WebSocket Server | Broadcast | *(sin filtro)* |
4. Creá un **Trigger**: Twitch → Channel Point Reward Redemption → **sin filtro de reward**.

> **¿Por qué sin filtro?** Agregar un video nuevo solo requiere editar `config.json`.
> Si filtrás en Streamer.bot, tenés que tocar dos lugares por cada reward nuevo.

---

### 4. OBS

1. En tu escena → **Agregar fuente** → **Browser**.
2. Marcá **Local file** → buscá `overlay.html`.
3. Width: `1920` / Height: `1080` (o tu resolución de canvas).
4. **Desmarcá** "Shutdown source when not visible".
5. **Desmarcá** "Refresh browser when scene becomes active".
6. Poné el Browser Source **encima de todo** en la escena.

---

## Agregar un video nuevo

1. Copiá el archivo a `videos/`.
2. Editá `config.json` y agregá la entrada.
3. Creá el reward en Twitch con ese nombre exacto.
4. Click derecho en el Browser Source en OBS → **Refresh** (o usá la tecla `R` en DevTools).
5. Listo. **No hay que tocar Streamer.bot ni reiniciar OBS.**

---

## Probar sin Streamer.bot / Twitch

### Opción A — DevTools (más fácil)

1. Click derecho en el Browser Source → **Interact** → F12 para abrir DevTools.
2. En la consola ejecutá:
   ```js
   spawnVideo("Nombre exacto del reward")
   ```
3. El video aparece en posición random en el overlay.

### Opción B — Mock WS server (Node.js)

```bash
npm install ws
node mock-ws-server.js
```

El script levanta un WS server en el puerto 8080 y te pide el nombre del reward
por consola. Útil para testear el flujo completo.

---

## Troubleshooting

| Problema | Qué revisar |
|----------|-------------|
| No se conecta al WS | Streamer.bot → WebSocket Server habilitado en puerto 8080 |
| Video no aparece | Abrí DevTools → consola → ¿hay errores? Probá `spawnVideo()` manual |
| Sin audio | Asegurate de que OBS tenga el Browser Source con audio habilitado |
| Video fuera del canvas | Revisá `width`/`height` en `config.json` vs tamaño real del video |
| Overlay fondo blanco/negro | Browser Source debe tener "Allow transparency" activado (OBS lo hace por default con local files) |
| Reward no dispara | El nombre en `config.json` debe ser idéntico al de Twitch |

---

## Hot-reload de config

Con DevTools abierto en el Browser Source, presioná **`R`** para recargar `config.json`
sin refrescar la página completa. Útil mientras estás editando la config en vivo.

---

## Estructura de archivos

```
overlay.html          ← overlay principal (todo inline, sin build)
config.json           ← tu configuración
videos/               ← tus archivos .mp4 / .webm
mock-ws-server.js     ← server de prueba (opcional, requiere Node.js + ws)
CLAUDE.md             ← contexto del proyecto para Claude Code
README.md             ← este archivo
.gitignore            ← ignora videos/ en git
```
