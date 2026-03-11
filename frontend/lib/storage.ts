const API_KEY_KEY = "dtc_api_key";
const PROVIDER_KEY = "dtc_provider";

export type Provider = "anthropic" | "openrouter" | "openai";

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(API_KEY_KEY);
}

export function setApiKey(key: string) {
  localStorage.setItem(API_KEY_KEY, key);
}

export function getProvider(): Provider {
  if (typeof window === "undefined") return "anthropic";
  return (localStorage.getItem(PROVIDER_KEY) as Provider) ?? "anthropic";
}

export function setProvider(provider: Provider) {
  localStorage.setItem(PROVIDER_KEY, provider);
}

export function clearCredentials() {
  localStorage.removeItem(API_KEY_KEY);
  localStorage.removeItem(PROVIDER_KEY);
}
