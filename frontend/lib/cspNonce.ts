export function generateNonce(): string {
  return crypto.randomUUID();
}

export function applyNonceToCsp(csp: string, nonce: string): string {
  return csp.replace(
    /script-src\s+([^;]+)/,
    (match, directive) => {
      const tokens = directive.split(/\s+/).filter((token: string) => token !== "'unsafe-inline'");
      return `script-src 'nonce-${nonce}' ${tokens.join(" ")}`;
    }
  );
}
