import type { Request } from "express";
import { env } from "./env.js";

function isCapacitorOrigin(req?: Request): boolean {
  if (!req) return false;
  const origin = req.headers?.origin || "";
  return origin.includes("capacitor://") || origin === "https://localhost";
}

function getConfiguredCookieSecurity(): boolean {
  return (
    env.APP_URL.startsWith("https://") || env.API_URL.startsWith("https://")
  );
}

export function shouldUseSecureCookies(req?: Request): boolean {
  if (isCapacitorOrigin(req)) {
    return true;
  }

  if (req) {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto;

    if (req.secure || protocol === "https") {
      return true;
    }
  }

  return getConfiguredCookieSecurity();
}

export function getSessionCookieOptions(req?: Request) {
  const capacitor = isCapacitorOrigin(req);
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(req),
    sameSite: capacitor ? ("none" as const) : ("lax" as const),
    domain: capacitor ? undefined : env.COOKIE_DOMAIN,
    path: "/",
  };
}

export function getAdminSessionCookieOptions(req?: Request) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(req),
    sameSite: "lax" as const,
    domain: env.COOKIE_DOMAIN,
    path: "/",
  };
}
