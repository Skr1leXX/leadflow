// Deletes the demo database so the next `npm run demo` starts from the original fictional data.
import { rmSync } from "node:fs";

const base = process.env.LEADFLOW_DB_PATH || "data/demo.db";
for (const suffix of ["", "-wal", "-shm"]) rmSync(base + suffix, { force: true });
console.log(`Демо-база удалена: ${base}`);
