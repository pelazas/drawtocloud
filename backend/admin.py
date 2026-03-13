import os
from functools import lru_cache


def _normalize_email(email: str) -> str:
    return email.strip().lower()


@lru_cache(maxsize=1)
def _admin_email_set() -> frozenset[str]:
    raw = os.getenv("ADMIN_EMAILS", "")
    emails = {_normalize_email(email) for email in raw.split(",") if email.strip()}
    return frozenset(emails)


def is_admin_email(email: str | None) -> bool:
    if not isinstance(email, str) or not email.strip():
        return False
    return _normalize_email(email) in _admin_email_set()


def reset_admin_cache() -> None:
    _admin_email_set.cache_clear()
