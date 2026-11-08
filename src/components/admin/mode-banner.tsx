import Link from "next/link";
import { connection } from "next/server";
import { TriangleAlert } from "lucide-react";
import { canManageIntegration } from "@/features/auth/permissions";
import { getCurrentUser } from "@/features/auth/session";
import { getIntegrationStatus } from "@/features/bitrix/integration";
import { getSettings } from "@/features/leads/service";

/** Shown on every admin page unless live mode is configured, so a demo is never mistaken for a real connection. */
export async function ModeBanner() {
  await connection();
  const user = await getCurrentUser();
  const admin = user ? canManageIntegration(user) : false; // only administrators can open the setup page
  const s = getIntegrationStatus((await getSettings()).mode);
  if (s.state === "ready") return null;

  const demo = s.state === "demo";
  return (
    <div
      role={demo ? "note" : "alert"}
      className={`flex items-start gap-2 px-4 py-2 text-sm md:px-8 ${demo ? "bg-warning/15 text-foreground" : "bg-destructive/10 text-destructive"}`}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        {demo ? "Демонстрационный режим: заявки не уходят в настоящий Битрикс24." : s.problem}{" "}
        {admin && (
          <Link href="/admin/integration" className="font-medium underline underline-offset-2">
            Настроить
          </Link>
        )}
      </p>
    </div>
  );
}
