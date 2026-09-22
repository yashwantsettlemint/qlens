import { createHmac, timingSafeEqual } from "node:crypto";
import { hasura } from "@/server/hasura";

/**
 * Razorpay webhook — confirms a Payment Link was paid and marks the invoice
 * paid the same way a manual "Mark as paid" does (insert_payments_one +
 * payment_status: paid). No session cookie here; Razorpay authenticates
 * itself via the signed body, not a user session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

function validSignature(rawBody: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!validSignature(rawBody, req.headers.get("x-razorpay-signature"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.event !== "payment_link.paid") return Response.json({ ok: true });

  // reference_id is "<invoiceId>-<timestamp>" (see create-link route) — the
  // invoice id is always the first 36 chars (a UUID).
  const invoiceId: string | undefined = event.payload?.payment_link?.entity?.reference_id?.slice(0, 36);
  const payment = event.payload?.payment?.entity;
  if (!invoiceId || !payment) return Response.json({ ok: true });

  const amountPaid = Number(payment.amount) / 100;
  const paidAt = new Date((payment.created_at ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);

  // payments.company_id is NOT NULL, and Razorpay only echoes back the invoice
  // id we put in reference_id — so resolve the owning company before writing.
  const owner = await hasura<{ invoices_by_pk: { company_id: string } | null }>(
    `query PayCompany($id: uuid!) { invoices_by_pk(id: $id) { company_id } }`,
    { id: invoiceId },
    { admin: true },
  );
  const companyId = owner.invoices_by_pk?.company_id;
  if (!companyId) return Response.json({ ok: true });

  await hasura(
    `mutation WebhookPay($p: payments_insert_input!, $id: uuid!, $companyId: uuid!) {
       insert_payments_one(object: $p) { id }
       update_invoices(
         where: { id: { _eq: $id }, company_id: { _eq: $companyId } }
         _set: { payment_status: "paid" }
       ) { affected_rows }
     }`,
    {
      p: { invoice_id: invoiceId, paid_at: paidAt, amount_paid: amountPaid, company_id: companyId },
      id: invoiceId,
      companyId,
    },
    { admin: true },
  );

  return Response.json({ ok: true });
}
