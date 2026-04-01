import { describe, expect, it, vi } from "vitest";
import {
  UrlValidationError,
  assertExternalHttpUrl,
  isInternalIp,
  normalizeHostname,
} from "./urlSecurity.js";

describe("normalizeHostname", () => {
  it("removes IPv6 brackets and normalizes case", () => {
    expect(normalizeHostname("[FD00::1]")).toBe("fd00::1");
  });
});

describe("isInternalIp", () => {
  it("detects private IPv6 literals", () => {
    expect(isInternalIp("fd00::1")).toBe(true);
    expect(isInternalIp("fe80::1")).toBe(true);
    expect(isInternalIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isInternalIp("1.1.1.1")).toBe(false);
    expect(isInternalIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertExternalHttpUrl", () => {
  it("rejects private IPv6 literal URLs without DNS", async () => {
    await expect(assertExternalHttpUrl("http://[fd00::1]/")).rejects.toEqual(
      expect.objectContaining<Partial<UrlValidationError>>({
        code: "internal_url",
      }),
    );
  });

  it("rejects hosts that resolve to private addresses", async () => {
    const lookupHost = vi.fn(async () => ["10.0.0.2"]);

    await expect(
      assertExternalHttpUrl("https://example.com", lookupHost),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UrlValidationError>>({
        code: "internal_url",
      }),
    );
  });

  it("fails closed when hostname validation cannot complete", async () => {
    const lookupHost = vi.fn(async () => {
      throw new Error("lookup failed");
    });

    await expect(
      assertExternalHttpUrl("https://example.com", lookupHost),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UrlValidationError>>({
        code: "internal_url",
      }),
    );
  });

  it("accepts public HTTP(S) URLs", async () => {
    const lookupHost = vi.fn(async () => ["93.184.216.34"]);

    const parsed = await assertExternalHttpUrl(
      "https://example.com/path",
      lookupHost,
    );

    expect(parsed.hostname).toBe("example.com");
  });
});
