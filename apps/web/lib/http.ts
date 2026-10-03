import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * One response shape for the whole API: `{ ok: true, ... }` or
 * `{ ok: false, error, issues? }`. The companion only has to branch on `ok`.
 */

/** A single zod issue, flattened to something a log line can hold. */
export const apiIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  issues: z.array(apiIssueSchema).optional(),
});

export type ApiIssue = z.infer<typeof apiIssueSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

/** An error body. `issues` is omitted entirely when there are none. */
export function jsonError(status: number, error: string, issues?: readonly ApiIssue[]): NextResponse {
  const body: ApiError =
    issues && issues.length > 0 ? { ok: false, error, issues: [...issues] } : { ok: false, error };
  return NextResponse.json(body, { status });
}

/** A success body, parsed through its own response schema so a route cannot drift from it. */
export function jsonOk<S extends z.ZodType>(schema: S, value: z.input<S>, status = 200): NextResponse {
  return NextResponse.json(schema.parse(value), { status });
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Reads a JSON request body and validates it. Malformed JSON and a body that does not match
 * the schema are both 400 with the same shape; the caller just returns `result.response`.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, 'request body is not valid JSON') };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { ok: false, response: jsonError(400, 'request body failed validation', issues) };
  }

  return { ok: true, data: parsed.data };
}

export type ParsedRequestBody<T> =
  | { ok: true; form: boolean; data: T }
  | { ok: false; form: boolean; response: NextResponse };

export type RawRequestBody =
  | { ok: true; form: boolean; raw: unknown }
  | { ok: false; form: boolean; response: NextResponse };

/**
 * Reads a request body that may be JSON (the API, and the tests) or a URL-encoded HTML form
 * (the admin pages, which ship no client JavaScript at all), **without validating it**.
 *
 * Split from {@link parseFormOrJsonBody} for the session routes (M13.4): they read the body
 * once, look at its `groupId` to decide whether the caller may act in that group at all, and only
 * then run the route's full schema -- so a caller who is not an admin of the group still learns
 * nothing about the payload beyond the one field every one of them carries.
 */
export async function readFormOrJsonBody(request: Request): Promise<RawRequestBody> {
  const contentType = request.headers.get('content-type') ?? '';
  const form =
    contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');

  if (form) {
    try {
      const data = await request.formData();
      const entries: Record<string, string> = {};
      for (const [key, value] of data.entries()) {
        if (typeof value === 'string') entries[key] = value;
      }
      return { ok: true, form, raw: entries };
    } catch {
      return { ok: false, form, response: jsonError(400, 'request body is not a valid form') };
    }
  }

  try {
    return { ok: true, form, raw: await request.json() };
  } catch {
    return { ok: false, form, response: jsonError(400, 'request body is not valid JSON') };
  }
}

/** The zod half of {@link parseFormOrJsonBody}, over a body {@link readFormOrJsonBody} already read. */
export function validateBody<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  form: boolean,
): ParsedRequestBody<z.output<S>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { ok: false, form, response: jsonError(400, 'request body failed validation', issues) };
  }
  return { ok: true, form, data: parsed.data };
}

/**
 * Reads a request body that may be JSON (the API, and the tests) or a URL-encoded HTML form
 * (the admin pages, which ship no client JavaScript at all).
 *
 * Form values arrive as strings, so the schema has to accept them — see
 * `lib/admin/formValues.ts`, where "" means null and "true"/"false" mean a boolean. Validation
 * is the same zod parse either way, so a browser and a curl cannot take different paths
 * through a route.
 */
export async function parseFormOrJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedRequestBody<z.output<S>>> {
  const body = await readFormOrJsonBody(request);
  if (!body.ok) return body;
  return validateBody(schema, body.raw, body.form);
}
