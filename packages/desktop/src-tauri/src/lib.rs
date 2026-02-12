mod auth;
mod java;
mod launcher;

use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct AppState {
    backend_child: Mutex<Option<CommandChild>>,
}

fn spawn_backend(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data dir");
    std::fs::create_dir_all(&data_dir)?;

    let sidecar = app
        .shell()
        .sidecar("binaries/mc-backend")
        .expect("Failed to create sidecar command")
        .env("TAURI_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("NODE_ENV", "production")
        .env("PORT", "3001");

    let (mut rx, child) = sidecar.spawn()?;

    let state = app.state::<AppState>();
    *state.backend_child.lock().unwrap() = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    log::error!(
                        "Backend process terminated: code={:?} signal={:?}",
                        payload.code,
                        payload.signal
                    );
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            backend_child: Mutex::new(None),
        })
        .manage(auth::AuthState::new())
        .manage(launcher::LauncherState::new())
        .invoke_handler(tauri::generate_handler![
            auth::ms_auth_start,
            auth::ms_auth_poll,
            auth::ms_auth_refresh,
            auth::get_mc_access_token,
            auth::remove_account,
            java::get_java_installations,
            java::download_java,
            launcher::launch_game,
            launcher::get_running_games,
            launcher::kill_game,
        ])
        .setup(|app| {
            if std::env::var("TAURI_DEV_BACKEND_EXTERNAL").is_err() {
                spawn_backend(app.handle())?;
            }

            let show_item =
                MenuItemBuilder::with_id("show", "Show Window").build(app)?;
            let quit_item =
                MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("MC Server Manager")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let state = app.state::<AppState>();
                        if let Some(child) = state.backend_child.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                        app.exit(0);
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
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
