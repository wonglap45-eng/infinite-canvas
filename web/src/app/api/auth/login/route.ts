import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, checkCredentials, createSessionValue, sessionCookieOptions } from "@/lib/auth";

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = String(body.username || "");
    const password = String(body.password || "");

    if (!checkCredentials(username, password)) {
        return NextResponse.json({ ok: false, error: "用户名或密码不正确" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE, createSessionValue(), sessionCookieOptions());
    return response;
}
