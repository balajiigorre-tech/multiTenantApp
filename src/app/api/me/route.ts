import { route } from "@/lib/http";
import { withUser } from "@/lib/db";
import { listWorkspaces } from "@/lib/services";

export const GET = route(async ({ user }) => {
  const workspaces = await withUser(user.id, (db) => listWorkspaces(db));
  return { user, workspaces };
});
