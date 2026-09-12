//! Machine à états de la voix — pure, sans audio, donc testable.
//!
//! Deux threads (écoute, parole) partagent un seul état ; chacun n'applique
//! que les transitions de son domaine et ignore le reste. Le tableau ci-dessous
//! est la seule source de vérité : un thread ne change jamais l'état « à la
//! main ». Règle de fond : **l'assistant ne parle jamais par-dessus
//! l'utilisateur** — une phrase à dire qui arrive pendant l'écoute est jetée.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceState {
    Idle,
    Listening,
    Transcribing,
    Speaking,
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

        // ── Parole ──
        (Idle, SpeakRequested) | (Speaking, SpeakRequested) => (Speaking, vec![]),
        (Listening, SpeakRequested) | (Transcribing, SpeakRequested) => (state, vec![DropSentence]),
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
}
