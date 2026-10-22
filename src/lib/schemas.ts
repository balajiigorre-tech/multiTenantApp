import { z } from "zod";

// .strict() everywhere: unexpected keys (e.g. a smuggled workspace_id / user_id) are rejected, not ignored.
const uuid = z.string().uuid();

export const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).strict();

export const createProjectSchema = z
  .object({
    workspaceId: uuid,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
  })
  .strict();

export const updateProjectSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const createNoteSchema = z
  .object({ projectId: uuid, title: z.string().trim().min(1).max(200), content: z.string().max(10000).default("") })
  .strict();

export const updateNoteSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional(), content: z.string().max(10000).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const inviteSchema = z
  .object({
    email: z.string().email().max(254).transform((s) => s.toLowerCase()),
    role: z.enum(["owner", "editor", "viewer"]),
  })
  .strict();
