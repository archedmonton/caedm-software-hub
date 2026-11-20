import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (type === "recovery") {
    const target = new URL("/reset-password", request.url);
    if (hash && /^(?:pkce_)?[a-f0-9]{32,128}$/i.test(hash))
      target.hash = new URLSearchParams({ token_hash: hash }).toString();
    const response = NextResponse.redirect(target);
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (hash && (type === "signup" || type === "email")) {
    const db = await createClient();
    const { error } = await db.auth.verifyOtp({ token_hash: hash, type });
    if (!error)
      return NextResponse.redirect(new URL("/pending-approval", request.url));
  }
  return NextResponse.redirect(
    new URL(
      "/login?error=Verification+link+is+invalid+or+expired",
      request.url,
    ),
  );
}
