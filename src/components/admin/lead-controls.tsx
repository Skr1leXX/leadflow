"use client";

import { useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { nativeSelectClass } from "@/components/shared/field";
import { useToast } from "@/components/shared/toaster";
import { assignAction, setStatusAction } from "@/features/leads/actions";
import { leadStatusMeta } from "@/features/leads/status-meta";
import { LEAD_STATUSES, type LeadStatus } from "@/features/leads/types";

/** Status and responsible person. Disabled (with the reason shown) for a manager looking at a colleague's lead. */
export function LeadControls({
  leadId,
  status,
  assigneeId,
  staff,
  canEdit,
}: {
  leadId: string;
  status: LeadStatus;
  assigneeId?: string;
  staff: { id: string; name: string; active: boolean }[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const options = staff.filter((s) => s.active || s.id === assigneeId);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="lead-status" className="mb-1 block text-xs font-medium text-muted-foreground">
          Статус
        </label>
        <select
          id="lead-status"
          value={status}
          disabled={!canEdit || pending}
          onChange={(e) => start(async () => toast.result(await setStatusAction(leadId, e.target.value)))}
          className={`${nativeSelectClass} h-10`}
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {leadStatusMeta[s].label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="lead-assignee" className="mb-1 block text-xs font-medium text-muted-foreground">
          Ответственный
        </label>
        <select
          id="lead-assignee"
          value={assigneeId ?? ""}
          disabled={!canEdit || pending}
          onChange={(e) => start(async () => toast.result(await assignAction(leadId, e.target.value)))}
          className={`${nativeSelectClass} h-10`}
        >
          <option value="">Не назначен</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.active ? "" : " (отключён)"}
            </option>
          ))}
        </select>
      </div>

      {pending && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Сохраняем…
        </p>
      )}
      {!canEdit && (
        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          Заявка закреплена за другим сотрудником. Менять её может он или администратор, вам она доступна для просмотра.
        </p>
      )}
    </div>
  );
}
