from app.main import _configure_app_insights


def test_configure_app_insights_noop_without_conn_string(monkeypatch):
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)
    assert _configure_app_insights() is False
