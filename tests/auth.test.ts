import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/lib/db";
import { authenticate, destroySession, userFromToken } from "../src/lib/auth";
import { SEED_PASSWORD, adminQuery, resetSeed } from "./helpers";

beforeEach(async () => { await resetSeed(); });
afterAll(async () => { await pool.end(); });

describe("authentication", () => {
  it("logs in with correct credentials and resolves the user from the token", async () => {
    const res = await authenticate("bob@example.com", SEED_PASSWORD);
    expect(res).not.toBeNull();
    expect((await userFromToken(res!.token))?.email).toBe("bob@example.com");
  });

  it("is case-insensitive on email and rejects wrong password / unknown user identically (null)", async () => {
    expect(await authenticate("BOB@example.com", SEED_PASSWORD)).not.toBeNull();
    expect(await authenticate("bob@example.com", "wrong")).toBeNull();
    expect(await authenticate("nobody@example.com", SEED_PASSWORD)).toBeNull();
  });

  it("stores only a hash of the token, and logout / expiry invalidate it", async () => {
    const res = (await authenticate("bob@example.com", SEED_PASSWORD))!;
    const stored = await adminQuery("select token_hash from sessions");
    expect(stored.rows.map((r) => r.token_hash)).not.toContain(res.token);

    await adminQuery("update sessions set expires_at = now() - interval '1 minute'");
    expect(await userFromToken(res.token)).toBeNull();

    const again = (await authenticate("bob@example.com", SEED_PASSWORD))!;
    await destroySession(again.token);
    expect(await userFromToken(again.token)).toBeNull();
  });

  it("rejects garbage tokens", async () => {
    expect(await userFromToken("")).toBeNull();
    expect(await userFromToken("x".repeat(500))).toBeNull();
    expect(await userFromToken("' or 1=1 --")).toBeNull();
  });
});
