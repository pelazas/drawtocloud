import time
from collections import defaultdict
from typing import Any


class RateLimiter:
    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._ws_by_ip: dict[str, set[Any]] = defaultdict(set)
        self._ws_by_user: dict[str, set[Any]] = defaultdict(set)

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

    def track_ws_user(self, ip: str, user_id: str, websocket: Any, max_user_connections: int) -> bool:
        if len(self._ws_by_user[user_id]) >= max_user_connections:
            return False
        self._ws_by_user[user_id].add(websocket)
        return True
