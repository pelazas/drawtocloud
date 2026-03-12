import os
import pytest
from starlette.testclient import TestClient

# Provide a dummy key so llm_client module-level _detect_provider() doesn't raise at import time.
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from main import app


@pytest.fixture
def client():
    """Synchronous TestClient for HTTP endpoints."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def ws_client():
    """WebSocket test client helper (wraps TestClient.websocket_connect)."""
    with TestClient(app) as c:
        yield c
