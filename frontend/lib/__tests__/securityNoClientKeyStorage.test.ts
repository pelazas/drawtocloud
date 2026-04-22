import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const FRONTEND_DIR = resolve(__dirname, "../..");

describe("security: no client-side API key storage", () => {
  it("does not contain frontend/lib/storage.ts", () => {
    const path = resolve(FRONTEND_DIR, "lib/storage.ts");
    expect(existsSync(path)).toBe(false);
  });

  it("does not reference dtc_api_key or dtc_provider in source", () => {
    const result = execSync(
      `grep -r "dtc_api_key\\|dtc_provider" ${FRONTEND_DIR} --include="*.ts" --include="*.tsx" -l || true`,
      { encoding: "utf-8" }
    );
    const files = result
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("node_modules"))
      .filter((f) => !f.includes("__tests__/securityNoClientKeyStorage.test.ts"))
      .filter((f) => !f.includes("__tests__/eslintLocalStorageRule.test.ts"));

    expect(files).toEqual([]);
  });

  it("does not use localStorage for credentials in source", () => {
    const result = execSync(
      `grep -rn "localStorage\\.setItem\\|localStorage\\.getItem\\|localStorage\\.removeItem" ${FRONTEND_DIR} --include="*.ts" --include="*.tsx" || true`,
      { encoding: "utf-8" }
    );
    const lines = result
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.includes("node_modules"))
      .filter((line) => !line.includes("__tests__/securityNoClientKeyStorage.test.ts"))
      .filter((line) => !line.includes("__tests__/eslintLocalStorageRule.test.ts"));

    expect(lines).toEqual([]);
  });
});
