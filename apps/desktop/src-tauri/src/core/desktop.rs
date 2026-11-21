//! Fenêtres Windows lues par l'arbre d'accessibilité (UI Automation) plutôt
//! que par capture + OCR, et quelques actions bornées sur elles (LIMITES.md § 1).
//!
//! Demandé par les outils `read_window` et `window_action` de l'agent
//! (notification `desktop.request`, réponse `desktop.response`) : l'agent ne
//! touche pas aux API natives, tout passe par ici.
//!
//! - **Entrées validées** (`parse_request`) : action connue, fenêtre désignée par
//!   un id ou un titre de 200 caractères au plus, sans caractère de contrôle.
//! - **Fenêtres éligibles** seulement : visibles, de premier niveau, ni outils ni
//!   masquées (bureaux virtuels), jamais celles de CatDesk. Un id hors de cette
//!   liste est refusé, quel qu'il soit.
//! - **Lecture bornée** : 600 éléments visités, 80 lignes rendues, 4 000
//!   caractères, 3 s de parcours, 2 s par appel UI Automation (une appli figée
//!   ne bloque pas). La valeur d'un champ mot de passe n'est jamais lue.
//! - **Actions** : premier plan, réduire, agrandir, restaurer, demande de
//!   fermeture (`WM_CLOSE` : l'appli peut proposer d'enregistrer), sur une
//!   fenêtre désignée sans ambiguïté (`single_window`). Aucune frappe, aucun
//!   clic dans la fenêtre.
//! - **Audit** après succès : appli et nombre d'éléments pour une lecture (pas
//!   le contenu), appli et titre pour une action.

use serde_json::{json, Value};

/// Longueur maximale d'un titre recherché.
pub const MAX_WINDOW_QUERY: usize = 200;
/// Fenêtres listées au plus.
pub const MAX_WINDOWS: usize = 40;
/// Lignes d'éléments rendues au plus (veille du 15/11 : ~800 tokens par fenêtre).
pub const MAX_ELEMENTS: usize = 80;
/// Caractères rendus au plus pour la liste d'éléments.
pub const MAX_OUTPUT_CHARS: usize = 4_000;
/// Caractères gardés d'une valeur (champ, liste…).
pub const MAX_VALUE_CHARS: usize = 200;
/// Caractères gardés du texte d'un document (Bloc-notes, Word…).
pub const MAX_DOCUMENT_CHARS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowAction {
    Focus,
    Minimize,
    Maximize,
    Restore,
    Close,
}

impl WindowAction {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "focus" => Some(Self::Focus),
            "minimize" => Some(Self::Minimize),
            "maximize" => Some(Self::Maximize),
            "restore" => Some(Self::Restore),
            "close" => Some(Self::Close),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::Minimize => "minimize",
            Self::Maximize => "maximize",
            Self::Restore => "restore",
            Self::Close => "close",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowTarget {
    Id(isize),
    Title(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopRequest {
    ListWindows,
    ReadWindow(WindowTarget),
    Act(WindowTarget, WindowAction),
}

/// Une fenêtre éligible, telle que la voit l'agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowInfo {
    pub id: isize,
    pub title: String,
    pub app: String,
}

impl WindowInfo {
    pub fn to_json(&self) -> Value {
        json!({ "id": self.id, "titre": self.title, "appli": self.app })
    }
}

fn parse_target(params: &Value) -> Result<WindowTarget, String> {
    match params.get("window") {
        Some(Value::Number(n)) => n
            .as_i64()
            .filter(|id| *id > 0)
            .and_then(|id| isize::try_from(id).ok())
            .map(WindowTarget::Id)
            .ok_or_else(|| "Identifiant de fenêtre invalide.".to_string()),
        Some(Value::String(raw)) => {
            let query = raw.trim();
            if query.is_empty() {
                return Err("Fenêtre à désigner : titre, appli ou id.".into());
            }
            if query.chars().count() > MAX_WINDOW_QUERY {
                return Err(format!(
                    "Titre de fenêtre trop long ({MAX_WINDOW_QUERY} caractères au plus)."
                ));
            }
            if query.chars().any(char::is_control) {
                return Err("Titre de fenêtre invalide (caractère de contrôle).".into());
            }
            match query.parse::<isize>() {
                Ok(id) if id > 0 => Ok(WindowTarget::Id(id)),
                _ => Ok(WindowTarget::Title(query.to_string())),
            }
        }
        _ => Err("Fenêtre à désigner : titre, appli ou id.".into()),
    }
}

/// Valide une demande de l'agent. Rien n'est exécuté si elle est refusée ici.
pub fn parse_request(action: &str, params: &Value) -> Result<DesktopRequest, String> {
    match action {
        "list_windows" => Ok(DesktopRequest::ListWindows),
        "read_window" => parse_target(params).map(DesktopRequest::ReadWindow),
        "window_action" => {
            let target = parse_target(params)?;
            let raw = params.get("action").and_then(Value::as_str).unwrap_or("");
            let action = WindowAction::parse(raw).ok_or_else(|| {
                "Action inconnue (focus, minimize, maximize, restore ou close).".to_string()
            })?;
            Ok(DesktopRequest::Act(target, action))
        }
        _ => Err(format!("Opération native inconnue : {action}")),
    }
}

/// Fenêtre visée parmi les éligibles, plus les autres qui correspondaient
/// (deux fenêtres au même titre : l'agent peut redemander par id).
pub fn pick_window(
    windows: &[WindowInfo],
    target: &WindowTarget,
) -> Result<(WindowInfo, Vec<WindowInfo>), String> {
    match target {
        WindowTarget::Id(id) => windows
            .iter()
            .find(|w| w.id == *id)
            .map(|w| (w.clone(), Vec::new()))
            .ok_or_else(|| {
                "Aucune fenêtre ouverte avec cet id (read_window sans fenêtre donne la liste)."
                    .to_string()
            }),
        WindowTarget::Title(query) => {
            let q = query.to_lowercase();
            let mut matches = windows.iter().filter(|w| {
                let app = w.app.to_lowercase();
                w.title.to_lowercase().contains(&q) || app.trim_end_matches(".exe") == q
            });
            let first = matches.next().cloned().ok_or_else(|| {
                format!(
                    "Aucune fenêtre ouverte ne correspond à « {query} » (read_window sans fenêtre donne la liste)."
                )
            })?;
            Ok((first, matches.take(5).cloned().collect()))
        }
    }
}

/// Une action ne se fait que sur une fenêtre désignée sans ambiguïté : fermer
/// « la première » de deux fenêtres au même titre pourrait viser la mauvaise.
/// La lecture, elle, prend la première et signale les autres.
pub fn single_window(windows: &[WindowInfo], target: &WindowTarget) -> Result<WindowInfo, String> {
    let (window, others) = pick_window(windows, target)?;
    if others.is_empty() {
        return Ok(window);
    }
    let candidates: Vec<String> = std::iter::once(&window)
        .chain(others.iter())
        .map(|w| format!("{} « {} » ({})", w.id, clip(&w.title, 60), w.app))
        .collect();
    Err(format!(
        "Plusieurs fenêtres correspondent : {}. Rien n'a été fait : préciser le titre ou passer l'id.",
        candidates.join(" ; ")
    ))
}

/// Coupe à `max` caractères (pas octets), en le marquant.
pub fn clip(text: &str, max: usize) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max {
        return one_line;
    }
    let mut out: String = one_line.chars().take(max).collect();
    out.push('…');
    out
}

/// Nom français d'un type de contrôle UI Automation, ou `None` pour ceux qui
/// n'apprennent rien au modèle (barres de défilement, séparateurs, poignées…).
pub fn control_kind(control_type: i32) -> Option<&'static str> {
    Some(match control_type {
        50000 => "bouton",
        50001 => "calendrier",
        50002 => "case à cocher",
        50003 => "liste déroulante",
        50004 => "champ",
        50005 => "lien",
        50006 => "image",
        50007 => "élément",
        50008 => "liste",
        50009 => "menu",
        50010 => "barre de menus",
        50011 => "menu",
        50012 => "progression",
        50013 => "bouton radio",
        50015 => "curseur",
        50016 => "compteur",
        50017 => "barre d'état",
        50018 => "onglets",
        50019 => "onglet",
        50020 => "texte",
        50021 => "barre d'outils",
        50022 => "info-bulle",
        50023 => "arbre",
        50024 => "nœud",
        50025 => "élément",
        50026 => "groupe",
        50028 => "grille",
        50029 => "ligne",
        50030 => "document",
        50031 => "bouton",
        50032 => "fenêtre",
        50033 => "volet",
        50034 => "en-tête",
        50035 => "colonne",
        50036 => "tableau",
        50040 => "barre d'appli",
        // 50014 barre de défilement, 50027 poignée, 50037 barre de titre
        // (redit le titre), 50038 séparateur : rien d'utile.
        _ => return None,
    })
}

/// Un élément lu dans l'arbre, avant rendu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElementInfo {
    pub control_type: i32,
    pub name: String,
    pub value: Option<String>,
    pub enabled: bool,
}

/// Liste numérotée, compacte, dédoublonnée et bornée. Renvoie aussi `true` si
/// elle a été coupée.
pub fn render_elements(elements: &[ElementInfo]) -> (String, usize, bool) {
    let mut lines: Vec<String> = Vec::new();
    let mut chars = 0usize;
    let mut previous: Option<(String, Option<String>)> = None;
    let mut truncated = false;
    for el in elements {
        let Some(kind) = control_kind(el.control_type) else {
            continue;
        };
        let max_value = if el.control_type == 50030 {
            MAX_DOCUMENT_CHARS
        } else {
            MAX_VALUE_CHARS
        };
        let name = clip(&el.name, MAX_VALUE_CHARS);
        let value = el
            .value
            .as_deref()
            .map(|v| clip(v, max_value))
            .filter(|v| !v.is_empty() && *v != name);
        if name.is_empty() && value.is_none() {
            continue;
        }
        let key = (name.clone(), value.clone());
        if previous.as_ref() == Some(&key) {
            continue;
        }
        previous = Some(key);
        if lines.len() >= MAX_ELEMENTS {
            truncated = true;
            break;
        }
        let mut line = format!("{}. {kind}", lines.len() + 1);
        if !name.is_empty() {
            line.push_str(&format!(" « {name} »"));
        }
        if let Some(v) = &value {
            line.push_str(&format!(" = « {v} »"));
        }
        if !el.enabled {
            line.push_str(" (désactivé)");
        }
        if chars + line.len() > MAX_OUTPUT_CHARS {
            truncated = true;
            break;
        }
        chars += line.len() + 1;
        lines.push(line);
    }
    let count = lines.len();
    (lines.join("\n"), count, truncated)
}

/// Exécute une demande validée. Bloquant (UI Automation) : à lancer hors de
/// la boucle async. Audit après succès seulement.
pub fn execute(request: DesktopRequest) -> Result<Value, String> {
    native::execute(request)
}

#[cfg(windows)]
mod native {
    use super::*;
    use crate::core::audit;
    use std::ffi::c_void;
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW, SetForegroundWindow,
        ShowWindow, GWL_EXSTYLE, GW_OWNER, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, WM_CLOSE,
        WS_EX_TOOLWINDOW,
    };

    use windows::core::Interface;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomation2, IUIAutomationCacheRequest,
        IUIAutomationElement, IUIAutomationTextPattern, IUIAutomationTreeWalker,
        IUIAutomationValuePattern, UIA_ControlTypePropertyId, UIA_IsEnabledPropertyId,
        UIA_IsOffscreenPropertyId, UIA_IsPasswordPropertyId, UIA_NamePropertyId, UIA_TextPatternId,
        UIA_ValuePatternId, UIA_ValueValuePropertyId,
    };

    const MAX_VISITED: usize = 600;
    const MAX_DEPTH: usize = 30;
    const WALK_BUDGET: Duration = Duration::from_secs(3);
    const UIA_TIMEOUT_MS: u32 = 2_000;
    const DOCUMENT: i32 = 50030;
    const EDIT: i32 = 50004;

    pub fn execute(request: DesktopRequest) -> Result<Value, String> {
        match request {
            DesktopRequest::ListWindows => {
                let windows = eligible_windows();
                let total = windows.len();
                let listed: Vec<Value> = windows
                    .iter()
                    .take(MAX_WINDOWS)
                    .map(WindowInfo::to_json)
                    .collect();
                audit::log("DESKTOP_LIST_WINDOWS", json!({ "count": total }));
                Ok(json!({ "fenetres": listed, "total": total }))
            }
            DesktopRequest::ReadWindow(target) => {
                let (window, others) = pick_window(&eligible_windows(), &target)?;
                let elements = read_tree(window.id)?;
                let (text, count, truncated) = render_elements(&elements.items);
                audit::log(
                    "DESKTOP_READ_WINDOW",
                    json!({ "app": window.app, "elements": count, "visited": elements.visited }),
                );
                let mut out = json!({
                    "fenetre": window.to_json(),
                    "elements": if text.is_empty() { "(aucun élément lisible : appli sans accessibilité, essayer ocr_region)".to_string() } else { text },
                });
                if truncated || elements.cut {
                    out["coupe"] = json!(true);
                }
                if !others.is_empty() {
                    out["autres_fenetres"] =
                        Value::Array(others.iter().map(WindowInfo::to_json).collect());
                }
                Ok(out)
            }
            DesktopRequest::Act(target, action) => {
                let window = single_window(&eligible_windows(), &target)?;
                act(&window, action)?;
                audit::log(
                    "DESKTOP_WINDOW_ACTION",
                    json!({ "action": action.as_str(), "app": window.app, "title": clip(&window.title, 80) }),
                );
                Ok(json!({ "fenetre": window.to_json(), "action": action.as_str(), "fait": true }))
            }
        }
    }

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> i32 {
        let handles = &mut *(lparam as *mut Vec<isize>);
        handles.push(hwnd as isize);
        1
    }

    /// Fenêtres de premier niveau visibles, dans l'ordre de superposition.
    fn eligible_windows() -> Vec<WindowInfo> {
        let mut handles: Vec<isize> = Vec::new();
        unsafe { EnumWindows(Some(collect), &mut handles as *mut Vec<isize> as LPARAM) };
        let own_pid = unsafe { GetCurrentProcessId() };
        handles
            .into_iter()
            .filter_map(|h| describe(h, own_pid))
            .collect()
    }

    fn describe(id: isize, own_pid: u32) -> Option<WindowInfo> {
        let hwnd = id as HWND;
        unsafe {
            if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
                return None;
            }
            if (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW != 0 {
                return None;
            }
            // Fenêtre « masquée » : appli UWP suspendue, autre bureau virtuel.
            let mut cloaked: u32 = 0;
            let hr = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED as u32,
                &mut cloaked as *mut u32 as *mut c_void,
                std::mem::size_of::<u32>() as u32,
            );
            if hr == 0 && cloaked != 0 {
                return None;
            }
        }
        let title = window_title(hwnd);
        if title.trim().is_empty() {
            return None;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid == own_pid {
            return None;
        }
        Some(WindowInfo {
            id,
            title,
            app: process_name(pid).unwrap_or_default(),
        })
    }

    fn window_title(hwnd: HWND) -> String {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; (len as usize).min(511) + 1];
        let copied = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..copied.max(0) as usize])
    }

    fn process_name(pid: u32) -> Option<String> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return None;
        }
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len) };
        unsafe { CloseHandle(process) };
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().map(str::to_string)
    }

    fn act(window: &WindowInfo, action: WindowAction) -> Result<(), String> {
        let hwnd = window.id as HWND;
        unsafe {
            match action {
                WindowAction::Focus => {
                    if IsIconic(hwnd) != 0 {
                        ShowWindow(hwnd, SW_RESTORE);
                    }
                    if SetForegroundWindow(hwnd) == 0 {
                        return Err(
                            "Windows a refusé de passer cette fenêtre au premier plan.".into()
                        );
                    }
                }
                WindowAction::Minimize => {
                    ShowWindow(hwnd, SW_MINIMIZE);
                }
                WindowAction::Maximize => {
                    ShowWindow(hwnd, SW_MAXIMIZE);
                }
                WindowAction::Restore => {
                    ShowWindow(hwnd, SW_RESTORE);
                }
                WindowAction::Close => {
                    if PostMessageW(hwnd, WM_CLOSE, 0, 0) == 0 {
                        return Err(
                            "Fermeture refusée par Windows (appli lancée en administrateur ?)."
                                .into(),
                        );
                    }
                }
            }
        }
        Ok(())
    }

    /// COM initialisé pour ce fil le temps d'une lecture.
    struct ComScope(bool);

    impl Drop for ComScope {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub struct TreeRead {
        pub items: Vec<ElementInfo>,
        pub visited: usize,
        pub cut: bool,
    }

    fn uia_error(e: windows::core::Error) -> String {
        format!("Lecture de la fenêtre impossible ({})", e.message())
    }

    fn read_tree(id: isize) -> Result<TreeRead, String> {
        let _com = ComScope(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok());
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
                .map_err(uia_error)?;
        // Une appli figée ne doit pas bloquer la lecture : 2 s par appel.
        if let Ok(bounded) = automation.cast::<IUIAutomation2>() {
            unsafe {
                let _ = bounded.SetConnectionTimeout(UIA_TIMEOUT_MS);
                let _ = bounded.SetTransactionTimeout(UIA_TIMEOUT_MS);
            }
        }
        let cache: IUIAutomationCacheRequest =
            unsafe { automation.CreateCacheRequest() }.map_err(uia_error)?;
        for property in [
            UIA_NamePropertyId,
            UIA_ControlTypePropertyId,
            UIA_IsOffscreenPropertyId,
            UIA_IsEnabledPropertyId,
            UIA_IsPasswordPropertyId,
            UIA_ValueValuePropertyId,
        ] {
            unsafe { cache.AddProperty(property) }.map_err(uia_error)?;
        }
        unsafe { cache.AddPattern(UIA_ValuePatternId) }.map_err(uia_error)?;
        let walker: IUIAutomationTreeWalker =
            unsafe { automation.ControlViewWalker() }.map_err(uia_error)?;
        let root = unsafe {
            automation.ElementFromHandleBuildCache(
                windows::Win32::Foundation::HWND(id as *mut c_void),
                &cache,
            )
        }
        .map_err(uia_error)?;
        // Fenêtre réduite : tout y est « hors écran », ne rien filtrer.
        let filter_offscreen = !unsafe { root.CachedIsOffscreen() }
            .map(|b| b.as_bool())
            .unwrap_or(false);

        let started = Instant::now();
        let mut items = Vec::new();
        let mut visited = 0usize;
        let mut cut = false;
        let mut stack: Vec<(IUIAutomationElement, usize)> = vec![(root, 0)];
        while let Some((element, depth)) = stack.pop() {
            visited += 1;
            if visited > MAX_VISITED || started.elapsed() > WALK_BUDGET {
                cut = true;
                break;
            }
            let offscreen = unsafe { element.CachedIsOffscreen() }
                .map(|b| b.as_bool())
                .unwrap_or(false);
            if filter_offscreen && offscreen && depth > 0 {
                continue;
            }
            if depth > 0 {
                items.push(element_info(&element));
            }
            if depth >= MAX_DEPTH {
                continue;
            }
            // Enfants empilés à l'envers : on les dépile dans l'ordre du document.
            let mut children = Vec::new();
            let mut child = unsafe { walker.GetFirstChildElementBuildCache(&element, &cache) }.ok();
            while let Some(current) = child {
                if children.len() + visited >= MAX_VISITED {
                    cut = true;
                    break;
                }
                let next = unsafe { walker.GetNextSiblingElementBuildCache(&current, &cache) }.ok();
                children.push((current, depth + 1));
                child = next;
            }
            stack.extend(children.into_iter().rev());
        }
        Ok(TreeRead {
            items,
            visited,
            cut,
        })
    }

    fn element_info(element: &IUIAutomationElement) -> ElementInfo {
        let name = unsafe { element.CachedName() }
            .map(|b| b.to_string())
            .unwrap_or_default();
        let control_type = unsafe { element.CachedControlType() }
            .map(|c| c.0)
            .unwrap_or(0);
        let enabled = unsafe { element.CachedIsEnabled() }
            .map(|b| b.as_bool())
            .unwrap_or(true);
        let password = unsafe { element.CachedIsPassword() }
            .map(|b| b.as_bool())
            .unwrap_or(false);
        let value = if password {
            None
        } else {
            let from_pattern = unsafe {
                element.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            }
            .ok()
            .and_then(|p| unsafe { p.CachedValue() }.ok())
            .map(|b| b.to_string())
            .filter(|v| !v.is_empty());
            // Bloc-notes, Word… : le texte vient du motif Text, pas de Value.
            from_pattern.or_else(|| {
                if control_type != DOCUMENT && control_type != EDIT {
                    return None;
                }
                unsafe {
                    element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                }
                .ok()
                .and_then(|p| unsafe { p.DocumentRange() }.ok())
                .and_then(|r| unsafe { r.GetText((MAX_DOCUMENT_CHARS + 1) as i32) }.ok())
                .map(|b| b.to_string())
            })
        };
        ElementInfo {
            control_type,
            name,
            value,
            enabled,
        }
    }
}

#[cfg(not(windows))]
mod native {
    use super::*;

    pub fn execute(_request: DesktopRequest) -> Result<Value, String> {
        Err("Lecture des fenêtres : Windows uniquement.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(id: isize, title: &str, app: &str) -> WindowInfo {
        WindowInfo {
            id,
            title: title.into(),
            app: app.into(),
        }
    }

    #[test]
    fn valide_les_demandes_et_refuse_le_reste() {
        assert_eq!(
            parse_request("list_windows", &Value::Null),
            Ok(DesktopRequest::ListWindows)
        );
        assert_eq!(
            parse_request("read_window", &json!({ "window": "Bloc-notes" })),
            Ok(DesktopRequest::ReadWindow(WindowTarget::Title(
                "Bloc-notes".into()
            )))
        );
        assert_eq!(
            parse_request("read_window", &json!({ "window": "132456" })),
            Ok(DesktopRequest::ReadWindow(WindowTarget::Id(132456)))
        );
        assert_eq!(
            parse_request("window_action", &json!({ "window": 42, "action": "close" })),
            Ok(DesktopRequest::Act(
                WindowTarget::Id(42),
                WindowAction::Close
            ))
        );
        assert!(
            parse_request("window_action", &json!({ "window": 42, "action": "kill" })).is_err()
        );
        assert!(parse_request("send_keys", &json!({ "window": 42 })).is_err());
        assert!(parse_request("read_window", &json!({})).is_err());
        assert!(parse_request("read_window", &json!({ "window": "  " })).is_err());
        assert!(parse_request("read_window", &json!({ "window": -3 })).is_err());
        assert!(parse_request("read_window", &json!({ "window": "a\u{7}b" })).is_err());
        assert!(parse_request("read_window", &json!({ "window": "x".repeat(201) })).is_err());
    }

    #[test]
    fn choisit_la_fenetre_par_id_titre_ou_appli() {
        let windows = [
            win(1, "Sans titre - Bloc-notes", "notepad.exe"),
            win(2, "Calculatrice", "CalculatorApp.exe"),
            win(3, "notes.txt - Bloc-notes", "notepad.exe"),
        ];
        let (w, others) = pick_window(&windows, &WindowTarget::Title("bloc-notes".into())).unwrap();
        assert_eq!(w.id, 1);
        assert_eq!(others.iter().map(|o| o.id).collect::<Vec<_>>(), vec![3]);
        let (w, _) = pick_window(&windows, &WindowTarget::Title("calculatorapp".into())).unwrap();
        assert_eq!(w.id, 2);
        let (w, _) = pick_window(&windows, &WindowTarget::Id(3)).unwrap();
        assert_eq!(w.title, "notes.txt - Bloc-notes");
        // Un id qui n'est pas une fenêtre éligible est refusé, quel qu'il soit.
        assert!(pick_window(&windows, &WindowTarget::Id(999)).is_err());
        assert!(pick_window(&windows, &WindowTarget::Title("Paint".into())).is_err());
    }

    #[test]
    fn une_action_refuse_une_fenetre_ambigue() {
        let windows = [
            win(1, "Sans titre - Bloc-notes", "notepad.exe"),
            win(2, "Calculatrice", "CalculatorApp.exe"),
            win(3, "notes.txt - Bloc-notes", "notepad.exe"),
        ];
        let err = single_window(&windows, &WindowTarget::Title("bloc-notes".into())).unwrap_err();
        assert!(err.contains("Rien n'a été fait"), "{err}");
        assert!(err.contains("1 « Sans titre - Bloc-notes »") && err.contains("3 « notes.txt"));
        assert_eq!(single_window(&windows, &WindowTarget::Id(3)).unwrap().id, 3);
        assert_eq!(
            single_window(&windows, &WindowTarget::Title("calculatrice".into()))
                .unwrap()
                .id,
            2
        );
    }

    #[test]
    fn rend_une_liste_numerotee_compacte_et_dedoublonnee() {
        let el = |control_type, name: &str, value: Option<&str>, enabled| ElementInfo {
            control_type,
            name: name.into(),
            value: value.map(str::to_string),
            enabled,
        };
        let (text, count, truncated) = render_elements(&[
            el(50000, "Enregistrer", None, true),
            el(50014, "Barre verticale", None, true), // barre de défilement : ignorée
            el(50007, "Fichier A", None, true),
            el(50020, "Fichier A", None, true), // texte qui redit l'élément : ignoré
            el(50004, "Recherche", Some("chat   roux"), true),
            el(50026, "", None, true), // groupe sans nom : ignoré
            el(50000, "Supprimer", None, false),
        ]);
        assert_eq!(
            text,
            "1. bouton « Enregistrer »\n2. élément « Fichier A »\n3. champ « Recherche » = « chat roux »\n4. bouton « Supprimer » (désactivé)"
        );
        assert_eq!(count, 4);
        assert!(!truncated);
    }

    #[test]
    fn borne_le_nombre_de_lignes_et_la_taille() {
        let many: Vec<ElementInfo> = (0..500)
            .map(|i| ElementInfo {
                control_type: 50007,
                name: format!("élément {i}"),
                value: None,
                enabled: true,
            })
            .collect();
        let (_, count, truncated) = render_elements(&many);
        assert_eq!(count, MAX_ELEMENTS);
        assert!(truncated);

        let long = vec![ElementInfo {
            control_type: 50030,
            name: "Document".into(),
            value: Some("mot ".repeat(5_000)),
            enabled: true,
        }];
        let (text, _, _) = render_elements(&long);
        assert!(text.chars().count() < MAX_DOCUMENT_CHARS + 100);
    }

    /// Sur un vrai bureau : `cargo test -- --ignored lit_les_fenetres_du_poste`.
    /// `CATDESK_UIA_WINDOW=<titre>` lit cette fenêtre plutôt que la première ;
    /// `CATDESK_UIA_CLOSE=1` lui demande ensuite de se fermer.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn lit_les_fenetres_du_poste() {
        let listed = execute(DesktopRequest::ListWindows).expect("liste");
        println!("{listed:#}");
        let target = match std::env::var("CATDESK_UIA_WINDOW") {
            Ok(title) => WindowTarget::Title(title),
            Err(_) => WindowTarget::Id(
                listed["fenetres"][0]["id"]
                    .as_i64()
                    .expect("au moins une fenêtre") as isize,
            ),
        };
        let read = execute(DesktopRequest::ReadWindow(target.clone())).expect("lecture");
        println!("{read:#}");
        if std::env::var("CATDESK_UIA_CLOSE").as_deref() == Ok("1") {
            let closed =
                execute(DesktopRequest::Act(target, WindowAction::Close)).expect("fermeture");
            println!("{closed:#}");
        }
    }
}
