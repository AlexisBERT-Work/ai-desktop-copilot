"""Fast screen capture using mss"""

import base64
import io
import logging
from typing import Optional, Dict, Any
from PIL import Image

log = logging.getLogger(__name__)


class ScreenshotCapture:
    def __init__(self):
        import mss
        self._mss = mss
        log.info("ScreenshotCapture initialized")

    def capture(
        self,
        region: Optional[Dict[str, int]] = None,
        active_window_only: bool = False,
    ) -> Image.Image:
        """Capture screen or region"""
        with self._mss.mss() as sct:
            if active_window_only:
                bounds = self._get_active_window_bounds()
                if bounds:
                    region = bounds

            if region:
                monitor = {
                    "top": region["y"],
                    "left": region["x"],
                    "width": region["width"],
                    "height": region["height"],
                }
            else:
                # Full primary monitor
                monitor = sct.monitors[1]

            screenshot = sct.grab(monitor)
            return Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")

    def to_base64(self, image: Image.Image, format: str = "PNG") -> str:
        buffer = io.BytesIO()
        image.save(buffer, format=format, optimize=True)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")

    def _get_active_window_bounds(self) -> Optional[Dict[str, int]]:
        try:
            import win32gui
            hwnd = win32gui.GetForegroundWindow()
            rect = win32gui.GetWindowRect(hwnd)
            x, y, right, bottom = rect
            return {
                "x": max(0, x),
                "y": max(0, y),
                "width": right - x,
                "height": bottom - y,
            }
        except Exception as e:
            log.warning(f"Could not get active window bounds: {e}")
            return None
