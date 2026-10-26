"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/env";
import { password, workEmail } from "@/lib/domain";
import { limitAuth } from "@/lib/rate-limit";
export type AuthState = { error?: string; message?: string };
export async function authenticate(
  mode: string,
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const secret = String(form.get("password") || "");
  try {
    if (!["login", "register", "forgot", "update"].includes(mode))
      return { error: "Invalid request." };
    if (mode !== "update") workEmail.parse(email);
    if (mode === "register" || mode === "update") {
      password.parse(secret);
      if (secret !== form.get("confirmation"))
        return { error: "Passwords do not match." };
    }
    if (mode === "register")
      z.string().trim().min(1).max(150).parse(form.get("full_name"));
    if (mode !== "update") await limitAuth(email);
    const db = await createClient();
    if (mode === "login") {
      const { error } = await db.auth.signInWithPassword({
        email,
        password: secret,
      });
      if (error)
        return {
          error: "Unable to sign in. Check your details and verify your email.",
        };
    } else if (mode === "register") {
      const { error } = await db.auth.signUp({
        email,
        password: secret,
        options: {
          data: { full_name: String(form.get("full_name")).trim() },
          emailRedirectTo: `${appUrl()}/auth/callback`,
        },
      });
      if (error)
        return {
          error:
            "Registration could not be completed. Check your details or contact IT.",
        };
      return {
        message:
          "Check your work email to verify your address. An administrator will then approve your access.",
      };
    } else if (mode === "forgot") {
      await db.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl()}/auth/callback?next=/auth/update-password`,
      });
      return {
        message:
          "If an account exists, a password reset link has been sent to your work email.",
      };
    } else {
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user?.email_confirmed_at)
        return { error: "Open a valid password reset link first." };
      await limitAuth(user.email || user.id);
      const { error } = await db.auth.updateUser({ password: secret });
      if (error)
        return {
          error: "Password could not be updated. Request a new reset link.",
        };
      return { message: "Password updated. You can return to the dashboard." };
    }
  } catch (error) {
    return {
      error:
        error instanceof z.ZodError
          ? error.issues[0].message
          : error instanceof Error &&
              /Too many|configured|unavailable/.test(error.message)
            ? error.message
            : "Unable to complete the request. Please try again.",
    };
  }
  redirect("/dashboard");
}
export async function logout() {
  const db = await createClient();
  await db.auth.signOut();
  redirect("/login");
}
