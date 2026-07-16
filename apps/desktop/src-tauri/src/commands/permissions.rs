use serde::Deserialize;
use serde_json::json;
use tracing::info;

use crate::core::audit;
use crate::ipc::bridge::send_permission_response;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponseArgs {
    pub request_id: String,
    pub granted: bool,
    pub remember: Option<bool>,
}

/// Called from React UI when user responds to a permission dialog.
/// Forwards the decision to the Node.js agent runtime.
#[tauri::command]
pub async fn permission_respond(args: PermissionResponseArgs) -> Result<(), String> {
    info!(
        request_id = %args.request_id,
        granted = args.granted,
        "Permission response"
    );

    send_permission_response(
        &args.request_id,
        args.granted,
        args.remember.unwrap_or(false),
    )
    .await
    .map_err(|e| e.to_string())?;

    audit::log(
        "PERMISSION_DECISION",
        json!({
            "requestId": args.request_id,
            "granted": args.granted,
            "remember": args.remember.unwrap_or(false),
        }),
    );
    Ok(())
}
