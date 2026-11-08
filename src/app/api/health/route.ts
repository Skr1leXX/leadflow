import { connection, NextResponse } from "next/server";
import { getDb } from "@/features/leads/db";

/** Liveness and database check for load balancers and container health checks. It reveals nothing about configuration. */
export async function GET() {
  await connection();
  try {
    await (await getDb()).get("SELECT 1 AS ok");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
