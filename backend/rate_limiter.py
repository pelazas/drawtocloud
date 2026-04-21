import time
from collections import defaultdict


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
