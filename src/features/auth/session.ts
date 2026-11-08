import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/features/leads/db";
import { getStaff } from "@/features/leads/repo-workflow";
import type { Actor } from "./permissions";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from "./token";

/** Production needs LEADFLOW_SESSION_SECRET; the fixed fallback exists only so a fresh dev checkout can sign in. */
function secret(): string | null {
  const s = process.env.LEADFLOW_SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  return process.env.NODE_ENV === "production" ? null : "leadflow-dev-secret-not-for-production";
}

export const sessionConfigured = () => secret() !== null;

/** The signed-in, still active staff member, or null. The role is read from the database on every call, not from the cookie. */
export async function getCurrentUser(): Promise<(Actor & { email: string }) | null> {
  // Request data comes first, before any branch on the environment. At build time the secret is not set, and returning early
  // there made Next bake "not signed in" (a redirect to /login) into the prerendered shell of every admin page.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const key = secret();
  if (!key) return null;
  const sid = verifySession(token, key);
  const staff = sid ? getStaff(getDb(), sid) : undefined;
  return staff?.active ? { id: staff.id, name: staff.name, email: staff.email, role: staff.role } : null;
}

/** For pages: signed-in user or a redirect to the login page. */
export async function requireUser(): Promise<Actor & { email: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function startSession(staffId: string) {
  const key = secret();
  if (!key) throw new Error("LEADFLOW_SESSION_SECRET is not set");
  (await cookies()).set(SESSION_COOKIE, signSession(staffId, key), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
