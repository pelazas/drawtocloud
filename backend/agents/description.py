import json
from typing import Any

from fastapi import WebSocket
from llm_client import async_complete
from agents.log_helper import emit_log

DESCRIPTION_SYSTEM = """
You are an AWS architecture explainer. Given a structured requirements JSON, produce a clear
architecture description for non-technical stakeholders. Return JSON only — no prose outside
the JSON object, no markdown formatting inside values, no bullet points:

{
  "overview": "2-4 sentence paragraph describing the overall architecture and its purpose.",
  "key_components": "2-4 sentence paragraph naming and explaining the main AWS services used.",
  "tradeoffs": "2-4 sentence paragraph covering the key design tradeoffs and why they were made.",
  "next_steps": "2-4 sentence paragraph suggesting concrete next steps to evolve this architecture."
}

Rules:
- Each value is plain prose (no bullet points, no markdown headers, no newlines inside values)
- Service names and resource identifiers should appear naturally in prose
- Keep each paragraph to 2-4 sentences
- Valid JSON only. No prose before or after the JSON object.
"""


async def run_description_agent(
    requirements: dict,
    websocket: WebSocket,
    start_time: float = 0,
    diagram_nodes: list | None = None,
    llm_creds: dict[str, Any] | None = None,
) -> None:
    await emit_log(websocket, "description", "Writing architecture description...", start_time)

    if diagram_nodes:
        node_summary = [
            {
                "id": n.get("id"),
                "label": n.get("data", {}).get("label"),
                "category": n.get("data", {}).get("category"),
            }
            for n in diagram_nodes
        ]
        enriched = {**requirements, "architect_diagram": node_summary}
    else:
        enriched = requirements

    prompt = "Generate an architecture description for:\n" + json.dumps(enriched, indent=2)

    raw = await async_complete(
        messages=[{"role": "user", "content": prompt}],
        system=DESCRIPTION_SYSTEM,
        llm_creds=llm_creds,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        sections = json.loads(raw)
        await websocket.send_text(json.dumps({
            "type": "arch_description",
            "sections": sections,
        }))
        await emit_log(websocket, "description", "Description ready", start_time)
    except (json.JSONDecodeError, Exception):
        await websocket.send_text(json.dumps({
            "type": "pipeline_event",
            "stage": "description",
            "event": "parse_failed",
            "level": "warning",
            "message": "Description output could not be parsed.",
        }))
