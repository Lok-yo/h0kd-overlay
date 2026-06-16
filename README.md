# Stream Overlay

Overlay para OBS que reproduce videos cuando tus viewers canjean **Channel Points** en Twitch.
Self-hosted y sin servicios externos — sin límite de videos, posición random, volumen por video,
múltiples instancias simultáneas del mismo video.

Es una app de escritorio (Tauri) con un **panel de control nativo** que se conecta
**directo a Twitch** vía EventSub. No necesitás Streamer.bot ni ningún otro programa.

---

## Requisitos

- **Windows** (`.exe` / instalador) o **macOS** (`.app` / `.dmg`)
- **OBS Studio** (con Browser Source)
- Una cuenta de Twitch (te conectás con un click — no hace falta registrar nada)
- Videos en formato `.mp4` (H.264 + AAC) o `.webm` (VP9 + Opus)

---

## Instalación

1. Descargá el instalador para tu sistema desde **Releases** y ejecutalo.
2. Abrí la app. Se abre el panel de control y arranca un server local en `http://localhost:3001`.

> La app guarda tu configuración y videos en una carpeta propia de tu usuario
> (Windows: `%APPDATA%\Stream Overlay`, macOS: `~/Library/Application Support/Stream Overlay`).
> El botón **Carpeta** del panel la abre directamente.

---

## Conectar con Twitch

1. En el panel de control, panel **"Twitch"** (arriba a la izquierda) → **Conectar con Twitch**.
2. La app muestra un **código**. Andá a **https://www.twitch.tv/activate**, ingresalo y autorizá
   (te pide permiso `channel:read:redemptions` para leer tus canjes).
3. El panel cambia a **✓ Conectado como `<tu usuario>`**. Listo.

El token queda guardado local a tu máquina, así que **la próxima vez se reconecta solo**.
A partir de acá, cada canje de Channel Points dispara el video correspondiente automáticamente.

> **Avanzado:** podés usar tu propia Twitch App (Client Type *Public*) con el botón
> "Usar mi propio Client ID". Normalmente no hace falta — la app trae uno compartido.

---

## Configurar rewards y videos

1. Copiá tus videos a la carpeta `videos/`.
2. En el panel de control → **Rewards** → **+ Nuevo**. Configurá:
   - **Nombre del reward:** debe coincidir **exactamente** con el título del reward en Twitch
     (mayúsculas incluidas — Twitch manda el `reward.title`).
   - **Videos:** elegí uno o más de la carpeta `videos/`.
   - **Modo de reproducción** (cuando hay varios videos):
     - *Aleatorio* (por defecto): se reproduce **1 al azar** por canje.
     - *Todos a la vez*: se reproducen **todos** juntos, cada uno en su propia posición aleatoria.
   - **Volumen** y **ancho/alto** (caja máxima — el video mantiene su aspect ratio).
   - **Duración máxima** (en segundos, mostrada como `m:ss`): se autocompleta con la
     duración real del video y **no deja superarla** (así los videos no se cortan).
     Reducila si querés que el clip corte antes.
   - **Respetar safe zones** (que el video no aparezca sobre tu webcam, etc.).
3. **Safe Zones:** definí rectángulos (x, y, ancho, alto) donde los videos no deben aparecer.
4. **Canvas:** la resolución de tu escena (por defecto 1920×1080).
5. Click **Guardar config.json**.

> También podés editar `config.json` a mano (el botón **Carpeta** abre la ubicación).

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

## Troubleshooting

| Problema | Qué revisar |
|----------|-------------|
| "Suscripción rechazada" | Autorizá con tu cuenta de broadcaster (la que tiene los Channel Points) |
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
