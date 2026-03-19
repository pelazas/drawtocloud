# Better Setup PDF — Design Spec

**Issue:** #75
**Date:** 2026-03-19
**Status:** Draft

## Problem

The current setup PDF is generated with Pillow (PIL), which renders all content as rasterized bitmap images. This causes:
1. Pixelated text at any zoom level
2. Text is not selectable or searchable
3. Content is generic/hard-coded — not project-specific enough to be genuinely useful

## Solution

Rewrite `setup_pdf_generator.py` using **fpdf2** (pure Python PDF library) to produce a real vector-text PDF with project-specific content. Minor update to `setup_pdf_service.py` to pass additional fields to the generator.

### What changes
- `backend/setup_pdf_generator.py` — full rewrite (Pillow → fpdf2, new content structure)
- `backend/setup_pdf_service.py` — minor update: expand `render_payload` to include `cost_estimate`, `arch_description`, and `edges`
- `backend/requirements.txt` — replace `Pillow` with `fpdf2`

### What stays the same
- `backend/main.py` — HTTP endpoints (same API contract)
- Frontend components — same status/progress/download flow
- Database schema — no changes
- Supabase Storage — same bucket and path format

## Library Choice: fpdf2

- Pure Python, `pip install fpdf2`, no system dependencies
- Produces real vector text — crisp at any zoom, selectable, searchable
- Handles page breaks automatically
- Simple API for headings, tables, code blocks, bullet lists
- Docker-friendly (no Cairo/Pango like WeasyPrint)

**Fonts:** Use fpdf2's bundled **DejaVu Sans** TTF font (ships with fpdf2) for Unicode support. This handles accented characters, arrows, and special symbols in project names or Terraform content without encoding errors.

## PDF Content Structure

### Page 1 — Overview
- Project name as title
- Generated date, region, environment
- Architecture description paragraph (from Description agent `arch_description` output)
- **Fallback:** If `arch_description` is null, show: "No architecture description available. Run the generation pipeline to populate this section."

### Page 2 — Your Resources
- Table: Resource Name | Category
- Populated from canvas `nodes` — every node on the user's diagram
- Category shown as text label (network, compute, database, storage, security, monitoring)
- **Fallback:** If `nodes` is empty, show: "No resources defined yet. Add resources to your canvas to populate this section."

### Page 3 — Prerequisites
- Brief checklist: AWS account, Terraform 1.6+, AWS CLI v2
- Essentials only — links to official docs for each tool
- No full install tutorial

### Page 4 — Step-by-step Deployment
- References actual `.tf` filenames from `terraform_files` (e.g., "Save `main.tf`, `variables.tf` to a new directory")
- Commands: `terraform init`, `terraform fmt`, `terraform validate`, `terraform plan -out plan.tfplan`, `terraform apply plan.tfplan`
- Inline snippets: show the **first 40 lines** of each `.tf` file in a monospace code block. If a file exceeds 40 lines, append `... (N more lines — see full file in your download)`.
- **Fallback:** If `terraform_files` is empty/null, show generic deployment steps without file-specific references.

### Page 5 — Verify in AWS Console
- Per-resource instructions generated from canvas `nodes`
- Maps each node to its AWS Console path (see mapping below). Examples:
  - "Go to **VPC > Your VPCs** and confirm `my-app-vpc` exists"
  - "Go to **RDS > Databases** and verify `my-app-db` status is 'Available'"
  - "Go to **S3 > Buckets** and confirm `my-app-assets` was created"
- Fallback for unknown services: "Search for `<resource-name>` in the AWS Console search bar"
- **Fallback:** If `nodes` is empty, skip this section entirely (page 2 already shows the empty-state message).

### Page 6 — Cost Management
- Monthly total and breakdown table (from Cost Analyst `cost_estimate` output)
- Instructions to navigate AWS Cost Explorer
- How to set a Budget Alert matching their estimate
- **Fallback:** If `cost_estimate` is null, show: "No cost estimate available. Cost data will appear here after the Cost Analyst agent completes." Still include the generic AWS Cost Explorer and Budget Alert instructions.

### Page 7 — Troubleshooting
- Common errors specific to their resource types, generated from canvas `nodes` using the troubleshooting mapping (see below)
- Generic fallbacks always included: auth errors, provider errors, drift detection
- **Fallback:** If `nodes` is empty, show only the generic troubleshooting tips.

Page count is approximate — fpdf2 handles page breaks automatically so content flows naturally.

## Data Inputs

All data is available on the project row in Supabase:

| Field | Type | Used for |
|-------|------|----------|
| `title` | `str` | Project name in header |
| `arch_description` | `dict \| null` | Overview paragraph (Page 1) |
| `nodes` | `list[dict]` with `{id, label, category}` | Resource table (Page 2), Console verification (Page 5), Troubleshooting (Page 7) |
| `terraform_files` | `list[dict]` with `{filename, content}` | Deployment section (Page 4) — filenames and inline code snippets |
| `cost_estimate` | `dict \| null` with `{monthly_total, breakdown}` | Cost management section (Page 6) |
| `questionnaire_answers` | `dict` | Region, environment, budget context (Page 1) |

**Note:** `edges` removed from data inputs — no page description uses relationship data. If edge data becomes useful later (e.g., showing resource dependencies), it can be added in a follow-up.

### Service layer change

`setup_pdf_service.py` `_run_setup_pdf_generation` must expand its `render_payload` dict to include:
- `cost_estimate` (from project row)
- `arch_description` (Supabase column is `description`; service should pass it as `arch_description` in the render payload to match the generator's expected key)
- These fields are already in the project row and already included in the staleness hash (`_canonical_payload`), so the change is a 2-3 line addition.

## AWS Console Path Mapping

New dict in the generator mapping service keywords to Console paths:

```python
CONSOLE_PATHS = {
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
```

Matching: lowercase node ID and label checked against these keys (substring match). Fallback: "Search for `<resource-name>` in the AWS Console search bar."

## Troubleshooting Tips Mapping

Maps resource types to common issues. Generated per-node from canvas data:

```python
TROUBLESHOOTING_TIPS = {
    "rds": "If RDS fails to create, check that the specified subnet group exists and covers at least 2 AZs.",
    "lambda": "If Lambda fails, verify the IAM execution role has the required permissions and the deployment package is under the size limit.",
    "ecs": "If ECS tasks fail to start, check the task definition's container image URI and ensure the cluster has sufficient capacity.",
    "ec2": "If EC2 instances fail to launch, verify the AMI ID exists in your region and your instance type quota is sufficient.",
    "s3": "If S3 bucket creation fails, the bucket name may already be taken globally. Choose a unique name.",
    "vpc": "If VPC creation fails, check you haven't exceeded the VPC limit in your region (default: 5).",
    "alb": "If the load balancer is unhealthy, verify target group health checks and security group ingress rules.",
    "dynamodb": "If DynamoDB throttles requests, review your provisioned capacity or switch to on-demand mode.",
    "elasticache": "If ElastiCache fails, verify the subnet group and security group allow access from your application.",
    "cloudfront": "If CloudFront returns errors, check the origin configuration and ensure the origin is accessible.",
    "iam": "If IAM role creation fails, check for name conflicts and verify you have permission to create roles.",
    "route53": "If DNS records don't resolve, verify the hosted zone's NS records match your domain registrar.",
}
```

Generic tips always appended regardless of resources:
- "**Auth errors:** Run `aws sts get-caller-identity` to verify your credentials. Re-run `aws configure` if needed."
- "**Provider errors:** Verify your region is correct and you haven't hit service quotas. Check AWS Service Health Dashboard."
- "**Drift detection:** Run `terraform plan` to detect any changes made outside of Terraform. Import or re-apply as needed."

## Code Block Formatting

For Terraform code snippets in Page 4:
- Use fpdf2's monospace font (DejaVu Sans Mono or Courier)
- Light gray background fill (`#f1f5f9`) behind code blocks
- Reduced font size (8-9pt) for code vs 10-11pt for body text
- Preserve indentation and line breaks from original Terraform content

## Non-goals
- No architecture diagram image in the PDF (user has the canvas in the app)
- No heavy branding or visual polish — functional and clean
- No changes to the generation/download API contract
- No changes to frontend components
- No custom TTF font files — use fpdf2 bundled fonts only
