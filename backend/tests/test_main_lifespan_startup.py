"""Tests for main.py lifespan startup validation (issue 228)."""

from unittest.mock import AsyncMock, patch

import pytest

import main as main_module


@pytest.mark.asyncio
async def test_lifespan_startup_validates_encryption_secret():
    """The lifespan startup hook must validate LLM_KEY_ENCRYPTION_SECRET."""
    app = main_module.app
    lifespan = app.router.lifespan_context

    with patch("main.validate_encryption_secret") as mock_validate:
        with patch("main._assert_single_worker"):
            with patch("main.reset_stale_generations", new=AsyncMock()):
                with patch("main._warn_if_thumbnails_bucket_missing"):
                    with patch("main._warn_if_setup_pdfs_bucket_missing"):
                        async with lifespan(app):
                            pass

    mock_validate.assert_called_once()


@pytest.mark.asyncio
async def test_lifespan_startup_aborts_on_short_encryption_secret():
    """Startup must fail if LLM_KEY_ENCRYPTION_SECRET is set but too short."""
    app = main_module.app
    lifespan = app.router.lifespan_context

    with patch("main.validate_encryption_secret", side_effect=ValueError("too short")):
        with patch("main._assert_single_worker"):
            with patch("main.reset_stale_generations", new=AsyncMock()):
                with patch("main._warn_if_thumbnails_bucket_missing"):
                    with patch("main._warn_if_setup_pdfs_bucket_missing"):
                        with pytest.raises(ValueError, match="too short"):
                            async with lifespan(app):
                                pass
