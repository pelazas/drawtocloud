"""
Cost estimation is now handled client-side in frontend/lib/costEstimator.ts.
This module remains as a no-op stub for compatibility.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def run_cost_analyst(
    requirements: dict,
    websocket,
    start_time: float = 0,
    diagram_nodes: list | None = None,
    llm_creds: dict[str, Any] | None = None,
) -> None:
    _ = requirements, websocket, start_time, diagram_nodes, llm_creds
    logger.info("cost_analyst is a no-op; estimation is client-side")
