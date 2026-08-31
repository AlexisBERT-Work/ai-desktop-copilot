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


def test_unknown_method_is_method_not_found():
    """-32601, pas -32603 : une methode absente est une faute de l'appelant.

    Le cote TypeScript (ipc/StdinBridge.ts) repondait deja -32601 ici ; les deux
    moities du meme protocole doivent s'accorder.
    """
    response = main.handle_request({"id": 7, "method": "nope.nope", "params": {}})
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 7
    assert response["error"]["code"] == -32601
    assert "Unknown method" in response["error"]["message"]


def test_missing_param_is_invalid_params():
    """-32602 : un parametre requis absent n'est pas une erreur interne."""
    response = main.handle_request(
        {"id": 8, "method": "files.export_document", "params": {}}
    )
    assert response["error"]["code"] == -32602


def test_require_signale_le_paquet_a_installer():
    from deps import require

    try:
        require("paquet_absent_pour_le_test")
    except RuntimeError as exc:
        assert "pip install" in str(exc)
    else:
        raise AssertionError("require aurait du lever RuntimeError")
