use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn ready() -> String {
    "ready".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            // For now, just navigate to about:blank
            // When sidecar is ready, we'll parse stdout and navigate to the URL
            // TODO: Start sidecar and parse URL from stdout
            window.eval("console.log('Kustom Overlay ready')")?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ready])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
