import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const smokeDoc = new URL("../../../docs/pexlo-smoke.md", import.meta.url);

describe("Pexlo intake smoke artifact", () => {
  it("exists and records the successful intake result", () => {
    expect(existsSync(smokeDoc)).toBe(true);
    expect(readFileSync(smokeDoc, "utf8")).toContain("Pexlo intake works");
  });
});
