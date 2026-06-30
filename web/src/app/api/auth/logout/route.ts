import { NextResponse } from "next/server";
import { AUTH_COOKIE, clearSessionCookieOptions } from "@/lib/auth";

export async function POST() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE, "", clearSessionCookieOptions());
    return response;
}
