from setup_pdf_generator import build_setup_pdf


def _pdf_text(pdf_bytes: bytes) -> str:
    return pdf_bytes.decode("latin-1", errors="ignore")


def test_build_setup_pdf_includes_project_specific_issue_75_content() -> None:
    project = {
        "id": "proj-75",
        "title": "Issue 75 Demo",
        "questionnaire_answers": {"region": "us-west-2", "environment": "staging"},
        "arch_description": {"summary": "Three-tier app with VPC, ALB, and RDS."},
        "nodes": [
            {"id": "vpc-main", "data": {"label": "vpc-main", "category": "network"}},
            {"id": "app-db", "data": {"label": "app-db", "category": "database"}},
            {"id": "assets", "data": {"label": "assets", "category": "storage"}},
        ],
        "terraform_files": [
            {"filename": "main.tf", "content": "resource \"aws_vpc\" \"main\" {}\n"},
            {"filename": "variables.tf", "content": "variable \"region\" { type = string }\n"},
        ],
        "cost_estimate": {
            "monthly_total": 123.45,
            "breakdown": [
                {"service": "EC2", "monthly_cost": 80.0},
                {"service": "RDS", "monthly_cost": 43.45},
            ],
        },
    }

    pdf_bytes = build_setup_pdf(project, "2026-03-19T12:00:00+00:00")
    text = _pdf_text(pdf_bytes)

    assert pdf_bytes.startswith(b"%PDF")
    assert "Issue 75 Demo Setup Guide" in text
    assert "main.tf" in text
    assert "terraform plan -out plan.tfplan" in text
    assert "vpc-main" in text
    assert "VPC > Your VPCs" in text
    assert "123.45" in text


def test_build_setup_pdf_shows_defined_empty_state_messages() -> None:
    project = {
        "id": "proj-empty",
        "title": "Empty",
        "questionnaire_answers": {},
        "arch_description": None,
        "nodes": [],
        "terraform_files": [],
        "cost_estimate": None,
    }

    pdf_bytes = build_setup_pdf(project, "2026-03-19T12:00:00+00:00")
    text = _pdf_text(pdf_bytes)

    assert "No architecture description available." in text
    assert "No resources defined yet." in text
    assert "No cost estimate available." in text


def test_build_setup_pdf_reads_cost_estimate_items_payload() -> None:
    project = {
        "id": "proj-items",
        "title": "Items Payload",
        "questionnaire_answers": {},
        "arch_description": {"summary": "ALB fronts ECS."},
        "nodes": [],
        "terraform_files": [],
        "cost_estimate": {
            "monthly_total": 28.15,
            "items": [
                {"node_id": "alb", "label": "Application Load Balancer", "cost": 28.15, "estimated": True},
            ],
        },
    }

    pdf_bytes = build_setup_pdf(project, "2026-04-08T12:00:00+00:00")
    text = _pdf_text(pdf_bytes)

    assert "Application Load Balancer" in text
    assert "28.15" in text
