"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/shared/toaster";
import { deleteRuleAction, toggleRuleAction } from "@/features/leads/actions";

export function RuleControls({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <div className="flex items-center gap-3">
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <Switch checked={enabled} disabled={pending} aria-label={`Правило «${name}»: ${enabled ? "включено" : "выключено"}`} onCheckedChange={(v) => start(async () => toast.result(await toggleRuleAction(id, v)))} />
        <span className="text-muted-foreground">{enabled ? "Включено" : "Выключено"}</span>
      </label>
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
        disabled={pending}
        aria-label={`Удалить правило «${name}»`}
        onClick={() => {
          if (confirm(`Удалить правило «${name}»? История его срабатываний сохранится.`)) start(async () => toast.result(await deleteRuleAction(id)));
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
