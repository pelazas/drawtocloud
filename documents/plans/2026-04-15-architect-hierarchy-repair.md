# Architect Hierarchy Repair Implementation Plan

**Goal:** Prevent architect generations from producing empty structural containers with misplaced workloads by enforcing AWS-aware hierarchy rules and repairing obvious mistakes before the frontend renders them.

## Scope

- Add authoritative backend graph normalization before final `done`
- Reject ambiguous multi-subnet placement instead of guessing
- Tighten architect prompt and in-stream parent/container validation
- Add backend tests for normalization, pruning, ambiguity, and validation
- Document hierarchy invariants and normalization behavior

## Tasks

1. Add isolated graph normalization helpers in `backend/architecture_graph.py`
2. Add unit coverage in `backend/tests/test_architecture_graph.py`
3. Integrate normalization into `backend/generation_service.py`
4. Tighten architect prompt and validation in `backend/agents/architect.py`
5. Add architect validation tests in `backend/tests/agents/test_architect.py`
6. Update `documents/data-reference.md` and `documents/platform-docs.md`

## Rules To Enforce

- Valid structural chain is `region -> vpc -> az -> subnet -> services`
- Services under `vpc` or `az` should move to the deepest unambiguous subnet
- Empty `az` and `subnet` containers should be pruned when they have no service descendants
- Allowed root-level services are limited to CloudWatch, Route 53, WAF, and S3
- Ambiguous placement must fail rather than guessing silently

## Verification

- `pytest backend/tests/test_architecture_graph.py backend/tests/test_generation_service.py backend/tests/agents/test_architect.py -v`
