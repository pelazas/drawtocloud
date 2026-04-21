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
