#!/usr/bin/env python3
"""
NeuroDesk OCR/Vision Sidecar
JSON-RPC 2.0 over stdin/stdout
"""

import sys
import json
import traceback
import logging
from typing import Any

# Configure logging to stderr to keep stdout clean for JSON-RPC
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format='{"ts":"%(asctime)s","level":"%(levelname)s","ns":"ocr:main","msg":"%(message)s"}'
)
log = logging.getLogger(__name__)

# Lazy imports (loaded only when first used)
_screenshot = None
_ocr_engine = None
_file_parsers = {}


def get_screenshot_module():
    global _screenshot
    if _screenshot is None:
        from vision.screenshot import ScreenshotCapture
        _screenshot = ScreenshotCapture()
    return _screenshot


def get_ocr_engine():
    global _ocr_engine
    if _ocr_engine is None:
        from ocr.tesseract_engine import TesseractEngine
        _ocr_engine = TesseractEngine()
    return _ocr_engine


def handle_request(request: dict) -> dict:
    method = request.get("method", "")
    params = request.get("params", {})
    req_id = request.get("id")

    log.info(f"Handling method: {method}")

    try:
        result = dispatch(method, params)
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as e:
        log.error(f"Error in {method}: {traceback.format_exc()}")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32603, "message": str(e)}
        }


def dispatch(method: str, params: dict) -> Any:
    match method:
        case "health.check":
            return {"status": "ok", "pid": __import__("os").getpid()}

        case "ocr.capture_and_read":
            return capture_and_ocr(params)

        case "ocr.from_image":
            return ocr_from_base64(params)

        case "screen.capture":
            return capture_screen(params)

        case "screen.active_window":
            return get_active_window()

        case "files.parse_pdf":
            return parse_pdf(params)

        case "files.parse_docx":
            return parse_docx(params)

        case "files.parse_csv":
            return parse_csv(params)

        case _:
            raise ValueError(f"Unknown method: {method}")


def capture_and_ocr(params: dict) -> dict:
    screenshot_mod = get_screenshot_module()
    ocr_engine = get_ocr_engine()

    region = params.get("region")
    active_only = params.get("activeWindowOnly", False)

    image = screenshot_mod.capture(region=region, active_window_only=active_only)
    text, confidence = ocr_engine.read(image, language=params.get("language", "fra+eng"))

    return {
        "text": text,
        "confidence": confidence,
        "imageBase64": screenshot_mod.to_base64(image)
    }


def ocr_from_base64(params: dict) -> dict:
    import base64
    from PIL import Image
    import io

    ocr_engine = get_ocr_engine()
    image_data = base64.b64decode(params["imageBase64"])
    image = Image.open(io.BytesIO(image_data))
    text, confidence = ocr_engine.read(image, language=params.get("language", "fra+eng"))

    return {"text": text, "confidence": confidence}


def capture_screen(params: dict) -> dict:
    screenshot_mod = get_screenshot_module()
    region = params.get("region")
    active_only = params.get("activeWindowOnly", False)

    image = screenshot_mod.capture(region=region, active_window_only=active_only)
    return {"imageBase64": screenshot_mod.to_base64(image)}


def get_active_window() -> dict:
    try:
        import win32gui
        hwnd = win32gui.GetForegroundWindow()
        title = win32gui.GetWindowText(hwnd)
        return {"title": title, "hwnd": hwnd}
    except ImportError:
        return {"title": "unknown", "hwnd": 0}


def parse_pdf(params: dict) -> dict:
    from files.pdf_parser import parse_pdf_file
    return parse_pdf_file(params["path"], max_pages=params.get("maxPages", 50))


def parse_docx(params: dict) -> dict:
    from files.docx_parser import parse_docx_file
    return parse_docx_file(params["path"])


def parse_csv(params: dict) -> dict:
    from files.csv_parser import parse_csv_file
    return parse_csv_file(params["path"], max_rows=params.get("maxRows", 1000))


def main():
    log.info("NeuroDesk OCR sidecar started")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            log.warning(f"Invalid JSON: {e}")
            continue

        response = handle_request(request)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    log.info("stdin closed — shutting down")


if __name__ == "__main__":
    main()
