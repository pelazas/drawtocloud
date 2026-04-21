#!/usr/bin/env python3
"""Validation tests for .github/workflows/deploy-on-tag.yml

These tests enforce the acceptance criteria from issue #223:
1. Deploy no longer uses --volumes --rmi all --remove-orphans
2. Images are built in CI (or pre-built) rather than on the server
3. Deploy waits for /health/ready before marking successful
4. Server IP/username are not hardcoded in the workflow file
5. Rollback to previous image is possible
"""

import pathlib
import re
import sys

import yaml

WORKFLOW_PATH = pathlib.Path(__file__).parent.parent.parent / ".github" / "workflows" / "deploy-on-tag.yml"


def _load_workflow() -> dict:
    if not WORKFLOW_PATH.exists():
        pytest.fail(f"Workflow file not found: {WORKFLOW_PATH}")
    with WORKFLOW_PATH.open() as f:
        return yaml.safe_load(f)


def _get_step_run_content(workflow: dict, step_name_contains: str) -> str:
    """Return the 'run' content of the first step whose name contains the given string."""
    jobs = workflow.get("jobs", {})
    for job in jobs.values():
        for step in job.get("steps", []):
            name = step.get("name", "")
            if step_name_contains.lower() in name.lower():
                return step.get("run", "")
    return ""


def _get_all_run_content(workflow: dict) -> str:
    """Return concatenated 'run' content from all steps."""
    content = []
    jobs = workflow.get("jobs", {})
    for job in jobs.values():
        for step in job.get("steps", []):
            if "run" in step:
                content.append(step["run"])
    return "\n".join(content)


# ---------------------------------------------------------------------------
# AC-1: No destructive docker flags
# ---------------------------------------------------------------------------

def test_no_destructive_docker_down():
    """Workflow must never run 'docker compose down --volumes --rmi all --remove-orphans'."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    assert "--volumes --rmi all" not in all_run, "Found destructive --volumes --rmi all flag"
    assert "--remove-orphans" not in all_run, "Found destructive --remove-orphans flag"


def test_no_rmi_all():
    """Workflow must never run 'docker rmi all' or similar."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    assert "--rmi all" not in all_run, "Found destructive --rmi all flag"


# ---------------------------------------------------------------------------
# AC-2: Images built in CI, not on server
# ---------------------------------------------------------------------------

def test_ci_builds_images():
    """Workflow must build images in CI (e.g., via docker build or docker/build-push-action)."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    uses = []
    jobs = workflow.get("jobs", {})
    for job in jobs.values():
        for step in job.get("steps", []):
            if "uses" in step:
                uses.append(step["uses"])

    builds_in_ci = (
        "docker build" in all_run
        or "docker/build-push-action" in " ".join(uses)
        or "docker/build-push-action" in all_run
    )
    assert builds_in_ci, "Workflow must build images in CI (docker build or build-push-action)"


def test_server_pulls_prebuilt_images():
    """Server deploy step must pull images (docker compose pull) rather than build."""
    workflow = _load_workflow()
    deploy_run = _get_step_run_content(workflow, "deploy")
    assert "docker compose pull" in deploy_run, "Server must pull pre-built images"


def test_server_does_not_build():
    """Server deploy step must not contain --build."""
    workflow = _load_workflow()
    deploy_run = _get_step_run_content(workflow, "deploy")
    assert "--build" not in deploy_run, "Server must not build images (--build found)"


# ---------------------------------------------------------------------------
# AC-3: Health gate after deploy
# ---------------------------------------------------------------------------

def test_health_gate_exists():
    """Workflow must curl /health/ready and fail deploy if not 200."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    assert "/health/ready" in all_run, "Workflow must check /health/ready after deploy"


def test_health_gate_fails_on_bad_status():
    """Health gate must cause the workflow to fail when the endpoint is unhealthy."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    # Look for retry loop or set -e combined with curl --fail or explicit exit
    has_fail_logic = (
        "set -e" in all_run
        and ("curl --fail" in all_run or "exit 1" in all_run or "|| exit" in all_run)
    )
    assert has_fail_logic, "Health gate must fail the deploy when unhealthy"


# ---------------------------------------------------------------------------
# AC-4: No hardcoded server IP/username
# ---------------------------------------------------------------------------

def test_no_hardcoded_ip():
    """Workflow must not contain hardcoded IP addresses like 5.75.155.106."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    ip_pattern = re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")
    matches = ip_pattern.findall(all_run)
    assert not matches, f"Found hardcoded IP(s): {matches}"


def test_server_via_secrets_or_vars():
    """Server connection must use GitHub secrets/variables (e.g., secrets.SSH_HOST, vars.SSH_USER)."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    uses_vars_or_secrets = "secrets." in all_run or "vars." in all_run
    assert uses_vars_or_secrets, "Server host/user must come from secrets or vars"


# ---------------------------------------------------------------------------
# AC-5: Rollback capability
# ---------------------------------------------------------------------------

def test_image_retention_or_tagging():
    """Workflow must retain previous images or tag them for rollback (e.g., keep last N tags)."""
    workflow = _load_workflow()
    all_run = _get_all_run_content(workflow)
    has_retention = (
        "docker tag" in all_run
        or "docker image tag" in all_run
        or "docker image prune" in all_run
        or "docker images" in all_run
        or "keep" in all_run
        or "rollback" in all_run
        or "backup" in all_run
    )
    assert has_retention, "Workflow must retain previous images or support rollback"


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
