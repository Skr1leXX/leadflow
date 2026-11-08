"use client";

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, errorId, nativeSelectClass } from "@/components/shared/field";
import { useToast } from "@/components/shared/toaster";
import { createManualLeadAction, type ManualLeadState } from "@/features/leads/actions";
import { SERVICES } from "@/features/leads/services";

export function NewLeadForm({ idempotencyKey, staff, lockedAssigneeId }: { idempotencyKey: string; staff: { id: string; name: string }[]; lockedAssigneeId?: string }) {
  const [state, action, pending] = useActionState<ManualLeadState, FormData>(createManualLeadAction, {});
  const toast = useToast();
  const e = state.errors ?? {};
  const bad = (name: keyof typeof e) => (e[name] ? { "aria-invalid": true, "aria-describedby": errorId(name) } : {});

  useEffect(() => {
    if (state.message) toast.error(state.message);
  }, [state, toast]);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Card className="max-w-2xl">
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label="Имя" error={e.name}>
              <Input id="name" name="name" autoComplete="off" className="h-10" {...bad("name")} />
            </Field>
            <Field name="phone" label="Телефон" error={e.phone}>
              <Input id="phone" name="phone" type="tel" placeholder="+7 900 123-45-67" autoComplete="off" className="h-10" {...bad("phone")} />
            </Field>
          </div>
          <Field name="email" label="Email" error={e.email} hint="Необязательно: для звонков и заявок из мессенджеров можно оставить пустым">
            <Input id="email" name="email" type="email" autoComplete="off" className="h-10" {...bad("email")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="serviceId" label="Услуга" error={e.serviceId}>
              <select id="serviceId" name="serviceId" defaultValue="" className={`${nativeSelectClass} h-10`} {...bad("serviceId")}>
                <option value="">Выберите услугу</option>
                {SERVICES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field name="assigneeId" label="Ответственный" error={e.assigneeId} hint={lockedAssigneeId ? "Менеджер создаёт заявки на себя" : "Если не выбрать, сработают правила автоматизации"}>
              <select id="assigneeId" name="assigneeId" defaultValue={lockedAssigneeId ?? ""} className={`${nativeSelectClass} h-10`} {...bad("assigneeId")}>
                {!lockedAssigneeId && <option value="">Назначить автоматически</option>}
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field name="comment" label="Комментарий" error={e.comment}>
            <Textarea id="comment" name="comment" rows={4} {...bad("comment")} />
          </Field>
          <Button type="submit" className="h-10" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Создать заявку
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
