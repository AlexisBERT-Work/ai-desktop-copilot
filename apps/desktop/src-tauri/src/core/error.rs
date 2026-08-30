//! Erreurs du cœur Rust, rendues en français.
//!
//! Les commandes Tauri renvoient `Result<T, String>` (contrat IPC), et le
//! réflexe `.map_err(|e| e.to_string())` faisait remonter tel quel le texte de
//! l'OS ou d'anyhow dans une UI francophone — « The system cannot find the path
//! specified. (os error 3) ». Ce type interpose une phrase compréhensible tout
//! en conservant le détail technique entre parenthèses pour le diagnostic.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CatdeskError {
    /// Le sidecar agent n'est pas démarré, ou son canal stdin est fermé.
    #[error("L'agent ne répond pas ({0})")]
    Agent(String),

    /// Ollama injoignable ou en erreur.
    #[error("Ollama est injoignable ({0})")]
    Ollama(String),

    /// Réponse d'un service reçue mais illisible.
    #[error("Réponse illisible du service ({0})")]
    Parse(String),

    /// Lecture/écriture disque.
    #[error("Erreur d'accès au fichier ({0})")]
    Io(String),

    /// Refus délibéré (validation, garde-fou) — le message est DÉJÀ en français
    /// et se suffit à lui-même, on ne le réhabille pas.
    #[error("{0}")]
    Refused(String),
}

impl From<CatdeskError> for String {
    fn from(err: CatdeskError) -> Self {
        err.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::CatdeskError;

    #[test]
    fn les_messages_sont_en_francais_et_gardent_le_detail() {
        let msg: String = CatdeskError::Io("os error 3".into()).into();
        assert_eq!(msg, "Erreur d'accès au fichier (os error 3)");
    }

    #[test]
    fn refused_ne_rehabille_pas_un_message_deja_francais() {
        let msg: String = CatdeskError::Refused("Commande bloquée par politique".into()).into();
        assert_eq!(msg, "Commande bloquée par politique");
    }
}
