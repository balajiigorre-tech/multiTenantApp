import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ApiError } from "./errors";
import { requireUser } from "./session";
import type { SessionUser } from "./auth";

export class Created {
  constructor(public body: unknown) {}
}

function assertSameOrigin(req: NextRequest) {
  // Defence in depth on top of SameSite=Lax: reject cross-site state-changing requests.
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* fall through */
    }
    if (host !== req.headers.get("host")) throw new ApiError(403, "Forbidden");
  }
}

export async function readBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  return schema.parse(json);
}

type Ctx<P> = { req: NextRequest; params: P; user: SessionUser };

export function route<P extends Record<string, string> = Record<string, string>>(
  fn: (c: Ctx<P>) => Promise<unknown>,
  opts: { auth?: boolean } = {},
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const user = opts.auth === false ? (null as unknown as SessionUser) : await requireUser();
      const params = await ctx.params;
      const result = await fn({ req, params, user });
      if (result instanceof Created) return NextResponse.json(result.body, { status: 201 });
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  const code = (e as { code?: string })?.code;
  // RLS / privilege violations and malformed ids all look like "not found" to the caller.
  if (code === "42501" || code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 });
  console.error("Unhandled error", e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
