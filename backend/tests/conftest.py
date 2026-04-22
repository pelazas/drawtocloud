import os
import pytest
from starlette.testclient import TestClient

# Provide dummy keys so module-level initialization doesn't raise at import time.
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SECRET_KEY", "test-secret-key-for-test-suite-only")
os.environ.setdefault("LLM_KEY_ENCRYPTION_SECRET", "test-secret-key-for-unit-tests-only!!")

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
