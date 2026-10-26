export function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
export function publicConfig() {
  if (!configured())
    throw new Error(
      "Supabase is not configured. Follow the setup instructions in README.md.",
    );
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  };
}
export function appUrl() {
  const url =
    process.env.APP_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!url) throw new Error("APP_URL is required in production.");
  const parsed = new URL(url);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
    throw new Error("APP_URL must use HTTPS.");
  return parsed.origin;
}
