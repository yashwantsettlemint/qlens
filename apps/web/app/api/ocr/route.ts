import { cookies } from "next/headers";
import { verifyHS256, type Claims } from "@/server/jwt";
import { SESSION_COOKIE } from "@/server/auth";

/**
 * BFF: proxies a document upload (PDF / image) to ocr-service /extract. Keeps
 * ocr-service off the public network and enforces the session + role the same
 * way /api/graphql does. Returns ocr-service's JSON verbatim
 * ({extracted_fields, source_map, valid, issues, review_queue_id}).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";
const REQUIRE_AUTH = /^(1|true|yes)$/i.test(process.env.REQUIRE_AUTH ?? "");
const OCR_URL = process.env.OCR_SERVICE_URL ?? "http://localhost:8096";
const MAX_BYTES = 20 * 1024 * 1024;
// Demo/offline mode (no session, REQUIRE_AUTH off) has no real tenant — falls
// back to the seeded demo company so uploads still work, same as the rest of
// the app's demo-mode behavior.
const DEMO_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

export async function POST(req: Request) {
  let claims: Claims | null = null;
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    claims = verifyHS256(token, JWT_SECRET);
    if (!claims) return fail(401, "Your session has expired — sign in again.");
  }
  if (REQUIRE_AUTH && !claims) return fail(401, "Sign in to continue.");
  if (claims && !["finance_user", "admin"].includes(claims.role)) {
    return fail(403, `Adding invoices needs role finance_user or admin (you are ${claims.role}).`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Expected a multipart file upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail(400, "No file uploaded.");
  if (file.size > MAX_BYTES) return fail(413, "File is larger than 20 MB.");

  const out = new FormData();
  out.append("file", file, file.name);
  out.append("company_id", claims?.companyId || DEMO_COMPANY_ID);

  let resp: Response;
  try {
    resp = await fetch(`${OCR_URL}/extract`, { method: "POST", body: out });
  } catch {
    return fail(502, "ocr-service is unreachable — is the stack up?");
  }
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) return fail(502, `ocr-service error (${resp.status}).`);
  return Response.json(body);
}
