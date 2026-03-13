import admin


def test_is_admin_email_matches_case_insensitive_list(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", " Admin@Example.com, second@example.com ")
    admin.reset_admin_cache()

    assert admin.is_admin_email("admin@example.com")
    assert admin.is_admin_email("SECOND@EXAMPLE.COM")
    assert not admin.is_admin_email("user@example.com")


def test_is_admin_email_returns_false_when_env_empty(monkeypatch):
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    admin.reset_admin_cache()

    assert not admin.is_admin_email("admin@example.com")
