/**
 * Fire-and-forget security event log — invalid/rejected sessions and
 * forbidden-role attempts (audit_logs table, admin-only, no Hasura role can
 * read or write it). Talks to Hasura directly with the admin secret rather
 * than through ./hasura, to avoid a hasura.ts <-> auth.ts import cycle
 * (auth.ts's requireRole is the caller, and hasura.ts already imports auth.ts).
 */
const ENDPOINT = process.env.HASURA_ENDPOINT ?? "http://localhost:8088/v1/graphql";
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET ?? "devsecret";

export function logSecurityEvent(
  eventType: string,
  detail: Record<string, unknown>,
  companyId: string | null = null,
): void {
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hasura-admin-secret": ADMIN_SECRET },
    body: JSON.stringify({
      query: `mutation Log($event_type: String!, $detail: jsonb!, $company_id: uuid) {
        insert_audit_logs_one(object: { event_type: $event_type, detail: $detail, company_id: $company_id }) { id }
      }`,
      variables: { event_type: eventType, detail, company_id: companyId },
    }),
  }).catch((err) => console.error("audit log failed:", eventType, err));
}
