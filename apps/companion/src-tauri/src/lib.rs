//! Kustom (M17.8): one Tauri 2 app with the host engine in-process. The window and the tray are drawn from
//! [`model`]; [`app::App`] owns the state and talks to the engine through [`host_api::Host`]. This file is
//! only the Tauri glue: plugins, the window's events, the tray, and the commands the webview calls.
//!
//! Plugins: single-instance (a second launch focuses the first; two engines on one PC would share one
//! queue), autostart (Start with Windows, on by default), dialog (the League folder picker), opener (Open
//! logs, Open Tonight), updater (signed updates from `latest.json`, [`updater`]).

pub mod app;
pub mod copy;
pub mod folder;
pub mod host_api;
pub mod link;
pub mod model;
pub mod tray_icon;
pub mod updater;
pub mod window;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use engine::api::transport::{
    BoxFuture as TransportFuture, HttpRequest, HttpResponse, ReqwestTransport, Transport,
};
use engine::config::{SystemProcessProbe, load_config};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::DialogExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::app::{App, Shell};
use crate::host_api::{BoxFuture, Host, HostBoot};
use crate::model::{FolderOrigin, TrayModel, View};
use crate::updater::{Schedule, TauriUpdater, UpdateSource};
use crate::window::{AUTOSTART_ARG, WindowOps};

/// The event the webview listens to for a new [`View`].
pub const VIEW_EVENT: &str = "kustom://view";
const TRAY_ID: &str = "main";
const WINDOW: &str = "main";
/// Written once Start with Windows has been turned on by default, so turning it off sticks.
const AUTOSTART_MARKER: &str = "autostart-default-applied";

struct TauriWindow<'a>(&'a WebviewWindow);

impl WindowOps for TauriWindow<'_> {
    fn show(&self) {
        let _ = self.0.show();
    }
    fn hide(&self) {
        let _ = self.0.hide();
    }
    fn unminimize(&self) {
        let _ = self.0.unminimize();
    }
    fn focus(&self) {
        let _ = self.0.set_focus();
    }
}

fn with_window(app: &AppHandle, f: impl FnOnce(&TauriWindow<'_>)) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        f(&TauriWindow(&window));
    }
}

fn open_window(app: &AppHandle) {
    with_window(app, |w| window::open(w));
    if let Some(state) = app.try_state::<Arc<App>>() {
        state.window_shown();
    }
}

/// The platform side of [`App`].
struct TauriShell {
    app: AppHandle,
}

/// The display scale the tray is drawn at: the window's monitor, else the primary monitor, else 1.
fn tray_scale(app: &AppHandle) -> f64 {
    app.get_webview_window(WINDOW)
        .and_then(|w| w.scale_factor().ok())
        .or_else(|| app.primary_monitor().ok().flatten().map(|m| m.scale_factor()))
        .unwrap_or(1.0)
}

/// Hands the tray the ICO frame that matches the scale (16, 20, 24 or 32 px), never a downsampled one.
fn apply_tray_icon(app: &AppHandle, not_recording: bool) {
    let Some(icon) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Some(frame) = tray_icon::frame_for(not_recording, tray_scale(app)) {
        let _ = icon.set_icon(Some(Image::new_owned(frame.rgba, frame.width, frame.height)));
    }
}

impl TauriShell {
    fn build_menu(&self, tray: &TrayModel) -> tauri::Result<Menu<tauri::Wry>> {
        let app = &self.app;
        let menu = Menu::new(app)?;
        menu.append(&MenuItem::with_id(
            app,
            "line1",
            &tray.line1,
            false,
            None::<&str>,
        )?)?;
        if let Some(line2) = &tray.line2 {
            menu.append(&MenuItem::with_id(app, "line2", line2, false, None::<&str>)?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        if let Some(groups) = &tray.groups {
            let submenu = Submenu::with_id(app, "switch", copy::SWITCH_GROUP, true)?;
            for group in groups {
                submenu.append(&CheckMenuItem::with_id(
                    app,
                    format!("group:{}", group.id),
                    &group.label,
                    true,
                    group.checked,
                    None::<&str>,
                )?)?;
            }
            menu.append(&submenu)?;
        }
        menu.append(&MenuItem::with_id(
            app,
            "open",
            copy::TRAY_OPEN,
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "logs",
            copy::OPEN_LOGS,
            true,
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&CheckMenuItem::with_id(
            app,
            "autostart",
            copy::START_WITH_WINDOWS,
            true,
            tray.autostart,
            None::<&str>,
        )?)?;
        if let Some(restart) = &tray.restart {
            menu.append(&MenuItem::with_id(app, "restart", restart, true, None::<&str>)?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(
            app,
            "quit",
            copy::TRAY_QUIT,
            true,
            None::<&str>,
        )?)?;
        Ok(menu)
    }

    fn tray_icon(&self) -> Option<TrayIcon> {
        self.app.tray_by_id(TRAY_ID)
    }
}

impl Shell for TauriShell {
    fn render(&self, view: &View) {
        let _ = self.app.emit_to(WINDOW, VIEW_EVENT, view);
    }

    fn tray(&self, tray: &TrayModel) {
        let Some(icon) = self.tray_icon() else { return };
        match self.build_menu(tray) {
            Ok(menu) => {
                let _ = icon.set_menu(Some(menu));
            }
            Err(error) => tracing::warn!(component = "tray", %error, "could not build the tray menu"),
        }
        let _ = icon.set_tooltip(Some(&tray.tooltip));
        apply_tray_icon(&self.app, tray.not_recording);
    }

    fn open_url(&self, url: &str) {
        if let Err(error) = self.app.opener().open_url(url, None::<&str>) {
            tracing::warn!(component = "app", %error, "could not open the browser");
        }
    }

    fn open_path(&self, path: &Path) {
        if let Err(error) = self.app.opener().open_path(path.to_string_lossy(), None::<&str>) {
            tracing::warn!(component = "app", %error, "could not open the folder");
        }
    }

    fn pick_folder(&self, title: &str, start: PathBuf) -> BoxFuture<'static, Option<PathBuf>> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let mut dialog = self.app.dialog().file().set_title(title).set_directory(start);
        if let Some(window) = self.app.get_webview_window(WINDOW) {
            dialog = dialog.set_parent(&window);
        }
        dialog.pick_folder(move |picked| {
            let _ = tx.send(picked.and_then(|p| p.into_path().ok()));
        });
        Box::pin(async move { rx.await.ok().flatten() })
    }

    fn autostart(&self) -> Option<bool> {
        self.app.autolaunch().is_enabled().ok()
    }

    fn set_autostart(&self, on: bool) -> Option<bool> {
        let manager = self.app.autolaunch();
        let result = if on { manager.enable() } else { manager.disable() };
        if let Err(error) = result {
            tracing::warn!(component = "app", %error, "could not change Start with Windows");
        }
        manager.is_enabled().ok()
    }

    fn exit(&self) {
        self.app.exit(0);
    }
}

/// When the HTTP client cannot be built (it never fails in practice), every call is a network error and the
/// window says so; the app keeps running.
struct NoTransport(String);

impl Transport for NoTransport {
    fn send(&self, _request: HttpRequest) -> TransportFuture<'_, Result<HttpResponse, String>> {
        let message = self.0.clone();
        Box::pin(async move { Err(message) })
    }
}

/// Start with Windows is on by default (decision row 2026-10-04): applied once, on the first start of a
/// release build on Windows, so a person who turns it off keeps it off.
fn apply_default_autostart(app: &AppHandle, config_dir: &Path) {
    if !cfg!(windows) || cfg!(debug_assertions) {
        return;
    }
    let marker = config_dir.join(AUTOSTART_MARKER);
    if marker.exists() {
        return;
    }
    if let Err(error) = app.autolaunch().enable() {
        tracing::warn!(component = "app", %error, "could not turn on Start with Windows");
        return;
    }
    let _ = std::fs::create_dir_all(config_dir);
    let _ = std::fs::write(&marker, b"1\n");
}

// --- Commands (the webview's buttons) --------------------------------------------------------------------

type AppState<'a> = State<'a, Arc<App>>;

#[tauri::command]
fn get_view(app: AppState<'_>) -> View {
    app.view()
}

#[tauri::command]
fn link_input(app: AppState<'_>, raw: String) -> String {
    app.link_input(&raw)
}

#[tauri::command]
async fn link_submit(app: AppState<'_>, code: String) -> Result<(), ()> {
    let app = app.inner().clone();
    app.link_submit(code).await;
    Ok(())
}

#[tauri::command]
fn link_open(app: AppState<'_>) {
    app.link_open();
}

#[tauri::command]
fn link_back(app: AppState<'_>) {
    app.link_back();
}

#[tauri::command]
async fn choose_group(app: AppState<'_>, id: String) -> Result<(), ()> {
    let app = app.inner().clone();
    app.choose_group(id).await;
    Ok(())
}

#[tauri::command]
async fn pick_folder(app: AppState<'_>, origin: String) -> Result<(), ()> {
    let app = app.inner().clone();
    let origin = if origin == "change" {
        FolderOrigin::Change
    } else {
        FolderOrigin::Browse
    };
    app.pick_folder(origin).await;
    Ok(())
}

#[tauri::command]
async fn try_again(app: AppState<'_>) -> Result<(), ()> {
    let app = app.inner().clone();
    app.try_again().await;
    Ok(())
}

#[tauri::command]
async fn retry_old_engine(app: AppState<'_>) -> Result<(), ()> {
    let app = app.inner().clone();
    app.retry_old_engine().await;
    Ok(())
}

#[tauri::command]
fn open_tonight(app: AppState<'_>) {
    app.open_tonight();
}

#[tauri::command]
fn open_logs(app: AppState<'_>) {
    app.open_logs();
}

#[tauri::command]
fn set_autostart(app: AppState<'_>, on: bool) {
    app.set_autostart(on);
}

#[tauri::command]
fn restart_now(app: AppState<'_>) {
    app.restart_now();
}

/// Esc in the webview.
#[tauri::command]
fn hide_window(window: WebviewWindow, app: AppState<'_>) {
    window::on_close_requested(&TauriWindow(&window));
    app.window_hidden();
}

fn on_menu(handle: &AppHandle, id: &str) {
    let Some(app) = handle.try_state::<Arc<App>>().map(|s| s.inner().clone()) else {
        return;
    };
    match id {
        "open" => open_window(handle),
        "logs" => app.open_logs(),
        "autostart" => {
            let on = !app.model().autostart;
            app.set_autostart(on);
        }
        "restart" => app.restart_now(),
        "quit" => {
            tauri::async_runtime::spawn(async move { app.quit().await });
        }
        other => {
            if let Some(group) = other.strip_prefix("group:") {
                let group = group.to_owned();
                tauri::async_runtime::spawn(async move { app.choose_group(group).await });
            }
        }
    }
}

/// Runs Kustom.
pub fn run() {
    let config_dir = engine::config::config_dir().unwrap_or_else(|| PathBuf::from("."));
    if let Err(error) = engine::log::init(&config_dir) {
        eprintln!("{error}");
    }
    let version = env!("CARGO_PKG_VERSION").to_owned();
    tracing::info!(component = "app", version = %version, "Kustom starting");
    let args: Vec<String> = std::env::args().collect();

    let built = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            with_window(app, |w| window::on_second_instance(w));
            if let Some(state) = app.try_state::<Arc<App>>() {
                state.window_shown();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Only Rust talks to it: the capability grants the webview no updater command.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_view,
            link_input,
            link_submit,
            link_open,
            link_back,
            choose_group,
            pick_folder,
            try_again,
            retry_old_engine,
            open_tonight,
            open_logs,
            set_autostart,
            restart_now,
            hide_window,
        ])
        .setup(move |tauri_app| {
            let handle = tauri_app.handle().clone();
            apply_default_autostart(&handle, &config_dir);
            let transport: Arc<dyn Transport> = match ReqwestTransport::new() {
                Ok(transport) => Arc::new(transport),
                Err(error) => {
                    tracing::error!(component = "app", %error, "could not build the HTTP client");
                    Arc::new(NoTransport(error))
                }
            };
            let api_base = load_config(&config_dir)
                .config()
                .map_or_else(|| engine::config::DEFAULT_API_BASE.to_owned(), |c| c.api_base);

            let first = tray_icon::frame_for(true, tray_scale(&handle))
                .ok_or("the tray icon could not be decoded")?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(Image::new_owned(first.rgba, first.width, first.height))
                .tooltip(copy::TOOLTIP_NOT_LINKED)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        open_window(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
                .build(tauri_app)?;

            let options = engine::host::HostOptions::new(
                config_dir.clone(),
                transport.clone(),
                Arc::new(SystemProcessProbe),
                version.clone(),
            );
            let handle_host = tauri::async_runtime::block_on(async { engine::host::start(options) });
            let host: Arc<dyn Host> = Arc::new(handle_host);
            let shell = Arc::new(TauriShell { app: handle.clone() });
            let updater = Arc::new(TauriUpdater::new(handle.clone(), host.clone()));
            let app = App::new(
                &version,
                config_dir.clone(),
                host.clone(),
                shell,
                updater.clone(),
                transport,
                api_base,
            );
            tauri_app.manage(app.clone());
            updater.bind(&app);
            tauri::async_runtime::spawn(app.clone().follow());
            let source: Arc<dyn UpdateSource> = updater;
            tauri::async_runtime::spawn(updater::run(app.clone(), source, Schedule::default()));

            // Show the window once boot has settled (at most 3 s), unless Start with Windows launched it
            // and Kustom does not need the person.
            let args = args.clone();
            tauri::async_runtime::spawn(async move {
                let mut status = host.status();
                let _ = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    status.wait_for(|s| s.boot != HostBoot::Starting),
                )
                .await;
                if window::show_at_start(&args, app.view().screen) {
                    open_window(&handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::ScaleFactorChanged { .. } = event {
                // A new display scale: pick the tray frame again.
                if let Some(state) = window.app_handle().try_state::<Arc<App>>() {
                    let not_recording = !state.model().recording();
                    apply_tray_icon(window.app_handle(), not_recording);
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                if let Some(state) = window.app_handle().try_state::<Arc<App>>() {
                    state.window_hidden();
                }
            }
        })
        .build(tauri::generate_context!());
    let app = match built {
        Ok(app) => app,
        Err(error) => {
            tracing::error!(component = "app", %error, "Kustom could not start");
            return;
        }
    };
    app.run(|_handle, event| {
        // The window only hides; the process ends from Quit (app.exit), never because no window is shown.
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}
