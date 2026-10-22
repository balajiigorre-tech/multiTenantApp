// Local-development defaults only. Real deployments must provide env vars.
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://app_user:app_user_pw@localhost:54329/notes",
  adminDatabaseUrl: process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/notes",
  appDbPassword: process.env.APP_DB_PASSWORD ?? "app_user_pw",
  mockMalformedOnce: (process.env.MOCK_LLM_MALFORMED_ONCE ?? "1") === "1",
  sessionTtlHours: 12,
};
