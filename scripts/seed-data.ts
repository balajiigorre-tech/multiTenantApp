// Fixed ids so tests and the README demo can refer to them.
export const IDS = {
  acme: "a0000000-0000-4000-8000-000000000001",
  globex: "a0000000-0000-4000-8000-000000000002",

  alice: "b0000000-0000-4000-8000-000000000001", // Acme owner, Globex viewer
  bob: "b0000000-0000-4000-8000-000000000002", // Acme editor only
  carol: "b0000000-0000-4000-8000-000000000003", // Globex owner only
  dave: "b0000000-0000-4000-8000-000000000004", // Acme viewer only
  evan: "b0000000-0000-4000-8000-000000000005", // Globex editor only

  acmeSite: "c0000000-0000-4000-8000-000000000001",
  acmeLaunch: "c0000000-0000-4000-8000-000000000002",
  globexRoadmap: "c0000000-0000-4000-8000-000000000003",

  acmeNote1: "d0000000-0000-4000-8000-000000000001",
  acmeNote2: "d0000000-0000-4000-8000-000000000002",
  acmeNoteLaunch: "d0000000-0000-4000-8000-000000000003",
  acmeNoteInjection: "d0000000-0000-4000-8000-000000000004",
  globexNote: "d0000000-0000-4000-8000-000000000005",
} as const;

export const SEED_PASSWORD = "password123"; // demo data only
export const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";
