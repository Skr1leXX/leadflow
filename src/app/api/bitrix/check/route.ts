import { NextResponse } from "next/server";
import { checkConnection, getSettings } from "@/features/leads/service";
import { guardApi } from "../guard";

/** Runs the connection check against the active integration and reports portal details or the error. */
export async function POST(request: Request) {
  const denied = guardApi(request, (await getSettings()).mode);
  if (denied) return denied;
  const report = await checkConnection();
  return NextResponse.json(report, { status: report.ok ? 200 : 502 });
}
