from typing import Any

from fpdf import FPDF

MAX_CODE_PREVIEW_LINES = 40

CONSOLE_PATHS: dict[str, str] = {
    "vpc": "VPC > Your VPCs",
    "subnet": "VPC > Subnets",
    "rds": "RDS > Databases",
    "s3": "S3 > Buckets",
    "lambda": "Lambda > Functions",
    "ecs": "ECS > Clusters",
    "ec2": "EC2 > Instances",
    "alb": "EC2 > Load Balancers",
    "elb": "EC2 > Load Balancers",
    "cloudfront": "CloudFront > Distributions",
    "dynamodb": "DynamoDB > Tables",
    "elasticache": "ElastiCache > Redis/Memcached",
    "sqs": "SQS > Queues",
    "sns": "SNS > Topics",
    "cloudwatch": "CloudWatch > Dashboards",
    "iam": "IAM > Roles",
    "waf": "WAF > Web ACLs",
    "route53": "Route 53 > Hosted Zones",
    "efs": "EFS > File Systems",
    "api_gateway": "API Gateway > APIs",
    "cognito": "Cognito > User Pools",
    "secrets_manager": "Secrets Manager > Secrets",
    "kms": "KMS > Customer managed keys",
    "ecr": "ECR > Repositories",
}

TROUBLESHOOTING_TIPS: dict[str, str] = {
    "rds": "If RDS fails to create, check that the specified subnet group exists and covers at least 2 AZs.",
    "lambda": "If Lambda fails, verify the IAM execution role has the required permissions and the deployment package is under the size limit.",
    "ecs": "If ECS tasks fail to start, check the task definition image URI and ensure the cluster has enough capacity.",
    "ec2": "If EC2 instances fail to launch, verify the AMI exists in your target region and that instance quotas are available.",
    "s3": "If S3 bucket creation fails, the name may already be taken globally. Choose a unique bucket name.",
    "vpc": "If VPC creation fails, verify you have not exceeded your region's VPC quota.",
    "alb": "If the load balancer is unhealthy, verify target group health checks and security group ingress rules.",
    "dynamodb": "If DynamoDB throttles requests, review provisioned capacity or switch to on-demand mode.",
    "elasticache": "If ElastiCache fails, verify subnet group and security group access from your application tier.",
    "cloudfront": "If CloudFront returns errors, check origin configuration and confirm the origin is reachable.",
    "iam": "If IAM role creation fails, check name conflicts and your principal permissions to create roles.",
    "route53": "If DNS records do not resolve, verify hosted-zone NS records match your registrar configuration.",
}

GENERIC_TROUBLESHOOTING = [
    "Auth errors: run aws sts get-caller-identity to confirm credentials, then re-run aws configure if needed.",
    "Provider errors: verify your AWS region and service quotas, then check AWS Service Health Dashboard.",
    "Drift detection: run terraform plan to detect out-of-band changes and reconcile before applying updates.",
]


def _safe_str(value: Any, fallback: str = "") -> str:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            return stripped
    return fallback


def _pdf_safe(text: str) -> str:
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _format_currency(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"${value:,.2f}"
    return _safe_str(value, "n/a")


def _truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: limit - 3]}..."


def _extract_architecture_summary(project: dict[str, Any]) -> str:
    arch_description = project.get("arch_description")

    if isinstance(arch_description, str) and arch_description.strip():
        return arch_description.strip()

    if isinstance(arch_description, dict):
        for key in ("summary", "overview", "description", "text"):
            candidate = arch_description.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()

        flattened: list[str] = []
        for value in arch_description.values():
            if isinstance(value, str) and value.strip():
                flattened.append(value.strip())
        if flattened:
            return " ".join(flattened)

    return "No architecture description available. Run the generation pipeline to populate this section."


def _resource_rows(project: dict[str, Any]) -> list[dict[str, str]]:
    nodes = project.get("nodes")
    if not isinstance(nodes, list):
        return []

    rows: list[dict[str, str]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        label = _safe_str(data.get("label"), _safe_str(node.get("id"), "Unnamed resource"))
        category = _safe_str(data.get("category"), "general")
        rows.append(
            {
                "id": _safe_str(node.get("id"), label),
                "name": label,
                "category": category,
            }
        )

    return rows


def _terraform_files(project: dict[str, Any]) -> list[dict[str, str]]:
    files = project.get("terraform_files")
    if not isinstance(files, list):
        return []

    result: list[dict[str, str]] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        filename = _safe_str(entry.get("filename"))
        if not filename:
            continue
        content = entry.get("content")
        result.append(
            {
                "filename": filename,
                "content": content if isinstance(content, str) else "",
            }
        )

    return result


def _code_preview(content: str) -> str:
    if not content.strip():
        return "# file is empty"

    lines = content.splitlines()
    preview_lines = lines[:MAX_CODE_PREVIEW_LINES]

    if len(lines) > MAX_CODE_PREVIEW_LINES:
        remaining = len(lines) - MAX_CODE_PREVIEW_LINES
        preview_lines.append(f"... ({remaining} more lines - see full file in your download)")

    return "\n".join(preview_lines)


def _console_path_for_resource(resource_name: str, resource_id: str) -> str | None:
    haystack = f"{resource_name} {resource_id}".lower().replace("-", "_")
    for key, path in CONSOLE_PATHS.items():
        if key in haystack:
            return path
    return None


def _troubleshooting_for_resources(resources: list[dict[str, str]]) -> list[str]:
    tips: list[str] = []
    seen: set[str] = set()

    for resource in resources:
        haystack = f"{resource['name']} {resource['id']}".lower().replace("-", "_")
        for key, tip in TROUBLESHOOTING_TIPS.items():
            if key in haystack and tip not in seen:
                seen.add(tip)
                tips.append(tip)

    tips.extend(GENERIC_TROUBLESHOOTING)
    return tips


def _cost_rows(project: dict[str, Any]) -> tuple[str | None, list[tuple[str, str]]]:
    cost_estimate = project.get("cost_estimate")
    if not isinstance(cost_estimate, dict):
        return None, []

    total = _format_currency(cost_estimate.get("monthly_total"))
    breakdown = cost_estimate.get("breakdown")
    rows: list[tuple[str, str]] = []

    if isinstance(breakdown, list):
        for item in breakdown:
            if not isinstance(item, dict):
                continue
            service = _safe_str(item.get("service"), _safe_str(item.get("name"), "Unknown service"))
            cost = item.get("monthly_cost")
            if cost is None:
                cost = item.get("cost")
            rows.append((service, _format_currency(cost)))

    return total, rows


def _set_font(pdf: FPDF, *, style: str = "", size: int = 11, family: str = "Helvetica") -> None:
    pdf.set_font(family, style=style, size=size)


def _section_title(pdf: FPDF, text: str) -> None:
    _set_font(pdf, style="B", size=17)
    pdf.multi_cell(0, 8, _pdf_safe(text), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)


def _subheading(pdf: FPDF, text: str) -> None:
    _set_font(pdf, style="B", size=12)
    pdf.multi_cell(0, 7, _pdf_safe(text), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)


def _paragraph(pdf: FPDF, text: str) -> None:
    _set_font(pdf, size=11)
    pdf.multi_cell(0, 6, _pdf_safe(text), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)


def _bullets(pdf: FPDF, items: list[str]) -> None:
    _set_font(pdf, size=11)
    for item in items:
        pdf.multi_cell(0, 6, _pdf_safe(f"- {item}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)


def _table_header(pdf: FPDF, columns: list[tuple[str, float]]) -> None:
    _set_font(pdf, style="B", size=11)
    for label, width in columns:
        pdf.cell(width, 8, _pdf_safe(label), border=1)
    pdf.ln()


def _table_row(pdf: FPDF, values: list[str], columns: list[tuple[str, float]]) -> None:
    _set_font(pdf, size=10)
    for value, (_, width) in zip(values, columns):
        pdf.cell(width, 7, _pdf_safe(_truncate(value, 50)), border=1)
    pdf.ln()


def _code_block(pdf: FPDF, title: str, content: str) -> None:
    _subheading(pdf, title)
    pdf.set_fill_color(241, 245, 249)
    _set_font(pdf, family="Courier", size=8)
    lines = content.splitlines() or [""]
    for line in lines:
        pdf.multi_cell(0, 4.3, _pdf_safe(line), fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)


def _overview_page(
    pdf: FPDF,
    *,
    app_name: str,
    generated_at_iso: str,
    region: str,
    environment: str,
    architecture_summary: str,
) -> None:
    pdf.add_page()
    _section_title(pdf, f"{app_name} Setup Guide")
    _paragraph(pdf, f"Generated at: {generated_at_iso}")
    _paragraph(pdf, f"Region: {region} | Environment: {environment}")
    _subheading(pdf, "Overview")
    _paragraph(pdf, architecture_summary)


def _resources_page(pdf: FPDF, resources: list[dict[str, str]]) -> None:
    pdf.add_page()
    _section_title(pdf, "Your Resources")
    columns = [("Resource Name", 130.0), ("Category", 60.0)]

    if not resources:
        _paragraph(pdf, "No resources defined yet. Add resources to your canvas to populate this section.")
        return

    _table_header(pdf, columns)
    for resource in resources:
        _table_row(pdf, [resource["name"], resource["category"]], columns)


def _prerequisites_page(pdf: FPDF) -> None:
    pdf.add_page()
    _section_title(pdf, "Prerequisites")
    _bullets(
        pdf,
        [
            "AWS account with permission to create the target resources.",
            "Terraform 1.6+ installed.",
            "AWS CLI v2 installed and configured.",
            "Reference docs: docs.aws.amazon.com and developer.hashicorp.com/terraform/docs",
        ],
    )


def _deployment_page(pdf: FPDF, terraform_files: list[dict[str, str]]) -> None:
    pdf.add_page()
    _section_title(pdf, "Step-by-step Deployment")

    if terraform_files:
        filenames = ", ".join(entry["filename"] for entry in terraform_files)
        _paragraph(pdf, f"Save these Terraform files into a new working directory: {filenames}")
    else:
        _paragraph(pdf, "No Terraform files are attached yet. Run generation first, then return to this guide.")

    _subheading(pdf, "Run these commands")
    _bullets(
        pdf,
        [
            "terraform init",
            "terraform fmt",
            "terraform validate",
            "terraform plan -out plan.tfplan",
            "terraform apply plan.tfplan",
        ],
    )

    for entry in terraform_files:
        preview = _code_preview(entry["content"])
        _code_block(pdf, f"File: {entry['filename']}", preview)


def _verify_page(pdf: FPDF, resources: list[dict[str, str]]) -> None:
    if not resources:
        return

    pdf.add_page()
    _section_title(pdf, "Verify in AWS Console")

    checks: list[str] = []
    for resource in resources:
        path = _console_path_for_resource(resource["name"], resource["id"])
        if path:
            checks.append(f"Go to {path} and confirm {resource['name']} exists.")
        else:
            checks.append(f"Search for {resource['name']} in the AWS Console search bar.")

    _bullets(pdf, checks)


def _cost_page(pdf: FPDF, project: dict[str, Any]) -> None:
    pdf.add_page()
    _section_title(pdf, "Cost Management")

    total, rows = _cost_rows(project)
    if total is None:
        _paragraph(pdf, "No cost estimate available. Cost data will appear here after the Cost Analyst agent completes.")
    else:
        _paragraph(pdf, f"Estimated monthly total: {total}")

    _paragraph(pdf, "Open AWS Cost Explorer to validate current spend and set a Budget Alert aligned with this estimate.")

    if rows:
        columns = [("Service", 130.0), ("Estimated Monthly Cost", 60.0)]
        _table_header(pdf, columns)
        for service, amount in rows:
            _table_row(pdf, [service, amount], columns)


def _troubleshooting_page(pdf: FPDF, resources: list[dict[str, str]]) -> None:
    pdf.add_page()
    _section_title(pdf, "Troubleshooting")
    _bullets(pdf, _troubleshooting_for_resources(resources))


def build_setup_pdf(project: dict[str, Any], generated_at_iso: str) -> bytes:
    app_name = _safe_str(project.get("title"), "Untitled Project")
    questionnaire = project.get("questionnaire_answers") if isinstance(project.get("questionnaire_answers"), dict) else {}
    region = _safe_str(questionnaire.get("region"), "us-east-1")
    environment = _safe_str(questionnaire.get("environment"), "not specified")

    resources = _resource_rows(project)
    terraform_files = _terraform_files(project)
    architecture_summary = _extract_architecture_summary(project)

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.set_compression(False)

    _overview_page(
        pdf,
        app_name=app_name,
        generated_at_iso=generated_at_iso,
        region=region,
        environment=environment,
        architecture_summary=architecture_summary,
    )
    _resources_page(pdf, resources)
    _prerequisites_page(pdf)
    _deployment_page(pdf, terraform_files)
    _verify_page(pdf, resources)
    _cost_page(pdf, project)
    _troubleshooting_page(pdf, resources)

    output = pdf.output()
    if isinstance(output, str):
        return output.encode("latin-1", errors="replace")
    return bytes(output)
