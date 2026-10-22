export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// One shared 404 for "does not exist" AND "exists in a workspace you cannot see",
// so responses never reveal whether another workspace's data exists.
export const notFound = () => new ApiError(404, "Not found");
export const forbidden = () => new ApiError(403, "You do not have permission to do that");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(v: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw notFound();
  return v;
}
