"""Local audio transcription using faster-whisper (CTranslate2 backend)"""

import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

SUPPORTED_FORMATS = {
    '.mp3', '.wav', '.m4a', '.mp4', '.webm',
    '.ogg', '.flac', '.opus', '.mkv', '.aac',
}

VALID_MODELS = {'tiny', 'base', 'small', 'medium', 'large-v3'}


class AudioTranscriber:
    def __init__(self):
        try:
            from faster_whisper import WhisperModel
            self._WhisperModel = WhisperModel
        except ImportError:
            log.error("faster-whisper not installed. Run: pip install faster-whisper")
            raise

        self._models: dict = {}
        log.info("AudioTranscriber initialized")

    def transcribe(
        self,
        path: str,
        model_size: str = "base",
        language: Optional[str] = None,
        task: str = "transcribe",
    ) -> dict:
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Fichier audio introuvable: {path}")

        suffix = p.suffix.lower()
        if suffix not in SUPPORTED_FORMATS:
            raise ValueError(
                f"Format non supporté: {p.suffix}. "
                f"Formats acceptés: {', '.join(sorted(SUPPORTED_FORMATS))}"
            )

        if model_size not in VALID_MODELS:
            model_size = "base"

        model = self._get_model(model_size)

        log.info(f"Transcribing {p.name} (model={model_size}, lang={language or 'auto'})")

        segments_iter, info = model.transcribe(
            str(p),
            language=language or None,
            task=task,
            beam_size=5,
            word_timestamps=False,
            vad_filter=True,         # skip silence for speed
            vad_parameters={"min_silence_duration_ms": 500},
        )

        all_segments = []
        text_parts = []
        for seg in segments_iter:
            text = seg.text.strip()
            if text:
                all_segments.append({
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": text,
                })
                text_parts.append(text)

        full_text = " ".join(text_parts)

        return {
            "text": full_text,
            "language": info.language,
            "languageConfidence": round(info.language_probability, 3),
            "duration": round(info.duration, 2),
            "segmentCount": len(all_segments),
            "segments": all_segments,
            "model": model_size,
            "task": task,
        }

    def _get_model(self, size: str):
        if size not in self._models:
            log.info(f"Loading Whisper model '{size}' (first call may take a moment)…")
            self._models[size] = self._WhisperModel(
                size,
                device="cpu",
                compute_type="int8",  # quantized for speed/memory on CPU
            )
            log.info(f"Whisper model '{size}' loaded")
        return self._models[size]
