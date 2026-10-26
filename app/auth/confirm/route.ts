import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (hash && (type === "signup" || type === "recovery" || type === "email")) {
    const db = await createClient();
    const { error } = await db.auth.verifyOtp({ token_hash: hash, type });
    if (!error)
      return NextResponse.redirect(
        new URL(
          type === "recovery" ? "/auth/update-password" : "/pending-approval",
          request.url,
        ),
      );
  }
  return NextResponse.redirect(
    new URL(
      "/login?error=Verification+link+is+invalid+or+expired",
      request.url,
    ),
  );
}
