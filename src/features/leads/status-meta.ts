import type { Tone } from "@/components/shared/status-badge";
import type { LeadStatus, SyncStatus } from "./types";

export const leadStatusMeta: Record<LeadStatus, { label: string; tone: Tone }> = {
  new: { label: "Новая", tone: "info" },
  in_progress: { label: "В работе", tone: "warning" },
  awaiting_reply: { label: "Ожидает ответа", tone: "neutral" },
  won: { label: "Успешно завершён", tone: "success" },
  rejected: { label: "Отклонён", tone: "danger" },
};

export const syncStatusMeta: Record<SyncStatus, { label: string; tone: Tone }> = {
  pending: { label: "Ожидает отправки", tone: "warning" },
  sending: { label: "Отправляется", tone: "info" },
  synced: { label: "Отправлено", tone: "success" },
  failed: { label: "Ошибка отправки", tone: "danger" },
};
