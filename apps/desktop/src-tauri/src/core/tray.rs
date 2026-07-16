use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager,
};
use tracing::info;

pub fn setup_tray(app: &mut App) -> anyhow::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show/Hide CatDesk", true, None::<&str>)?;
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle, &separator, &quit])?;

    // Embed the tray icon at compile time so it always shows, regardless of the
    // process working directory or whether the app was bundled.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../icons/32x32.png"))?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("CatDesk — clic pour ouvrir (Ctrl+Shift+Space)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("ui:overlay-toggle", ());
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("ui:overlay-toggle", ());
                }
            }
            "quit" => {
                info!("Quit from tray");
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    info!("System tray configured");
    Ok(())
}
