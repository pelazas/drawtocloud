"""Tests for production Docker infrastructure. Issue #222."""

import pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]


class TestFrontendDockerfile:
    def test_frontend_dockerfile_exists(self):
        dockerfile = REPO_ROOT / "frontend" / "Dockerfile"
        assert dockerfile.exists(), "frontend/Dockerfile must exist"

    def test_frontend_dockerfile_uses_node_20_alpine(self):
        content = (REPO_ROOT / "frontend" / "Dockerfile").read_text()
        assert "node:20-alpine" in content, "Must use node:20-alpine base image"

    def test_frontend_dockerfile_is_multi_stage(self):
        content = (REPO_ROOT / "frontend" / "Dockerfile").read_text()
        # At least two FROM lines indicating multi-stage
        from_count = content.lower().count("from ")
        assert from_count >= 2, "Must be a multi-stage build (at least 2 FROM lines)"

    def test_frontend_dockerfile_runs_next_start_not_dev(self):
        content = (REPO_ROOT / "frontend" / "Dockerfile").read_text()
        # Accept shell form (next start) or exec JSON form (["...", "next", "start"])
        normalized = content.replace('"', "").replace(",", "")
        assert "next start" in normalized, "Production image must run 'next start'"
        assert "next dev" not in normalized, "Production image must not run 'next dev'"

    def test_next_config_has_standalone_output(self):
        config = REPO_ROOT / "frontend" / "next.config.mjs"
        content = config.read_text()
        assert "output:" in content and "standalone" in content, (
            "next.config.mjs must set output: 'standalone' for minimal runtime image"
        )


class TestBackendDockerfile:
    def test_backend_dockerfile_exists(self):
        dockerfile = REPO_ROOT / "backend" / "Dockerfile"
        assert dockerfile.exists(), "backend/Dockerfile must exist"

    def test_backend_dockerfile_uses_python_312_slim(self):
        content = (REPO_ROOT / "backend" / "Dockerfile").read_text()
        assert "python:3.12-slim" in content, "Must use python:3.12-slim base image"

    def test_backend_dockerfile_no_reload(self):
        content = (REPO_ROOT / "backend" / "Dockerfile").read_text()
        assert "--reload" not in content, "Production image must not use --reload"

    def test_backend_dockerfile_installs_only_production_deps(self):
        content = (REPO_ROOT / "backend" / "Dockerfile").read_text()
        assert "--no-dev" in content or "--only-production" in content, (
            "Must exclude dev dependencies (pytest, coverage) from production image"
        )
