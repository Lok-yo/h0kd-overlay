mod server;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub tx: broadcast::Sender<String>,
    pub data_dir: Arc<PathBuf>,
}

fn default_config() -> Value {
    json!({
        "rewards": {},
        "safeZones": { "exclude": [] },
        "canvas": { "width": 1920, "height": 1080 }
    })
}

fn find_data_dir() -> PathBuf {
    // Priority: cwd → exe parent → cwd parent (dev case: cwd = src-tauri)
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.to_path_buf());
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }
    for cand in &candidates {
        if cand.join("config.json").exists() {
            println!("[Data] Found config.json at: {}", cand.display());
            return cand.clone();
        }
    }
    let fallback = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    println!(
        "[Data] No config.json found in candidates. Using: {}",
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
    std::fs::write(state.data_dir.join("config.json"), pretty).map_err(|e| e.to_string())
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
    let msg = json!({
        "event": { "source": "General", "type": "Custom" },
        "data": { "action": "playVideo", "reward": reward, "user": user }
    })
    .to_string();
    let clients = state.tx.send(msg).unwrap_or(0);
    println!("[Trigger] playVideo → {} | clientes: {}", reward, clients);
    json!({ "ok": true, "clients": clients })
}

#[tauri::command]
fn open_data_dir(state: tauri::State<AppState>) -> Result<(), String> {
    let path = state.data_dir.as_path();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        return Err("unsupported platform".into());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = Arc::new(find_data_dir());
    // Drop the initial receiver so the count reflects only real WS clients (overlay connections).
    // tx.send() will return SendError when no subscribers exist; trigger_reward handles that via unwrap_or(0).
    let (tx, _) = broadcast::channel::<String>(64);

    let state = AppState {
        tx: tx.clone(),
        data_dir: data_dir.clone(),
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            list_videos,
            trigger_reward,
            open_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
