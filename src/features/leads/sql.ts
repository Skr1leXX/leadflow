import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";
import pg from "pg";

/** A bound SQL value. */
export type Arg = InValue;
export type Row = Record<string, unknown>;

/**
 * The only door to the database. Queries are written once, with `?` placeholders, in the subset both engines share:
 * SQLite (a local file, or a libSQL/Turso server) and Postgres (e.g. Supabase). The few places that differ read `dialect`.
 * Every call is asynchronous, so nothing may assume a call finishes
 * before the next line runs; code that must be atomic goes through `tx`.
 */
export type Dialect = "sqlite" | "postgres";

export interface Db {
  readonly dialect: Dialect;
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
  readonly dialect = "sqlite";

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

/** Insertion order of rows that share a timestamp: SQLite's implicit rowid, or the identity column Postgres tables get. */
export const seq = (db: Db) => (db.dialect === "postgres" ? "seq" : "rowid");

// ---- Postgres ----------------------------------------------------------------------------------------------------

/** What a Postgres driver must offer; `pg` and the in-process PGlite used by tests both fit. */
export interface PgConn {
  query(sql: string, args: Arg[]): Promise<{ rows: Row[]; changes: number }>;
}
export interface PgRoot extends PgConn {
  transaction<T>(fn: (conn: PgConn) => Promise<T>): Promise<T>;
}

/** `?` becomes `$1, $2…`, leaving question marks inside string literals alone. */
export function toPgSql(sql: string): string {
  let n = 0;
  let quoted = false;
  let out = "";
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === "?" && !quoted ? `$${++n}` : ch;
  }
  return out;
}

class PgDb implements Db {
  readonly dialect = "postgres";

  constructor(
    private readonly conn: PgConn,
    /** Null inside a transaction. */
    private readonly root: PgRoot | null,
  ) {}

  async all(sql: string, args: Arg[] = []): Promise<Row[]> {
    return (await this.conn.query(toPgSql(sql), args)).rows;
  }

  async get(sql: string, args?: Arg[]) {
    return (await this.all(sql, args))[0];
  }

  async run(sql: string, args: Arg[] = []) {
    return { changes: (await this.conn.query(toPgSql(sql), args)).changes };
  }

  async exec(sql: string) {
    for (const s of statements(sql)) await this.conn.query(s, []);
  }

  tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.root) return fn(this);
    return this.root.transaction((c) => fn(new PgDb(c, null)));
  }
}

export const createPgDb = (root: PgRoot): Db => new PgDb(root, root);

// COUNT(*) and BIGINT columns arrive as int8; every such value in this app is far below 2^53.
pg.types.setTypeParser(20, Number);

function pgPool(url: string): PgRoot {
  const u = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  u.searchParams.delete("sslmode"); // the TLS settings below replace it
  // Remote servers get TLS with the certificate checked. Supabase signs with its own CA: put its PEM in LEADFLOW_DB_CA.
  const ssl = local ? undefined : { ca: process.env.LEADFLOW_DB_CA?.replace(/\\n/g, "\n") || undefined };
  const pool = new pg.Pool({ connectionString: u.toString(), ssl, max: 3, idleTimeoutMillis: 10_000 });
  const wrap = (c: { query: pg.Pool["query"] }): PgConn => ({
    query: async (sql, args) => {
      const r = await c.query(sql, args);
      return { rows: r.rows as Row[], changes: r.rowCount ?? 0 };
    },
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

/** `file:data/leadflow.db`, `file::memory:` (tests), `libsql://…` / `https://…` with an auth token, or `postgres://…`. */
export function createDb(url: string, authToken?: string): Db {
  if (/^postgres(ql)?:\/\//.test(url)) return createPgDb(pgPool(url));
  const client = createClient({ url, authToken: authToken || undefined });
  return new LibsqlDb(client, client);
}
