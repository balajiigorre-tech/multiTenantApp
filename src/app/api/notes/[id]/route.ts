import { route, readBody } from "@/lib/http";
import { withUser } from "@/lib/db";
import { deleteNote, updateNote } from "@/lib/services";
import { updateNoteSchema } from "@/lib/schemas";

type P = { id: string };

export const PATCH = route<P>(async ({ req, params, user }) => {
  const patch = await readBody(req, updateNoteSchema);
  return withUser(user.id, (db) => updateNote(db, params.id, patch));
});

export const DELETE = route<P>(({ params, user }) => withUser(user.id, (db) => deleteNote(db, params.id)));
