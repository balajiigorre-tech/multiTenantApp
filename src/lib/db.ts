import { Pool, type PoolClient } from "pg";
import { config } from "./config";

const g = globalThis as unknown as { __notesPool?: Pool };
export const pool: Pool = g.__notesPool ?? new Pool({ connectionString: config.databaseUrl, max: 10 });
if (process.env.NODE_ENV !== "production") g.__notesPool = pool;

export type Db = PoolClient;

/**
 * Runs `fn` inside a transaction with `app.user_id` set to the *server-verified* user id.
 * set_config(..., true) is transaction-local, so a pooled connection can never carry
 * one user's identity into another request. Row-level security does the rest.
 */
export async function withUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
