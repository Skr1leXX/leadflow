import "server-only";
import { BitrixError, type BitrixClient, type IntegrationMode, type PortalInfo } from "./client";
import { readBitrixEnv } from "./config";
import type { Db } from "@/features/leads/sql";
import { dbDemoStore, MockBitrixClient } from "./mock-client";
import { RealBitrixClient } from "./real-client";

/** demo: built-in client. ready: live mode with a valid webhook. misconfigured: live requested but the webhook is missing or invalid. */
export type IntegrationState = "demo" | "ready" | "misconfigured";

export interface Integration {
  mode: IntegrationMode;
  state: IntegrationState;
  host: string | null;
  /** Why live mode cannot be used; undefined unless misconfigured. */
  problem?: string;
  client: BitrixClient;
}

/** Live mode without usable credentials fails loudly: no call is faked as successful. */
class UnconfiguredClient implements BitrixClient {
  readonly demo = false;
  constructor(private readonly message: string) {}
  async createLead(): Promise<never> {
    throw new BitrixError(this.message, "NOT_CONFIGURED");
  }
  async findLeadByOrigin(): Promise<never> {
    throw new BitrixError(this.message, "NOT_CONFIGURED");
  }
  async updateLead(): Promise<never> {
    throw new BitrixError(this.message, "NOT_CONFIGURED");
  }
  async addLeadComment(): Promise<never> {
    throw new BitrixError(this.message, "NOT_CONFIGURED");
  }
  async getPortalInfo(): Promise<never> {
    throw new BitrixError(this.message, "NOT_CONFIGURED");
  }
}

/** `db` lets the demo portal remember its state in the database; without it the simulation keeps state in memory. */
export function resolveIntegration(mode: IntegrationMode, db?: Db): Integration {
  if (mode === "demo") return { mode, state: "demo", host: null, client: new MockBitrixClient({ store: db ? dbDemoStore(db) : undefined }) };

  const env = readBitrixEnv();
  if (env.webhookUrl) {
    return { mode, state: "ready", host: env.host, client: new RealBitrixClient({ webhookUrl: env.webhookUrl }) };
  }
  const problem = env.invalid
    ? "BITRIX24_WEBHOOK_URL задан в неверном формате. Ожидается https://портал.bitrix24.ru/rest/1/код/"
    : "BITRIX24_WEBHOOK_URL не задан. Укажите вебхук в .env.local и перезапустите сервер.";
  return { mode, state: "misconfigured", host: null, problem, client: new UnconfiguredClient(problem) };
}

/** Everything the admin UI may know about the integration. Contains no secrets. */
export interface IntegrationStatus {
  mode: IntegrationMode;
  state: IntegrationState;
  host: string | null;
  problem?: string;
  /** Whether a valid webhook is present in the environment, so the live switch makes sense. */
  webhookConfigured: boolean;
}

export function getIntegrationStatus(mode: IntegrationMode): IntegrationStatus {
  const { state, host, problem } = resolveIntegration(mode);
  return { mode, state, host, problem, webhookConfigured: readBitrixEnv().webhookUrl !== null };
}

export type ConnectionReport =
  | { ok: true; mode: IntegrationMode; info: PortalInfo }
  | { ok: false; mode: IntegrationMode; error: { code: string; message: string } };

export async function checkIntegration(mode: IntegrationMode, db?: Db): Promise<ConnectionReport> {
  try {
    return { ok: true, mode, info: await resolveIntegration(mode, db).client.getPortalInfo() };
  } catch (e) {
    if (e instanceof BitrixError) return { ok: false, mode, error: { code: e.code, message: e.message } };
    return { ok: false, mode, error: { code: "UNKNOWN", message: "Неизвестная ошибка при проверке подключения" } };
  }
}

/** Read-only methods the generic call endpoint may run. Writes go through the lead sync, not through here. */
export const CALLABLE_METHODS = ["profile", "server.time", "scope", "crm.lead.fields", "crm.status.list"] as const;
