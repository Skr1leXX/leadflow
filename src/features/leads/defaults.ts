import type { IntegrationSettings } from "./types";

/** Status IDs of Bitrix24's standard lead funnel. A portal with a custom funnel changes them in Settings. */
export const DEFAULT_STATUS_MAP: IntegrationSettings["statusMap"] = {
  new: "NEW",
  in_progress: "IN_PROCESS",
  awaiting_reply: "PROCESSED",
  won: "CONVERTED",
  rejected: "JUNK",
};

export const DEFAULT_SETTINGS: IntegrationSettings = {
  mode: "demo",
  autoSync: true,
  responsibleId: 1,
  sourceId: "WEB",
  notifyEmail: "sales@example.com",
  statusMap: DEFAULT_STATUS_MAP,
};
