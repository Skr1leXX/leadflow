"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/features/leads/db";
import { getCredentials } from "@/features/leads/repo-workflow";
import { createRateLimiter } from "@/features/leads/spam";
import { verifyPassword } from "./password";
import { endSession, sessionConfigured, startSession } from "./session";

export interface LoginState {
  error?: string;
}

// Against password guessing: 8 failed or successful tries per 10 minutes for one address from one client.
const limiter = createRateLimiter(8, 10 * 60_000);
// Verified when the account does not exist, so a missing user costs the same time as a wrong password.
const DUMMY_HASH = "scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  if (!sessionConfigured()) return { error: "Вход не настроен: задайте LEADFLOW_SESSION_SECRET на сервере." };

  const email = String(form.get("email") ?? "").trim().slice(0, 120);
  const password = String(form.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { error: "Введите почту и пароль" };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const wait = limiter.hit(`${ip}|${email.toLowerCase()}`, Date.now());
  if (wait > 0) return { error: `Слишком много попыток. Повторите через ${Math.ceil(wait / 60)} мин.` };

  const found = getCredentials(getDb(), email);
  const ok = verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
  if (!found || !ok || !found.staff.active) return { error: "Неверная почта или пароль" };

  await startSession(found.staff.id);
  const next = String(form.get("next") ?? "");
  // Only paths inside the admin panel: never an arbitrary URL.
  redirect(/^\/admin(\/|$|\?)/.test(next) && !next.startsWith("//") ? next : "/admin");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}
