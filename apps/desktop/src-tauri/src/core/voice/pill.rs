//! Pastille de dictée — une petite capsule en bas de l'écran qui montre que
//! le micro enregistre, puis ce qui a été tapé (ou pourquoi rien ne l'a été).
//!
//! Elle ne doit **jamais** prendre le focus : la dictée tape dans la fenêtre
//! active, et une pastille qui s'active volerait le texte. D'où :
//! - `focusable(false)` (`WS_EX_NOACTIVATE`) et `focused(false)` à la
//!   création — le premier affichage passe alors en `SW_SHOWNOACTIVATE` ;
//! - créée **une fois**, visible, et jamais masquée ni réaffichée : un
//!   `show()` ultérieur repasserait par `SW_SHOW`, qui active. Seul son
//!   contenu change (transparent au repos) ;
//! - traversée par la souris (`set_ignore_cursor_events`), hors barre des
//!   tâches, au-dessus des autres fenêtres.
//!
//! Elle n'existe que tant que la dictée est activée (désactivée par défaut),
//! et sa capacité Tauri se limite à écouter des événements
//! (`capabilities/dictation-pill.json`).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::core::error::CatdeskError;

pub const LABEL: &str = "dictation-pill";
/// Taille logique : de quoi tenir « 42 caractères tapés » avec l'icône.
const WIDTH: f64 = 280.0;
const HEIGHT: f64 = 56.0;
/// Écart au bas de la zone de travail (au-dessus de la barre des tâches).
const BOTTOM_MARGIN: f64 = 24.0;

/// Crée la pastille si elle n'existe pas encore.
pub fn ensure(app: &AppHandle) -> Result<(), CatdeskError> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("CatDesk — dictée")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(true);
    if let Some((x, y)) = position(app) {
        builder = builder.position(x, y);
    }
    let window = builder.build().map_err(|e| {
        CatdeskError::Refused(format!("Pastille de dictée impossible à créer ({e})"))
    })?;
    // Les clics la traversent : elle ne gêne jamais ce qu'il y a dessous.
    let _ = window.set_ignore_cursor_events(true);
    Ok(())
}

/// Retire la pastille (dictée désactivée). Fermer n'active aucune fenêtre.
pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

/// Bas de l'écran principal, centré, au-dessus de la barre des tâches.
fn position(app: &AppHandle) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok()??;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    Some(bottom_center(
        (f64::from(area.position.x), f64::from(area.position.y)),
        (f64::from(area.size.width), f64::from(area.size.height)),
        scale,
    ))
}

/// Coordonnées logiques du coin haut-gauche, depuis la zone de travail en
/// pixels physiques.
fn bottom_center(origin: (f64, f64), size: (f64, f64), scale: f64) -> (f64, f64) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let x = origin.0 / scale + (size.0 / scale - WIDTH) / 2.0;
    let y = origin.1 / scale + size.1 / scale - HEIGHT - BOTTOM_MARGIN;
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_pastille_est_centree_en_bas_de_la_zone_de_travail() {
        // 1920×1040 utiles (barre des tâches de 40 px), échelle 100 %.
        let (x, y) = bottom_center((0.0, 0.0), (1920.0, 1040.0), 1.0);
        assert_eq!(x, (1920.0 - WIDTH) / 2.0);
        assert_eq!(y, 1040.0 - HEIGHT - BOTTOM_MARGIN);
        // Échelle 150 % : coordonnées logiques.
        let (x, y) = bottom_center((0.0, 0.0), (2880.0, 1560.0), 1.5);
        assert_eq!(x, (1920.0 - WIDTH) / 2.0);
        assert_eq!(y, 1040.0 - HEIGHT - BOTTOM_MARGIN);
        // Écran principal décalé ; échelle absurde ramenée à 1.
        let (x, _) = bottom_center((100.0, 0.0), (1920.0, 1040.0), 0.0);
        assert_eq!(x, 100.0 + (1920.0 - WIDTH) / 2.0);
    }
}
