"""Tesseract OCR engine wrapper with preprocessing"""

import logging
from typing import Tuple
from PIL import Image, ImageFilter, ImageEnhance

log = logging.getLogger(__name__)


class TesseractEngine:
    def __init__(self):
        try:
            import pytesseract
            self._tesseract = pytesseract
            # Try to detect Tesseract on Windows
            import shutil
            if not shutil.which("tesseract"):
                # Common Windows install path
                pytesseract.pytesseract.tesseract_cmd = (
                    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
                )
            log.info("Tesseract OCR engine initialized")
        except ImportError:
            log.error("pytesseract not installed")
            raise

    def read(self, image: Image.Image, language: str = "fra+eng") -> Tuple[str, float]:
        """
        Extract text from image using Tesseract.
        Returns (text, confidence) tuple.
        """
        processed = self._preprocess(image)

        # Get detailed output with confidence
        data = self._tesseract.image_to_data(
            processed,
            lang=language,
            output_type=self._tesseract.Output.DICT,
        )

        # Filter confident words
        words = []
        confidences = []
        for i, conf in enumerate(data["conf"]):
            if isinstance(conf, int) and conf > 30:
                word = data["text"][i].strip()
                if word:
                    words.append(word)
                    confidences.append(conf)

        text = " ".join(words)
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

        return text, round(avg_confidence / 100.0, 3)

    def _preprocess(self, image: Image.Image) -> Image.Image:
        """Preprocess image for better OCR accuracy"""
        # Convert to grayscale
        if image.mode != "L":
            image = image.convert("L")

        # Increase contrast
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)

        # Sharpen
        image = image.filter(ImageFilter.SHARPEN)

        # Scale up if too small (Tesseract works better at 300 DPI)
        w, h = image.size
        if w < 1000 or h < 600:
            scale = max(1000 / w, 600 / h)
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        return image
