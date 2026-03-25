# AWS Pricing API + Real-Time Cost Panel

**Issue:** #118
**Date:** 2026-03-25
**Status:** Approved

---

## Overview

Replace the client-side hardcoded cost estimator (`frontend/lib/costEstimator.ts`) with real AWS Pricing API calls on the backend, and upgrade the cost overlay from a simple badge to a detailed collapsible panel.

---

## Pipeline Changes

Current flow after architect completes:

```
Requirements → Architect → Description (parallel)
```

New flow:

```
Requirements → Architect (streams events) → Cost Analyst → done
```

- **Description agent**: removed from `_run_generation`. Separate feature later.
- **Coder agent**: already triggered manually via `generate_terraform` WS message. No change.
- **Cost analyst**: runs synchronously right after architect completes. Pure API lookups (no LLM call), so no need for the specialist retry machinery.

The cost analyst result is:
1. Sent to frontend as a `cost_estimate` WS message
2. Persisted to Supabase `cost_estimate` column
3. Stored in `PersistenceState`

---

## Architect Agent Changes

The architect system prompt is updated to emit pricing metadata on `add_node` events:

```json
{"action": "add_node", "id": "rds", "label": "RDS PostgreSQL", "category": "database", "aws_service_code": "AmazonRDS", "instance_type": "db.t3.medium", "engine": "PostgreSQL"}
{"action": "add_node", "id": "ec2", "label": "EC2 Instance", "category": "compute", "aws_service_code": "AmazonEC2", "instance_type": "t3.medium"}
{"action": "add_node", "id": "lambda", "label": "Lambda", "category": "compute", "aws_service_code": "AWSLambda"}
```

### New fields on `add_node` events

| Field | Required | Description |
|---|---|---|
| `aws_service_code` | Yes (all nodes) | AWS Pricing API service code (e.g. `AmazonRDS`, `AmazonEC2`) |
| `instance_type` | Only instance-based | Instance tier (e.g. `db.t3.medium`, `t3.medium`) |
| `engine` | Only RDS/ElastiCache | Database engine (e.g. `PostgreSQL`, `Redis`) |

The architect already has budget context and picks appropriate tiers (e.g. `db.t3.micro` for tight budgets).

### Backend validation

A small allowlist of valid `aws_service_code` values. If the architect emits an unrecognized code, the cost analyst falls back to a keyword-to-SKU lookup table before attempting the Pricing API.

---

## Cost Analyst Implementation

`backend/agents/cost_analyst.py` is replaced with a real module. No LLM calls — pure API lookups.

### Function signature

```python
async def run_cost_analyst(
    nodes: list[dict],
    regions: list[str],
    project_id: str,
    runtime: GenerationRuntime,
) -> dict | None
```

### Logic flow

1. **Check AWS credentials**: read `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` from env. If absent, skip entirely — no cost message sent, return `None`.
2. **Resolve region**: use first region from pre-gen form answers. If none provided, call ipapi.co from the backend to determine closest region via Haversine distance.
3. **For each node**:
   - **Instance-based** (has `instance_type`): call `boto3` Pricing API `GetProducts` with filters for service code, instance type, region, and engine. Extract On-Demand hourly price → multiply by 730 for monthly estimate.
   - **Usage-based** (no `instance_type`): use hardcoded monthly estimates from a `USAGE_ESTIMATES` dict. Mark as `estimated: true`.
   - **Unknown/invalid `aws_service_code`**: fall back to keyword-to-cost table, mark as `estimated: true`.
4. **Build response**: assemble `cost_estimate` payload, send via WS, persist to Supabase.

### Caching

Module-level in-memory cache:

```python
_price_cache: dict[str, float] = {}
# key format: "AmazonRDS:db.t3.medium:us-east-1" → value: 29.20
```

Cache lives for server process lifetime. Checked before any API call. AWS prices change at most a few times per year.

### Service classification

**Instance-based** (query AWS Pricing API):
- EC2, RDS, ElastiCache, NAT Gateway, ECS Fargate

**Usage-based** (hardcoded estimates, `estimated: true`):
- Lambda, S3, SQS, SNS, CloudWatch, Route53, API Gateway, CloudFront, WAF, DynamoDB, EFS

---

## Region Detection (Backend)

New utility: `backend/region_detect.py`

### Function

```python
async def detect_closest_region(client_ip: str | None) -> str
```

- Calls `https://ipapi.co/json/` (or `https://ipapi.co/{ip}/json/` if IP provided)
- Runs Haversine formula against same AWS region coordinates as the frontend's `regionDetect.ts`
- Returns closest region code (e.g. `us-east-1`)
- Falls back to `us-east-1` on any failure

The client IP is extracted from WebSocket connection headers at generation start.

---

## Canvas Edit Cost Updates

### Node added

After `ws_handler.py` processes a `canvas_edit` → `add_node`:
1. Cost analyst prices just that one node (single API lookup or keyword fallback)
2. Sends updated `cost_estimate` message with the new node appended to existing breakdown + recalculated total

Manually-added nodes (no `aws_service_code`) use the keyword-to-SKU fallback table. Marked `estimated: true`.

### Node removed

Frontend handles client-side:
- Drop the item from the stored breakdown
- Recalculate total
- No backend call needed

### Node renamed

No cost change — price is keyed to `aws_service_code` + `instance_type`, not label.

---

## Frontend: CostOverlay Panel

Replace the 13-line badge with a collapsible panel component.

### Collapsed state (default)

Same position (top-right of canvas). Shows `$99/mo`. Click to expand.

### Expanded state

```
+-------------------------------------+
| Prices for us-east-1           $/mo |
+-------------------------------------+
| RDS PostgreSQL                 $29  |
|  db.t3.medium                       |
| ECS Fargate                    $28  |
|  0.25 vCPU, 0.5GB                   |
| NAT Gateway                    $32  |
| Lambda                  ~$5   est.  |
| S3 Bucket               ~$5   est.  |
+-------------------------------------+
| Total                          $99  |
+-------------------------------------+
```

- Transparent/blurred background: `backdrop-blur-md bg-black/30` (consistent with existing style)
- Instance type shown as muted subtext below service name
- `est.` tag on usage-based rows
- Region label at the top
- Total with separator at the bottom
- Component stays under 150 lines; split item row into sub-component if needed

### useCanvasPipeline.ts changes

- Handle new `cost_estimate` WS message type
- Store full breakdown in pipeline state (replaces `useMemo` → `estimateCost`)
- On `canvas_edit` ack for `remove_node`: filter removed node from breakdown, recalculate total client-side

---

## Frontend Removals

- Delete `frontend/lib/costEstimator.ts`
- Delete `frontend/lib/__tests__/costEstimator.test.ts`
- Remove `estimateCost` import/usage from `app/page.tsx`
- Remove `estimateCost` import/usage from `lib/projects.ts`
- `projects.ts` project summaries read `cost_estimate.monthly_total` from persisted project data instead

---

## WS Message

**Server → Client** (emitted after architect completes):

```json
{
  "type": "cost_estimate",
  "project_id": "...",
  "region": "us-east-1",
  "monthly_total": 99.20,
  "items": [
    {"node_id": "rds", "label": "RDS PostgreSQL", "instance_type": "db.t3.medium", "cost": 29.20, "estimated": false},
    {"node_id": "ecs", "label": "ECS Fargate", "instance_type": "0.25 vCPU / 0.5GB", "cost": 28.00, "estimated": false},
    {"node_id": "nat", "label": "NAT Gateway", "cost": 32.00, "estimated": false},
    {"node_id": "lambda", "label": "Lambda", "cost": 5.00, "estimated": true},
    {"node_id": "s3", "label": "S3 Bucket", "cost": 5.00, "estimated": true}
  ]
}
```

---

## Affected Files

### Backend (modified)
- `backend/agents/architect.py` — update system prompt to emit `aws_service_code`, `instance_type`, `engine`
- `backend/agents/cost_analyst.py` — replace no-op stub with AWS Pricing API client + cache
- `backend/generation_service.py` — call cost analyst after architect; remove description agent from auto-run; emit `cost_estimate` WS message
- `backend/ws_handler.py` — handle canvas-edit cost diff (add node → price it)
- `backend/.env.example` — add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

### Backend (new)
- `backend/region_detect.py` — server-side geo-IP + Haversine utility

### Frontend (modified)
- `frontend/components/CostOverlay.tsx` — replace badge with collapsible panel
- `frontend/lib/useCanvasPipeline.ts` — handle `cost_estimate` WS message, store breakdown in state
- `frontend/lib/projects.ts` — stop calling `estimateCost`, read from persisted cost
- `frontend/app/page.tsx` — remove `estimateCost` usage, pass full breakdown to CostOverlay

### Frontend (deleted)
- `frontend/lib/costEstimator.ts`
- `frontend/lib/__tests__/costEstimator.test.ts`

### Docs (updated)
- `CLAUDE.md` — add `cost_estimate` to Server→Client WS message types
- `documents/data-reference.md` — update `CostBreakdown` and `NodeCost` types
