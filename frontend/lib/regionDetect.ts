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
