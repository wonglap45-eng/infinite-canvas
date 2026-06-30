import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const AUTH_COOKIE = "eons_session";
const SESSION_DAYS = 7;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

function authSecret() {
    return process.env.ADMIN_PASSWORD || "change-me";
}

function sign(value: string) {
    return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export function createSessionValue(now = Date.now()) {
    const expiresAt = now + SESSION_MAX_AGE * 1000;
    const payload = String(expiresAt);
    return `${payload}.${sign(payload)}`;
}

export function isValidSession(value?: string | null, now = Date.now()) {
    if (!value) return false;
    const [payload, signature] = value.split(".");
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
    const expiresAt = Number(payload);
    return Number.isFinite(expiresAt) && expiresAt > now;
}

export function isAuthenticatedRequest(request: NextRequest) {
    return isValidSession(request.cookies.get(AUTH_COOKIE)?.value);
}

export function sessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_MAX_AGE,
    };
}

export function clearSessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    };
}

export function checkCredentials(username: string, password: string) {
    const expectedUsername = process.env.ADMIN_USERNAME || "admin";
    const expectedPassword = process.env.ADMIN_PASSWORD || "change-me";
    return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}
