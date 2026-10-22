import { route, readBody, Created } from "@/lib/http";
import { withUser } from "@/lib/db";
import { createProject, listProjects } from "@/lib/services";
import { createProjectSchema } from "@/lib/schemas";
import { assertUuid } from "@/lib/errors";

export const GET = route(async ({ req, user }) => {
  const workspaceId = assertUuid(req.nextUrl.searchParams.get("workspaceId") ?? "");
  return withUser(user.id, (db) => listProjects(db, workspaceId));
});

export const POST = route(async ({ req, user }) => {
  const input = await readBody(req, createProjectSchema);
  return new Created(await withUser(user.id, (db) => createProject(db, input)));
});
