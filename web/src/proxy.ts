import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth";

const PUBLIC_FILE = /\.(.*)$/;

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (pathname.startsWith("/_next") || pathname === "/favicon.ico" || PUBLIC_FILE.test(pathname)) {
        return NextResponse.next();
    }

    if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
        if (pathname === "/login" && isAuthenticatedRequest(request)) {
            return NextResponse.redirect(new URL("/", request.url));
        }
        return NextResponse.next();
    }

    if (!isAuthenticatedRequest(request)) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
