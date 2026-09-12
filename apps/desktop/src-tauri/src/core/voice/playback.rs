//! Haut-parleurs (cpal / WASAPI) : un tampon mono partagé que le rappel audio
//! vide frame par frame, silence quand il est à sec. Couper la parole, c'est
//! vider le tampon — instantané, sans fermer le flux.
//!
//! Même contrainte que le micro : le `cpal::Stream` n'est pas `Send`, le
//! [`Player`] vit sur le thread [`super::speaker`].

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SizedSample};
use tracing::warn;

use crate::core::error::CatdeskError;

pub struct Player {
    _stream: cpal::Stream,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    pub sample_rate: u32,
}

impl Player {
    pub fn open() -> Result<Self, CatdeskError> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or_else(|| CatdeskError::Audio("aucune sortie audio".into()))?;
        let supported = device
            .default_output_config()
            .map_err(|e| CatdeskError::Audio(format!("sortie audio : {e}")))?;
        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels() as usize;
        let config: cpal::StreamConfig = supported.clone().into();
        let buffer = Arc::new(Mutex::new(VecDeque::new()));

        let stream = match supported.sample_format() {
            SampleFormat::F32 => build::<f32>(&device, &config, channels, buffer.clone()),
            SampleFormat::I16 => build::<i16>(&device, &config, channels, buffer.clone()),
            SampleFormat::U16 => build::<u16>(&device, &config, channels, buffer.clone()),
            other => Err(CatdeskError::Audio(format!(
                "format de sortie non géré : {other:?}"
            ))),
        }?;
        stream
            .play()
            .map_err(|e| CatdeskError::Audio(format!("sortie audio : {e}")))?;

        Ok(Self {
            _stream: stream,
            buffer,
            sample_rate,
        })
    }

    /// Le tampon lui-même, pour y écrire depuis un rappel `'static`
    /// (mono, déjà à `self.sample_rate`).
    pub fn sink(&self) -> Arc<Mutex<VecDeque<f32>>> {
        self.buffer.clone()
    }

    pub fn clear(&self) {
        self.buffer.lock().expect("player buffer").clear();
    }

    /// Échantillons pas encore joués.
    pub fn pending(&self) -> usize {
        self.buffer.lock().expect("player buffer").len()
    }
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    buffer: Arc<Mutex<VecDeque<f32>>>,
) -> Result<cpal::Stream, CatdeskError>
where
    T: SizedSample + cpal::FromSample<f32>,
{
    device
        .build_output_stream(
            config,
            move |out: &mut [T], _| {
                let mut buf = buffer.lock().expect("player buffer");
                for frame in out.chunks_mut(channels.max(1)) {
                    let s = buf.pop_front().unwrap_or(0.0);
                    for ch in frame.iter_mut() {
                        *ch = T::from_sample(s);
                    }
                }
            },
            |e| warn!("voice: erreur de sortie audio ({e})"),
            None,
        )
        .map_err(|e| CatdeskError::Audio(format!("sortie audio : {e}")))
}
