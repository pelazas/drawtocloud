import type { NextResponse } from "next/server";
import { applyNonceToCsp } from "./cspNonce";

export function applySecurityHeaders(response: NextResponse, nonce: string): void {
  const existingCsp = response.headers.get("Content-Security-Policy");
  if (existingCsp) {
    const hardenedCsp = applyNonceToCsp(existingCsp, nonce);
    response.headers.set("Content-Security-Policy", hardenedCsp);
  }
}
