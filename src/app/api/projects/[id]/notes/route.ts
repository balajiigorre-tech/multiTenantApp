import { route } from "@/lib/http";
import { withUser } from "@/lib/db";
import { listNotes } from "@/lib/services";

export const GET = route<{ id: string }>(({ params, user }) => withUser(user.id, (db) => listNotes(db, params.id)));
