//! Micro (cpal / WASAPI) → morceaux mono `f32` à la fréquence du périphérique.
//!
//! Le rappel audio tourne sur un thread temps réel de l'OS : il ne fait que
//! mixer en mono et pousser dans un canal. Le rééchantillonnage à 16 kHz et
//! le VAD se font côté [`super::listener`].
//!
//! Un `cpal::Stream` n'est pas `Send` : à ouvrir et à lâcher sur le thread
//! qui l'utilise. Le fermer, c'est simplement le laisser tomber.

use std::sync::mpsc::Sender;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, SizedSample};
use tracing::warn;

use crate::core::error::CatdeskError;

pub struct MicStream {
    _stream: cpal::Stream,
    pub sample_rate: u32,
}

/// Ouvre le micro par défaut et commence à pousser des morceaux mono dans `tx`.
pub fn open(tx: Sender<Vec<f32>>) -> Result<MicStream, CatdeskError> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| CatdeskError::Audio("aucun micro".into()))?;
    let supported = device
        .default_input_config()
        .map_err(|e| CatdeskError::Audio(format!("micro : {e}")))?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.clone().into();

    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &config, channels, tx),
        SampleFormat::I16 => build::<i16>(&device, &config, channels, tx),
        SampleFormat::U16 => build::<u16>(&device, &config, channels, tx),
        other => Err(CatdeskError::Audio(format!(
            "format micro non géré : {other:?}"
        ))),
    }?;
    stream
        .play()
        .map_err(|e| CatdeskError::Audio(format!("micro : {e}")))?;

    Ok(MicStream {
        _stream: stream,
        sample_rate,
    })
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    tx: Sender<Vec<f32>>,
) -> Result<cpal::Stream, CatdeskError>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mono: Vec<f32> = data
                    .chunks(channels.max(1))
                    .map(|frame| {
                        frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / frame.len() as f32
                    })
                    .collect();
                // Récepteur parti = écoute terminée ; rien à signaler.
                let _ = tx.send(mono);
            },
            |e| warn!("voice: erreur micro ({e})"),
            None,
        )
        .map_err(|e| CatdeskError::Audio(format!("micro : {e}")))
}

/// Niveau RMS d'un morceau, borné à [0, 1] — pour le halo du bouton micro.
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt().min(1.0)
}

#[cfg(test)]
mod tests {
    use super::rms;

    #[test]
    fn rms_du_silence_est_nul_et_borne_a_un() {
        assert_eq!(rms(&[]), 0.0);
        assert_eq!(rms(&[0.0; 16]), 0.0);
        assert!((rms(&[0.5, -0.5, 0.5, -0.5]) - 0.5).abs() < 1e-6);
        assert_eq!(rms(&[4.0, -4.0]), 1.0);
    }
}
