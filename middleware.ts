import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SANDBOX_COOKIE,
  SANDBOX_MAX_AGE,
  isSandboxId,
  newSandboxId,
} from "./app/lib/session";

export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const current = req.cookies.get(SANDBOX_COOKIE)?.value;
  if (current && isSandboxId(current)) return res;

  res.cookies.set(SANDBOX_COOKIE, newSandboxId(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SANDBOX_MAX_AGE,
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
