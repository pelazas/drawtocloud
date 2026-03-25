import asyncio
import json
import logging
import os
from typing import Any

from region_detect import detect_closest_region

logger = logging.getLogger(__name__)

_HOURS_PER_MONTH = 730
_PRICING_REGION = "us-east-1"

_REGION_LOCATION_LABELS: dict[str, str] = {
    "us-east-1": "US East (N. Virginia)",
    "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)",
    "us-west-2": "US West (Oregon)",
    "ca-central-1": "Canada (Central)",
    "eu-west-1": "EU (Ireland)",
    "eu-west-2": "EU (London)",
    "eu-west-3": "EU (Paris)",
    "eu-central-1": "EU (Frankfurt)",
    "eu-north-1": "EU (Stockholm)",
    "ap-southeast-1": "Asia Pacific (Singapore)",
    "ap-southeast-2": "Asia Pacific (Sydney)",
    "ap-northeast-1": "Asia Pacific (Tokyo)",
    "ap-northeast-2": "Asia Pacific (Seoul)",
    "ap-northeast-3": "Asia Pacific (Osaka)",
    "ap-south-1": "Asia Pacific (Mumbai)",
    "sa-east-1": "South America (Sao Paulo)",
    "me-south-1": "Middle East (Bahrain)",
    "af-south-1": "Africa (Cape Town)",
}

_VALID_SERVICE_CODES = {
    "AmazonEC2",
    "AmazonRDS",
    "AmazonElastiCache",
    "AmazonECS",
    "AWSLambda",
    "AmazonS3",
    "AmazonSQS",
    "AmazonSNS",
    "AmazonCloudWatch",
    "AmazonRoute53",
    "AmazonApiGateway",
    "AmazonCloudFront",
    "AWSWAF",
    "AmazonDynamoDB",
    "AmazonEFS",
    "AmazonVPC",
}

_USAGE_ESTIMATES: dict[str, float] = {
    "AWSLambda": 5.0,
    "AmazonS3": 5.0,
    "AmazonSQS": 5.0,
    "AmazonSNS": 5.0,
    "AmazonCloudWatch": 10.0,
    "AmazonRoute53": 5.0,
    "AmazonApiGateway": 15.0,
    "AmazonCloudFront": 10.0,
    "AWSWAF": 15.0,
    "AmazonDynamoDB": 25.0,
    "AmazonEFS": 10.0,
    "AmazonVPC": 35.0,
}

_KEYWORD_FALLBACKS: list[tuple[str, str, float]] = [
    ("nat gateway", "AmazonVPC", 35.0),
    ("route 53", "AmazonRoute53", 5.0),
    ("route53", "AmazonRoute53", 5.0),
    ("api gateway", "AmazonApiGateway", 15.0),
    ("cloudfront", "AmazonCloudFront", 10.0),
    ("cloudwatch", "AmazonCloudWatch", 10.0),
    ("lambda", "AWSLambda", 5.0),
    ("dynamodb", "AmazonDynamoDB", 25.0),
    ("elasticache", "AmazonElastiCache", 40.0),
    ("redis", "AmazonElastiCache", 40.0),
    ("rds", "AmazonRDS", 80.0),
    ("s3", "AmazonS3", 5.0),
    ("efs", "AmazonEFS", 10.0),
    ("sqs", "AmazonSQS", 5.0),
    ("sns", "AmazonSNS", 5.0),
    ("waf", "AWSWAF", 15.0),
    ("ecs", "AmazonECS", 50.0),
    ("ec2", "AmazonEC2", 50.0),
    ("alb", "AmazonEC2", 20.0),
    ("load balancer", "AmazonEC2", 20.0),
]

_PRICE_CACHE: dict[str, float] = {}
_PRICING_CLIENT: Any = None
_PRICING_CLIENT_LOCK = asyncio.Lock()


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _as_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return round(float(value), 2)
    if isinstance(value, str):
        try:
            return round(float(value), 2)
        except ValueError:
            return None
    return None


def _normalize_regions(regions: Any) -> list[str]:
    if not isinstance(regions, list):
        return []
    return [entry.strip() for entry in regions if _is_non_empty_string(entry)]


def _node_data(node: Any) -> dict[str, Any]:
    if not isinstance(node, dict):
        return {}
    data = node.get("data")
    if isinstance(data, dict):
        return data
    return {}


def _first_fallback_match(label: str) -> tuple[str, float] | None:
    lower_label = label.lower()
    for keyword, service_code, estimate in _KEYWORD_FALLBACKS:
        if keyword in lower_label:
            return service_code, estimate
    return None


def _has_aws_credentials() -> bool:
    return bool(os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"))


async def _get_pricing_client() -> Any:
    global _PRICING_CLIENT

    if _PRICING_CLIENT is not None:
        return _PRICING_CLIENT

    async with _PRICING_CLIENT_LOCK:
        if _PRICING_CLIENT is not None:
            return _PRICING_CLIENT
        try:
            import boto3  # type: ignore
        except ModuleNotFoundError:
            logger.warning("boto3 is not installed; skipping AWS Pricing API lookups")
            return None

        _PRICING_CLIENT = await asyncio.to_thread(
            boto3.client,
            "pricing",
            region_name=_PRICING_REGION,
        )
        return _PRICING_CLIENT


def _service_filters(service_code: str, instance_type: str, location: str, engine: str | None) -> list[dict[str, str]]:
    filters = [
        {"Type": "TERM_MATCH", "Field": "location", "Value": location},
        {"Type": "TERM_MATCH", "Field": "locationType", "Value": "AWS Region"},
    ]

    if service_code in {"AmazonEC2", "AmazonRDS", "AmazonElastiCache"}:
        filters.append({"Type": "TERM_MATCH", "Field": "instanceType", "Value": instance_type})

    if service_code == "AmazonEC2":
        filters.extend(
            [
                {"Type": "TERM_MATCH", "Field": "operatingSystem", "Value": "Linux"},
                {"Type": "TERM_MATCH", "Field": "preInstalledSw", "Value": "NA"},
                {"Type": "TERM_MATCH", "Field": "tenancy", "Value": "Shared"},
                {"Type": "TERM_MATCH", "Field": "capacitystatus", "Value": "Used"},
            ]
        )

    if service_code == "AmazonRDS":
        filters.append({"Type": "TERM_MATCH", "Field": "deploymentOption", "Value": "Single-AZ"})
        if _is_non_empty_string(engine):
            filters.append({"Type": "TERM_MATCH", "Field": "databaseEngine", "Value": str(engine).strip()})

    return filters


def _extract_hourly_price(price_list: list[str]) -> float | None:
    best_price: float | None = None

    for raw in price_list:
        try:
            payload = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue

        terms = payload.get("terms")
        if not isinstance(terms, dict):
            continue
        on_demand = terms.get("OnDemand")
        if not isinstance(on_demand, dict):
            continue

        for term in on_demand.values():
            if not isinstance(term, dict):
                continue
            dimensions = term.get("priceDimensions")
            if not isinstance(dimensions, dict):
                continue

            for dimension in dimensions.values():
                if not isinstance(dimension, dict):
                    continue
                price_per_unit = dimension.get("pricePerUnit")
                if not isinstance(price_per_unit, dict):
                    continue
                usd = _as_number(price_per_unit.get("USD"))
                if usd is None or usd <= 0:
                    continue
                if best_price is None or usd < best_price:
                    best_price = usd

    return best_price


async def _fetch_hourly_instance_price(
    service_code: str,
    instance_type: str,
    region: str,
    engine: str | None,
) -> float | None:
    if not _is_non_empty_string(service_code) or not _is_non_empty_string(instance_type):
        return None

    cache_key = f"{service_code}:{instance_type}:{region}:{engine or ''}"
    if cache_key in _PRICE_CACHE:
        return _PRICE_CACHE[cache_key]

    location = _REGION_LOCATION_LABELS.get(region)
    if not location:
        return None

    client = await _get_pricing_client()
    if client is None:
        return None

    filters = _service_filters(service_code, instance_type, location, engine)

    try:
        response = await asyncio.to_thread(
            client.get_products,
            ServiceCode=service_code,
            Filters=filters,
            MaxResults=100,
        )
    except Exception:
        logger.exception(
            "pricing_api_lookup_failed service_code=%s instance_type=%s region=%s",
            service_code,
            instance_type,
            region,
        )
        return None

    price_list = response.get("PriceList")
    if not isinstance(price_list, list):
        return None

    hourly = _extract_hourly_price(price_list)
    if hourly is None:
        return None

    _PRICE_CACHE[cache_key] = hourly
    return hourly


async def _estimate_node_item(node: dict[str, Any], region: str) -> dict[str, Any] | None:
    node_id = node.get("id") if _is_non_empty_string(node.get("id")) else None
    if node_id is None:
        return None

    data = _node_data(node)
    label = data.get("label") if _is_non_empty_string(data.get("label")) else node_id
    service_code = data.get("aws_service_code") if _is_non_empty_string(data.get("aws_service_code")) else None
    instance_type = data.get("instance_type") if _is_non_empty_string(data.get("instance_type")) else None
    engine = data.get("engine") if _is_non_empty_string(data.get("engine")) else None

    fallback_match = _first_fallback_match(str(label))
    fallback_estimate: float | None = None

    if not service_code and fallback_match is not None:
        service_code, fallback_estimate = fallback_match

    if service_code and service_code not in _VALID_SERVICE_CODES:
        service_code = None

    if service_code in _USAGE_ESTIMATES and not instance_type:
        return {
            "node_id": node_id,
            "label": label,
            "cost": round(_USAGE_ESTIMATES[service_code], 2),
            "estimated": True,
        }

    if service_code and instance_type:
        hourly_price = await _fetch_hourly_instance_price(service_code, instance_type, region, engine)
        if hourly_price is not None:
            item = {
                "node_id": node_id,
                "label": label,
                "instance_type": instance_type,
                "cost": round(hourly_price * _HOURS_PER_MONTH, 2),
                "estimated": False,
            }
            return item

    if fallback_estimate is None and fallback_match is not None:
        fallback_estimate = fallback_match[1]

    if fallback_estimate is None and service_code in _USAGE_ESTIMATES:
        fallback_estimate = _USAGE_ESTIMATES[service_code]

    if fallback_estimate is None:
        return None

    item = {
        "node_id": node_id,
        "label": label,
        "cost": round(fallback_estimate, 2),
        "estimated": True,
    }
    if instance_type:
        item["instance_type"] = instance_type
    return item


async def run_cost_analyst(
    nodes: list[dict[str, Any]],
    regions: list[str],
    project_id: str,
    runtime: Any,
    *,
    monthly_budget: Any = None,
    budget_cap: Any = None,
) -> dict[str, Any] | None:
    del project_id

    if not _has_aws_credentials():
        logger.info("cost_analyst skipped: AWS credentials not configured")
        return None

    normalized_regions = _normalize_regions(regions)
    region = normalized_regions[0] if normalized_regions else await detect_closest_region(getattr(runtime, "client_ip", None))

    items: list[dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        item = await _estimate_node_item(node, region)
        if item is not None:
            items.append(item)

    monthly_total = round(sum(float(item.get("cost") or 0) for item in items), 2)

    payload: dict[str, Any] = {
        "region": region,
        "monthly_total": monthly_total,
        "items": items,
    }

    effective_budget = _as_number(budget_cap)
    if effective_budget is None:
        effective_budget = _as_number(monthly_budget)

    if effective_budget is not None:
        payload["budget_cap"] = effective_budget
        payload["monthly_budget"] = effective_budget
        payload["over_budget"] = monthly_total > effective_budget

    return payload
