"use client";

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, errorId, nativeSelectClass } from "@/components/shared/field";
import { useToast } from "@/components/shared/toaster";
import { saveSettingsAction, type SettingsErrors, type SettingsState } from "@/features/leads/actions";
import { leadStatusMeta } from "@/features/leads/status-meta";
import { LEAD_STATUSES, type IntegrationSettings } from "@/features/leads/types";

export function SettingsForm({ initial }: { initial: IntegrationSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettingsAction, {});
  const toast = useToast();
  const e: SettingsErrors = state.errors ?? {};
  const bad = (name: keyof SettingsErrors) => (e[name] ? { "aria-invalid": true, "aria-describedby": errorId(name) } : {});

  useEffect(() => {
    if (state.result) toast.result(state.result);
  }, [state, toast]);

  return (
    <form action={action} noValidate>
      <Card className="max-w-2xl">
        <CardContent className="space-y-5">
          <Field name="mode" label="Режим интеграции" error={e.mode} hint="Адрес вебхука задаётся только в .env.local и здесь не показывается.">
            <select id="mode" name="mode" defaultValue={initial.mode} className={`${nativeSelectClass} h-10`} {...bad("mode")}>
              <option value="demo">Демонстрационный: без реального портала</option>
              <option value="live">Боевой: заявки уходят в Битрикс24</option>
            </select>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field name="responsibleId" label="ID ответственного по умолчанию" error={e.responsibleId} hint="Используется, если у заявки нет ответственного или у него не указан ID в Битрикс24">
              <Input id="responsibleId" name="responsibleId" inputMode="numeric" defaultValue={initial.responsibleId} className="h-10" {...bad("responsibleId")} />
            </Field>
            <Field name="sourceId" label="Код источника" error={e.sourceId}>
              <Input id="sourceId" name="sourceId" defaultValue={initial.sourceId} className="h-10" {...bad("sourceId")} />
            </Field>
          </div>
          <Field name="notifyEmail" label="Почта для уведомлений об ошибках" error={e.notifyEmail}>
            <Input id="notifyEmail" name="notifyEmail" type="email" defaultValue={initial.notifyEmail} className="h-10" {...bad("notifyEmail")} />
          </Field>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Соответствие статусов воронке Битрикс24</legend>
            <p className="text-xs text-muted-foreground">Значения по умолчанию подходят для стандартной воронки лидов. Если у портала своя воронка, впишите её коды статусов (STATUS_ID).</p>
            {LEAD_STATUSES.map((s) => {
              const key = `status_${s}` as const;
              return (
                <div key={s} className="grid items-start gap-2 sm:grid-cols-2">
                  <label htmlFor={key} className="pt-2 text-sm">
                    {leadStatusMeta[s].label}
                  </label>
                  <div>
                    <Input id={key} name={key} defaultValue={initial.statusMap[s]} className="h-10" {...bad(key)} />
                    {e[key] && (
                      <p id={errorId(key)} className="mt-1 text-sm text-destructive">
                        {e[key]}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </fieldset>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="autoSync" className="text-sm">
              <span className="block font-medium">Передавать заявки автоматически</span>
              <span className="text-muted-foreground">Иначе заявки ждут ручной отправки из карточки</span>
            </label>
            <Switch id="autoSync" name="autoSync" defaultChecked={initial.autoSync} />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" className="h-10" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Сохранить
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
