import { Client } from "pg";
import { expect } from "vitest";
import { config } from "../src/lib/config";
import { ApiError } from "../src/lib/errors";
export { IDS, MISSING_ID, SEED_PASSWORD } from "../scripts/seed-data";
export { seed as resetSeed } from "../scripts/db";

/** Superuser query used only to check ground truth (bypasses RLS). */
export async function adminQuery(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: config.adminDatabaseUrl });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

export async function expectApiError(p: Promise<unknown>, status: number): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(status);
    return e as ApiError;
  }
  throw new Error(`expected ApiError ${status} but the call succeeded`);
}
