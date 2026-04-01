import dns from "dns/promises";
import { isIP } from "node:net";

export class UrlValidationError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_url" | "unsupported_protocol" | "internal_url",
  ) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export type HostLookup = (hostname: string) => Promise<string[]>;

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

export function isInternalIp(ip: string): boolean {
  const normalizedIp = normalizeHostname(ip);

  if (normalizedIp.startsWith("::ffff:")) {
    return isInternalIp(normalizedIp.slice("::ffff:".length));
  }

  if (isIP(normalizedIp) === 4) {
    const parts = normalizedIp.split(".");
    const first = Number(parts[0]);
    const second = Number(parts[1]);

    if (first === 127) return true;
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    if (first === 0) return true;
    return false;
  }

  if (isIP(normalizedIp) === 6) {
    if (normalizedIp === "::1" || normalizedIp === "::") return true;
    if (normalizedIp.startsWith("fe80:")) return true;
    if (normalizedIp.startsWith("fc") || normalizedIp.startsWith("fd"))
      return true;
  }

  return false;
}

export async function lookupHostAddresses(hostname: string): Promise<string[]> {
  const addresses = await dns.lookup(normalizeHostname(hostname), {
    all: true,
    verbatim: true,
  });

  return addresses.map((address) => address.address);
}

export async function assertExternalHttpUrl(
  urlString: string,
  lookupHost: HostLookup = lookupHostAddresses,
): Promise<URL> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new UrlValidationError("Invalid URL", "invalid_url");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new UrlValidationError(
      "Only HTTP/HTTPS URLs supported",
      "unsupported_protocol",
    );
  }

  const hostname = normalizeHostname(parsedUrl.hostname);

  if (hostname === "localhost" || hostname === "0.0.0.0") {
    throw new UrlValidationError("Internal URLs not allowed", "internal_url");
  }

  if (isIP(hostname) !== 0) {
    if (isInternalIp(hostname)) {
      throw new UrlValidationError("Internal URLs not allowed", "internal_url");
    }
    return parsedUrl;
  }

  let addresses: string[];
  try {
    addresses = await lookupHost(hostname);
  } catch {
    throw new UrlValidationError("Internal URLs not allowed", "internal_url");
  }

  if (
    addresses.length === 0 ||
    addresses.some((address) => isInternalIp(address))
  ) {
    throw new UrlValidationError("Internal URLs not allowed", "internal_url");
  }

  return parsedUrl;
}
