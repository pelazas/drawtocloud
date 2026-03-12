import json
import time


async def emit_log(websocket, agent: str, message: str, start_time: float) -> None:
    elapsed = round(time.time() - start_time, 1)
    await websocket.send_text(json.dumps({
        "type": "agent_log",
        "agent": agent,
        "message": message,
        "elapsed": elapsed,
    }))
