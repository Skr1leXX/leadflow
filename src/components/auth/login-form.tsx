"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, errorId } from "@/components/shared/field";
import { loginAction, type LoginState } from "@/features/auth/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="mt-4 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field name="email" label="Почта">
        <Input id="email" name="email" type="email" autoComplete="username" required className="h-11" {...(state.error ? { "aria-invalid": true, "aria-describedby": errorId("login") } : {})} />
      </Field>
      <Field name="password" label="Пароль">
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" />
      </Field>
      {state.error && (
        <p id={errorId("login")} role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Войти
      </Button>
    </form>
  );
}
