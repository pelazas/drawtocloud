# Issue 226 — Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add configurable IP-based and authenticated-user rate limiting to all HTTP endpoints and WebSocket connections.

**Architecture:** A single in-memory rate limiter (`backend/rate_limiter.py`) tracks sliding-window counters per IP and per user. A FastAPI middleware applies general IP limits to every HTTP request, with stricter per-user limits on expensive operations. The WebSocket endpoint gates connection acceptance by IP and user connection counts. All limits are configurable via environment variables.

**Tech Stack:** FastAPI, Python 3.12, in-memory counters (single-worker deployment), pytest.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/rate_limiter.py` | In-memory sliding-window rate limiter, WS connection tracker, IP extraction helpers |
| `backend/tests/test_rate_limiter.py` | Unit tests for the limiter logic |
| `backend/tests/test_rate_limit_middleware.py` | HTTP integration tests (429 headers, per-IP isolation, per-user limits) |
| `backend/tests/test_rate_limit_ws.py` | WebSocket integration tests (connection rejection by IP/user) |
| `backend/main.py` | Wire middleware into the FastAPI app; add env-var config at startup |
| `backend/ws_handler.py` | Gate `websocket_endpoint` with connection limits |

---

## Chunk 1: Core Rate Limiter (IP + user sliding window)

### Task 1: Write failing tests for `RateLimiter.is_allowed`

**Files:**
- Test: `backend/tests/test_rate_limiter.py`

- [ ] **Step 1: Write the failing test**

```python
import pytest
from rate_limiter import RateLimiter

class TestRateLimiterIsAllowed:
    def test_allows_requests_under_limit(self):
        limiter = RateLimiter()
        allowed, retry_after = limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=60)
        assert allowed is True
        assert retry_after == 0

    def test_blocks_requests_over_limit(self):
        limiter = RateLimiter()
        for _ in range(3):
            limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=60)
        allowed, retry_after = limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=60)
        assert allowed is False
        assert retry_after > 0

    def test_separate_keys_do_not_interfere(self):
        limiter = RateLimiter()
        for _ in range(3):
            limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=60)
        allowed, _ = limiter.is_allowed("ip:5.6.7.8", max_requests=3, window_seconds=60)
        assert allowed is True

    def test_window_resets_after_time(self):
        import time
        limiter = RateLimiter()
        for _ in range(3):
            limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=1)
        allowed, _ = limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=1)
        assert allowed is False
        time.sleep(1.1)
        allowed, _ = limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=1)
        assert allowed is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rate_limiter.py -v`
Expected: ImportError / NameError — `RateLimiter` does not exist.

- [ ] **Step 3: Implement `RateLimiter`**

Create `backend/rate_limiter.py`:

```python
import time
from collections import defaultdict
from typing import Any

class RateLimiter:
    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> tuple[bool, int]:
        now = time.time()
        window = self._windows[key]
        cutoff = now - window_seconds
        while window and window[0] < cutoff:
            window.pop(0)
        if len(window) < max_requests:
            window.append(now)
            return True, 0
        retry_after = max(1, int(window[0] - cutoff))
        return False, retry_after
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_rate_limiter.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/rate_limiter.py backend/tests/test_rate_limiter.py
git commit -m "feat(rate-limit): add in-memory sliding-window rate limiter (issue #226)"
```

---

## Chunk 2: WebSocket Connection Tracker

### Task 2: Write failing tests for WS connection tracking

**Files:**
- Test: `backend/tests/test_rate_limiter.py` (append)
- Modify: `backend/rate_limiter.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_rate_limiter.py`:

```python
class TestRateLimiterWsConnections:
    def test_can_add_connection_when_under_limit(self):
        limiter = RateLimiter()
        ws = object()
        assert limiter.add_ws_connection("ip:1.2.3.4", ws, max_connections=3) is True

    def test_cannot_add_connection_when_over_limit(self):
        limiter = RateLimiter()
        for i in range(3):
            limiter.add_ws_connection("ip:1.2.3.4", object(), max_connections=3)
        ws = object()
        assert limiter.add_ws_connection("ip:1.2.3.4", ws, max_connections=3) is False

    def test_remove_ws_connection_frees_slot(self):
        limiter = RateLimiter()
        ws = object()
        limiter.add_ws_connection("ip:1.2.3.4", ws, max_connections=1)
        assert limiter.add_ws_connection("ip:1.2.3.4", object(), max_connections=1) is False
        limiter.remove_ws_connection("ip:1.2.3.4", None, ws)
        assert limiter.add_ws_connection("ip:1.2.3.4", object(), max_connections=1) is True

    def test_user_connections_tracked_separately(self):
        limiter = RateLimiter()
        ws1 = object()
        assert limiter.add_ws_connection("ip:1.2.3.4", ws1, max_connections=5, user_id="u1", max_user_connections=2) is True
        ws2 = object()
        assert limiter.add_ws_connection("ip:1.2.3.4", ws2, max_connections=5, user_id="u1", max_user_connections=2) is True
        ws3 = object()
        assert limiter.add_ws_connection("ip:1.2.3.4", ws3, max_connections=5, user_id="u1", max_user_connections=2) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rate_limiter.py::TestRateLimiterWsConnections -v`
Expected: AttributeError — `add_ws_connection` / `remove_ws_connection` do not exist.

- [ ] **Step 3: Implement WS tracking**

Add to `backend/rate_limiter.py` inside `RateLimiter`:

```python
    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._ws_by_ip: dict[str, set[Any]] = defaultdict(set)
        self._ws_by_user: dict[str, set[Any]] = defaultdict(set)

    def add_ws_connection(
        self,
        ip: str,
        websocket: Any,
        max_connections: int,
        user_id: str | None = None,
        max_user_connections: int | None = None,
    ) -> bool:
        if len(self._ws_by_ip[ip]) >= max_connections:
            return False
        if user_id is not None and max_user_connections is not None:
            if len(self._ws_by_user[user_id]) >= max_user_connections:
                return False
        self._ws_by_ip[ip].add(websocket)
        if user_id is not None:
            self._ws_by_user[user_id].add(websocket)
        return True

    def remove_ws_connection(self, ip: str, user_id: str | None, websocket: Any) -> None:
        self._ws_by_ip[ip].discard(websocket)
        if user_id is not None:
            self._ws_by_user[user_id].discard(websocket)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_rate_limiter.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/rate_limiter.py backend/tests/test_rate_limiter.py
git commit -m "feat(rate-limit): add websocket connection tracker (issue #226)"
```

---

## Chunk 3: HTTP Middleware (general IP limit)

### Task 3: Write failing integration tests for HTTP rate limiting

**Files:**
- Test: `backend/tests/test_rate_limit_middleware.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_rate_limit_middleware.py`:

```python
import os
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def rate_limited_client(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_IP_RPM", "2")
    monkeypatch.setenv("RATE_LIMIT_USER_RPM", "2")
    import importlib
    import main as main_module
    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        yield c


class TestHttpRateLimitByIp:
    def test_allows_requests_under_limit(self, rate_limited_client):
        resp = rate_limited_client.get("/health")
        assert resp.status_code == 200
        resp = rate_limited_client.get("/health")
        assert resp.status_code == 200

    def test_blocks_requests_over_limit(self, rate_limited_client):
        for _ in range(2):
            rate_limited_client.get("/health")
        resp = rate_limited_client.get("/health")
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers
        assert int(resp.headers["Retry-After"]) > 0
        assert resp.json()["error"] == "rate_limit_exceeded"

    def test_separate_ips_have_independent_limits(self, rate_limited_client):
        for _ in range(2):
            rate_limited_client.get("/health")
        resp = rate_limited_client.get("/health", headers={"X-Forwarded-For": "9.9.9.9"})
        assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rate_limit_middleware.py -v`
Expected: FAIL — `RATE_LIMIT_IP_RPM` env var not read, no middleware returns 429.

- [ ] **Step 3: Add env-var config + middleware to `main.py`**

Add near the top of `main.py` (after imports):

```python
from rate_limiter import RateLimiter

_limiter = RateLimiter()

RATE_LIMIT_IP_RPM = int(os.getenv("RATE_LIMIT_IP_RPM", "60"))
RATE_LIMIT_USER_RPM = int(os.getenv("RATE_LIMIT_USER_RPM", "30"))
RATE_LIMIT_WS_PER_IP = int(os.getenv("RATE_LIMIT_WS_PER_IP", "10"))
RATE_LIMIT_WS_PER_USER = int(os.getenv("RATE_LIMIT_WS_PER_USER", "5"))
```

Add middleware before `app = FastAPI(...)` or after CORS:

```python
@app.middleware("http")
async def rate_limit_middleware(request, call_next):
    ip = _client_ip_from_request(request)
    allowed, retry_after = _limiter.is_allowed(f"http_ip:{ip}", max_requests=RATE_LIMIT_IP_RPM, window_seconds=60)
    if not allowed:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            content={"error": "rate_limit_exceeded", "message": "Too many requests. Please slow down."},
        )
    return await call_next(request)
```

Add helper in `main.py`:

```python
def _client_ip_from_request(request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if isinstance(forwarded_for, str) and forwarded_for.strip():
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if isinstance(real_ip, str) and real_ip.strip():
        return real_ip.strip()
    host = request.client.host if request.client else "unknown"
    return host
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_rate_limit_middleware.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_rate_limit_middleware.py
git commit -m "feat(rate-limit): add HTTP IP-based rate limit middleware (issue #226)"
```

---

## Chunk 4: Per-User Limits on Expensive Endpoints

### Task 4: Write failing tests for per-user rate limiting on expensive ops

**Files:**
- Test: `backend/tests/test_rate_limit_middleware.py` (append)
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_rate_limit_middleware.py`:

```python
class TestHttpRateLimitByUser:
    def test_expensive_endpoint_uses_user_limit(self, rate_limited_client):
        auth_user = {"user_id": "user-123", "email": "a@example.com"}
        with patch("main.verify_access_token_user", return_value=auth_user):
            for _ in range(2):
                resp = rate_limited_client.post("/api/generations/start", json={"answers": {}, "access_token": "tok"})
                assert resp.status_code in (200, 400)  # allowed or business error, not 429 yet
            resp = rate_limited_client.post("/api/generations/start", json={"answers": {}, "access_token": "tok"})
            assert resp.status_code == 429
            assert resp.json()["error"] == "rate_limit_exceeded"

    def test_different_users_have_independent_limits(self, rate_limited_client):
        auth_user_a = {"user_id": "user-a", "email": "a@example.com"}
        auth_user_b = {"user_id": "user-b", "email": "b@example.com"}
        with patch("main.verify_access_token_user", return_value=auth_user_a):
            for _ in range(2):
                rate_limited_client.post("/api/generations/start", json={"answers": {}, "access_token": "tok-a"})
        with patch("main.verify_access_token_user", return_value=auth_user_b):
            resp = rate_limited_client.post("/api/generations/start", json={"answers": {}, "access_token": "tok-b"})
            assert resp.status_code in (200, 400)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rate_limit_middleware.py::TestHttpRateLimitByUser -v`
Expected: FAIL — user-specific 429 not returned because per-user middleware is missing.

- [ ] **Step 3: Enhance middleware with per-user limits on expensive paths**

Update the middleware in `main.py`:

```python
_EXPENSIVE_PATHS = {
    "/api/generations/start",
    "/api/questionnaire",
    "/api/projects",
    "/api/templates",
}

@app.middleware("http")
async def rate_limit_middleware(request, call_next):
    ip = _client_ip_from_request(request)
    allowed, retry_after = _limiter.is_allowed(f"http_ip:{ip}", max_requests=RATE_LIMIT_IP_RPM, window_seconds=60)
    if not allowed:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            content={"error": "rate_limit_exceeded", "message": "Too many requests. Please slow down."},
        )

    # Per-user limits on expensive paths
    if request.url.path in _EXPENSIVE_PATHS:
        token = _token_from_authorization_header(request.headers.get("authorization"))
        if token:
            auth_user = await verify_access_token_user(token)
            if auth_user is not None:
                user_key = f"http_user:{auth_user.user_id}:{request.url.path}"
                allowed, retry_after = _limiter.is_allowed(user_key, max_requests=RATE_LIMIT_USER_RPM, window_seconds=60)
                if not allowed:
                    return JSONResponse(
                        status_code=429,
                        headers={"Retry-After": str(retry_after)},
                        content={"error": "rate_limit_exceeded", "message": "Too many requests. Please slow down."},
                    )

    return await call_next(request)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_rate_limit_middleware.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_rate_limit_middleware.py
git commit -m "feat(rate-limit): add per-user rate limits on expensive endpoints (issue #226)"
```

---

## Chunk 5: WebSocket Connection Limits

### Task 5: Write failing tests for WS connection limits

**Files:**
- Test: `backend/tests/test_rate_limit_ws.py`
- Modify: `backend/ws_handler.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_rate_limit_ws.py`:

```python
import json
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def ws_limit_client(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_WS_PER_IP", "2")
    monkeypatch.setenv("RATE_LIMIT_WS_PER_USER", "2")
    import importlib
    import main as main_module
    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        yield c


class TestWsRateLimitByIp:
    def test_allows_connections_under_ip_limit(self, ws_limit_client):
        ws1 = ws_limit_client.websocket_connect("/ws")
        ws2 = ws_limit_client.websocket_connect("/ws")
        ws1.close()
        ws2.close()

    def test_rejects_connections_over_ip_limit(self, ws_limit_client):
        ws1 = ws_limit_client.websocket_connect("/ws")
        ws2 = ws_limit_client.websocket_connect("/ws")
        with pytest.raises(Exception):  # connection refused/closed
            with ws_limit_client.websocket_connect("/ws") as ws3:
                pass
        ws1.close()
        ws2.close()


class TestWsRateLimitByUser:
    def test_rejects_connections_over_user_limit(self, ws_limit_client):
        auth_user = {"user_id": "user-123", "email": "a@example.com"}
        with patch("ws_handler.verify_access_token_user", return_value=auth_user):
            ws1 = ws_limit_client.websocket_connect("/ws")
            ws2 = ws_limit_client.websocket_connect("/ws")
            with ws_limit_client.websocket_connect("/ws") as ws3:
                ws3.send_text(json.dumps({"type": "chat", "message": "hi", "access_token": "tok"}))
                data = json.loads(ws3.receive_text())
                assert data["type"] == "error"
                assert "rate_limit" in data["error"]
            ws1.close()
            ws2.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rate_limit_ws.py -v`
Expected: FAIL — WS connections are not limited yet.

- [ ] **Step 3: Add WS connection gating to `ws_handler.py`**

Import the limiter at the top of `ws_handler.py`:

```python
from rate_limiter import RateLimiter
```

Pass the limiter into `handle_websocket` as an optional arg or import a shared instance. Since `main.py` already instantiates `_limiter`, pass it in `websocket_endpoint`:

In `main.py`, update the websocket endpoint call:

```python
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    ...
    await handle_websocket(ws, rate_limiter=_limiter)
```

In `ws_handler.py`, modify `handle_websocket` signature and add gating at the top:

```python
async def handle_websocket(websocket: WebSocket, rate_limiter: RateLimiter | None = None) -> None:
    ...
    client_ip = _client_ip_from_websocket(websocket) or "unknown"
    if rate_limiter is not None:
        if not rate_limiter.add_ws_connection(client_ip, websocket, max_connections=int(os.getenv("RATE_LIMIT_WS_PER_IP", "10"))):
            await websocket.close(code=1008, reason="Too many connections from this IP.")
            return

    # After auth inside the loop, for the first authenticated message, register user connection
    ...
```

Actually, we need to gate BEFORE `ws.accept()` in `main.py`, because `add_ws_connection` should happen after accept. Or we can accept then close. Let's accept then close if over limit — it's cleaner.

Wait, `TestClient` doesn't support checking close codes easily. We should send an error JSON when the WS is accepted but then closed due to limit. Or just close with code 1008.

For TestClient, catching the exception is enough for IP limits. For user limits, we need auth first. The test expects an error JSON on the third connection after auth.

Let me adjust the WS handler logic:

```python
async def handle_websocket(websocket: WebSocket, rate_limiter: RateLimiter | None = None) -> None:
    ...
    client_ip = _client_ip_from_websocket(websocket) or "unknown"
    if rate_limiter is not None:
        if not rate_limiter.add_ws_connection(client_ip, websocket, max_connections=int(os.getenv("RATE_LIMIT_WS_PER_IP", "10"))):
            await _safe_send_json(websocket, {"type": "error", "error": "rate_limit_exceeded", "message": "Too many connections from this IP."})
            await websocket.close(code=1008)
            return
    ...
```

And after auth is confirmed, if user_id is set:

```python
            if rate_limiter is not None and user_id is not None:
                if not rate_limiter.add_ws_connection(
                    client_ip, websocket,
                    max_connections=int(os.getenv("RATE_LIMIT_WS_PER_IP", "10")),
                    user_id=user_id,
                    max_user_connections=int(os.getenv("RATE_LIMIT_WS_PER_USER", "5")),
                ):
                    await _safe_send_json(websocket, {"type": "error", "error": "rate_limit_exceeded", "message": "Too many connections for this user."})
                    await websocket.close(code=1008)
                    return
```

Wait — `add_ws_connection` already adds the IP connection. We need a separate method to check/add user connections, or modify the flow. Better: have two separate methods or allow `add_ws_connection` to be called again with `user_id` after auth.

Let's refactor slightly: `add_ws_connection` checks both IP and user limits atomically. If called first without user_id, it only checks IP. If called again with user_id, it checks user limit and registers user.

Actually, simpler: add a `track_ws_user` method:

```python
    def track_ws_user(self, ip: str, user_id: str, websocket: Any, max_user_connections: int) -> bool:
        if len(self._ws_by_user[user_id]) >= max_user_connections:
            return False
        self._ws_by_user[user_id].add(websocket)
        return True
```

Then in the handler, after first auth:

```python
            if rate_limiter is not None and user_id is not None:
                if not rate_limiter.track_ws_user(client_ip, user_id, websocket, max_user_connections=int(os.getenv("RATE_LIMIT_WS_PER_USER", "5"))):
                    await _safe_send_json(websocket, {"type": "error", "error": "rate_limit_exceeded", "message": "Too many connections for this user."})
                    await websocket.close(code=1008)
                    return
```

And in cleanup:

```python
    for project_id in list(subscribed_projects):
        await unsubscribe_websocket(project_id, websocket)
    await unsubscribe_websocket_from_all(websocket)
    if rate_limiter is not None:
        rate_limiter.remove_ws_connection(client_ip, user_id, websocket)
    logger.info("ws.cleanup_complete client=%s:%s", client_host, client_port)
```

Add `track_ws_user` and tests for it in `rate_limiter.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_rate_limit_ws.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/ws_handler.py backend/rate_limiter.py backend/tests/test_rate_limit_ws.py backend/main.py
git commit -m "feat(rate-limit): add websocket connection limits per IP and user (issue #226)"
```

---

## Chunk 6: Environment Variable Configuration Tests

### Task 6: Write failing tests for env-var configuration

**Files:**
- Test: `backend/tests/test_rate_limiter.py` (append)
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_rate_limiter.py`:

```python
class TestRateLimiterEnvConfig:
    def test_default_limits_when_env_not_set(self, monkeypatch):
        monkeypatch.delenv("RATE_LIMIT_IP_RPM", raising=False)
        monkeypatch.delenv("RATE_LIMIT_USER_RPM", raising=False)
        import importlib
        import main as main_module
        importlib.reload(main_module)
        assert main_module.RATE_LIMIT_IP_RPM == 60
        assert main_module.RATE_LIMIT_USER_RPM == 30

    def test_custom_limits_from_env(self, monkeypatch):
        monkeypatch.setenv("RATE_LIMIT_IP_RPM", "120")
        monkeypatch.setenv("RATE_LIMIT_USER_RPM", "50")
        import importlib
        import main as main_module
        importlib.reload(main_module)
        assert main_module.RATE_LIMIT_IP_RPM == 120
        assert main_module.RATE_LIMIT_USER_RPM == 50
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rate_limiter.py::TestRateLimiterEnvConfig -v`
Expected: FAIL — `RATE_LIMIT_IP_RPM` / `RATE_LIMIT_USER_RPM` not exported from `main.py`.

- [ ] **Step 3: Ensure `main.py` exports the config variables at module level**

They should already be there from Chunk 3. If tests fail because they're not accessible, make sure they're top-level module variables (not inside a function).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_rate_limiter.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_rate_limiter.py backend/main.py
git commit -m "test(rate-limit): verify env-var configuration for limits (issue #226)"
```

---

## Chunk 7: Full Test Suite Verification

### Task 7: Run full backend test suite

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && uv run pytest tests/ -v --tb=short
```

Expected: All existing tests still pass; new rate-limit tests pass.

- [ ] **Step 2: Commit if any fixes were needed**

If no fixes needed, no commit.

---

## Completion Checklist

- [ ] `RateLimiter` unit tests pass
- [ ] HTTP middleware returns 429 with `Retry-After` header
- [ ] Per-user limits apply to expensive endpoints
- [ ] WebSocket connections are limited per IP and per user
- [ ] Limits are configurable via environment variables
- [ ] All existing tests continue to pass
- [ ] FastAPI endpoint documentation updated (middleware does not need decorator docs, but new env vars should be noted)
- [ ] `data-reference.md` not affected (no new data shapes)
- [ ] `styleguide.md` not affected (backend only)
