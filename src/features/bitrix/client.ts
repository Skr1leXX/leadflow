/** demo: built-in client, no network. live: a real Bitrix24 portal through the inbound webhook. */
export type IntegrationMode = "demo" | "live";

/** Anything but "live" means demo, so a typo can never switch real sending on. */
export const parseMode = (v?: string): IntegrationMode => (v?.trim().toLowerCase() === "live" ? "live" : "demo");

/** Field shape of the Bitrix24 `crm.lead.add` method (the subset LeadFlow sends). */
export interface BitrixLeadFields {
  TITLE: string;
  NAME: string;
  PHONE: { VALUE: string; VALUE_TYPE: "WORK" }[];
  EMAIL: { VALUE: string; VALUE_TYPE: "WORK" }[];
  COMMENTS: string;
  SOURCE_ID: string;
  SOURCE_DESCRIPTION: string;
  /** Stage in the portal's lead funnel, mapped from the LeadFlow status. */
  STATUS_ID: string;
  ASSIGNED_BY_ID: number;
  /** Together these identify the lead on the LeadFlow side, so a retry can find a lead that was already created. */
  ORIGINATOR_ID: string;
  ORIGIN_ID: string;
}

/** Fields of `crm.lead.update` that LeadFlow changes after the lead exists. */
export interface BitrixLeadChanges {
  STATUS_ID?: string;
  ASSIGNED_BY_ID?: number;
}

/** What "Check connection" learns about the portal. Safe to send to the browser: never contains the webhook URL. */
export interface PortalInfo {
  /** Portal host, e.g. "company.bitrix24.ru". */
  portal: string;
  /** True when the answer comes from the built-in demo client, not from a real portal. */
  demo: boolean;
  /** Name of the user the webhook acts as. */
  user?: string;
  /** Permission scopes of the webhook; undefined when the portal did not report them. */
  scopes?: string[];
  /** Portal time as returned by `server.time`. */
  serverTime?: string;
  latencyMs: number;
}

export interface BitrixClient {
  /** True for the built-in demo client: its answers must never be shown as confirmation from a real portal. */
  readonly demo: boolean;
  /** crm.lead.add: resolves with the new lead's ID, throws BitrixError on failure. */
  createLead(fields: BitrixLeadFields): Promise<{ id: number }>;
  /** crm.lead.list by ORIGINATOR_ID/ORIGIN_ID: the ID of a lead LeadFlow already created, or null. */
  findLeadByOrigin(originId: string): Promise<number | null>;
  /** crm.lead.update: throws BitrixError unless the portal confirms the change. */
  updateLead(bitrixId: number, changes: BitrixLeadChanges): Promise<void>;
  /** crm.timeline.comment.add on the lead: resolves with the comment's ID. Not idempotent: a repeat adds a second comment. */
  addLeadComment(bitrixId: number, text: string): Promise<{ id: number }>;
  /** Checks the connection and reads portal details; throws BitrixError when the portal cannot be used. */
  getPortalInfo(): Promise<PortalInfo>;
}

export class BitrixError extends Error {
  constructor(
    message: string,
    /** Bitrix24 REST error code (e.g. "QUERY_LIMIT_EXCEEDED") or a LeadFlow code (TIMEOUT, PORTAL_UNREACHABLE, ...). */
    readonly code: string,
  ) {
    super(message);
    this.name = "BitrixError";
  }
}

/** Identifies leads created by LeadFlow in the portal's ORIGINATOR_ID field. */
export const ORIGINATOR_ID = "leadflow";

/** Errors that a later attempt can fix on its own. Everything else needs a person (credentials, rights, setup). */
const RETRYABLE = new Set(["TIMEOUT", "PORTAL_UNREACHABLE", "QUERY_LIMIT_EXCEEDED", "OVERLOAD_LIMIT", "BAD_RESPONSE"]);
/**
 * Safe to resend a *write that cannot be repeated* (a comment) only when the portal certainly did not apply it.
 * A timeout or 5xx may have landed, so those wait for a person instead of risking a duplicate.
 */
export const isSafeToResend = (code: string) => code === "QUERY_LIMIT_EXCEEDED" || code === "OVERLOAD_LIMIT" || code === "PORTAL_UNREACHABLE";
export const isRetryable = (code: string) => RETRYABLE.has(code) || /^HTTP_5\d\d$/.test(code);
