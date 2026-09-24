import { hasura, NOTIFICATION_URL, internalServiceHeaders, PUBLIC_LEAD_CLAIMS } from "@/server/hasura";

/**
 * Public lead-gen form on the landing page's "Book a demo" — no session, no
 * company scope. Saved to demo_requests (admin reads it via the demoRequests
 * query) and forwarded to notification-service, which emails both the ops
 * inbox and a confirmation back to the prospect.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const companyName = String(body?.companyName ?? "").trim();
  const contactName = String(body?.contactName ?? "").trim();
  const workEmail = String(body?.workEmail ?? "").trim();
  const companySize = body?.companySize ? String(body.companySize).trim() : null;
  const message = body?.message ? String(body.message).trim() : null;

  if (!companyName || !contactName || !workEmail) {
    return fail(400, "Company name, your name, and work email are required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    return fail(400, "That doesn't look like a valid email address.");
  }

  try {
    await hasura(
      // affected_rows, not insert_..._one { id }: public_lead is insert-only, and
      // Hasura only exposes *_one / returning fields to roles that can select.
      `mutation InsertDemoRequest($o: demo_requests_insert_input!) { insert_demo_requests(objects: [$o]) { affected_rows } }`,
      { o: { company_name: companyName, contact_name: contactName, work_email: workEmail, company_size: companySize, message } },
      { claims: PUBLIC_LEAD_CLAIMS },
    );
  } catch (e) {
    console.error("demo-request insert failed:", e);
    return fail(502, "Couldn't save your request — please try again.");
  }

  let resp: Response;
  try {
    resp = await fetch(`${NOTIFICATION_URL}/notify/demo-request`, {
      method: "POST",
      headers: { "content-type": "application/json", ...internalServiceHeaders() },
      body: JSON.stringify({
        company_name: companyName,
        contact_name: contactName,
        work_email: workEmail,
        company_size: companySize,
        message,
      }),
    });
  } catch {
    // The request is saved and an admin will see it either way — email is best-effort on top.
    return Response.json({ ok: true, sent: false });
  }
  const data = await resp.json().catch(() => ({ sent: false }));
  return Response.json({ ok: true, sent: Boolean(data.sent) });
}
