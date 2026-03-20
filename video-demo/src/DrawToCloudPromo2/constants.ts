export const FF = '"DM Sans", system-ui, sans-serif';
export const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

export const CATEGORY_COLORS: Record<string, string> = {
  network: "#3b82f6",
  compute: "#f97316",
  database: "#22c55e",
  storage: "#eab308",
  security: "#ef4444",
  monitoring: "#a855f7",
};

export const AI_PROMPT_PREVIEW = `You are helping me generate AWS infrastructure using DrawToCloud.\n\nAnalyze my codebase and respond in EXACTLY this structured format. No markdown, no preamble...`;

export const AI_RESPONSE = `WHAT IT DOES
This application streams live Wikipedia edit events, filters for high-signal human edits, enriches each edit with AI-generated topic and geography, and visualizes the results on a real-time globe dashboard. It is used by viewers/analysts who want to monitor global knowledge activity as it happens. The core user action is opening the dashboard to watch incoming edits in real time and interactively filter by topic and geography trends.

SERVICES REQUIRED
- Real-time data delivery to clients (database change subscriptions / pub-sub) for live edit inserts.
- Event-driven ingestion pipeline for continuous upstream stream consumption (Wikimedia SSE) and forwarding.
- Stateless enrichment API endpoint for ingest requests (POST ingest endpoint).
- Background processing for AI enrichment (geotag + category classification per event).
- Managed relational database persistence for enriched events.
- Scheduled background cleanup jobs for retention (daily purge; optional weekly compaction/leaderboard pruning).
- Leaderboard/query service for recent top edits (7-day ranked view).

DATA LAYER
Relational database is required (PostgreSQL): structured tabular event records with constraints, indexes, ordering by time, and a weekly ranking view, plus one JSON/raw payload column. Caching is not explicitly implemented; optional short-TTL cache for hot reads could reduce repeated query load. Growth is continuous/append-heavy from a live stream with 30-day retention and frontend windows up to 5,000 recent events per hour view.

TRAFFIC CHARACTERISTICS
Primary backend load is event-driven: a long-lived SSE consumer continuously receives upstream events and emits filtered candidates to the ingest API. User traffic is read-heavy on initial page load plus persistent realtime subscriptions (one live channel per connected client session). Batch frequency includes a daily retention purge (03:00) and optional weekly cleanup job.

EXTERNAL INTEGRATIONS
- Wikimedia EventStreams SSE: https://stream.wikimedia.org/v2/stream/recentchange
- Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct) for enrichment
- Supabase: Postgres storage, Realtime postgres_changes subscriptions, REST API with service-role key
- DiceBear avatar API for live editor marker avatars

COMPLIANCE SIGNALS
None detected. Stored fields are public Wikipedia edit metadata plus AI-derived category/geography.

INFRASTRUCTURE CONSTRAINTS
- Hard dependency on Supabase-compatible PostgreSQL + Realtime semantics with service-role credentials.
- Hard dependency on Cloudflare Worker-style ingest with AI inference binding.
- Continuous outbound egress required to Wikimedia stream, Supabase endpoints, and public APIs.
- Requires secure secret management for SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, and CLOUDFLARE credentials.`;

export const AI_FULL_PROMPT = `You are helping me generate AWS infrastructure using DrawToCloud.

Analyze my codebase and respond in EXACTLY this structured format. No markdown, no preamble, no commentary — only the sections below:

WHAT IT DOES
[2-3 sentences: what the application does, who uses it, and what the core user action is]

SERVICES REQUIRED
[Bullet list of backend capabilities actually present in the code: authentication, file storage, real-time updates, background jobs, email/notifications, payments, search, etc.]

DATA LAYER
[Database type (relational / document / key-value / time-series) and why. Caching needs. Approximate data volume or growth rate if inferable. Any search requirements.]

TRAFFIC CHARACTERISTICS
[Infer from code patterns: request-driven vs event-driven, peak load indicators, real-time connection counts, batch job frequency, webhook volume.]

EXTERNAL INTEGRATIONS
[Third-party APIs, webhooks, OAuth providers, payment processors, CDN requirements, media processing. List only what is present in the code.]

COMPLIANCE SIGNALS
[Any indicators of regulated data: healthcare records (HIPAA), payment data (PCI-DSS), EU users (GDPR), government systems. Write "None detected" if not applicable.]

INFRASTRUCTURE CONSTRAINTS
[Hard requirements: multi-tenancy data isolation, VPC isolation, specific AWS services already in use, queue systems, CDN, geographic distribution.]

This output feeds directly into an AI system that generates Terraform infrastructure. Vague or incomplete answers produce generic, unusable results. Be precise.`;

export const TERRAFORM_LINES = `provider "aws" {
  region = var.aws_region
}

data "aws_vpc" "default" {
  default = true
}

data "aws_security_group" "default" {
  name   = "default"
  vpc_id = data.aws_vpc.default.id
}

resource "aws_s3_bucket" "frontend_bucket" {
  bucket = "\${var.app_name_slug}-frontend-\${random_id.suffix.hex}"
  acl    = "private"

  versioning {
    enabled = false
  }

  lifecycle_rule {
    enabled = true
    abort_incomplete_multipart_upload_days = 7
  }
}

resource "aws_s3_bucket_public_access_block" "frontend_bucket" {
  bucket = aws_s3_bucket.frontend_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_distribution" "s3_distribution" {
  origin {
    domain_name = aws_s3_bucket.frontend_bucket.bucket_regional_domain_name
    origin_id   = "S3Origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3Origin"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  price_class = "PriceClass_All"
}

resource "aws_lambda_function" "backend_lambda" {
  filename         = "lambda_function.zip"
  function_name    = "\${var.app_name_slug}-backend"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 10
  memory_size      = 128
  source_code_hash = filebase64sha256("lambda_function.zip")

  environment {
    variables = {
      DB_TABLE_NAME = aws_dynamodb_table.main.name
    }
  }
}

resource "aws_api_gateway_rest_api" "backend_api" {
  name = "\${var.app_name_slug}-api"
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.backend_api.id
  parent_id   = aws_api_gateway_rest_api.backend_api.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy_method" {
  rest_api_id   = aws_api_gateway_rest_api.backend_api.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "lambda_proxy" {
  rest_api_id = aws_api_gateway_rest_api.backend_api.id
  resource_id = aws_api_gateway_resource.proxy.id
  http_method = aws_api_gateway_method.proxy_method.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.backend_lambda.invoke_arn
}

resource "aws_api_gateway_method" "root_proxy_method" {
  rest_api_id   = aws_api_gateway_rest_api.backend_api.id
  resource_id   = aws_api_gateway_rest_api.backend_api.root_resource_id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "root_lambda_proxy" {
  rest_api_id = aws_api_gateway_rest_api.backend_api.id
  resource_id = aws_api_gateway_rest_api.backend_api.root_resource_id
  http_method = aws_api_gateway_method.root_proxy_method.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.backend_lambda.invoke_arn
}

resource "aws_api_gateway_deployment" "api_deployment" {
  depends_on = [
    aws_api_gateway_integration.lambda_proxy,
    aws_api_gateway_integration.root_lambda_proxy
  ]

  rest_api_id = aws_api_gateway_rest_api.backend_api.id
  stage_name  = "prod"
}

resource "aws_lambda_permission" "apigateway_invoke" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "\${aws_api_gateway_rest_api.backend_api.execution_arn}/*/*"
}

resource "aws_dynamodb_table" "main" {
  name         = "\${var.app_name_slug}-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  stream_enabled = false
  ttl_enabled    = true

  point_in_time_recovery {
    enabled = false
  }
}

resource "aws_iam_role" "lambda_exec" {
  name = "\${var.app_name_slug}_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = "sts:AssumeRole",
        Effect = "Allow",
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_exec" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "dynamodb_access" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess"
}

resource "random_id" "suffix" {
  byte_length = 4
}`.split("\n");

export const COST_ROWS = [
  ["ECS Fargate (2 tasks x 0.25 vCPU)", "$18.40"],
  ["RDS PostgreSQL (db.t3.medium)", "$15.20"],
  ["Application Load Balancer", "$6.80"],
  ["ElastiCache (cache.t3.micro)", "$4.10"],
  ["S3 + data transfer", "$1.60"],
  ["CloudWatch logs", "$0.90"],
] as const;
