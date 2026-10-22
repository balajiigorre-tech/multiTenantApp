import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db";
import { config } from "./config";

export type SessionUser = { id: string; email: string; name: string };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

let dummyHash: string | undefined;

/** Verifies credentials and creates a server-side session. Returns null on any failure. */
export async function authenticate(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser } | null> {
  const found = await pool.query("select id, password_hash from app.login_lookup($1)", [email]);
  const row = found.rows[0] as { id: string; password_hash: string } | undefined;

  // Compare against a dummy hash when the user does not exist, to keep timing similar.
  dummyHash ??= bcrypt.hashSync("not-a-real-password", 10);
  const ok = await bcrypt.compare(password, row?.password_hash ?? dummyHash);
  if (!row || !ok) return null;

  const token = randomBytes(32).toString("base64url");
  await pool.query("select app.create_session($1, $2, $3)", [row.id, hashToken(token), config.sessionTtlHours]);
  const user = await userFromToken(token);
  return user ? { token, user } : null;
}

export async function userFromToken(token: string): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const r = await pool.query("select id, email, name from app.session_user($1)", [hashToken(token)]);
  return (r.rows[0] as SessionUser | undefined) ?? null;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query("select app.destroy_session($1)", [hashToken(token)]);
}
