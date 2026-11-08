import { PGlite, types } from "@electric-sql/pglite";
import { openDatabase, type OpenOptions } from "./db";
import { createDb, createPgDb, type Db } from "./sql";

/** Tests only. A fresh empty database: SQLite in memory, or Postgres (PGlite) when LEADFLOW_TEST_DB=postgres. */
export async function rawTestDb(): Promise<Db> {
  if (process.env.LEADFLOW_TEST_DB !== "postgres") return createDb("file::memory:");
  const pg = new PGlite({ parsers: { [types.INT8]: (v: string) => Number(v) } });
  await pg.waitReady;
  const conn = (c: Pick<PGlite, "query">) => ({
    query: async (sql: string, args: unknown[]) => {
      const r = await c.query(sql, args);
      return { rows: r.rows as Record<string, unknown>[], changes: r.affectedRows ?? 0 };
    },
  });
  return createPgDb({ ...conn(pg), transaction: (fn) => pg.transaction((tx) => fn(conn(tx))) });
}

export async function testDatabase(opts: OpenOptions = {}): Promise<Db> {
  return openDatabase("", { ...opts, db: await rawTestDb() });
}
