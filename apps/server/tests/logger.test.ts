import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars!!";

const { redact } = await import("../src/lib/logger.js");

/**
 * The one security-critical logging rule: values under secret-looking keys
 * are replaced before anything is written anywhere.
 */
describe("redact", () => {
  it("masks token-like keys at any depth", () => {
    const input = {
      accessToken: "abc",
      nested: { apiKey: "xyz", safe: 1 },
      list: [{ password: "pw" }],
    };
    const output = redact(input) as typeof input;
    expect(output.accessToken).toBe("[REDACTED]");
    expect(output.nested.apiKey).toBe("[REDACTED]");
    expect(output.nested.safe).toBe(1);
    expect(output.list[0]?.password).toBe("[REDACTED]");
  });

  it("leaves ordinary data untouched", () => {
    const input = { title: "Build a shop", bids: 7 };
    expect(redact(input)).toEqual(input);
  });

  it("passes primitives through", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});
