import { route, Created } from "@/lib/http";
import { summarizeProject } from "@/lib/summarize";

export const POST = route<{ id: string }>(async ({ params, user }) => new Created(await summarizeProject(user.id, params.id)));
