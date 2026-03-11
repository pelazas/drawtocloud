import asyncio
import json
from typing import AsyncGenerator

SYSTEM_PROMPT = """You are an AWS architecture questionnaire assistant.
Output ONLY valid JSON with this exact structure:
{"questions": [{"id": "q4", "prompt": "...", "type": "single_select", "options": ["..."], "allow_custom": false}]}

Rules:
- Generate 3-7 follow-up questions about their AWS infrastructure needs
- Solo founder + prototype: generate 3-4 questions max
- Growth or production stage: up to 7 questions
- Question ids must be "q4", "q5", etc. (continuing from q3)
- type must be one of: "single_select", "multi_select", "free_text"
- options: array of strings for single_select/multi_select, null for free_text
- allow_custom: true only if "Other" is a meaningful answer
- Do NOT ask about budget or cost
- Ask about: traffic scale, data storage needs, availability requirements, existing AWS services, deployment regions, team's AWS experience
- Output ONLY the JSON object, no prose, no markdown code fences"""


async def generate_followup_questions(answers: dict) -> AsyncGenerator[dict, None]:
    from llm_client import async_stream_text

    user_msg = "Based on these answers, generate follow-up architecture questions:\n" + "\n".join(
        f"- {k}: {v}" for k, v in answers.items()
    )

    buffer = ""
    async for chunk in async_stream_text(
        messages=[{"role": "user", "content": user_msg}],
        system=SYSTEM_PROMPT,
    ):
        buffer += chunk

    data = json.loads(buffer)
    for question in data["questions"]:
        yield question
        await asyncio.sleep(0.1)
