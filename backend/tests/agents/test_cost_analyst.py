import asyncio


class MockWebSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, payload: str) -> None:
        self.sent.append(payload)


def test_cost_analyst_is_noop():
    async def run():
        ws = MockWebSocket()
        from agents.cost_analyst import run_cost_analyst

        await run_cost_analyst({"app_type": "web"}, ws)
        return ws

    ws = asyncio.run(run())
    assert ws.sent == []


def test_cost_analyst_accepts_optional_parameters():
    async def run():
        ws = MockWebSocket()
        from agents.cost_analyst import run_cost_analyst

        await run_cost_analyst(
            requirements={"app_type": "web", "monthly_budget": 100},
            websocket=ws,
            start_time=1.23,
            diagram_nodes=[{"id": "rds"}],
            llm_creds={"provider": "openai", "api_key": "sk"},
        )
        return ws

    ws = asyncio.run(run())
    assert ws.sent == []
