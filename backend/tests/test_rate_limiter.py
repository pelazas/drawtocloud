import time

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
        limiter = RateLimiter()
        for _ in range(3):
            limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=1)
        allowed, _ = limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=1)
        assert allowed is False
        time.sleep(1.1)
        allowed, _ = limiter.is_allowed("ip:1.2.3.4", max_requests=3, window_seconds=1)
        assert allowed is True


class TestRateLimiterWsConnections:
    def test_can_add_connection_when_under_limit(self):
        limiter = RateLimiter()
        ws = object()
        assert limiter.add_ws_connection("ip:1.2.3.4", ws, max_connections=3) is True

    def test_cannot_add_connection_when_over_limit(self):
        limiter = RateLimiter()
        for _ in range(3):
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
