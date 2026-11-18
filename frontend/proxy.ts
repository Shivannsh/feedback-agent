import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (process.env.REQUIRE_APP_PASSWORD !== "1") {
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse("The app password is not configured.", {
      status: 503,
    });
  }

  const credentials = request.headers.get("authorization") ?? "";
  const expected =
    "Basic " + Buffer.from(`listener:${password}`).toString("base64");
  const receivedHash = createHash("sha256").update(credentials).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(receivedHash, expectedHash)) {
    return new NextResponse("Sign in to First Listener.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="First Listener", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("authorization");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
