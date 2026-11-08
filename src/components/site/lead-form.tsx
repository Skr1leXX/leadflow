"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, errorId, nativeSelectClass } from "@/components/shared/field";
import { parseLeadInput, type LeadFieldErrors, type LeadInput } from "@/features/leads/schema";
import { SERVICES } from "@/features/leads/services";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done"; duplicate: boolean } | { kind: "error"; message: string };

const EMPTY: LeadInput = { name: "", phone: "", email: "", serviceId: "", comment: "" };

/** randomUUID needs a secure context; the fallback keeps the form working over plain http on a LAN. */
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export function LeadForm({ defaultServiceId = "" }: { defaultServiceId?: string }) {
  const [values, setValues] = useState<LeadInput>({ ...EMPTY, serviceId: defaultServiceId });
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [state, setState] = useState<State>({ kind: "idle" });
  // One key per fill: a double click or a retry after a network error resends the same key and cannot create a second lead.
  // Created in the browser after mount, never during prerender, so no key is baked into the static HTML.
  const fill = useRef<{ key: string; shownAt: number } | null>(null);
  useEffect(() => {
    fill.current = { key: newKey(), shownAt: Date.now() };
  }, []);
  const honeypot = useRef<HTMLInputElement>(null);

  const set = (name: keyof LeadInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const bad = (name: keyof LeadInput) => (errors[name] ? { "aria-invalid": true, "aria-describedby": errorId(name) } : {});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind === "sending") return;

    const current = (fill.current ??= { key: newKey(), shownAt: Date.now() });
    const parsed = parseLeadInput(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setState({ kind: "idle" });
      return;
    }
    setErrors({});
    setState({ kind: "sending" });

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, idempotencyKey: current.key, startedAt: current.shownAt, website: honeypot.current?.value ?? "" }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; errors?: LeadFieldErrors; duplicate?: boolean } | null;

      if (res.ok && body?.ok) {
        setState({ kind: "done", duplicate: Boolean(body.duplicate) });
        setValues({ ...EMPTY });
        fill.current = { key: newKey(), shownAt: Date.now() };
        return;
      }
      if (body?.errors) setErrors(body.errors);
      setState({
        kind: "error",
        message: body?.message ?? (res.status >= 500 ? "Сервис временно недоступен. Заявка не отправлена, попробуйте через минуту." : "Не удалось отправить заявку."),
      });
    } catch {
      setState({ kind: "error", message: "Нет связи с сервером. Заявка не отправлена: проверьте интернет и нажмите «Отправить» ещё раз." });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="rounded-xl border border-success/30 bg-success/5 p-6">
        <p className="flex items-center gap-2 text-lg font-semibold text-success">
          <CircleCheck className="size-5" /> Заявка принята
        </p>
        <p className="mt-2 text-sm">
          {state.duplicate ? "Такая заявка у нас уже есть, повторно создавать её не нужно. " : ""}
          Менеджер свяжется с вами в рабочее время по телефону или почте, которые вы указали.
        </p>
        <Button variant="outline" className="mt-4 h-10" onClick={() => setState({ kind: "idle" })}>
          Отправить ещё одну
        </Button>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Заявка на консультацию">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Имя" error={errors.name}>
          <Input id="name" name="name" autoComplete="name" value={values.name} onChange={set("name")} className="h-11" {...bad("name")} />
        </Field>
        <Field name="phone" label="Телефон" error={errors.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+7 900 123-45-67" value={values.phone} onChange={set("phone")} className="h-11" {...bad("phone")} />
        </Field>
      </div>
      <Field name="email" label="Email" error={errors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" value={values.email} onChange={set("email")} className="h-11" {...bad("email")} />
      </Field>
      <Field name="serviceId" label="Услуга" error={errors.serviceId}>
        <select id="serviceId" name="serviceId" value={values.serviceId} onChange={set("serviceId")} className={`${nativeSelectClass} h-11`} {...bad("serviceId")}>
          <option value="">Выберите услугу</option>
          {SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </Field>
      <Field name="comment" label="Комментарий" error={errors.comment} hint="Необязательно: опишите задачу в двух словах">
        <Textarea id="comment" name="comment" rows={4} value={values.comment} onChange={set("comment")} {...bad("comment")} />
      </Field>

      {/* Honeypot: invisible to people and skipped by keyboard and screen readers; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Сайт
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {state.kind === "error" && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {state.message}
        </p>
      )}

      <Button type="submit" className="h-11 w-full sm:w-auto sm:px-8" disabled={sending}>
        {sending && <Loader2 className="animate-spin" />} {sending ? "Отправляем…" : "Отправить заявку"}
      </Button>
      <p className="text-xs text-muted-foreground">Демонстрационный проект: заявка сохраняется в тестовой базе, настоящие данные вводить не нужно.</p>
    </form>
  );
}
