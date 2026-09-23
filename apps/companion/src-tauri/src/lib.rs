use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    mode: String,
    state: String,
    phase: Option<String>,
    player_name: Option<String>,
    overlay_url: Option<String>,
    overlay_visible: bool,
    error: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadConfigResult {
    configured: bool,
    mode: Option<String>,
    api_base: Option<String>,
}

struct AppState {
    engine: Mutex<Option<Child>>,
    last_overlay_url: Mutex<Option<String>>,
}

fn config_dir() -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var("CUSTOMS_NIGHT_CONFIG_DIR") {
        if !override_dir.trim().is_empty() {
            return Ok(PathBuf::from(override_dir.trim()));
        }
    }
    let base = dirs_next_appdata()?;
    Ok(base.join("customs-night"))
}

fn dirs_next_appdata() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA is not set".to_string())?;
        Ok(PathBuf::from(appdata))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        let xdg = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{}/.config", home));
        Ok(PathBuf::from(xdg))
    }
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

fn status_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("status.json"))
}

fn logs_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("logs"))
}

fn companion_root() -> PathBuf {
    // src-tauri/ -> apps/companion
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn path_has(file: &std::path::Path) -> bool {
    file.is_file()
}

/// Windows `CreateProcess` does not resolve `.cmd` / `.ps1` the way a shell does.
fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|p| path_has(p))
}

fn node_exe() -> Result<PathBuf, String> {
    if let Ok(from_env) = std::env::var("CUSTOMS_NIGHT_NODE") {
        let p = PathBuf::from(from_env);
        if path_has(&p) {
            return Ok(p);
        }
    }
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join("node.exe"));
            candidates.push(dir.join("node"));
        }
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(pf).join("nodejs").join("node.exe"));
    }
    candidates.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
    first_existing(candidates).ok_or_else(|| {
        "node.exe not found. Install Node, or set CUSTOMS_NIGHT_NODE to node.exe.".into()
    })
}

fn tsx_cli(root: &std::path::Path) -> Result<PathBuf, String> {
    first_existing([
        root.join("node_modules").join("tsx").join("dist").join("cli.mjs"),
        root.join("..")
            .join("..")
            .join("node_modules")
            .join("tsx")
            .join("dist")
            .join("cli.mjs"),
    ])
    .ok_or_else(|| {
        format!(
            "tsx not found under {}. Run pnpm install in the repo.",
            root.display()
        )
    })
}

fn sidecar_engine(app: Option<&AppHandle>) -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("CUSTOMS_NIGHT_ENGINE") {
        let p = PathBuf::from(override_path);
        if path_has(&p) {
            return Some(p);
        }
    }
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
        }
    }
    if let Some(app) = app {
        if let Ok(dir) = app.path().resource_dir() {
            dirs.push(dir);
        }
    }
    dirs.push(companion_root().join("dist"));
    for dir in dirs {
        let named = dir.join("kustom-engine.exe");
        if path_has(&named) {
            return Some(named);
        }
    }
    None
}

fn engine_command(app: &AppHandle) -> Result<(Command, PathBuf), String> {
    if let Some(sidecar) = sidecar_engine(Some(app)) {
        let workdir = sidecar
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let mut cmd = Command::new(&sidecar);
        cmd.current_dir(workdir).env("CUSTOMS_NIGHT_TAURI", "1");
        return Ok((cmd, sidecar));
    }

    let root = companion_root()
        .canonicalize()
        .unwrap_or_else(|_| companion_root());
    let node = node_exe()?;
    let tsx = tsx_cli(&root)?;
    let mut cmd = Command::new(&node);
    cmd.current_dir(&root)
        .arg(&tsx)
        .arg("src/main.ts")
        .env("CUSTOMS_NIGHT_TAURI", "1");
    Ok((cmd, node))
}

#[tauri::command]
fn load_app_config() -> Result<LoadConfigResult, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(LoadConfigResult {
            configured: false,
            mode: None,
            api_base: Some("https://kustom-delta.vercel.app".into()),
        });
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("config is not JSON: {e}"))?;
    let mode = value
        .get("mode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            if value.get("companionToken").and_then(|v| v.as_str()).is_some() {
                Some("host".into())
            } else {
                None
            }
        });
    let api_base = value
        .get("apiBase")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let configured = match mode.as_deref() {
        Some("overlay") => api_base.is_some(),
        Some("host") => value
            .get("companionToken")
            .and_then(|v| v.as_str())
            .map(|t| t.len() == 43)
            .unwrap_or(false),
        _ => false,
    };
    Ok(LoadConfigResult {
        configured,
        mode,
        api_base,
    })
}

#[tauri::command]
fn save_app_config(
    mode: String,
    api_base: String,
    companion_token: Option<String>,
) -> Result<(), String> {
    let dir = config_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let api = api_base.trim().trim_end_matches('/').to_string();
    if !api.starts_with("http://") && !api.starts_with("https://") {
        return Err("apiBase must be an http(s) origin".into());
    }
    let body = match mode.as_str() {
        "overlay" => json!({
            "mode": "overlay",
            "apiBase": api,
        }),
        "host" => {
            let token = companion_token
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .ok_or_else(|| "Host mode needs a companion token".to_string())?;
            if token.len() != 43 {
                return Err("That does not look like a token from the admin page (expected 43 characters).".into());
            }
            json!({
                "mode": "host",
                "apiBase": api,
                "companionToken": token,
            })
        }
        _ => return Err("mode must be host or overlay".into()),
    };
    fs::write(
        config_path()?,
        format!("{}\n", serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_engine_status() -> Result<Option<EngineStatus>, String> {
    let path = status_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let status: EngineStatus = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(Some(status))
}

fn spawn_engine(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
        if let Some(child) = slot.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(()); // already running
            }
        }
        *slot = None;
    }

    let (mut cmd, program) = engine_command(app)?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start engine ({}): {e}", program.display()))?;

    if let Some(stdout) = child.stdout.take() {
        let handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Some(url) = line.strip_prefix("OVERLAY_READY ") {
                    let url = url.trim().to_string();
                    let _ = open_overlay_window(&handle, &url);
                }
            }
        });
    }

    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    *slot = Some(child);
    Ok(())
}

fn open_overlay_window(app: &AppHandle, url: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let mut last = state.last_overlay_url.lock().map_err(|e| e.to_string())?;
        if last.as_deref() == Some(url) {
            if let Some(window) = app.get_webview_window("overlay") {
                let _ = window.show();
                return Ok(());
            }
        }
        *last = Some(url.to_string());
    }

    if let Some(existing) = app.get_webview_window("overlay") {
        let _ = existing.close();
    }

    let parsed = url
        .parse()
        .map_err(|e| format!("bad overlay url: {e}"))?;
    WebviewWindowBuilder::new(app, "overlay", WebviewUrl::External(parsed))
        .title("Kustom")
        .inner_size(420.0, 720.0)
        .resizable(true)
        .always_on_top(true)
        .decorations(true)
        .skip_taskbar(false)
        .build()
        .map_err(|e| format!("overlay window: {e}"))?;
    Ok(())
}

#[tauri::command]
fn start_engine(app: AppHandle) -> Result<(), String> {
    spawn_engine(&app)
}

#[tauri::command]
fn stop_engine(state: State<AppState>) -> Result<(), String> {
    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn open_logs() -> Result<(), String> {
    let path = logs_path()?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn show_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let _ = stop_engine(state);
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            engine: Mutex::new(None),
            last_overlay_url: Mutex::new(None),
        })
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _ = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Kustom")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        if let Some(state) = app.try_state::<AppState>() {
                            let _ = stop_engine(state);
                        }
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Show setup on first launch; hide to tray after start is the user's choice.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_config,
            save_app_config,
            read_engine_status,
            start_engine,
            stop_engine,
            open_logs,
            show_window,
            hide_window,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
