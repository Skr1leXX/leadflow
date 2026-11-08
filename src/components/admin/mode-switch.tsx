"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setModeAction, type ActionResult } from "@/features/leads/actions";
import type { IntegrationMode } from "@/features/bitrix/client";

const OPTIONS: { value: IntegrationMode; label: string }[] = [
  { value: "demo", label: "Демо" },
  { value: "live", label: "Боевой" },
];

export function ModeSwitch({ mode, webhookConfigured }: { mode: IntegrationMode; webhookConfigured: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Режим интеграции" className="inline-flex rounded-lg border bg-muted p-0.5">
        {OPTIONS.map((o) => (
          <Button
            key={o.value}
            variant={mode === o.value ? "default" : "ghost"}
            className="h-9 min-w-24"
            aria-pressed={mode === o.value}
            disabled={pending || (o.value === "live" && !webhookConfigured)}
            onClick={() => mode !== o.value && start(async () => setResult(await setModeAction(o.value)))}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {!webhookConfigured && (
        <p className="text-xs text-muted-foreground">Боевой режим включится после задания BITRIX24_WEBHOOK_URL (см. инструкцию ниже).</p>
      )}
      <p role="status" aria-live="polite" className={result ? (result.ok ? "text-sm text-success" : "text-sm text-destructive") : "sr-only"}>
        {result?.message}
      </p>
    </div>
  );
}
