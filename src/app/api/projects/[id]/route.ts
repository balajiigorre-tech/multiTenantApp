import { route, readBody } from "@/lib/http";
import { withUser } from "@/lib/db";
import { deleteProject, getProject, updateProject } from "@/lib/services";
import { updateProjectSchema } from "@/lib/schemas";

type P = { id: string };

export const GET = route<P>(({ params, user }) => withUser(user.id, (db) => getProject(db, params.id)));

export const PATCH = route<P>(async ({ req, params, user }) => {
  const patch = await readBody(req, updateProjectSchema);
  return withUser(user.id, (db) => updateProject(db, params.id, patch));
});

export const DELETE = route<P>(({ params, user }) => withUser(user.id, (db) => deleteProject(db, params.id)));
