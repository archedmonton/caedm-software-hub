import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { subscriptions, expenses } from "@/lib/data";
import { reportFilters, registerRows, expenseRows } from "@/lib/reports";
import { csv, financeRole, safeCell } from "@/lib/domain";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { data: profile } = await db
    .from("profiles")
    .select("role,status,email")
    .eq("id", user.id)
    .single();
  if (
    !user.email_confirmed_at ||
    profile?.status !== "active" ||
    !financeRole(profile.role) ||
    profile.email.toLowerCase() !== user.email?.toLowerCase() ||
    user.email?.toLowerCase().split("@")[1] !== "caedm.ca"
  )
    return Response.json({ error: "Finance access required" }, { status: 403 });
  const parsed = reportFilters.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return Response.json({ error: "Invalid report filters" }, { status: 400 });
  const f = parsed.data;
  const software = await subscriptions(db);
  const rows =
    f.report === "expenses"
      ? expenseRows(await expenses(db), software, f)
      : registerRows(software, f);
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="caedm-${f.report}.${f.format}"`,
  };
  if (f.format === "csv")
    return new Response(csv(rows), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  const book = new ExcelJS.Workbook();
  book.creator = "CAEDM Software Hub";
  const sheet = book.addWorksheet(
    f.report === "expenses" ? "Recorded Expenses" : "Software Register",
  );
  const keys = rows.length ? Object.keys(rows[0]) : ["No matching records"];
  sheet.columns = keys.map((key) => ({ header: key, key, width: 24 }));
  for (const row of rows)
    sheet.addRow(
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === "number" ? value : safeCell(value),
        ]),
      ),
    );
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF17233A" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: keys.length },
  };
  const output = await book.xlsx.writeBuffer();
  return new Response(new Uint8Array(output), {
    headers: {
      ...headers,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
