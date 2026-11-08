import { BitrixError, ORIGINATOR_ID, type BitrixClient, type BitrixLeadChanges, type BitrixLeadFields, type PortalInfo } from "./client";

export const WEBHOOK_PATTERN = /^https:\/\/[^\s/]+\/rest\/\d+\/[A-Za-z0-9]+\/?$/;

interface Options {
  /** Inbound webhook URL, https://<portal>/rest/<user id>/<code>/. It is a secret: it never leaves this class. */
  webhookUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Messages shown to the admin for the REST error codes that have a clear remedy. */
const KNOWN_ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: "Вебхук недействителен или отозван. Создайте новый и обновите BITRIX24_WEBHOOK_URL.",
  WRONG_AUTH_TYPE: "Вебхук недействителен или отозван. Создайте новый и обновите BITRIX24_WEBHOOK_URL.",
  INSUFFICIENT_SCOPE: "У вебхука нет нужных прав. Добавьте право «CRM» и повторите.",
  ACCESS_DENIED: "У пользователя вебхука нет доступа к этой операции в CRM.",
  QUERY_LIMIT_EXCEEDED: "Превышен лимит запросов к порталу. Повторите через несколько секунд.",
  ERROR_METHOD_NOT_FOUND: "Метод не найден на портале.",
  OVERLOAD_LIMIT: "Портал временно ограничил запросы. Повторите позже.",
  PORTAL_DELETED: "Портал удалён или заблокирован.",
};

/** Bitrix24 REST over an inbound webhook. Errors never include the webhook URL. */
export class RealBitrixClient implements BitrixClient {
  readonly demo = false;
  private readonly base: string;
  private readonly host: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(opts: Options) {
    if (!WEBHOOK_PATTERN.test(opts.webhookUrl)) throw new BitrixError("Некорректный формат URL вебхука", "BAD_WEBHOOK_URL");
    const url = new URL(opts.webhookUrl);
    this.host = url.host;
    this.base = `${url.origin}${url.pathname.replace(/\/?$/, "/")}`;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.doFetch = opts.fetch ?? fetch;
  }

  /** Calls one REST method and returns its `result`. */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${method}.json`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
        redirect: "error",
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new BitrixError(`Портал не ответил за ${Math.round(this.timeoutMs / 1000)} с`, "TIMEOUT");
      }
      throw new BitrixError("Портал недоступен: проверьте адрес и доступ к сети", "PORTAL_UNREACHABLE");
    }

    let body: { result?: T; error?: string; error_description?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      // Not JSON: handled below by status.
    }

    if (body?.error) {
      throw new BitrixError(KNOWN_ERRORS[body.error.toUpperCase()] ?? (body.error_description || body.error), body.error.toUpperCase());
    }
    if (!res.ok || body === null || !("result" in body)) {
      throw new BitrixError(`Портал вернул неожиданный ответ (HTTP ${res.status})`, res.ok ? "BAD_RESPONSE" : `HTTP_${res.status}`);
    }
    return body.result as T;
  }

  async findLeadByOrigin(originId: string) {
    const rows = await this.call<unknown>("crm.lead.list", {
      filter: { ORIGINATOR_ID: ORIGINATOR_ID, ORIGIN_ID: originId },
      select: ["ID"],
    });
    if (!Array.isArray(rows)) throw new BitrixError("Портал вернул неожиданный список лидов", "BAD_RESPONSE");
    const id = Number((rows[0] as { ID?: string } | undefined)?.ID);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  async createLead(fields: BitrixLeadFields) {
    const id = await this.call<unknown>("crm.lead.add", { fields, params: { REGISTER_SONET_EVENT: "Y" } });
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      throw new BitrixError("Портал не вернул ID созданного лида", "BAD_RESPONSE");
    }
    return { id };
  }

  async updateLead(bitrixId: number, changes: BitrixLeadChanges) {
    const ok = await this.call<unknown>("crm.lead.update", { id: bitrixId, fields: changes, params: { REGISTER_SONET_EVENT: "Y" } });
    if (ok !== true) throw new BitrixError("Портал не подтвердил изменение лида", "BAD_RESPONSE");
  }

  async addLeadComment(bitrixId: number, text: string) {
    const id = await this.call<unknown>("crm.timeline.comment.add", { fields: { ENTITY_ID: bitrixId, ENTITY_TYPE: "lead", COMMENT: text } });
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) throw new BitrixError("Портал не вернул ID комментария", "BAD_RESPONSE");
    return { id };
  }

  async getPortalInfo(): Promise<PortalInfo> {
    const started = Date.now();
    // `profile` and `server.time` need no scope; `scope` shows what the webhook may do.
    const [profile, time, scopes] = await Promise.all([
      this.call<{ NAME?: string; LAST_NAME?: string }>("profile"),
      this.call<string>("server.time"),
      this.call<string[]>("scope").catch(() => undefined),
    ]);
    if (scopes && !scopes.includes("crm")) {
      throw new BitrixError("У вебхука нет права «CRM»: заявки передать не получится.", "INSUFFICIENT_SCOPE");
    }
    return {
      portal: this.host,
      demo: false,
      user: [profile?.NAME, profile?.LAST_NAME].filter(Boolean).join(" ") || undefined,
      scopes,
      serverTime: typeof time === "string" ? time : undefined,
      latencyMs: Date.now() - started,
    };
  }
}
