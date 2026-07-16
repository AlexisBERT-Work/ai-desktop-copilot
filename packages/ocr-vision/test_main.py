"""Tests du dispatcher JSON-RPC (chemins purs, sans dépendances lourdes —
les imports paresseux de main.py ne chargent ni tesseract ni pandas ici)."""

import main


def test_health_check():
    result = main.dispatch("health.check", {})
    assert result["status"] == "ok"
    assert isinstance(result["pid"], int)


def test_handle_request_wraps_result():
    response = main.handle_request({"id": "a1", "method": "health.check", "params": {}})
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == "a1"
    assert response["result"]["status"] == "ok"
    assert "error" not in response


def test_unknown_method_becomes_jsonrpc_error():
    response = main.handle_request({"id": 7, "method": "nope.nope", "params": {}})
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 7
    assert response["error"]["code"] == -32603
    assert "Unknown method" in response["error"]["message"]
