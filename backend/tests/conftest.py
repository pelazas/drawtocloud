import pytest
from starlette.testclient import TestClient

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
