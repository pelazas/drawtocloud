from unittest.mock import AsyncMock, Mock, patch

import pytest

from setup_pdf_service import _run_setup_pdf_generation


@pytest.mark.asyncio
async def test_run_setup_pdf_generation_passes_issue_75_fields_to_renderer() -> None:
    project_row = {
        "id": "project-123",
        "title": "Payments Platform",
        "questionnaire_answers": {"region": "us-east-1", "environment": "prod"},
        "nodes": [{"id": "vpc-main", "data": {"label": "vpc-main", "category": "network"}}],
        "edges": [{"source": "vpc-main", "target": "app"}],
        "terraform_files": [{"filename": "main.tf", "content": "resource \"aws_vpc\" \"main\" {}"}],
        "cost_estimate": {"monthly_total": 42.5, "breakdown": [{"service": "EC2", "monthly_cost": 22.0}]},
        "description": {"summary": "Project-specific architecture summary"},
        "thumbnail_url": "https://example.com/ignored.png",
    }

    mock_build_pdf = Mock(return_value=b"%PDF-1.7\\nmock")

    with patch("setup_pdf_service.get_project_for_user", new=AsyncMock(return_value=project_row)):
        with patch("setup_pdf_service._update_status", new=AsyncMock()):
            with patch("setup_pdf_service._emit_status_event", new=AsyncMock()):
                with patch("setup_pdf_service.build_setup_pdf", new=mock_build_pdf):
                    with patch("setup_pdf_service._upload_pdf_and_sign", new=Mock(return_value="https://example.com/signed.pdf")):
                        await _run_setup_pdf_generation("user-123", "project-123")

    render_payload = mock_build_pdf.call_args.args[0]
    assert render_payload["cost_estimate"] == project_row["cost_estimate"]
    assert render_payload["arch_description"] == project_row["description"]
