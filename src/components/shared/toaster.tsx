"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

interface Notify {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
  /** Shows a server action's result: green when it worked, red when it did not. */
  result(r: { ok: boolean; message: string }): void;
}

const Ctx = createContext<Notify | null>(null);

/** Short-lived messages for actions and errors. Errors stay longer and are announced assertively. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  const api = useMemo<Notify>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      result: (r) => push(r.ok ? "success" : "error", r.message),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-card p-3 text-sm shadow-lg",
              t.tone === "error" && "border-destructive/40",
              t.tone === "success" && "border-success/40",
            )}
          >
            {t.tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> : t.tone === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
            <p className="min-w-0 flex-1 break-words">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление" className="-m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): Notify {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const FLASH: Record<string, { tone: "success" | "info"; message: string }> = {
  created: { tone: "success", message: "Заявка создана" },
  duplicate: { tone: "info", message: "Такая заявка уже была создана: открыта существующая" },
};

/** Shows the toast named by `?flash=` after a redirect, then removes the parameter so a reload does not repeat it. */
export function FlashToast() {
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const flash = params.get("flash");

  useEffect(() => {
    const f = flash ? FLASH[flash] : undefined;
    if (!f) return;
    toast[f.tone](f.message);
    router.replace(pathname, { scroll: false });
  }, [flash, pathname, router, toast]);
  return null;
}
