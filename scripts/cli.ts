import { migrate, seed, reset } from "./db";

const cmd = process.argv[2];
const tasks: Record<string, () => Promise<void>> = { migrate, seed, reset };

if (!tasks[cmd]) {
  console.error("usage: tsx scripts/cli.ts <migrate|seed|reset>");
  process.exit(1);
}
tasks[cmd]()
  .then(() => console.log(`${cmd}: done`))
  .catch((e) => {
    console.error(`${cmd}: failed\n`, e);
    console.error("\nIs Postgres running? Try: npm run db:up");
    process.exit(1);
  });
