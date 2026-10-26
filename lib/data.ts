import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subscription, Expense, Review } from "@/lib/domain";
export const subscriptionSelect =
  "*,vendors(name),teams(name),profiles!software_subscriptions_owner_id_fkey(full_name),payment_methods(nickname,last_four,brand)";
export async function allRows<T>(
  db: SupabaseClient,
  table: string,
  select = "*",
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .order(table === "team_members" ? "profile_id" : "id")
      .order(table === "team_members" ? "team_id" : "id")
      .range(offset, offset + 499);
    if (error)
      throw new Error(
        "The database request failed. Check that migrations are applied and your account has access.",
      );
    rows.push(...(data as unknown as T[]));
    if (data.length < 500) return rows;
  }
}
export async function subscriptions(db: SupabaseClient) {
  return allRows<Subscription>(
    db,
    "software_subscriptions",
    subscriptionSelect,
  );
}
export async function reviews(db: SupabaseClient) {
  return allRows<Review>(
    db,
    "usage_reviews",
    "*,software_subscriptions(" + subscriptionSelect + ")",
  );
}
export async function expenses(db: SupabaseClient) {
  return allRows<
    Expense & {
      vendor_name: string;
      team_name: string;
      team_id: string;
      cost_centre: string;
      payment_reference: string;
      payment_method_id: string | null;
    }
  >(db, "expense_records");
}
