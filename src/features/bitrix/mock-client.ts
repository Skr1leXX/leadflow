import { BitrixError, type BitrixClient, type BitrixLeadFields, type PortalInfo } from "./client";

/** Emails on this domain always fail, so the error state can be shown on demand. */
export const FAILING_EMAIL_DOMAIN = "bitrix-error.test";
/** Emails on this domain fail on the first attempt only, so a successful retry can be shown on demand. */
export const FLAKY_EMAIL_DOMAIN = "bitrix-flaky.test";
/** A comment containing this text always fails with PORTAL_UNREACHABLE, so a failed change push can be shown on demand. */
export const FAILING_COMMENT_MARKER = "[demo-error]";

interface Options {
  latencyMs?: number;
  firstId?: number;
}

// Kept on globalThis, not in module variables: the API routes and the background worker are bundled separately,
// and both must see the same demo "portal" (IDs already issued, which leads have failed once).
const g = globalThis as typeof globalThis & { __leadflowDemoPortal?: { nextId: number; created: Map<string, number>; flakySeen: Set<string> } };
const portal = () => (g.__leadflowDemoPortal ??= { nextId: 4200, created: new Map(), flakySeen: new Set() });

const hasDomain = (f: BitrixLeadFields, domain: string) => f.EMAIL.some((e) => e.VALUE.endsWith(`@${domain}`));

/** Demo mode: same contract as the real client, no network. Every answer is simulated and flagged `demo`. */
export class MockBitrixClient implements BitrixClient {
  readonly demo = true;

  constructor(private readonly opts: Options = {}) {
    if (opts.firstId !== undefined) portal().nextId = opts.firstId;
  }

  private wait() {
    const ms = this.opts.latencyMs ?? 400;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  async findLeadByOrigin(originId: string) {
    await this.wait();
    return portal().created.get(originId) ?? null;
  }

  async createLead(fields: BitrixLeadFields) {
    await this.wait();
    const fail = hasDomain(fields, FAILING_EMAIL_DOMAIN);
    const { flakySeen, created } = portal();
    const flaky = hasDomain(fields, FLAKY_EMAIL_DOMAIN) && !flakySeen.has(fields.ORIGIN_ID);
    if (flaky) flakySeen.add(fields.ORIGIN_ID);
    if (fail || flaky) {
      throw new BitrixError("превышен лимит запросов к REST API", "QUERY_LIMIT_EXCEEDED");
    }
    const id = portal().nextId++;
    created.set(fields.ORIGIN_ID, id);
    return { id };
  }

  async updateLead() {
    await this.wait();
  }

  async addLeadComment(_bitrixId: number, text: string) {
    await this.wait();
    if (text.includes(FAILING_COMMENT_MARKER)) throw new BitrixError("портал недоступен", "PORTAL_UNREACHABLE");
    return { id: portal().nextId++ };
  }

  async getPortalInfo(): Promise<PortalInfo> {
    const started = Date.now();
    await this.wait();
    return { portal: "demo.bitrix24.ru", demo: true, latencyMs: Date.now() - started };
  }
}
