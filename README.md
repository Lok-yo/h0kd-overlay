# Stream Overlay

Overlay para OBS que reproduce videos cuando tus viewers canjean **Channel Points** en Twitch.
Reemplazo self-hosted de TriggerFyre — sin límite de videos, posición random, volumen por video,
múltiples instancias simultáneas del mismo video.

Es una app de escritorio (Tauri) con un **panel de control nativo**. Se puede usar de dos formas:

- **Modo standalone (recomendado):** la app se conecta **directo a Twitch** vía EventSub.
  No necesitás Streamer.bot.
- **Modo Streamer.bot (opcional):** si ya usás Streamer.bot, podés seguir disparando por HTTP.

---

## Requisitos

- **Windows** (`.exe` / instalador) o **macOS** (`.app` / `.dmg`)
- **OBS Studio** (con Browser Source)
- Una **Twitch Application** propia (Client ID) — gratis, se crea una sola vez (ver más abajo)
- Videos en formato `.mp4` (H.264 + AAC) o `.webm` (VP9 + Opus)

---

## Instalación

1. Descargá / generá `stream-overlay.exe`.
2. Dejá al lado del `.exe` (en la misma carpeta) estos elementos:
   ```
   stream-overlay.exe
   config.json        ← tu configuración (rewards → videos)
   videos/            ← tus archivos de video
   ```
3. Doble click en el `.exe`. Se abre el panel de control y arranca un server local en `http://localhost:3001`.

> La app busca `config.json` en su propia carpeta (y carpetas superiores), así que mantené
> el `.exe`, `config.json` y `videos/` juntos.

---

## Setup de Twitch (modo standalone)

### 1. Crear tu Twitch Application (una sola vez)

1. Andá a **https://dev.twitch.tv/console/apps** → **Register Your Application**.
2. Completá:
   - **Name:** cualquier nombre único (ej: `mi-overlay`).
   - **OAuth Redirect URLs:** `https://localhost` → click **Add**.
     *(No se usa realmente con Device Code Flow, pero el formulario lo exige.)*
   - **Category:** cualquiera (ej: *Application Integration*).
   - **Client Type:** **Public** ✅ *(importante)*.
3. Click **Create** → entrá a la app → copiá el **Client ID**.
   *(El Client Secret NO se necesita.)*

### 2. Conectar la app

1. En el panel de control, panel **"Twitch"** (arriba a la izquierda).
2. Pegá el **Client ID** → **Guardar Client ID**.
3. Click **Conectar con Twitch**.
4. La app muestra un **código**. Andá a **https://www.twitch.tv/activate**, ingresalo y autorizá
   (te pide permiso `channel:read:redemptions` para leer tus canjes).
5. El panel cambia a **✓ Conectado como `<tu usuario>`**. Listo.

El token queda guardado (`twitch.json`, local a tu máquina), así que **la próxima vez se reconecta solo**.
A partir de acá, cada canje de Channel Points dispara el video correspondiente automáticamente.

---

## Configurar rewards y videos

1. Copiá tus videos a la carpeta `videos/`.
2. En el panel de control → **Rewards** → **+ Nuevo**. Configurá:
   - **Nombre del reward:** debe coincidir **exactamente** con el título del reward en Twitch
     (mayúsculas incluidas — Twitch manda el `reward.title`).
   - **Videos:** elegí uno o más de la carpeta `videos/`. Si hay varios, se elige uno al azar por canje.
   - **Volumen**, **ancho/alto** (caja máxima — el video mantiene su aspect ratio), **duración máxima**.
   - **Respetar safe zones** (que el video no aparezca sobre tu webcam, etc.).
3. **Safe Zones:** definí rectángulos (x, y, ancho, alto) donde los videos no deben aparecer.
4. **Canvas:** la resolución de tu escena (por defecto 1920×1080).
5. Click **Guardar config.json**.

> También podés editar `config.json` a mano (botón **📁 Carpeta** abre la ubicación).

---

## OBS

1. En tu escena → **Agregar fuente** → **Browser**.
2. **NO** marques "Local file". En **URL** poné:
   ```
   http://localhost:3001/overlay
   ```
3. Width: `1920` / Height: `1080` (o tu resolución de canvas).
4. **Desmarcá** "Shutdown source when not visible".
5. **Desmarcá** "Refresh browser when scene becomes active".
6. Poné el Browser Source **encima de todo** en la escena.

> La app tiene que estar abierta para que el overlay funcione (sirve el `/overlay` y el WebSocket).

---

## Probar un reward

En el panel de control, arriba: elegí un reward en el desplegable y click **▶ Probar**.
Si el overlay está conectado en OBS, vas a ver el video. (Si dice "⚠ Sin overlay conectado",
revisá que el Browser Source apunte a `http://localhost:3001/overlay` y que la app esté abierta.)

---

## Modo Streamer.bot (opcional)

Si preferís usar Streamer.bot en vez del modo standalone, el endpoint HTTP sigue activo:

1. Creá una **Action** con un sub-action **Fetch URL** (HTTP GET) a:
   ```
   http://localhost:3001/api/trigger?reward=%rewardName%&user=%userName%
   ```
2. **Trigger:** Twitch → Channel Point Reward Redemption (sin filtro de reward).

La Fetch URL está disponible para copiar en el footer del panel de control.

---

## Troubleshooting

| Problema | Qué revisar |
|----------|-------------|
| El panel Twitch pide Client ID de nuevo | Asegurate de haber guardado el Client ID y de que la Twitch App sea **Public** |
| "Suscripción rechazada" | El Client ID debe ser de una app **Public** y autorizaste con tu cuenta de broadcaster |
| El canje no dispara video | El nombre del reward en el panel debe ser **idéntico** al de Twitch (mayúsculas incluidas) |
| "Sin overlay conectado" al probar | El Browser Source debe apuntar a `http://localhost:3001/overlay` y la app estar abierta |
| Video no aparece | Verificá que el archivo exista en `videos/` (el panel marca ⚠ si falta) |
| Sin audio | El Browser Source de OBS debe tener audio habilitado; revisá el volumen del reward |
| Sesión expirada | Reconectá desde el panel Twitch (Conectar → activar código de nuevo) |

---

## Para desarrolladores

Multiplataforma: se desarrolla y compila tanto en **Windows** como en **macOS**.

**Requisitos comunes:** [Rust](https://rustup.rs) y el Tauri CLI:

```bash
cargo install tauri-cli --version "^2"   # provee `cargo tauri`
```

- **Windows:** Microsoft C++ Build Tools (o Visual Studio con "Desktop development with C++") + WebView2 (viene con Windows 10/11).
- **macOS:** Xcode Command Line Tools (`xcode-select --install`). WebKit viene con el sistema.

```bash
cd src-tauri

# Correr en modo dev (abre el panel + server en :3001)
cargo tauri dev      # o, sin el CLI: cargo run

# Generar bundles para el SO actual
cargo tauri build
#   Windows → src-tauri/target/release/bundle/{nsis,msi}/
#   macOS   → src-tauri/target/release/bundle/{macos/*.app, dmg/*.dmg}
```

> Cada plataforma genera **solo** sus propios instaladores (no hay cross-compile).
> En macOS los bundles no van firmados/notarizados: para uso local andan; al
> compartirlos, la primera vez se abren con click derecho → **Abrir**.

Estructura:

```
src-tauri/src/lib.rs      ← Tauri commands + arranque
src-tauri/src/server.rs   ← server axum (HTTP + WebSocket) en :3001
src-tauri/src/twitch.rs   ← OAuth Device Code Flow + cliente EventSub
src/control.html          ← panel de control (UI nativa)
src/overlay.html          ← overlay servido en /overlay (embebido)
config.json               ← configuración de rewards
videos/                   ← videos (ignorados en git)
```

Datos locales (no se commitean): `twitch.json` (tokens OAuth), `videos/`.
