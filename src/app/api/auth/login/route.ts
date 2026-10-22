import { route, readBody } from "@/lib/http";
import { authenticate } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { loginSchema } from "@/lib/schemas";
import { setSessionCookie } from "@/lib/session";
import { config } from "@/lib/config";

export const POST = route(
  async ({ req }) => {
    const { email, password } = await readBody(req, loginSchema);
    const result = await authenticate(email, password);
    if (!result) throw new ApiError(401, "Invalid email or password"); // same message for unknown email / wrong password
    await setSessionCookie(result.token, config.sessionTtlHours * 3600);
    return { user: result.user };
  },
  { auth: false },
);
