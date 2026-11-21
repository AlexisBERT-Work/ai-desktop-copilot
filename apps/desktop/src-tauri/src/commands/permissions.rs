use serde::Deserialize;
use serde_json::json;
use tracing::info;

use crate::core::audit;
use crate::core::error::CatdeskError;
use crate::ipc::bridge::send_permission_response;
use crate::ipc::protocol::GrantScope;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponseArgs {
    pub request_id: String,
    pub granted: bool,
    /// Absente : `once`. Inconnue : la commande est refusée (désérialisation).
    #[serde(default)]
    pub scope: GrantScope,
}

/// Called from React UI when user responds to a permission dialog.
/// Forwards the decision to the Node.js agent runtime.
#[tauri::command]
pub async fn permission_respond(args: PermissionResponseArgs) -> Result<(), String> {
    info!(
        request_id = %args.request_id,
        granted = args.granted,
        scope = ?args.scope,
        "Permission response"
    );

    send_permission_response(&args.request_id, args.granted, args.scope)
        .await
        .map_err(|e| CatdeskError::Agent(e.to_string()))?;

    // La portée dit ce que l'utilisateur a accordé : cette fois, ce site, la
    // session. Le site lui-même est tracé par l'agent (ligne PERMISSION).
    audit::log(
        "PERMISSION_DECISION",
        json!({
            "requestId": args.request_id,
            "granted": args.granted,
            "scope": args.scope,
        }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(v: serde_json::Value) -> Result<PermissionResponseArgs, serde_json::Error> {
        serde_json::from_value(v)
    }

    #[test]
    fn portee_lue_et_once_par_defaut() {
        let site = parse(json!({ "requestId": "r", "granted": true, "scope": "site" })).unwrap();
        assert_eq!(site.scope, GrantScope::Site);
        let absent = parse(json!({ "requestId": "r", "granted": true })).unwrap();
        assert_eq!(absent.scope, GrantScope::Once);
    }

    #[test]
    fn portee_inconnue_refusee() {
        assert!(parse(json!({ "requestId": "r", "granted": true, "scope": "toujours" })).is_err());
    }
}
