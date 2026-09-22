import { cookies } from "next/headers";
import { verifyHS256, type Claims } from "@/server/jwt";
import { SESSION_COOKIE } from "@/server/auth";

/**
 * BFF: proxies a multi-file document upload to ocr-service's RabbitMQ-backed
 * bulk pipeline. Same auth as /api/ocr; POST queues the files (fast — the
 * actual OCR happens async), GET polls their status.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";
const REQUIRE_AUTH = /^(1|true|yes)$/i.test(process.env.REQUIRE_AUTH ?? "");
const OCR_URL = process.env.OCR_SERVICE_URL ?? "http://localhost:8096";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 50;
// Demo/offline mode (no session, REQUIRE_AUTH off) has no real tenant — falls
// back to the seeded demo company so uploads still work, same as the rest of
// the app's demo-mode behavior.
const DEMO_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

function checkAuth(): { error: Response | null; claims: Claims | null } {
  let claims: Claims | null = null;
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    claims = verifyHS256(token, JWT_SECRET);
    if (!claims) return { error: fail(401, "Your session has expired — sign in again."), claims: null };
  }
  if (REQUIRE_AUTH && !claims) return { error: fail(401, "Sign in to continue."), claims: null };
  if (claims && !["finance_user", "admin"].includes(claims.role)) {
    return {
      error: fail(403, `Adding invoices needs role finance_user or admin (you are ${claims.role}).`),
      claims: null,
    };
  }
  return { error: null, claims };
}

export async function POST(req: Request) {
  const { error, claims } = checkAuth();
  if (error) return error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Expected a multipart file upload.");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail(400, "No files uploaded.");
  if (files.length > MAX_FILES) return fail(400, `Too many files — max ${MAX_FILES} per batch.`);
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  if (tooBig) return fail(413, `"${tooBig.name}" is larger than 20 MB.`);

  const out = new FormData();
  for (const f of files) out.append("files", f, f.name);
  out.append("company_id", claims?.companyId || DEMO_COMPANY_ID);

  let resp: Response;
  try {
    resp = await fetch(`${OCR_URL}/bulk/enqueue`, { method: "POST", body: out });
  } catch {
    return fail(502, "ocr-service is unreachable — is the stack up?");
  }
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) return fail(502, `ocr-service error (${resp.status}).`);
  return Response.json({ jobs: body });
}

export async function GET(req: Request) {
  const { error } = checkAuth();
  if (error) return error;

  const ids = new URL(req.url).searchParams.get("ids");
  if (!ids) return fail(400, "Missing ?ids=");

  let resp: Response;
  try {
    resp = await fetch(`${OCR_URL}/bulk/status?ids=${encodeURIComponent(ids)}`);
  } catch {
    return fail(502, "ocr-service is unreachable — is the stack up?");
  }
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) return fail(502, `ocr-service error (${resp.status}).`);
  return Response.json({ jobs: body });
}
