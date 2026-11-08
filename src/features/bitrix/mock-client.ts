import type { Db } from "@/features/leads/sql";
import { BitrixError, type BitrixClient, type BitrixLeadFields, type PortalInfo } from "./client";

/** Emails on this domain always fail, so the error state can be shown on demand. */
export const FAILING_EMAIL_DOMAIN = "bitrix-error.test";
/** Emails on this domain fail on the first attempt only, so a successful retry can be shown on demand. */
export const FLAKY_EMAIL_DOMAIN = "bitrix-flaky.test";
/** A comment containing this text always fails with PORTAL_UNREACHABLE, so a failed change push can be shown on demand. */
export const FAILING_COMMENT_MARKER = "[demo-error]";

/** What the simulated portal remembers between calls. */
export interface DemoState {
  nextId: number;
  /** ORIGIN_ID -> the demo lead ID issued for it. */
  created: Record<string, number>;
  /** ORIGIN_IDs that already failed once (for the "flaky" addresses). */
  flakySeen: string[];
}

export interface DemoStore {
  load(): Promise<DemoState>;
  save(state: DemoState): Promise<void>;
}

const fresh = (): DemoState => ({ nextId: 4200, created: {}, flakySeen: [] });

// Default memory: on globalThis, not in a module variable, because the API routes and the background worker are bundled
// separately and must see the same demo "portal".
const g = globalThis as typeof globalThis & { __leadflowDemoPortal?: DemoState };
const memoryStore: DemoStore = {
  load: async () => (g.__leadflowDemoPortal ??= fresh()),
  save: async (s) => {
    g.__leadflowDemoPortal = s;
  },
};

/** Keeps the demo portal's memory in the database, so every server instance (and every restart) sees the same one. */
export function dbDemoStore(db: Db): DemoStore {
  return {
    async load() {
      const r = await db.get("SELECT value FROM settings WHERE key = 'demo_portal'");
      return r ? ({ ...fresh(), ...(JSON.parse(r.value as string) as Partial<DemoState>) }) : fresh();
    },
    async save(state) {
      await db.run("INSERT INTO settings (key, value) VALUES ('demo_portal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(state)]);
    },
  };
}

interface Options {
  latencyMs?: number;
  firstId?: number;
  store?: DemoStore;
}

const hasDomain = (f: BitrixLeadFields, domain: string) => f.EMAIL.some((e) => e.VALUE.endsWith(`@${domain}`));

/** Demo mode: same contract as the real client, no network. Every answer is simulated and flagged `demo`. */
export class MockBitrixClient implements BitrixClient {
  readonly demo = true;
  private readonly store: DemoStore;
  private firstId?: number;

  constructor(private readonly opts: Options = {}) {
    this.store = opts.store ?? memoryStore;
    this.firstId = opts.firstId;
  }

  private wait() {
    const ms = this.opts.latencyMs ?? 400;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  private async state() {
    const s = await this.store.load();
    if (this.firstId !== undefined) {
      s.nextId = this.firstId;
      this.firstId = undefined;
    }
    return s;
  }

  async findLeadByOrigin(originId: string) {
    await this.wait();
    return (await this.state()).created[originId] ?? null;
  }

  async createLead(fields: BitrixLeadFields) {
    await this.wait();
    const s = await this.state();
    const fail = hasDomain(fields, FAILING_EMAIL_DOMAIN);
    const flaky = hasDomain(fields, FLAKY_EMAIL_DOMAIN) && !s.flakySeen.includes(fields.ORIGIN_ID);
    if (flaky) {
      s.flakySeen.push(fields.ORIGIN_ID);
      await this.store.save(s);
    }
    if (fail || flaky) {
      throw new BitrixError("превышен лимит запросов к REST API", "QUERY_LIMIT_EXCEEDED");
    }
    const id = s.nextId++;
    s.created[fields.ORIGIN_ID] = id;
    await this.store.save(s);
    return { id };
  }

  async updateLead() {
    await this.wait();
  }

  async addLeadComment(_bitrixId: number, text: string) {
    await this.wait();
    if (text.includes(FAILING_COMMENT_MARKER)) throw new BitrixError("портал недоступен", "PORTAL_UNREACHABLE");
    const s = await this.state();
    const id = s.nextId++;
    await this.store.save(s);
    return { id };
  }

  async getPortalInfo(): Promise<PortalInfo> {
    const started = Date.now();
    await this.wait();
    return { portal: "demo.bitrix24.ru", demo: true, latencyMs: Date.now() - started };
  }
}
