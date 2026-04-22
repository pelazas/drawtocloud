import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("ESLint rule: no localStorage credential storage", () => {
  it("catches localStorage.setItem for api keys", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "eslint-test-"));
    const eslintrc = JSON.stringify({
      parser: "@typescript-eslint/parser",
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "CallExpression[callee.type='MemberExpression'][callee.object.name='localStorage'][callee.property.name=/setItem|getItem|removeItem/]",
            message:
              "Client-side localStorage credential storage is forbidden. API keys must be managed server-side via environment variables.",
          },
        ],
      },
    });

    writeFileSync(join(tmpDir, ".eslintrc.json"), eslintrc);
    writeFileSync(
      join(tmpDir, "forbidden.ts"),
      `localStorage.setItem("dtc_api_key", "secret");`
    );

    let caught = false;
    const eslintBin = join(__dirname, "../../node_modules/.bin/eslint");
    try {
      execSync(
        `${eslintBin} --no-eslintrc --c ${join(tmpDir, ".eslintrc.json")} ${join(tmpDir, "forbidden.ts")}`,
        { encoding: "utf-8", cwd: join(__dirname, "../.."), stdio: "pipe" }
      );
    } catch (error: any) {
      caught = true;
      const output = (error.stdout || "") + (error.stderr || "");
      expect(output).toContain("Client-side localStorage credential storage is forbidden");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    expect(caught).toBe(true);
  });
});
