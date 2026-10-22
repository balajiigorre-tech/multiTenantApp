import { route, readBody, Created } from "@/lib/http";
import { withUser } from "@/lib/db";
import { inviteMember, listMembers } from "@/lib/services";
import { inviteSchema } from "@/lib/schemas";

type P = { id: string };

export const GET = route<P>(({ params, user }) => withUser(user.id, (db) => listMembers(db, params.id)));

export const POST = route<P>(async ({ req, params, user }) => {
  const { email, role } = await readBody(req, inviteSchema);
  return new Created(await withUser(user.id, (db) => inviteMember(db, params.id, email, role)));
});
