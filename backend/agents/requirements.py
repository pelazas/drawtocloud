import json
from llm_client import async_complete

SYSTEM_PROMPT = """You are an AWS solutions architect for DrawToCloud.
Convert questionnaire answers to a structured requirements JSON.

Answer keys will be: app_type, stage, team_size, then q4, q5, q6... for LLM-generated questions.

Rules:
- Infer what the user needs even if vague — make the reasonable default
- MVP/prototype: prefer simplicity, single AZ, managed services
- Growth/production: add redundancy, multi-AZ, consider auto-scaling
- Always include VPC and CloudWatch
- `inferred_services` must be ordered: network → compute → data → monitoring
- `architecture_style` must be one of: simple_three_tier | serverless | data_pipeline |
  microservices | static_with_api | ml_workload
- `notes`: single sentence capturing the most important constraint/decision

Output ONLY valid JSON. No prose, no markdown fences."""


async def generate_requirements(answers: dict) -> dict:
    user_msg = "Convert these questionnaire answers into a requirements JSON:\n" + json.dumps(answers, indent=2)
    raw = await async_complete(
        messages=[{"role": "user", "content": user_msg}],
        system=SYSTEM_PROMPT,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Requirements agent returned invalid JSON: {e}") from e
