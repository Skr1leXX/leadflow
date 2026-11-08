"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, nativeSelectClass } from "@/components/shared/field";
import { useToast } from "@/components/shared/toaster";
import { createRuleAction, type RuleFormState } from "@/features/leads/actions";
import { SERVICES } from "@/features/leads/services";

export function RuleForm({ staff }: { staff: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<"by_service" | "round_robin">("by_service");
  const [state, action, pending] = useActionState<RuleFormState, FormData>(createRuleAction, {});
  const toast = useToast();

  useEffect(() => {
    if (state.ok) toast.success("Правило создано и включено");
    else if (state.error) toast.error(state.error);
  }, [state, toast]);

  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Название">
          <Input id="name" name="name" placeholder="Например, заявки по услугам" className="h-10" />
        </Field>
        <Field name="kind" label="Тип правила">
          <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={`${nativeSelectClass} h-10`}>
            <option value="by_service">По услуге: каждая услуга своему сотруднику</option>
            <option value="round_robin">По кругу: поровну между выбранными</option>
          </select>
        </Field>
      </div>

      {kind === "by_service" ? (
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Кто отвечает за услугу</legend>
          {SERVICES.map((s) => (
            <div key={s.id} className="grid items-center gap-2 sm:grid-cols-2">
              <label htmlFor={`service_${s.id}`} className="text-sm">
                {s.title}
              </label>
              <select id={`service_${s.id}`} name={`service_${s.id}`} defaultValue="" className={`${nativeSelectClass} h-10`}>
                <option value="">—</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="grid items-center gap-2 border-t pt-3 sm:grid-cols-2">
            <label htmlFor="fallback" className="text-sm">
              Остальные услуги
            </label>
            <select id="fallback" name="fallback" defaultValue="" className={`${nativeSelectClass} h-10`}>
              <option value="">Не назначать</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      ) : (
        <fieldset className="space-y-1 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Кому передавать по очереди (минимум двое)</legend>
          {staff.map((p) => (
            <label key={p.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="staff" value={p.id} className="size-4 accent-[var(--primary)]" /> {p.name}
            </label>
          ))}
        </fieldset>
      )}

      <Button type="submit" className="h-10" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Создать правило
      </Button>
    </form>
  );
}
