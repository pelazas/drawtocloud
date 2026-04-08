# Issue 176 Pricing Estimates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop structural VPC/AZ/subnet containers from inflating AWS cost estimates and tune low-information fallbacks to realistic low-usage defaults.

**Architecture:** Keep the fix in the backend cost analyst so the websocket payload stays authoritative for every client. Distinguish structural container nodes from billable AWS resources before fallback pricing, then tune the remaining fallback estimates to match likely low-usage monthly costs in `eu-west-3`.

**Tech Stack:** Python 3.12, pytest, FastAPI backend agents, GitHub issue #176

---

## Chunk 1: Structural Container Pricing Guard

### Task 1: Reproduce the structural-container regression with tests

**Files:**
- Modify: `backend/tests/agents/test_cost_analyst.py`

- [ ] **Step 1: Write the failing tests**

Add async tests that assert:
- a `container` node with `containerType: "vpc"` and `aws_service_code: "AmazonVPC"` returns zero cost
- `az` and `subnet` containers also return zero cost
- a `NAT Gateway` service still returns a non-zero estimate

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `uv run pytest tests/agents/test_cost_analyst.py -k "structural or nat gateway" -v`
Expected: FAIL because structural containers currently inherit the generic `AmazonVPC` estimate.

- [ ] **Step 3: Implement the minimal production change**

Update `backend/agents/cost_analyst.py` to short-circuit structural container nodes (`region`, `vpc`, `az`, `subnet`) to cost-neutral estimated items before generic fallback pricing.

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `uv run pytest tests/agents/test_cost_analyst.py -k "structural or nat gateway" -v`
Expected: PASS

- [ ] **Step 5: Commit**

Commit message: `fix: stop pricing structural network containers`

## Chunk 2: Realistic Fallback Defaults

### Task 2: Lock in realistic fallback expectations with tests

**Files:**
- Modify: `backend/tests/agents/test_cost_analyst.py`
- Modify: `backend/agents/cost_analyst.py`

- [ ] **Step 1: Write the failing tests**

Add async tests that assert:
- `S3 Bucket` gets a small low-usage estimate (roughly sub-$1 or low-single-digit)
- `Application Load Balancer` gets a likely public ALB baseline rather than the current flat fallback

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `uv run pytest tests/agents/test_cost_analyst.py -k "s3 or load balancer" -v`
Expected: FAIL because existing fallbacks are too high or too generic.

- [ ] **Step 3: Implement the minimal production change**

Tune fallback estimates in `backend/agents/cost_analyst.py` to low-usage realistic defaults, including:
- a small S3 baseline
- a likely public ALB baseline that includes base hourly pricing, a small LCU assumption, and public IPv4 charges

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `uv run pytest tests/agents/test_cost_analyst.py -k "s3 or load balancer" -v`
Expected: PASS

- [ ] **Step 5: Commit**

Commit message: `fix: tune fallback pricing defaults`

## Chunk 3: Prevent Regression From Architect Metadata

### Task 3: Update architect guidance and add regression coverage

**Files:**
- Modify: `backend/agents/architect.py`
- Modify: `backend/tests/agents/test_architect.py`
- Modify: `backend/tests/test_generation_service.py`

- [ ] **Step 1: Write the failing tests**

Add coverage that asserts:
- the architect prompt no longer instructs structural VPC/AZ/subnet containers to carry `AmazonVPC`
- persisted nested container metadata still works as before

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `uv run pytest tests/agents/test_architect.py tests/test_generation_service.py -k "container" -v`
Expected: FAIL because the prompt currently requires `aws_service_code` on every node and examples assign `AmazonVPC` to containers.

- [ ] **Step 3: Implement the minimal production change**

Adjust the architect system prompt so structural containers remain nested correctly without being described as billable VPC resources.

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `uv run pytest tests/agents/test_architect.py tests/test_generation_service.py -k "container" -v`
Expected: PASS

- [ ] **Step 5: Commit**

Commit message: `fix: keep container metadata out of vpc pricing`

## Chunk 4: Documentation + Final Verification

### Task 4: Update docs and verify the full fix

**Files:**
- Modify: `documents/platform-docs.md`
- Modify: `documents/data-reference.md`

- [ ] **Step 1: Update documentation**

Document that:
- structural network containers are shown for topology clarity and do not add monthly cost by themselves
- fallback estimates use conservative low-usage defaults when exact service configuration is unknown

- [ ] **Step 2: Run the focused verification suite**

Run: `SUPABASE_URL=https://example.supabase.co SUPABASE_SECRET_KEY=test-secret uv run pytest tests/agents/test_cost_analyst.py tests/agents/test_architect.py tests/test_generation_service.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

Commit message: `docs: clarify structural pricing behavior`
