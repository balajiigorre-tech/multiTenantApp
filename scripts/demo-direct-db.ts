// Edge case #1c: "a direct database call". Logged in as Bob (Acme only), try to reach Globex data
// straight through SQL. Run after `npm run db:reset`:  npm run demo:db-attack
import { pool, withUser } from "../src/lib/db";
import { IDS } from "./seed-data";

async function attempt(label: string, sql: string, params: unknown[]) {
  try {
    const r = await withUser(IDS.bob, (db) => db.query(sql, params));
    console.log(`${label.padEnd(44)} -> rows=${r.rows.length} rowCount=${r.rowCount}`);
  } catch (e) {
    console.log(`${label.padEnd(44)} -> ERROR ${(e as { code?: string }).code}: ${(e as Error).message}`);
  }
}

async function main() {
  console.log("Acting as Bob (editor in Acme only). Target: Globex workspace.\n");
  await attempt("SELECT notes of Globex", "select * from notes where workspace_id = $1", [IDS.globex]);
  await attempt("SELECT Globex project by id", "select * from projects where id = $1", [IDS.globexRoadmap]);
  await attempt("UPDATE Globex note", "update notes set title = 'pwned' where workspace_id = $1", [IDS.globex]);
  await attempt("DELETE Globex project", "delete from projects where id = $1", [IDS.globexRoadmap]);
  await attempt(
    "INSERT note into Globex",
    "insert into notes (workspace_id, project_id, title, content, created_by) values ($1,$2,'x','x',$3)",
    [IDS.globex, IDS.globexRoadmap, IDS.bob],
  );
  await attempt("Move own note to Globex (workspace_id)", "update notes set workspace_id = $1 where id = $2", [IDS.globex, IDS.acmeNote1]);
  await attempt("SELECT sessions table", "select * from sessions", []);
  await attempt("SELECT password hashes", "select password_hash from users", []);
  await pool.end();
}
main();
