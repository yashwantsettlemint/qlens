import { cookies, headers } from "next/headers";
import { verifyHS256, type Claims } from "@/server/jwt";
import { SESSION_COOKIE } from "@/server/auth";
import { hasura } from "@/server/hasura";

/**
 * BFF: creates a Razorpay Payment Link for an approved, unpaid payable —
 * amount, vendor name/email and invoice number are all pulled server-side
 * from the invoice, never re-typed. Finance completes payment on Razorpay's
 * checkout; /api/payments/webhook marks the invoice paid once Razorpay
 * confirms it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";
const REQUIRE_AUTH = /^(1|true|yes)$/i.test(process.env.REQUIRE_AUTH ?? "");
const KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";

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
    return fail(403, `Paying invoices needs role finance_user or admin (you are ${claims.role}).`);
  }

  if (!KEY_ID || !KEY_SECRET) {
    return fail(501, "Payment gateway not configured — set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.");
  }

  const body = await req.json().catch(() => null);
  const invoiceId = body?.invoiceId;
  if (!invoiceId) return fail(400, "invoiceId is required.");

  let data: {
    invoices_by_pk: {
      invoice_number: string;
      amount: string;
      tax_amount: string;
      approval_status: string;
      payment_status: string;
      direction: string;
      vendor: { name: string; email: string | null } | null;
    } | null;
  };
  try {
    data = await hasura(
      `query PayLinkGate($id: uuid!) {
         invoices_by_pk(id: $id) {
           invoice_number amount tax_amount approval_status payment_status direction
           vendor { name email }
         }
       }`,
      { id: invoiceId },
      { admin: true },
    );
  } catch {
    return fail(502, "Backend is unreachable — is the stack up?");
  }
  const inv = data.invoices_by_pk;
  if (!inv) return fail(404, "Invoice not found.");
  if (inv.direction === "receivable") {
    return fail(400, "This is a receivable — nothing to pay out. Record the receipt instead.");
  }
  if (inv.approval_status !== "approved") {
    return fail(400, "This invoice isn't approved yet — it can't be paid until approval completes.");
  }
  if (inv.payment_status === "paid") return fail(400, "This invoice is already paid.");

  const amountPaise = Math.round((Number(inv.amount) + Number(inv.tax_amount)) * 100);
  const origin = headers().get("origin") ?? "";

  let resp: Response;
  try {
    resp = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        accept_partial: false,
        description: `Invoice ${inv.invoice_number}`,
        customer: { name: inv.vendor?.name ?? "Vendor", email: inv.vendor?.email || undefined },
        notify: { email: Boolean(inv.vendor?.email), sms: false },
        // Razorpay requires reference_id to be unique per account (not just per
        // open link, so a retry after an abandoned checkout would otherwise
        // collide) and caps it at 40 chars — invoiceId (a UUID) is already 36,
        // leaving room for only a short suffix.
        // ponytail: 3-char base36 suffix ~ 46k values, fine for manual retries
        // seconds apart; swap for a DB-stored link id if concurrent retries ever collide.
        reference_id: `${invoiceId}-${Date.now().toString(36).slice(-3)}`,
        callback_url: origin ? `${origin}/invoices/${invoiceId}` : undefined,
        callback_method: origin ? "get" : undefined,
      }),
    });
  } catch {
    return fail(502, "Razorpay is unreachable.");
  }
  const link = await resp.json().catch(() => null);
  if (!resp.ok || !link?.short_url) {
    return fail(502, `Razorpay error: ${link?.error?.description ?? resp.status}`);
  }
  return Response.json({ url: link.short_url as string });
}
