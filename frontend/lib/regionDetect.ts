export const ALL_AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "sa-east-1",
  "me-south-1",
  "af-south-1",
] as const;

export type AWSRegion = (typeof ALL_AWS_REGIONS)[number];

export const REGION_LABELS: Record<string, string> = {
  "us-east-1": "N. Virginia",
  "us-east-2": "Ohio",
  "us-west-1": "N. California",
  "us-west-2": "Oregon",
  "ca-central-1": "Canada",
  "eu-west-1": "Ireland",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "eu-central-1": "Frankfurt",
  "eu-north-1": "Stockholm",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney",
  "ap-northeast-1": "Tokyo",
  "ap-northeast-2": "Seoul",
  "ap-northeast-3": "Osaka",
  "ap-south-1": "Mumbai",
  "sa-east-1": "Sao Paulo",
  "me-south-1": "Bahrain",
  "af-south-1": "Cape Town",
};

const REGION_COORDINATES: Record<AWSRegion, { lat: number; lon: number }> = {
  "us-east-1": { lat: 39.0438, lon: -77.4874 },
  "us-east-2": { lat: 40.4173, lon: -82.9071 },
  "us-west-1": { lat: 37.3382, lon: -121.8863 },
  "us-west-2": { lat: 45.5231, lon: -122.6765 },
  "ca-central-1": { lat: 45.5017, lon: -73.5673 },
  "eu-west-1": { lat: 53.3498, lon: -6.2603 },
  "eu-west-2": { lat: 51.5074, lon: -0.1278 },
  "eu-west-3": { lat: 48.8566, lon: 2.3522 },
  "eu-central-1": { lat: 50.1109, lon: 8.6821 },
  "eu-north-1": { lat: 59.3293, lon: 18.0686 },
  "ap-southeast-1": { lat: 1.3521, lon: 103.8198 },
  "ap-southeast-2": { lat: -33.8688, lon: 151.2093 },
  "ap-northeast-1": { lat: 35.6762, lon: 139.6503 },
  "ap-northeast-2": { lat: 37.5665, lon: 126.978 },
  "ap-northeast-3": { lat: 34.6937, lon: 135.5023 },
  "ap-south-1": { lat: 19.076, lon: 72.8777 },
  "sa-east-1": { lat: -23.5505, lon: -46.6333 },
  "me-south-1": { lat: 26.0667, lon: 50.5577 },
  "af-south-1": { lat: -33.9249, lon: 18.4241 },
};

const TIMEZONE_TO_REGIONS: Record<string, AWSRegion[]> = {
  America: ["us-east-1", "us-west-2", "ca-central-1"],
  US: ["us-east-1", "us-west-2", "us-east-2"],
  Canada: ["ca-central-1", "us-east-1", "us-west-2"],
  Europe: ["eu-central-1", "eu-west-1", "eu-north-1"],
  Africa: ["af-south-1", "eu-west-1", "me-south-1"],
  Asia: ["ap-southeast-1", "ap-northeast-1", "ap-south-1"],
  Australia: ["ap-southeast-2", "ap-southeast-1", "ap-northeast-1"],
  Pacific: ["ap-southeast-2", "ap-northeast-1", "us-west-2"],
  Atlantic: ["eu-west-1", "us-east-1", "sa-east-1"],
  Indian: ["ap-south-1", "ap-southeast-1", "me-south-1"],
};

const CITY_OVERRIDES: Record<string, AWSRegion[]> = {
  "America/New_York": ["us-east-1", "us-east-2", "ca-central-1"],
  "America/Chicago": ["us-east-1", "us-west-2", "us-east-2"],
  "America/Denver": ["us-west-2", "us-east-1", "us-west-1"],
  "America/Los_Angeles": ["us-west-2", "us-west-1", "us-east-1"],
  "America/Sao_Paulo": ["sa-east-1", "us-east-1", "eu-west-1"],
  "Europe/London": ["eu-west-2", "eu-west-1", "eu-central-1"],
  "Europe/Berlin": ["eu-central-1", "eu-west-1", "eu-north-1"],
  "Europe/Paris": ["eu-west-3", "eu-central-1", "eu-west-1"],
  "Europe/Stockholm": ["eu-north-1", "eu-central-1", "eu-west-1"],
  "Asia/Tokyo": ["ap-northeast-1", "ap-northeast-3", "ap-northeast-2"],
  "Asia/Seoul": ["ap-northeast-2", "ap-northeast-1", "ap-northeast-3"],
  "Asia/Singapore": ["ap-southeast-1", "ap-northeast-1", "ap-south-1"],
  "Asia/Kolkata": ["ap-south-1", "ap-southeast-1", "me-south-1"],
  "Asia/Dubai": ["me-south-1", "ap-south-1", "eu-central-1"],
  "Australia/Sydney": ["ap-southeast-2", "ap-southeast-1", "ap-northeast-1"],
};

const DEFAULT_REGIONS: AWSRegion[] = ["us-east-1", "us-west-2", "eu-west-1"];

type IpLookupOptions = {
  fetcher?: typeof fetch;
  fallbackTimezone?: string;
};

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceInKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function fallbackRegions(timezone?: string): AWSRegion[] {
  return detectRecommendedRegions(timezone ?? detectTimezone());
}

export function detectClosestRegionsFromCoordinates(lat: number, lon: number, limit = 3): AWSRegion[] {
  return [...ALL_AWS_REGIONS]
    .sort((a, b) => {
      const aCoordinates = REGION_COORDINATES[a];
      const bCoordinates = REGION_COORDINATES[b];
      const distanceA = distanceInKm(lat, lon, aCoordinates.lat, aCoordinates.lon);
      const distanceB = distanceInKm(lat, lon, bCoordinates.lat, bCoordinates.lon);
      return distanceA - distanceB;
    })
    .slice(0, Math.max(1, limit));
}

export function detectRecommendedRegions(timezone?: string): AWSRegion[] {
  if (!timezone) return DEFAULT_REGIONS;

  const cityMatch = CITY_OVERRIDES[timezone];
  if (cityMatch) return cityMatch;

  const continent = timezone.split("/")[0];
  const continentMatch = TIMEZONE_TO_REGIONS[continent];
  if (continentMatch) return continentMatch;

  return DEFAULT_REGIONS;
}

export function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export async function detectRecommendedRegionsByIp(options: IpLookupOptions = {}): Promise<AWSRegion[]> {
  const fallback = fallbackRegions(options.fallbackTimezone);
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher("https://ipapi.co/json/");
    if (!response.ok) return fallback;

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload) return fallback;

    const latitude = asNumber(payload.latitude ?? payload.lat);
    const longitude = asNumber(payload.longitude ?? payload.lon);
    if (latitude === null || longitude === null) return fallback;

    return detectClosestRegionsFromCoordinates(latitude, longitude);
  } catch {
    return fallback;
  }
}
