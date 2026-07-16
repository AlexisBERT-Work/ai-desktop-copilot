//! Miroir Rust du contrat IPC partagé.
//!
//! La source de vérité est `packages/shared-types/src/ipc-contract.ts` ;
//! le test `mirror_matches_ts_contract` ci-dessous compare chaque constante
//! au fichier TS (`include_str!`) et casse `cargo test` à la moindre dérive.

// ─── Événements Tauri (Rust → React) ───────────────────────────
pub const EVENT_UI_OVERLAY_TOGGLE: &str = "ui:overlay-toggle";
pub const EVENT_CHAT_TOKEN: &str = "chat:token";
pub const EVENT_CHAT_DONE: &str = "chat:done";
pub const EVENT_CHAT_ERROR: &str = "chat:error";
pub const EVENT_AGENT_PLAN: &str = "agent:plan";
pub const EVENT_AGENT_TOOL_CALL: &str = "agent:tool_call";
pub const EVENT_PERMISSION_REQUEST: &str = "permission:request";
pub const EVENT_PROACTIVE_SUGGESTION: &str = "proactive:suggestion";
pub const EVENT_MARKET_UPDATE: &str = "market:update";
pub const EVENT_PRESS_FEEDS: &str = "press:feeds";
pub const EVENT_DAILIES_LOCAL: &str = "dailies:local";

// ─── Méthodes JSON-RPC hôte → agent ────────────────────────────
pub const RPC_AGENT_PROCESS: &str = "agent.process";
pub const RPC_AGENT_CANCEL: &str = "agent.cancel";
pub const RPC_PERMISSION_RESPONSE: &str = "permission.response";
pub const RPC_MARKET_SET_WATCHLIST: &str = "market.set_watchlist";
pub const RPC_PRESS_RUN_NOW: &str = "press.run_now";
pub const RPC_PRESS_FEEDS_SAVE: &str = "press.feeds.save";
pub const RPC_PRESS_FEEDS_DELETE: &str = "press.feeds.delete";
pub const RPC_PRESS_LOCAL_RUN_NOW: &str = "press.local.run_now";
pub const RPC_PRESS_LOCAL_SYNC: &str = "press.local.sync";
pub const RPC_SETTINGS_UPDATE: &str = "settings.update";

// ─── Notifications JSON-RPC agent → hôte ───────────────────────
pub const NOTIF_AGENT_STEP: &str = "agent.step";
pub const NOTIF_PERMISSION_REQUEST: &str = "permission.request";
pub const NOTIF_PROACTIVE_SUGGESTION: &str = "proactive.suggestion";
pub const NOTIF_MARKET_UPDATE: &str = "market.update";
pub const NOTIF_PRESS_FEEDS: &str = "press.feeds";
pub const NOTIF_DAILIES_LOCAL: &str = "dailies.local";

/// Enveloppe JSON-RPC 2.0 d'une requête vers l'agent (id aléatoire).
pub fn rpc_request(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "params": params,
    })
}

/// Enveloppe JSON-RPC 2.0 d'une notification (sans id, pas de réponse attendue).
pub fn rpc_notification(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS_CONTRACT: &str =
        include_str!("../../../../../packages/shared-types/src/ipc-contract.ts");

    const ALL_CONSTANTS: &[&str] = &[
        EVENT_UI_OVERLAY_TOGGLE,
        EVENT_CHAT_TOKEN,
        EVENT_CHAT_DONE,
        EVENT_CHAT_ERROR,
        EVENT_AGENT_PLAN,
        EVENT_AGENT_TOOL_CALL,
        EVENT_PERMISSION_REQUEST,
        EVENT_PROACTIVE_SUGGESTION,
        EVENT_MARKET_UPDATE,
        EVENT_PRESS_FEEDS,
        EVENT_DAILIES_LOCAL,
        RPC_AGENT_PROCESS,
        RPC_AGENT_CANCEL,
        RPC_PERMISSION_RESPONSE,
        RPC_MARKET_SET_WATCHLIST,
        RPC_PRESS_RUN_NOW,
        RPC_PRESS_FEEDS_SAVE,
        RPC_PRESS_FEEDS_DELETE,
        RPC_PRESS_LOCAL_RUN_NOW,
        RPC_PRESS_LOCAL_SYNC,
        RPC_SETTINGS_UPDATE,
        NOTIF_AGENT_STEP,
        NOTIF_PERMISSION_REQUEST,
        NOTIF_PROACTIVE_SUGGESTION,
        NOTIF_MARKET_UPDATE,
        NOTIF_PRESS_FEEDS,
        NOTIF_DAILIES_LOCAL,
    ];

    /// Chaque constante Rust doit apparaître comme littéral `'…'` dans le TS.
    #[test]
    fn mirror_matches_ts_contract() {
        for value in ALL_CONSTANTS {
            let needle = format!("'{value}'");
            assert!(
                TS_CONTRACT.contains(&needle),
                "constante Rust absente du contrat TS: {value}"
            );
        }
    }

    /// Détecte l'ajout côté TS non reflété ici : on compte les littéraux
    /// de valeur (`: '…',`) du contrat TS.
    #[test]
    fn ts_contract_has_no_extra_entries() {
        let ts_value_count = TS_CONTRACT
            .lines()
            .filter(|l| {
                let t = l.trim();
                !t.starts_with("//") && t.contains(": '") && t.ends_with("',")
            })
            .count();
        assert_eq!(
            ts_value_count,
            ALL_CONSTANTS.len(),
            "le contrat TS a {ts_value_count} entrées mais le miroir Rust en a {} — synchroniser protocol.rs",
            ALL_CONSTANTS.len()
        );
    }

    #[test]
    fn rpc_envelopes_are_wellformed() {
        let req = rpc_request(RPC_AGENT_CANCEL, serde_json::json!({}));
        assert_eq!(req["jsonrpc"], "2.0");
        assert_eq!(req["method"], "agent.cancel");
        assert!(req["id"].is_string());

        let notif = rpc_notification(NOTIF_AGENT_STEP, serde_json::json!({"x": 1}));
        assert!(notif.get("id").is_none());
        assert_eq!(notif["params"]["x"], 1);
    }
}
