import { route, readBody, Created } from "@/lib/http";
import { withUser } from "@/lib/db";
import { createNote } from "@/lib/services";
import { createNoteSchema } from "@/lib/schemas";

export const POST = route(async ({ req, user }) => {
  const input = await readBody(req, createNoteSchema);
  return new Created(await withUser(user.id, (db) => createNote(db, input)));
});
