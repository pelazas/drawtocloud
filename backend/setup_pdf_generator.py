import io
import textwrap
import urllib.request
from datetime import datetime, timezone
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps

PAGE_WIDTH = 1240
PAGE_HEIGHT = 1754
MARGIN_X = 84
MARGIN_TOP = 96
MARGIN_BOTTOM = 84
LINE_GAP = 10


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _new_page() -> Image.Image:
    return Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), "white")


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont | ImageFont.FreeTypeFont) -> int:
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        return max(0, bbox[2] - bbox[0])
    except Exception:
        return int(len(text) * 7)


def _line_height(draw: ImageDraw.ImageDraw, font: ImageFont.ImageFont | ImageFont.FreeTypeFont) -> int:
    try:
        bbox = draw.textbbox((0, 0), "Ag", font=font)
        return max(16, bbox[3] - bbox[1])
    except Exception:
        return 18


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    width: int,
) -> list[str]:
    words = text.split()
    if not words:
        return [""]

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if _text_width(draw, candidate, font) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _write_paragraph(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: int,
    y: int,
    width: int,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    fill: str = "#0f172a",
) -> int:
    line_height = _line_height(draw, font)
    for line in _wrap_text(draw, text, font, width):
        draw.text((x, y), line, fill=fill, font=font)
        y += line_height + LINE_GAP
    return y


def _write_bullets(
    draw: ImageDraw.ImageDraw,
    bullets: list[str],
    x: int,
    y: int,
    width: int,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
) -> int:
    bullet_indent = 28
    for bullet in bullets:
        wrapped = _wrap_text(draw, bullet, font, width - bullet_indent)
        if not wrapped:
            continue
        draw.text((x, y), "-", fill="#1f2937", font=font)
        draw.text((x + bullet_indent, y), wrapped[0], fill="#1f2937", font=font)
        line_height = _line_height(draw, font)
        y += line_height + LINE_GAP
        for continuation in wrapped[1:]:
            draw.text((x + bullet_indent, y), continuation, fill="#1f2937", font=font)
            y += line_height + LINE_GAP
        y += 4
    return y


def _read_thumbnail(url: str | None) -> Image.Image | None:
    if not isinstance(url, str) or not url.strip():
        return None

    try:
        with urllib.request.urlopen(url.strip(), timeout=8) as response:
            payload = response.read()
        image = Image.open(io.BytesIO(payload)).convert("RGB")
        return image
    except Exception:
        return None


def _safe_str(value: Any, fallback: str = "") -> str:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            return stripped
    return fallback


def _terraform_file_names(project: dict[str, Any]) -> list[str]:
    files = project.get("terraform_files")
    if not isinstance(files, list):
        return []

    names: list[str] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        filename = entry.get("filename")
        if isinstance(filename, str) and filename.strip():
            names.append(filename.strip())
    return sorted(set(names))


def _resource_checklist(project: dict[str, Any]) -> list[str]:
    nodes = project.get("nodes")
    if not isinstance(nodes, list):
        return []

    checklist: list[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        label = _safe_str(data.get("label"), "Unnamed resource")
        category = _safe_str(data.get("category"), "general")
        checklist.append(f"{label} ({category})")

    if not checklist:
        checklist.append("Review generated Terraform resources before deployment.")

    return checklist[:20]


def _project_commands(project: dict[str, Any]) -> list[str]:
    names = _terraform_file_names(project)
    files_hint = " ".join(names) if names else "main.tf variables.tf outputs.tf"
    return [
        "cd <your-project-directory>",
        "terraform fmt",
        f"terraform validate # expects files like: {files_hint}",
        "terraform init",
        "terraform plan -out plan.tfplan",
        "terraform apply plan.tfplan",
        "terraform show",
    ]


def build_setup_pdf(project: dict[str, Any], generated_at_iso: str) -> bytes:
    title_font = _load_font(30)
    heading_font = _load_font(22)
    body_font = _load_font(16)
    code_font = _load_font(15)

    app_name = _safe_str(project.get("title"), "Untitled Project")
    project_id = _safe_str(project.get("id"), "unknown-project")
    region = _safe_str(project.get("questionnaire_answers", {}).get("region") if isinstance(project.get("questionnaire_answers"), dict) else None, "us-east-1")

    pages: list[Image.Image] = []

    # Page 1: Overview + assumptions + architecture image
    page = _new_page()
    draw = ImageDraw.Draw(page)
    y = MARGIN_TOP

    draw.text((MARGIN_X, y), f"{app_name} Setup Guide", fill="#0b1220", font=title_font)
    y += 56
    y = _write_paragraph(
        draw,
        "Purpose: this guide helps beginner developers safely deploy and manage the generated AWS infrastructure for this project.",
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )
    y += 10
    y = _write_paragraph(
        draw,
        f"Generated at: {generated_at_iso}  |  Project ID: {project_id}  |  Target region: {region}",
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
        fill="#334155",
    )

    y += 8
    draw.text((MARGIN_X, y), "Assumptions", fill="#0f172a", font=heading_font)
    y += 36
    y = _write_bullets(
        draw,
        [
            "You have an AWS account with access to create infrastructure resources.",
            "You are deploying from a local machine with internet access.",
            "You will review terraform plan output before every apply.",
            "You will store secrets outside Terraform state where possible.",
        ],
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    y += 12
    draw.text((MARGIN_X, y), "Architecture Snapshot", fill="#0f172a", font=heading_font)
    y += 42

    thumbnail = _read_thumbnail(_safe_str(project.get("thumbnail_url")))
    preview_x = MARGIN_X
    preview_y = y
    preview_w = PAGE_WIDTH - (MARGIN_X * 2)
    preview_h = PAGE_HEIGHT - preview_y - MARGIN_BOTTOM
    if thumbnail is not None:
        fitted = ImageOps.contain(thumbnail, (preview_w, preview_h))
        bg = Image.new("RGB", (preview_w, preview_h), "#f8fafc")
        offset_x = (preview_w - fitted.width) // 2
        offset_y = (preview_h - fitted.height) // 2
        bg.paste(fitted, (offset_x, offset_y))
        page.paste(bg, (preview_x, preview_y))
    else:
        draw.rectangle(
            [preview_x, preview_y, preview_x + preview_w, preview_y + preview_h],
            outline="#94a3b8",
            width=2,
            fill="#f8fafc",
        )
        draw.text((preview_x + 24, preview_y + 24), "No architecture image available yet.", fill="#475569", font=body_font)

    pages.append(page)

    # Page 2: Prerequisites + tooling + AWS basics
    page = _new_page()
    draw = ImageDraw.Draw(page)
    y = MARGIN_TOP

    draw.text((MARGIN_X, y), "Prerequisites and Tool Installation", fill="#0b1220", font=title_font)
    y += 60
    draw.text((MARGIN_X, y), "Prerequisites Checklist", fill="#0f172a", font=heading_font)
    y += 38
    y = _write_bullets(
        draw,
        [
            "AWS account with IAM user/role that can manage target resources.",
            "Terraform 1.6+ installed.",
            "AWS CLI v2 installed and configured.",
            "A Git repository for tracking infra changes.",
            "Team communication channel for change announcements.",
        ],
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    y += 16
    draw.text((MARGIN_X, y), "Install Tools (macOS + Windows)", fill="#0f172a", font=heading_font)
    y += 38
    y = _write_bullets(
        draw,
        [
            "macOS: install Homebrew, then run 'brew install terraform awscli'.",
            "Windows: install Chocolatey, then run 'choco install terraform awscli'.",
            "Alternative: download Terraform and AWS CLI directly from official vendor pages.",
            "Verify versions with 'terraform version' and 'aws --version'.",
        ],
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    y += 16
    draw.text((MARGIN_X, y), "AWS Account Setup Basics", fill="#0f172a", font=heading_font)
    y += 38
    y = _write_bullets(
        draw,
        [
            "Enable MFA for root and admin users.",
            "Create least-privilege IAM roles for deployments.",
            "Set budget alerts in AWS Budgets before first apply.",
            "Configure local credentials with 'aws configure'.",
        ],
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    pages.append(page)

    # Page 3: Deploy + management + troubleshooting
    page = _new_page()
    draw = ImageDraw.Draw(page)
    y = MARGIN_TOP

    draw.text((MARGIN_X, y), "Deploy and Operate Safely", fill="#0b1220", font=title_font)
    y += 60
    draw.text((MARGIN_X, y), "Step-by-Step Deploy Flow", fill="#0f172a", font=heading_font)
    y += 38
    y = _write_bullets(
        draw,
        [
            "Run format and validation before planning.",
            "Create a plan file and review all creates/changes/deletes.",
            "Get peer review for production-impacting changes.",
            "Apply only reviewed plans (never apply unreviewed direct changes).",
            "Capture outputs and update runbooks after deployment.",
        ],
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    y += 16
    draw.text((MARGIN_X, y), "Management Playbook", fill="#0f172a", font=heading_font)
    y += 38
    y = _write_bullets(
        draw,
        [
            "Safe updates: always run plan before apply, and keep plans tied to a commit.",
            "Rollback: keep previous module versions and known-good variable sets.",
            "Cost control: review monthly estimate and enable per-service budget alarms.",
            "Destroy guardrails: require explicit approval before terraform destroy.",
        ],
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    y += 16
    draw.text((MARGIN_X, y), "Troubleshooting Quick Fixes", fill="#0f172a", font=heading_font)
    y += 38
    y = _write_bullets(
        draw,
        [
            "Auth errors: refresh AWS credentials and retry terraform init.",
            "Provider errors: confirm region and service quotas.",
            "Drift: run terraform plan to detect unmanaged changes.",
            "Stuck resources: check AWS console events for failed create/update operations.",
        ],
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    pages.append(page)

    # Page 4: Project-specific commands and checklist
    page = _new_page()
    draw = ImageDraw.Draw(page)
    y = MARGIN_TOP

    draw.text((MARGIN_X, y), "Project-Specific Runbook", fill="#0b1220", font=title_font)
    y += 60

    draw.text((MARGIN_X, y), "Execution Commands", fill="#0f172a", font=heading_font)
    y += 38

    for command in _project_commands(project):
        y = _write_paragraph(
            draw,
            command,
            MARGIN_X + 16,
            y,
            PAGE_WIDTH - (MARGIN_X * 2) - 16,
            code_font,
            fill="#111827",
        )

    y += 12
    draw.text((MARGIN_X, y), "Resource Checklist", fill="#0f172a", font=heading_font)
    y += 38
    y = _write_bullets(
        draw,
        _resource_checklist(project),
        MARGIN_X,
        y,
        PAGE_WIDTH - (MARGIN_X * 2),
        body_font,
    )

    y += 12
    draw.text(
        (MARGIN_X, min(y, PAGE_HEIGHT - MARGIN_BOTTOM)),
        f"Generated on {datetime.now(timezone.utc).isoformat()} by DrawToCloud setup guide generator.",
        fill="#64748b",
        font=body_font,
    )

    pages.append(page)

    buffer = io.BytesIO()
    pages[0].save(buffer, format="PDF", resolution=150.0, save_all=True, append_images=pages[1:])
    return buffer.getvalue()
