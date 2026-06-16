mod server;
mod twitch;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc};
use twitch::{TwitchCmd, TwitchStatus};

#[derive(Clone)]
pub struct AppState {
    pub tx: broadcast::Sender<String>,
    pub data_dir: Arc<PathBuf>,
    pub twitch: twitch::SharedStatus,
    pub twitch_cmd: mpsc::Sender<TwitchCmd>,
}

/// Broadcast a `playVideo` event to every connected overlay.
/// Single source of truth shared by the HTTP trigger, the admin "Probar"
/// button, and the Twitch EventSub listener. Returns the number of overlays.
pub fn broadcast_play_video(tx: &broadcast::Sender<String>, reward: &str, user: &str) -> usize {
    let msg = json!({
        "event": { "source": "General", "type": "Custom" },
        "data": { "action": "playVideo", "reward": reward, "user": user }
    })
    .to_string();
    tx.send(msg).unwrap_or(0)
}

fn default_config() -> Value {
    json!({
        "rewards": {},
        "safeZones": { "exclude": [] },
        "canvas": { "width": 1920, "height": 1080 }
    })
}

fn find_data_dir() -> PathBuf {
    // Search for config.json by walking up the ancestors of both the current
    // working directory and the executable's directory. This covers `tauri dev`
    // (cwd = src-tauri) as well as running the built exe directly, where the
    // binary lives several levels deep under src-tauri/target/<profile>/.
    let mut roots: Vec<PathBuf> = vec![];
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    // Walk ancestors of each root, preserving order (cwd ancestors first).
    for root in &roots {
        for ancestor in root.ancestors() {
            if ancestor.join("config.json").exists() {
                println!("[Data] Found config.json at: {}", ancestor.display());
                return ancestor.to_path_buf();
            }
        }
    }
    let fallback = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    println!(
        "[Data] No config.json found in any ancestor. Using: {}",
        fallback.display()
    );
    fallback
}

#[tauri::command]
fn get_config(state: tauri::State<AppState>) -> Value {
    let path = state.data_dir.join("config.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| default_config()),
        Err(_) => default_config(),
    }
}

#[tauri::command]
fn save_config(state: tauri::State<AppState>, cfg: Value) -> Result<(), String> {
    let pretty = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(state.data_dir.join("config.json"), pretty).map_err(|e| e.to_string())?;
    // Tell connected overlays to reload their config so size/volume/etc changes
    // apply immediately, without refreshing the OBS Browser Source.
    let _ = state.tx.send(reload_config_msg());
    Ok(())
}

/// Message that asks every connected overlay to re-fetch config.json.
fn reload_config_msg() -> String {
    json!({
        "event": { "source": "System", "type": "Custom" },
        "data": { "action": "reloadConfig" }
    })
    .to_string()
}

#[tauri::command]
fn list_videos(state: tauri::State<AppState>) -> Vec<String> {
    let dir = state.data_dir.join("videos");
    let mut files: Vec<String> = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                let lower = name.to_ascii_lowercase();
                if lower.ends_with(".mp4") || lower.ends_with(".webm") || lower.ends_with(".mov") {
                    files.push(name.to_string());
                }
            }
        }
    }
    files.sort();
    files
}

#[tauri::command]
fn trigger_reward(state: tauri::State<AppState>, reward: String, user: Option<String>) -> Value {
    let user = user.unwrap_or_default();
    let clients = broadcast_play_video(&state.tx, &reward, &user);
    println!("[Trigger] playVideo → {} | clientes: {}", reward, clients);
    json!({ "ok": true, "clients": clients })
}

// ── Twitch (standalone mode — no Streamer.bot) ───────────────────────────────

#[tauri::command]
fn twitch_status(state: tauri::State<AppState>) -> TwitchStatus {
    state.twitch.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
async fn twitch_set_client_id(
    state: tauri::State<'_, AppState>,
    client_id: String,
) -> Result<(), String> {
    let cmd = state.twitch_cmd.clone();
    cmd.send(TwitchCmd::SetClientId(client_id.trim().to_string()))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn twitch_connect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let cmd = state.twitch_cmd.clone();
    cmd.send(TwitchCmd::Connect).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn twitch_disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let cmd = state.twitch_cmd.clone();
    cmd.send(TwitchCmd::Disconnect)
        .await
        .map_err(|e| e.to_string())
}

/// Name of the OS utility that opens a file/URL with the default handler.
fn os_opener() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "explorer"
    }
    #[cfg(target_os = "macos")]
    {
        "open"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "xdg-open"
    }
}

#[tauri::command]
fn open_data_dir(state: tauri::State<AppState>) -> Result<(), String> {
    std::process::Command::new(os_opener())
        .arg(state.data_dir.as_path())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open an external URL in the system's default browser. Webview `<a target="_blank">`
/// links don't reach the OS browser, so the frontend routes clicks through this.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Only allow web URLs; never hand arbitrary strings to the OS opener.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs are allowed".into());
    }
    std::process::Command::new(os_opener())
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = Arc::new(find_data_dir());
    // Drop the initial receiver so the count reflects only real WS clients (overlay connections).
    // tx.send() will return SendError when no subscribers exist; trigger_reward handles that via unwrap_or(0).
    let (tx, _) = broadcast::channel::<String>(64);

    let twitch_shared = Arc::new(Mutex::new(TwitchStatus::default()));
    let (twitch_cmd, twitch_rx) = mpsc::channel::<TwitchCmd>(8);

    let state = AppState {
        tx: tx.clone(),
        data_dir: data_dir.clone(),
        twitch: twitch_shared,
        twitch_cmd,
    };

    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |_| {
            let server_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start(server_state).await {
                    eprintln!("[Server] failed to start: {}", e);
                }
            });
            // Twitch EventSub worker: lets the app run without Streamer.bot.
            let twitch_state = state.clone();
            tauri::async_runtime::spawn(twitch::worker_loop(twitch_state, twitch_rx));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            list_videos,
            trigger_reward,
            open_data_dir,
            open_url,
            twitch_status,
            twitch_set_client_id,
            twitch_connect,
            twitch_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
