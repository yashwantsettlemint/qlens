/**
 * generateAndSendInvoice / resendInvoice business logic — PDF rendering +
 * best-effort email delivery. Takes `companyId` as a plain argument; the
 * caller (server/resolvers.ts) is responsible for requireRole/requireCompanyId
 * before calling in — this module never imports ./auth.
 */
import { hasura, NOTIFICATION_URL, internalServiceHeaders } from "./hasura";
import { mapInvoice, round, num } from "./mappers";
import { publishNotification } from "./queue";
import {
  type CompanyBillingCtx,
  type CustomerBillingCtx,
  COMPANY_BILLING_SEL,
  CUSTOMER_BILLING_SEL,
  emptyCompanyBillingCtx,
  companyForPdf,
  customerForPdf,
  lineItemForPdf,
  lineItemInsertRow,
} from "./invoicePdfContext";
import { INVOICE_SEL } from "./mappers";

export async function generateAndSendInvoiceImpl(companyId: string, input: any) {
  const template = ["classic", "modern", "minimal", "sidebar", "compact"].includes(input.template) ? input.template : "classic";
  const lineItems = (input.lineItems ?? []) as {
    description: string;
    note?: string | null;
    quantity: number;
    unitPrice: number;
    unit?: string | null;
    hsnSac?: string | null;
    gstRate?: number | null;
  }[];
  if (!lineItems.length) throw new Error("Add at least one line item");
  const subtotal = round(lineItems.reduce((sum: number, li) => sum + li.quantity * li.unitPrice, 0));

  const ctx = await hasura<{
    customers_by_pk: CustomerBillingCtx | null;
    companies_by_pk: CompanyBillingCtx | null;
  }>(
    `query Ctx($customerId: uuid!, $companyId: uuid!) {
       customers_by_pk(id: $customerId) { ${CUSTOMER_BILLING_SEL} }
       companies_by_pk(id: $companyId) { ${COMPANY_BILLING_SEL} }
     }`,
    { customerId: input.customerId, companyId },
  );
  const customer = ctx.customers_by_pk;
  if (!customer) throw new Error("Customer not found");
  const company = ctx.companies_by_pk ?? emptyCompanyBillingCtx();

  const { splitTax } = await import("../lib/pdf/gst");
  const gst = splitTax(
    lineItems.map((li) => ({ hsnSac: li.hsnSac ?? null, gstRate: li.gstRate ?? null, taxableValue: li.quantity * li.unitPrice })),
    company.state,
    customer.state,
  );
  const tax = gst.totalTax;
  const total = round(subtotal + tax);

  const data = await hasura(
    `mutation Create($o: invoices_insert_input!) { insert_invoices_one(object: $o) { ${INVOICE_SEL} } }`,
    {
      // company_id isn't a field here — the insert permission auto-fills it
      // from the session.
      o: {
        invoice_number: String(input.invoiceNumber),
        description: input.notes ? String(input.notes).trim() : null,
        direction: "receivable",
        customer_id: input.customerId,
        invoice_date: String(input.invoiceDate),
        due_date: String(input.dueDate),
        amount: subtotal,
        tax_amount: tax,
        department: "sales",
        source: "manual",
        collection_status: "sent",
        template,
        buyer_order_no: input.buyerOrderNo ? String(input.buyerOrderNo).trim() || null : null,
        ack_no: input.ackNo ? String(input.ackNo).trim() || null : null,
      },
    },
  );
  const invoiceRow = data.insert_invoices_one;

  await hasura(
    `mutation Items($rows: [invoice_line_items_insert_input!]!) { insert_invoice_line_items(objects: $rows) { affected_rows } }`,
    { rows: lineItems.map((li) => lineItemInsertRow(li, invoiceRow.id)) },
  );

  // Best-effort: the invoice is created and tracked either way, even if
  // rendering or sending the PDF fails.
  try {
    const { renderInvoicePdf } = await import("../lib/pdf/render");
    const pdf = await renderInvoicePdf({
      template,
      invoiceNumber: String(input.invoiceNumber),
      invoiceDate: String(input.invoiceDate),
      dueDate: String(input.dueDate),
      notes: input.notes ?? null,
      buyerOrderNo: input.buyerOrderNo ?? null,
      ackNo: input.ackNo ?? null,
      company: companyForPdf(company),
      customer: customerForPdf(customer),
      lineItems: lineItems.map(lineItemForPdf),
      subtotal,
      tax,
      total,
      signatureDataUrl: company.signature_data_url,
    });
    if (customer.email) {
      await publishNotification({
        type: "send-invoice",
        payload: {
          customer_email: customer.email,
          customer_name: customer.name,
          invoice_number: String(input.invoiceNumber),
          pdf_base64: pdf.toString("base64"),
        },
      });
    }
  } catch (err) {
    // rendering failed — the invoice itself is still created and tracked
    console.error(`generateAndSendInvoice: PDF render failed for invoice ${input.invoiceNumber}`, err);
  }

  return mapInvoice(invoiceRow);
}

export async function resendInvoiceImpl(companyId: string, id: string): Promise<boolean> {
  const ctx = await hasura<{
    invoices_by_pk: {
      invoice_number: string;
      invoice_date: string;
      due_date: string;
      description: string | null;
      amount: string;
      tax_amount: string;
      template: string | null;
      company_id: string;
      buyer_order_no: string | null;
      ack_no: string | null;
      customer: CustomerBillingCtx | null;
      lineItems: {
        description: string;
        note: string | null;
        quantity: string;
        unit_price: string;
        unit: string | null;
        hsn_sac: string | null;
        gst_rate: string | null;
      }[];
    } | null;
    companies_by_pk: CompanyBillingCtx | null;
  }>(
    `query Ctx($id: uuid!, $companyId: uuid!) {
       invoices_by_pk(id: $id) {
         invoice_number invoice_date due_date description amount tax_amount template company_id buyer_order_no ack_no
         customer { ${CUSTOMER_BILLING_SEL} }
         lineItems { description note quantity unit_price unit hsn_sac gst_rate }
       }
       companies_by_pk(id: $companyId) { ${COMPANY_BILLING_SEL} }
     }`,
    { id, companyId },
  );
  const invoice = ctx.invoices_by_pk;
  if (!invoice || invoice.company_id !== companyId) throw new Error("Invoice not found");
  if (!invoice.template) throw new Error("This invoice wasn't generated with a template — nothing to resend.");
  if (!invoice.customer) throw new Error("This invoice has no customer to send to.");
  if (!invoice.customer.email) throw new Error("This customer has no email on file.");

  const subtotal = num(invoice.amount);
  const tax = num(invoice.tax_amount);
  const company = ctx.companies_by_pk ?? emptyCompanyBillingCtx();

  const { renderInvoicePdf } = await import("../lib/pdf/render");
  const pdf = await renderInvoicePdf({
    template: invoice.template as any,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    notes: invoice.description,
    buyerOrderNo: invoice.buyer_order_no,
    ackNo: invoice.ack_no,
    company: companyForPdf(company),
    customer: customerForPdf(invoice.customer),
    lineItems: invoice.lineItems.map((li) =>
      lineItemForPdf({
        description: li.description,
        note: li.note,
        quantity: num(li.quantity),
        unitPrice: num(li.unit_price),
        unit: li.unit,
        hsnSac: li.hsn_sac,
        gstRate: li.gst_rate == null ? null : num(li.gst_rate),
      }),
    ),
    subtotal,
    tax,
    total: round(subtotal + tax),
    signatureDataUrl: company.signature_data_url,
  });

  // Kept as a direct, synchronous call (not queued like send-invoice/
  // payment-received above) — its boolean result drives a real UI toast
  // (app/(app)/receivables/[id]/page.tsx), so the caller needs the actual
  // send outcome back, not a fire-and-forget queue ack.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let res: Response;
  try {
    res = await fetch(`${NOTIFICATION_URL}/notify/send-invoice`, {
      method: "POST",
      headers: { "content-type": "application/json", ...internalServiceHeaders() },
      body: JSON.stringify({
        customer_email: invoice.customer.email,
        customer_name: invoice.customer.name,
        invoice_number: invoice.invoice_number,
        pdf_base64: pdf.toString("base64"),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Couldn't send the email (notification-service returned ${res.status})`);
  const body = await res.json();
  return Boolean(body.sent);
}
