//! Machine à états de la voix — pure, sans audio, donc testable.
//!
//! Deux threads (écoute, parole) partagent un seul état ; chacun n'applique
//! que les transitions de son domaine et ignore le reste. Le tableau ci-dessous
//! est la seule source de vérité : un thread ne change jamais l'état « à la
//! main ». Règle de fond : **l'assistant ne parle jamais par-dessus
//! l'utilisateur** — une phrase à dire qui arrive pendant l'écoute est jetée.
//!
//! La dictée (`Ctrl+Alt+Espace` maintenu) a son propre état, `Dictating` :
//! le micro reste ouvert tant que la touche est tenue, sans fin de tour au
//! silence, et rien de la bulle ne l'interrompt. Au relâchement, elle passe
//! par `Transcribing` comme une question, mais finit en texte tapé dans
//! l'application active ([`Action::InsertText`]) au lieu d'un message au modèle.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceState {
    Idle,
    Listening,
    Transcribing,
    Speaking,
    /// Raccourci de dictée maintenu : le micro enregistre jusqu'au relâchement.
    Dictating,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Input {
    // — domaine écoute —
    ListenStart,
    ListenStop,
    /// Le VAD a clos une prise de parole.
    SegmentReady,
    /// Personne n'a parlé dans le délai imparti.
    NoSpeechTimeout,
    /// Le STT a fini (texte vide ou non).
    TranscriptReady,
    // — domaine dictée —
    /// Raccourci de dictée enfoncé.
    DictateStart,
    /// Raccourci relâché (ou plafond de durée atteint).
    DictateEnd,
    /// Micro impossible à ouvrir, modèles absents : on rend la main.
    DictateCancel,
    /// Le STT de la dictée a fini (texte vide ou non).
    DictationReady,
    // — domaine parole —
    SpeakRequested,
    SpeechFinished,
    SpeakStop,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    OpenMic,
    CloseMic,
    RunStt,
    EmitTranscript,
    /// Vide la file et le tampon de lecture.
    StopPlayback,
    /// La phrase reçue ne doit pas être dite (on écoute l'utilisateur).
    DropSentence,
    /// Taper le texte dicté dans la fenêtre qui avait le focus à l'appui.
    InsertText,
}

/// Applique `input` à `state` : nouvel état + actions à exécuter, dans l'ordre.
pub fn step(state: VoiceState, input: Input) -> (VoiceState, Vec<Action>) {
    use Action::*;
    use Input::*;
    use VoiceState::*;

    match (state, input) {
        // ── Écoute ──
        (Idle, ListenStart) | (Speaking, ListenStart) => (Listening, vec![OpenMic]),
        (Listening, ListenStart) => (Listening, vec![]),
        (Transcribing, ListenStart) => (Transcribing, vec![]),

        (Listening, ListenStop) => (Idle, vec![CloseMic]),
        // Le micro est fermé dès qu'on a la prise de parole : un seul tour.
        (Listening, SegmentReady) => (Transcribing, vec![CloseMic, RunStt]),
        (Listening, NoSpeechTimeout) => (Idle, vec![CloseMic]),
        (Transcribing, TranscriptReady) => (Idle, vec![EmitTranscript]),

        // ── Dictée ──
        // La parole en cours est coupée par l'appelant (comme pour l'écoute) :
        // la voix de CatDesk finirait dans le texte dicté.
        (Idle, DictateStart) | (Speaking, DictateStart) => (Dictating, vec![OpenMic]),
        // La bulle écoutait : son tour est abandonné, la dictée prend le micro.
        (Listening, DictateStart) => (Dictating, vec![CloseMic, OpenMic]),
        (Dictating, DictateStart) => (Dictating, vec![]),
        (Dictating, DictateEnd) => (Transcribing, vec![CloseMic, RunStt]),
        (Dictating, DictateCancel) => (Idle, vec![CloseMic]),
        (Transcribing, DictationReady) => (Idle, vec![InsertText]),
        // Ni Ctrl+Espace ni la fermeture de la bulle n'interrompent une dictée.
        (Dictating, ListenStart) | (Dictating, ListenStop) => (Dictating, vec![]),

        // ── Parole ──
        (Idle, SpeakRequested) | (Speaking, SpeakRequested) => (Speaking, vec![]),
        (Listening, SpeakRequested)
        | (Transcribing, SpeakRequested)
        | (Dictating, SpeakRequested) => (state, vec![DropSentence]),
        (Speaking, SpeechFinished) => (Idle, vec![]),
        (Speaking, SpeakStop) => (Idle, vec![StopPlayback]),
        // Un Stop qui arrive après que l'écoute a repris ne doit pas la casser,
        // mais la lecture en cours doit quand même s'arrêter.
        (_, SpeakStop) => (state, vec![StopPlayback]),

        // Tout le reste : hors domaine ou hors séquence, on ne bouge pas.
        _ => (state, vec![]),
    }
}

#[cfg(test)]
mod tests {
    use super::Action::*;
    use super::Input::*;
    use super::VoiceState::*;
    use super::*;

    #[test]
    fn un_tour_complet_ferme_le_micro_avant_le_stt() {
        let (s, a) = step(Idle, ListenStart);
        assert_eq!((s, a), (Listening, vec![OpenMic]));
        let (s, a) = step(s, SegmentReady);
        assert_eq!((s, a), (Transcribing, vec![CloseMic, RunStt]));
        let (s, a) = step(s, TranscriptReady);
        assert_eq!((s, a), (Idle, vec![EmitTranscript]));
    }

    #[test]
    fn ctrl_espace_pendant_la_parole_coupe_et_ecoute() {
        let (s, a) = step(Speaking, ListenStart);
        assert_eq!((s, a), (Listening, vec![OpenMic]));
    }

    #[test]
    fn jamais_parler_par_dessus_l_utilisateur() {
        assert_eq!(
            step(Listening, SpeakRequested),
            (Listening, vec![DropSentence])
        );
        assert_eq!(
            step(Transcribing, SpeakRequested),
            (Transcribing, vec![DropSentence])
        );
    }

    #[test]
    fn la_fin_de_lecture_ne_casse_pas_une_ecoute_reprise() {
        // Le thread parole apprend « file vide » après que l'utilisateur a
        // relancé l'écoute : l'état doit rester Listening.
        assert_eq!(step(Listening, SpeechFinished), (Listening, vec![]));
        assert_eq!(step(Listening, SpeakStop), (Listening, vec![StopPlayback]));
    }

    #[test]
    fn silence_prolonge_rend_la_main() {
        assert_eq!(step(Listening, NoSpeechTimeout), (Idle, vec![CloseMic]));
        // Hors écoute, le timeout n'a pas de sens.
        assert_eq!(step(Speaking, NoSpeechTimeout), (Speaking, vec![]));
    }

    #[test]
    fn stop_pendant_la_parole_vide_la_lecture() {
        assert_eq!(step(Speaking, SpeakStop), (Idle, vec![StopPlayback]));
        assert_eq!(step(Idle, SpeakStop), (Idle, vec![StopPlayback]));
    }

    #[test]
    fn une_dictee_complete_finit_en_texte_tape() {
        let (s, a) = step(Idle, DictateStart);
        assert_eq!((s, a), (Dictating, vec![OpenMic]));
        let (s, a) = step(s, DictateEnd);
        assert_eq!((s, a), (Transcribing, vec![CloseMic, RunStt]));
        let (s, a) = step(s, DictationReady);
        assert_eq!((s, a), (Idle, vec![InsertText]));
    }

    #[test]
    fn la_dictee_prend_le_micro_a_la_bulle_et_a_la_parole() {
        assert_eq!(
            step(Listening, DictateStart),
            (Dictating, vec![CloseMic, OpenMic])
        );
        assert_eq!(step(Speaking, DictateStart), (Dictating, vec![OpenMic]));
        // Pendant la transcription d'une question, la dictée attend son tour :
        // l'appui est ignoré, et son relâchement aussi.
        assert_eq!(step(Transcribing, DictateStart), (Transcribing, vec![]));
        assert_eq!(step(Transcribing, DictateEnd), (Transcribing, vec![]));
    }

    #[test]
    fn rien_de_la_bulle_n_interrompt_une_dictee() {
        assert_eq!(step(Dictating, ListenStart), (Dictating, vec![]));
        assert_eq!(step(Dictating, ListenStop), (Dictating, vec![]));
        assert_eq!(step(Dictating, NoSpeechTimeout), (Dictating, vec![]));
        assert_eq!(step(Dictating, SegmentReady), (Dictating, vec![]));
        // Répétition de l'appui (touche tenue) : sans effet.
        assert_eq!(step(Dictating, DictateStart), (Dictating, vec![]));
    }

    #[test]
    fn jamais_parler_pendant_une_dictee() {
        assert_eq!(
            step(Dictating, SpeakRequested),
            (Dictating, vec![DropSentence])
        );
        // Le Stop envoyé à l'appui arrive après coup : la dictée continue.
        assert_eq!(step(Dictating, SpeakStop), (Dictating, vec![StopPlayback]));
        assert_eq!(step(Dictating, SpeechFinished), (Dictating, vec![]));
    }

    #[test]
    fn une_dictee_annulee_ou_hors_sequence_rend_la_main() {
        assert_eq!(step(Dictating, DictateCancel), (Idle, vec![CloseMic]));
        // Relâchement sans appui pris en compte : rien.
        assert_eq!(step(Idle, DictateEnd), (Idle, vec![]));
        // Le texte d'une dictée n'est jamais envoyé au modèle, et une question
        // n'est jamais tapée dans une autre application.
        assert_eq!(step(Transcribing, TranscriptReady).1, vec![EmitTranscript]);
        assert_eq!(step(Transcribing, DictationReady).1, vec![InsertText]);
        assert_eq!(step(Idle, DictationReady), (Idle, vec![]));
    }
}
