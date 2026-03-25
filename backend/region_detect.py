import asyncio
import json
import math
from urllib.error import URLError
from urllib.request import urlopen

_DEFAULT_REGION = "us-east-1"
_IPAPI_TIMEOUT_SECONDS = 3.0

_REGION_COORDINATES: dict[str, tuple[float, float]] = {
    "us-east-1": (39.0438, -77.4874),
    "us-east-2": (40.4173, -82.9071),
    "us-west-1": (37.3382, -121.8863),
    "us-west-2": (45.5231, -122.6765),
    "ca-central-1": (45.5017, -73.5673),
    "eu-west-1": (53.3498, -6.2603),
    "eu-west-2": (51.5074, -0.1278),
    "eu-west-3": (48.8566, 2.3522),
    "eu-central-1": (50.1109, 8.6821),
    "eu-north-1": (59.3293, 18.0686),
    "ap-southeast-1": (1.3521, 103.8198),
    "ap-southeast-2": (-33.8688, 151.2093),
    "ap-northeast-1": (35.6762, 139.6503),
    "ap-northeast-2": (37.5665, 126.9780),
    "ap-northeast-3": (34.6937, 135.5023),
    "ap-south-1": (19.0760, 72.8777),
    "sa-east-1": (-23.5505, -46.6333),
    "me-south-1": (26.0667, 50.5577),
    "af-south-1": (-33.9249, 18.4241),
}


def _to_radians(value: float) -> float:
    return (value * math.pi) / 180


def _distance_in_km(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float:
    earth_radius_km = 6371
    d_lat = _to_radians(to_lat - from_lat)
    d_lon = _to_radians(to_lon - from_lon)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(_to_radians(from_lat))
        * math.cos(_to_radians(to_lat))
        * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c


def _as_float(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _fetch_location_coordinates(client_ip: str | None) -> tuple[float, float] | None:
    endpoint = (
        f"https://ipapi.co/{client_ip}/json/"
        if isinstance(client_ip, str) and client_ip.strip()
        else "https://ipapi.co/json/"
    )

    try:
        with urlopen(endpoint, timeout=_IPAPI_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None

    if not isinstance(payload, dict):
        return None

    latitude = _as_float(payload.get("latitude") or payload.get("lat"))
    longitude = _as_float(payload.get("longitude") or payload.get("lon"))
    if latitude is None or longitude is None:
        return None

    return latitude, longitude


def _closest_region(latitude: float, longitude: float) -> str:
    closest_code = _DEFAULT_REGION
    closest_distance = float("inf")
    for code, (region_lat, region_lon) in _REGION_COORDINATES.items():
        distance = _distance_in_km(latitude, longitude, region_lat, region_lon)
        if distance < closest_distance:
            closest_distance = distance
            closest_code = code
    return closest_code


async def detect_closest_region(client_ip: str | None) -> str:
    coordinates = await asyncio.to_thread(_fetch_location_coordinates, client_ip)
    if coordinates is None:
        return _DEFAULT_REGION
    return _closest_region(coordinates[0], coordinates[1])
