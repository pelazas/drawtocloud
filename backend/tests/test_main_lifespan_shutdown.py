"""Tests for main.py lifespan graceful shutdown (issue 227)."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

import generation_service
import main as main_module


@pytest.mark.asyncio
async def test_lifespan_shutdown_calls_generation_service_shutdown():
    """The lifespan shutdown hook must call generation_service.shutdown()."""
    app = main_module.app
    lifespan = app.router.lifespan_context

    with patch("main._validate_encryption_secret_at_startup"):
        with patch("generation_service.shutdown", new=AsyncMock()) as mock_shutdown:
            with patch("generation_service._BROADCASTER.close_all_connections", new=AsyncMock()) as mock_close_all:
                async with lifespan(app):
                    pass

    mock_shutdown.assert_awaited_once()
    mock_close_all.assert_awaited_once()


@pytest.mark.asyncio
async def test_lifespan_shutdown_passes_timeout_to_shutdown():
    """The lifespan shutdown must use a reasonable drain timeout."""
    app = main_module.app
    lifespan = app.router.lifespan_context

    with patch("main._validate_encryption_secret_at_startup"):
        with patch("generation_service.shutdown", new=AsyncMock()) as mock_shutdown:
            with patch("generation_service._BROADCASTER.close_all_connections", new=AsyncMock()):
                async with lifespan(app):
                    pass

    call_kwargs = mock_shutdown.await_args.kwargs
    assert "timeout_seconds" in call_kwargs
    assert call_kwargs["timeout_seconds"] >= 25.0
