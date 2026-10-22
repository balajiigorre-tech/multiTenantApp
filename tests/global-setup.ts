import { migrate, seed } from "../scripts/db";

export default async function setup() {
  try {
    await migrate();
    await seed();
  } catch (e) {
    throw new Error(
      `Could not prepare the test database. Is Postgres running? Start it with "npm run db:up".\n${(e as Error).message}`,
    );
  }
}
