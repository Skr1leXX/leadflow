"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, nativeSelectClass } from "@/components/shared/field";
import { useToast } from "@/components/shared/toaster";
import { createStaffAction, setStaffActiveAction, setStaffBitrixUserAction, type StaffFormState } from "@/features/leads/actions";

/** Active switch and the person's Bitrix24 user ID, saved on blur or Enter. */
export function StaffRowControls({ id, name, active, bitrixUserId, isSelf }: { id: string; name: string; active: boolean; bitrixUserId?: number; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(bitrixUserId?.toString() ?? "");
  const toast = useToast();
  const save = () => {
    if (value.trim() === (bitrixUserId?.toString() ?? "")) return;
    start(async () => toast.result(await setStaffBitrixUserAction(id, value)));
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <Switch checked={active} disabled={pending || isSelf} aria-label={`${name}: ${active ? "включён" : "отключён"}`} onCheckedChange={(v) => start(async () => toast.result(await setStaffActiveAction(id, v)))} />
        <span className="text-muted-foreground">{active ? "Активен" : "Отключён"}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">ID в Битрикс24</span>
        <Input
          inputMode="numeric"
          value={value}
          disabled={pending}
          aria-label={`ID пользователя Битрикс24: ${name}`}
          className="h-10 w-24"
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), save())}
        />
      </label>
    </div>
  );
}

export function StaffForm() {
  const [state, action, pending] = useActionState<StaffFormState, FormData>(createStaffAction, {});
  const toast = useToast();
  useEffect(() => {
    if (state.ok) toast.success("Сотрудник добавлен");
    else if (state.error) toast.error(state.error);
  }, [state, toast]);

  return (
    <form action={action} className="space-y-4" noValidate autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="staff-name" label="Имя">
          <Input id="staff-name" name="name" className="h-10" />
        </Field>
        <Field name="staff-email" label="Почта (логин)">
          <Input id="staff-email" name="email" type="email" className="h-10" />
        </Field>
        <Field name="staff-password" label="Пароль" hint="Минимум 10 символов. Сотрудник сможет войти сразу.">
          <Input id="staff-password" name="password" type="password" autoComplete="new-password" className="h-10" />
        </Field>
        <Field name="staff-role" label="Роль" hint="Менеджер работает с заявками, администратор настраивает систему">
          <select id="staff-role" name="role" defaultValue="manager" className={`${nativeSelectClass} h-10`}>
            <option value="manager">Менеджер</option>
            <option value="admin">Администратор</option>
          </select>
        </Field>
        <Field name="staff-bitrix" label="ID пользователя в Битрикс24" hint="Нужен, чтобы назначать этого сотрудника ответственным в CRM">
          <Input id="staff-bitrix" name="bitrixUserId" inputMode="numeric" className="h-10" />
        </Field>
      </div>
      <Button type="submit" className="h-10" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Добавить сотрудника
      </Button>
    </form>
  );
}
