import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (error) {
    // Log the real error server-side only — the response body is
    // reachable by anyone (it's a healthcheck endpoint, often public to
    // infra monitoring) and driver errors can include host/user details.
    console.error("Health check DB connection failed:", error);
    return NextResponse.json({ status: "error", database: "disconnected" }, { status: 503 });
  }
}
