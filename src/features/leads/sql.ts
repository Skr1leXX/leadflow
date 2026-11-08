import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";

/** A bound SQL value. */
export type Arg = InValue;
export type Row = Record<string, unknown>;

/**
 * The only door to the database. It is the same SQLite dialect everywhere: a local file in development and tests, a
 * libSQL (Turso) server over the network on Vercel. Every call is asynchronous, so nothing may assume a call finishes
 * before the next line runs; code that must be atomic goes through `tx`.
 */
export interface Db {
  all(sql: string, args?: Arg[]): Promise<Row[]>;
  get(sql: string, args?: Arg[]): Promise<Row | undefined>;
  /** `changes` is the number of rows the statement changed: the basis of every "claim" that must succeed only once. */
  run(sql: string, args?: Arg[]): Promise<{ changes: number }>;
  /** Several statements in one string, run one after the other. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` as one transaction: all of it is saved, or none. Called inside a transaction it joins the outer one. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

/** Splits a script into statements. Comment lines go first because they may contain semicolons; our scripts have none inside strings. */
export function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

class LibsqlDb implements Db {
  constructor(
    private readonly target: Client | Transaction,
    /** Null inside a transaction. */
    private readonly client: Client | null,
  ) {}

  private execute(sql: string, args: Arg[] = []) {
    return this.target.execute({ sql, args });
  }

  async all(sql: string, args?: Arg[]): Promise<Row[]> {
    const r = await this.execute(sql, args);
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
  }

  async get(sql: string, args?: Arg[]) {
    return (await this.all(sql, args))[0];
  }

  async run(sql: string, args?: Arg[]) {
    return { changes: (await this.execute(sql, args)).rowsAffected };
  }

  async exec(sql: string) {
    for (const s of statements(sql)) await this.execute(s);
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.client) return fn(this);
    const t = await this.client.transaction("write");
    try {
      const result = await fn(new LibsqlDb(t, null));
      await t.commit();
      return result;
    } catch (e) {
      await t.rollback().catch(() => undefined);
      throw e;
    } finally {
      t.close();
    }
  }
}

/** `file:data/leadflow.db`, `file::memory:` (tests) or `libsql://…` / `https://…` with an auth token. */
export function createDb(url: string, authToken?: string): Db {
  const client = createClient({ url, authToken: authToken || undefined });
  return new LibsqlDb(client, client);
}
