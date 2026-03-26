# Chat Cost/Architecture Proposal Loop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current pipeline-leaking "plan proposal" chat behavior with a conversation-first architecture optimization loop that analyzes cost drivers, requests missing usage inputs, proposes updated architecture + pricing options, and only runs generation after explicit user approval.

**Architecture:** Keep the existing backend generation pipeline, but hide it behind a new chat contract. For architecture-wide cost/refactor intents, the backend should return structured assistant outcomes (`analysis`, `question`, `proposal`, `approval_ready`) instead of hardcoded plan text. Chat iterates in place with usage assumptions and scenario pricing until the user approves a concrete proposal option, then `chat_plan_approve` starts generation using approved proposal context.

**Tech Stack:** FastAPI WebSocket orchestration, Python agent prompts/logic, Next.js chat UI state, TypeScript message contracts, pytest + frontend unit tests.

---

## Current Behavior Diagnosis

- `backend/ws_handler.py` classifies architecture-wide requests and immediately returns a static message from `_build_architecture_plan_message(...)`.
- That message exposes internals (`requirements -> architect -> cost analyst`) and sets `plan_ready=true` right away.
- `frontend/components/Chat.tsx` renders that as a single CTA (`Looks good, generate`), so the user cannot iterate on options before approval.
- `backend/agents/cost_analyst.py` estimates mostly static per-node monthly values; it does not model traffic/request/user sensitivity in chat-driven what-if analysis.
- Result: for prompts like "How can I make this architecture cheaper?", the system skips analysis dialog and jumps to an approval gate.

## File Structure

- Modify: `backend/ws_handler.py`
  - Replace hardcoded architecture-plan response path with iterative proposal flow.
  - Keep approval endpoint, but approve a concrete proposal state instead of generic plan text.
- Modify: `backend/agents/chat_agent.py`
  - Add architecture-cost optimization response strategy and prompts that ask for missing usage assumptions.
- Modify: `backend/agents/cost_analyst.py`
  - Support usage-aware scenario pricing for chat proposals (`baseline`, `expected`, `peak`) and richer line-item output.
- Modify: `backend/tests/test_ws_handler.py`
  - Update architecture-wide request tests to assert analysis/question/proposal behavior and non-leaking copy.
- Modify: `backend/tests/agents/test_chat_agent.py`
  - Add tests for cost-driver analysis prompts, missing-usage follow-ups, and proposal formatting.
- Modify: `backend/tests/agents/test_cost_analyst.py`
  - Add tests for usage-input sensitivity and scenario totals.
- Modify: `frontend/lib/projects.ts`
  - Extend chat message typing for proposal payloads and assumptions metadata.
- Modify: `frontend/lib/useCanvasPipeline.ts`
  - Parse/store proposal metadata across `chat_reply_delta/done`; track pending proposal approval target.
- Modify: `frontend/components/Chat.tsx`
  - Render proposal-focused approval affordance and iterative pricing summaries (instead of plan-only CTA).
- Modify: `frontend/lib/__tests__/chatStarters.test.ts`
  - Ensure starters remain aligned with new behavior.
- Modify: `documents/platform-docs.md`
  - Update chat-driven refactor section to new contract (no pipeline leakage, iterative proposal loop).
- Modify: `documents/data-reference.md`
  - Document new chat metadata shape for proposal/assumption state.

## Tasks

### Task 1: Replace static architecture-plan path with iterative chat outcomes (backend)

**Files:**
- Modify: `backend/ws_handler.py`
- Modify: `backend/tests/test_ws_handler.py`

- [ ] **Step 1: Write failing tests for architecture-wide prompts**
  - Assert no static "Proposed architecture refactor plan" template response.
  - Assert first response can be analysis/question/proposal (not immediate plan approval in all cases).
  - Assert response copy avoids exposing internal pipeline stage names.

- [ ] **Step 2: Run targeted websocket tests and confirm failures**
  - Run: `cd backend && uv run pytest tests/test_ws_handler.py -k "chat_architecture or plan_approve or cheaper" -q`

- [ ] **Step 3: Implement new architecture-wide chat flow in `ws_handler.py`**
  - Remove `_build_architecture_plan_message` usage from default architecture-wide handling.
  - Route architecture-wide messages through chat agent logic that can return:
    - analysis message with current cost hotspots
    - single follow-up question for missing usage assumptions
    - proposal with one or more cheaper options
  - Keep `chat_plan_approve`, but ensure it approves a specific proposal context captured in chat metadata.

- [ ] **Step 4: Re-run targeted websocket tests and make green**
  - Run: `cd backend && uv run pytest tests/test_ws_handler.py -k "chat_architecture or plan_approve or cheaper" -q`

### Task 2: Add cost-optimization conversational strategy in chat agent

**Files:**
- Modify: `backend/agents/chat_agent.py`
- Modify: `backend/tests/agents/test_chat_agent.py`

- [ ] **Step 1: Add failing unit tests for cheaper-architecture prompts**
  - Assert prompt strategy highlights current cost drivers from `cost_estimate`.
  - Assert when usage data is missing, assistant asks for concrete traffic/users/request volume.
  - Assert assistant output includes actionable cost alternatives (downsize vs architectural simplification).

- [ ] **Step 2: Run targeted tests and confirm failures**
  - Run: `cd backend && uv run pytest tests/agents/test_chat_agent.py -q`

- [ ] **Step 3: Implement strategy + prompt updates**
  - Extend system prompt instructions for architecture-cost conversations:
    - explain top cost contributors first
    - explain that estimates depend on workload assumptions
    - ask concise follow-up for missing usage data before final recommendation
    - present full updated pricing list when enough inputs exist
  - Preserve read-only default unless user explicitly asks to apply/generate.

- [ ] **Step 4: Re-run agent tests and make green**
  - Run: `cd backend && uv run pytest tests/agents/test_chat_agent.py -q`

### Task 3: Introduce usage-aware scenario pricing for proposal responses

**Files:**
- Modify: `backend/agents/cost_analyst.py`
- Modify: `backend/tests/agents/test_cost_analyst.py`

- [ ] **Step 1: Add failing tests for usage sensitivity**
  - Given higher request/traffic/user inputs, monthly totals should increase predictably.
  - Scenario outputs should include at least `baseline`, `expected`, `peak` totals and line-item deltas.

- [ ] **Step 2: Run targeted cost-analyst tests and confirm failure**
  - Run: `cd backend && uv run pytest tests/agents/test_cost_analyst.py -q`

- [ ] **Step 3: Implement usage-aware pricing helpers**
  - Add optional usage profile input shape (requests, active users, bandwidth/traffic).
  - Apply usage multipliers for relevant services (API Gateway, CloudFront, Lambda, queueing, storage transfer).
  - Return richer payload for chat proposals while preserving existing payload compatibility for current UI.

- [ ] **Step 4: Re-run targeted tests and make green**
  - Run: `cd backend && uv run pytest tests/agents/test_cost_analyst.py -q`

### Task 4: Frontend chat contract and proposal UX updates

**Files:**
- Modify: `frontend/lib/projects.ts`
- Modify: `frontend/lib/useCanvasPipeline.ts`
- Modify: `frontend/components/Chat.tsx`
- Modify: `frontend/lib/__tests__/chatStarters.test.ts`

- [ ] **Step 1: Add/adjust types for proposal metadata**
  - Include proposal id, assumption summary, pricing table/scenarios, and recommendation reason.

- [ ] **Step 2: Update pipeline state handling**
  - Parse proposal metadata from `chat_reply_done`.
  - Keep only latest approvable proposal as CTA target.

- [ ] **Step 3: Update chat rendering**
  - Replace generic plan CTA semantics with proposal approval semantics.
  - Keep button text user-facing (example: "Use this architecture") without pipeline language.

- [ ] **Step 4: Run frontend targeted tests**
  - Run: `cd frontend && pnpm test -- --runInBand lib/__tests__/chatStarters.test.ts`

### Task 5: Approval execution path and persistence contract

**Files:**
- Modify: `backend/ws_handler.py`
- Modify: `backend/tests/test_ws_handler.py`
- Modify: `documents/data-reference.md`
- Modify: `documents/platform-docs.md`

- [ ] **Step 1: Ensure `chat_plan_approve` uses approved proposal context**
  - Persist approved proposal assumptions/requested change in chat history metadata.
  - Build rerun answers from approved proposal state, not only raw user text.

- [ ] **Step 2: Add regression tests**
  - Approval starts generation with expected conversation context.
  - Missing/stale proposal id returns actionable error asking user to request a new proposal.

- [ ] **Step 3: Update platform/docs contracts**
  - Document new chat-driven proposal loop and WS payload fields.
  - Remove docs that imply exposing internal pipeline in assistant copy.

- [ ] **Step 4: Run contract-focused test subset**
  - Run: `cd backend && uv run pytest tests/test_ws_handler.py tests/agents/test_chat_agent.py tests/agents/test_cost_analyst.py -q`

### Task 6: End-to-end verification

**Files:**
- Modify as needed from prior tasks.

- [ ] **Step 1: Backend full verification**
  - Run: `cd backend && uv run pytest -q`

- [ ] **Step 2: Frontend verification**
  - Run: `cd frontend && pnpm test`

- [ ] **Step 3: Manual conversational acceptance check**
  - Scenario A: "How can I make this architecture cheaper?" -> assistant identifies high-cost components, asks usage assumptions, then provides updated pricing list.
  - Scenario B: User asks for cheaper still -> assistant proposes alternate downsized architecture with trade-offs.
  - Scenario C: Approval action starts generation and streams updated outputs without exposing pipeline internals in chat copy.
