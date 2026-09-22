/**
 * Resolvers for the frontend's GraphQL contract (graphql/schema.graphql),
 * backed by the real Hasura API + genai-service. Field names / enums / computed
 * values are translated here so no component, operation, or codegen output has
 * to change. This is the Hasura-backed sibling of mock/resolvers.ts.
 */
import { hasura, GENAI_URL, ML_SERVICE_URL, NOTIFICATION_URL, internalServiceHeaders } from "./hasura";
import { safeImageSrc } from "../lib/pdf/render";
import { requireRole, myCompanyId } from "./auth";
import { validateInvoiceInput } from "../lib/validateInvoice";

/** myCompanyId(), or throw — for the {admin:true} mutations below, which
 * bypass Hasura's own company_id filtering and so must scope themselves. */
function requireCompanyId(): string {
  const id = myCompanyId();
  if (!id) throw new Error("No company on this session — sign in again.");
  return id;
}

const TODAY = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayDiff = (a: string | Date, b: string | Date) =>
  Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
const round = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v == null ? 0 : Number(v));

// ---- read-model mapping (snake_case Hasura -> the frontend's camelCase types) ----

function effectivePayment(row: any): "PAID" | "UNPAID" | "OVERDUE" {
  if (row.payment_status === "paid") return "PAID";
  return new Date(row.due_date) < TODAY ? "OVERDUE" : "UNPAID";
}
const daysOverdue = (row: any) =>
  effectivePayment(row) === "OVERDUE" ? dayDiff(TODAY, row.due_date) : 0;
const grossOutstanding = (row: any) =>
  effectivePayment(row) === "PAID" ? 0 : num(row.amount) + num(row.tax_amount);

/** Trim; empty -> null; reject anything without an "@". */
function cleanEmail(raw?: string | null): string | null {
  const e = String(raw ?? "").trim();
  if (!e) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Enter a valid email address");
  return e;
}

function mapMlModel(m: any) {
  const metrics = m?.metrics ?? {};
  return {
    status: m?.status ?? "not_trained",
    method: m?.method ?? "unknown",
    modelVersion: m?.model_version ?? null,
    trainedAt: m?.trained_at ?? null,
    nRows: m?.n_rows ?? null,
    featureCount: m?.feature_count ?? null,
    threshold: m?.threshold ?? null,
    metrics: {
      rocAuc: metrics.roc_auc ?? null,
      accuracy: metrics.accuracy ?? null,
      precision: metrics.precision ?? null,
      recall: metrics.recall ?? null,
      maeDays: metrics.mae_days ?? null,
      r2: metrics.r2 ?? null,
    },
  };
}

function mapMlDriftReport(r: any) {
  return {
    modelName: r?.model_name ?? "unknown",
    checkedAt: r?.checked_at ?? null,
    driftDetected: Boolean(r?.drift_detected),
    featurePsiJson: JSON.stringify(r?.feature_psi ?? {}),
    rollingMetricsJson: JSON.stringify(r?.rolling_metrics ?? {}),
    baselineMetricsJson: JSON.stringify(r?.baseline_metrics ?? {}),
    notes: r?.notes ?? null,
  };
}

function mapMlRetrainEvent(e: any) {
  const metrics = (m: any) => ({
    rocAuc: m?.roc_auc ?? null,
    accuracy: m?.accuracy ?? null,
    precision: m?.precision ?? null,
    recall: m?.recall ?? null,
    maeDays: m?.mae_days ?? null,
    r2: m?.r2 ?? null,
  });
  return {
    id: e.id,
    modelName: e.model_name,
    triggeredBy: e.triggered_by,
    startedAt: e.started_at,
    finishedAt: e.finished_at ?? null,
    status: e.status,
    oldVersion: e.old_version ?? null,
    newVersion: e.new_version ?? null,
    oldMetrics: e.old_metrics ? metrics(e.old_metrics) : null,
    newMetrics: e.new_metrics ? metrics(e.new_metrics) : null,
    error: e.error ?? null,
  };
}

function mapReviewQueueItem(r: any) {
  const draft = r.invoice_draft ?? {};
  return {
    id: r.id,
    status: r.status,
    issues: r.issues ?? [],
    createdAt: r.created_at,
    filename: draft.filename ?? null,
    direction: draft.direction ?? null,
    counterpartyName: draft.counterparty_name ?? null,
    extractedFieldsJson: JSON.stringify(draft.extracted_fields ?? {}),
    sourceMapJson: JSON.stringify(draft.source_map ?? []),
    fullText: draft.full_text || null,
  };
}

function mapDemoRequest(d: any) {
  return {
    id: d.id,
    companyName: d.company_name,
    contactName: d.contact_name,
    workEmail: d.work_email,
    companySize: d.company_size,
    message: d.message,
    createdAt: d.created_at,
  };
}

function mapVendor(v: any) {
  return v
    ? {
        id: v.id,
        name: v.name,
        taxId: v.tax_id ?? null,
        paymentTermsDays: v.payment_terms_days ?? null,
        email: v.email ?? null,
        invoices: (v.invoices ?? []).map(mapInvoice),
      }
    : null;
}

// ---- shared by generateAndSendInvoice / resendInvoice ---------------------

interface CompanyBillingCtx {
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  state: string | null;
  signature_data_url: string | null;
  logo_data_url: string | null;
  bank_account_name: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_swift: string | null;
}
interface CustomerBillingCtx {
  name: string;
  email: string | null;
  gstin: string | null;
  tax_id: string | null;
  address: string | null;
  state: string | null;
}

const COMPANY_BILLING_SEL = `
  name gstin pan address state signature_data_url logo_data_url
  bank_account_name bank_name bank_account_number bank_ifsc bank_swift
`;
const CUSTOMER_BILLING_SEL = `name email gstin tax_id address state`;

const emptyCompanyBillingCtx = (): CompanyBillingCtx => ({
  name: "",
  gstin: null,
  pan: null,
  address: null,
  state: null,
  signature_data_url: null,
  logo_data_url: null,
  bank_account_name: null,
  bank_name: null,
  bank_account_number: null,
  bank_ifsc: null,
  bank_swift: null,
});

function companyForPdf(c: CompanyBillingCtx) {
  const hasBank = c.bank_account_name || c.bank_name || c.bank_account_number;
  return {
    name: c.name,
    gstin: c.gstin,
    pan: c.pan,
    address: c.address,
    state: c.state,
    logoDataUrl: c.logo_data_url,
    bank: hasBank
      ? {
          accountName: c.bank_account_name,
          bankName: c.bank_name,
          accountNumber: c.bank_account_number,
          ifsc: c.bank_ifsc,
          swift: c.bank_swift,
        }
      : null,
  };
}

function customerForPdf(c: CustomerBillingCtx) {
  return { name: c.name, email: c.email, gstin: c.gstin, pan: c.tax_id, address: c.address, state: c.state };
}

function lineItemForPdf(li: {
  description: string;
  note?: string | null;
  quantity: number;
  unitPrice: number;
  unit?: string | null;
  hsnSac?: string | null;
  gstRate?: number | null;
}) {
  return {
    description: li.description,
    note: li.note ?? null,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    unit: li.unit || "Units",
    hsnSac: li.hsnSac ?? null,
    gstRate: li.gstRate ?? null,
  };
}

function lineItemInsertRow(
  li: {
    description: string;
    note?: string | null;
    quantity: number;
    unitPrice: number;
    unit?: string | null;
    hsnSac?: string | null;
    gstRate?: number | null;
  },
  invoiceId: string,
  companyId: string,
) {
  return {
    invoice_id: invoiceId,
    company_id: companyId,
    description: li.description,
    note: li.note ?? null,
    quantity: li.quantity,
    unit_price: li.unitPrice,
    line_amount: round(li.quantity * li.unitPrice),
    unit: li.unit || "Units",
    hsn_sac: li.hsnSac ?? null,
    gst_rate: li.gstRate ?? null,
  };
}

const COMPANY_SEL = `
  name aliases signature_data_url logo_data_url gstin pan address state
  bank_account_name bank_name bank_account_number bank_ifsc bank_swift
`;

function mapCompanySettings(row: any) {
  row = row ?? {};
  return {
    name: row.name ?? "",
    aliases: row.aliases ?? [],
    signatureDataUrl: row.signature_data_url ?? null,
    logoDataUrl: row.logo_data_url ?? null,
    gstin: row.gstin ?? null,
    pan: row.pan ?? null,
    address: row.address ?? null,
    state: row.state ?? null,
    bankAccountName: row.bank_account_name ?? null,
    bankName: row.bank_name ?? null,
    bankAccountNumber: row.bank_account_number ?? null,
    bankIfsc: row.bank_ifsc ?? null,
    bankSwift: row.bank_swift ?? null,
  };
}

function mapCustomer(c: any) {
  return c
    ? {
        id: c.id,
        name: c.name,
        taxId: c.tax_id ?? null,
        email: c.email ?? null,
        paymentTermsDays: c.payment_terms_days ?? null,
        creditLimit: c.credit_limit == null ? null : num(c.credit_limit),
        gstin: c.gstin ?? null,
        address: c.address ?? null,
        state: c.state ?? null,
        invoices: (c.invoices ?? []).map(mapInvoice),
      }
    : null;
}

function mapInvoice(row: any): any {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    description: row.description ?? null,
    extractedText: row.extracted_text ?? null,
    direction: String(row.direction ?? "payable").toUpperCase(),
    collectionStatus: row.collection_status
      ? String(row.collection_status).toUpperCase()
      : null,
    customer: mapCustomer(row.customer),
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    amount: num(row.amount),
    taxAmount: num(row.tax_amount),
    department: row.department,
    approvalStatus: String(row.approval_status ?? "pending").toUpperCase(),
    paymentStatus: effectivePayment(row),
    source: row.source,
    template: row.template ?? null,
    daysOverdue: daysOverdue(row),
    vendor: mapVendor(row.vendor),
    purchaseOrder: row.purchaseOrder
      ? {
          id: row.purchaseOrder.id,
          poNumber: row.purchaseOrder.po_number,
          amount: num(row.purchaseOrder.amount),
          status: row.purchaseOrder.status,
          department: row.purchaseOrder.department,
          vendor: mapVendor(row.purchaseOrder.vendor),
        }
      : null,
    duplicateFlag: row.duplicateFlag
      ? {
          matchedInvoiceId: row.duplicateFlag.matched_invoice_id,
          confidenceScore: num(row.duplicateFlag.confidence_score),
          reviewedStatus: row.duplicateFlag.reviewed_status,
          reason: row.duplicateFlag.reason ?? null,
          explanation: row.duplicateFlag.explanation ?? [],
          matchedInvoice: row.duplicateFlag.matchedInvoice
            ? mapInvoice(row.duplicateFlag.matchedInvoice)
            : null,
        }
      : null,
    delayPrediction: row.delayPrediction
      ? {
          delayProbability: num(row.delayPrediction.delay_probability),
          predictedDelayDays: num(row.delayPrediction.predicted_delay_days),
          modelVersion: row.delayPrediction.model_version,
          explanation: row.delayPrediction.explanation ?? [],
        }
      : null,
    approvalEvents: (row.approvals ?? [])
      .filter((a: any) => a.status && a.status !== "pending")
      .map((a: any) => ({
        id: a.id,
        actor: a.approver,
        action: a.status,
        note: null,
        at: a.acted_at ?? row.invoice_date,
      })),
    payments: (row.payments ?? []).map((p: any) => ({
      id: p.id,
      paidAt: p.paid_at ?? null,
      amountPaid: num(p.amount_paid),
    })),
  };
}

const INVOICE_SEL = `
  id invoice_number description extracted_text direction collection_status
  invoice_date due_date amount tax_amount department
  approval_status payment_status source template
  vendor { id name tax_id payment_terms_days }
  customer { id name tax_id payment_terms_days email credit_limit }
  purchaseOrder { id po_number amount status department vendor { id name tax_id payment_terms_days } }
  duplicateFlag {
    matched_invoice_id confidence_score reviewed_status reason explanation
    matchedInvoice { id invoice_number amount tax_amount invoice_date vendor { id name } }
  }
  delayPrediction { delay_probability predicted_delay_days model_version explanation }
  approvals(order_by: { acted_at: asc_nulls_last }) { id approver level status acted_at }
  payments(order_by: { paid_at: asc_nulls_last }) { id paid_at amount_paid }
`;

// ---- filter / sort translation --------------------------------------------------

function buildWhere(f: any): Record<string, unknown> {
  const and: any[] = [];
  // Default to payables so every existing AP screen is unchanged; AR screens
  // pass direction: RECEIVABLE explicitly.
  and.push({ direction: { _eq: String(f?.direction ?? "PAYABLE").toLowerCase() } });
  if (!f) return { _and: and };
  if (f.vendorId) and.push({ vendor_id: { _eq: f.vendorId } });
  if (f.customerId) and.push({ customer_id: { _eq: f.customerId } });
  if (f.collectionStatus) and.push({ collection_status: { _eq: String(f.collectionStatus).toLowerCase() } });
  if (f.department) and.push({ department: { _eq: f.department } });
  if (f.source) and.push({ source: { _eq: f.source } });
  if (f.approvalStatus) and.push({ approval_status: { _eq: String(f.approvalStatus).toLowerCase() } });
  if (f.dateFrom) and.push({ invoice_date: { _gte: f.dateFrom } });
  if (f.dateTo) and.push({ invoice_date: { _lte: f.dateTo } });
  if (f.paymentStatus === "PAID") and.push({ payment_status: { _eq: "paid" } });
  if (f.paymentStatus === "OVERDUE")
    and.push({ payment_status: { _neq: "paid" } }, { due_date: { _lt: iso(TODAY) } });
  if (f.paymentStatus === "UNPAID")
    and.push({ payment_status: { _neq: "paid" } }, { due_date: { _gte: iso(TODAY) } });
  if (f.q)
    and.push({
      _or: [
        { invoice_number: { _ilike: `%${f.q}%` } },
        { vendor: { name: { _ilike: `%${f.q}%` } } },
        { customer: { name: { _ilike: `%${f.q}%` } } },
      ],
    });
  return and.length ? { _and: and } : {};
}

function buildOrderBy(sort: any): Record<string, unknown> {
  const dir = sort?.dir === "DESC" ? "desc" : "asc";
  switch (sort?.field) {
    case "amount":
      return { amount: dir };
    case "vendor":
      return { vendor: { name: dir } };
    case "customer":
      return { customer: { name: dir } };
    case "collectionStatus":
      return { collection_status: dir };
    case "invoiceNumber":
      return { invoice_number: dir };
    case "invoiceDate":
      return { invoice_date: dir };
    case "department":
      return { department: dir };
    case "approvalStatus":
      return { approval_status: dir };
    case "paymentStatus":
      return { payment_status: dir };
    case "daysOverdue":
      // more overdue == older due date, so invert
      return { due_date: dir === "desc" ? "asc" : "desc" };
    case "delayProbability":
      return { delayPrediction: { delay_probability: `${dir}_nulls_last` } };
    case "dueDate":
    default:
      return { due_date: dir };
  }
}

// ---- resolvers ----------------------------------------------------------------

/** update_vendors / update_customers differ only by table + returned columns. */
/** update_vendors / update_customers differ only by table, returned columns and
 * mapper — which always travel together, so they live in one record. */
const PARTY = {
  vendors: { sel: "id name tax_id payment_terms_days email", map: mapVendor, label: "Vendor" },
  customers: {
    sel: "id name tax_id payment_terms_days email credit_limit gstin address state",
    map: mapCustomer,
    label: "Customer",
  },
} as const;

async function setPartyEmail(table: keyof typeof PARTY, { id, email }: { id: string; email?: string | null }) {
  requireRole("admin");
  const { sel, map, label } = PARTY[table];
  const data = await hasura(
    `mutation SetEmail($id: uuid!, $companyId: uuid!, $email: String) {
       update_${table}(where: { id: { _eq: $id }, company_id: { _eq: $companyId } }, _set: { email: $email }) {
         returning { ${sel} }
       }
     }`,
    { id, email: cleanEmail(email), companyId: requireCompanyId() },
    { admin: true },
  );
  const row = data[`update_${table}`].returning[0];
  if (!row) throw new Error(`${label} not found`);
  return map(row);
}

export const resolvers = {
  Query: {
    async dashboardStats(_: unknown, { vendorId }: { vendorId?: string | null }) {
      const scope = vendorId ? `vendor_id: { _eq: "${vendorId}" }` : "";
      const s = scope ? `, ${scope}` : "";
      const today = iso(TODAY);
      const cutoff = iso(new Date(TODAY.getTime() - 30 * 86_400_000));
      const payScope = vendorId ? `, invoice: { vendor_id: { _eq: "${vendorId}" } }` : "";
      const d = `direction: { _eq: "payable" }`;
      const payDir = `, invoice: { direction: { _eq: "payable" } }`;
      const data = await hasura(`
        query {
          pending: invoices_aggregate(where: { ${d}, approval_status: { _eq: "pending" } ${s} }) {
            aggregate { count sum { amount tax_amount } }
          }
          overdue: invoices_aggregate(where: { ${d}, payment_status: { _neq: "paid" }, due_date: { _lt: "${today}" } ${s} }) {
            aggregate { count sum { amount tax_amount } }
          }
          exposure: invoices_aggregate(where: { ${d}, payment_status: { _neq: "paid" } ${s} }) {
            aggregate { sum { amount tax_amount } }
          }
          approvedUnpaid: invoices_aggregate(where: { ${d}, approval_status: { _eq: "approved" }, payment_status: { _neq: "paid" } ${s} }) {
            aggregate { count sum { amount tax_amount } }
          }
          rejected: invoices_aggregate(where: { ${d}, approval_status: { _eq: "rejected" } ${s} }) {
            aggregate { count }
          }
          paidLast30: payments_aggregate(where: { paid_at: { _gte: "${cutoff}" } ${payScope}${payDir} }) {
            aggregate { count sum { amount_paid } }
          }
          # ponytail: in-resolver scan for avg days-to-pay, capped at 500 paid invoices
          paidInvoices: invoices(where: { ${d}, payment_status: { _eq: "paid" } ${s} }, limit: 500) {
            invoice_date payments(order_by: { paid_at: asc_nulls_last }, limit: 1) { paid_at }
          }
        }
      `);
      const sum = (a: any) => num(a?.sum?.amount) + num(a?.sum?.tax_amount);
      const daysToPay = (data.paidInvoices ?? [])
        .map((i: any) => {
          const p = i.payments?.[0]?.paid_at;
          return p ? dayDiff(p, i.invoice_date) : null;
        })
        .filter((n: number | null): n is number => n != null && n >= 0);
      return {
        pendingCount: data.pending.aggregate.count,
        pendingAmount: round(sum(data.pending.aggregate)),
        overdueCount: data.overdue.aggregate.count,
        overdueAmount: round(sum(data.overdue.aggregate)),
        vendorExposureTotal: round(sum(data.exposure.aggregate)),
        approvedUnpaidCount: data.approvedUnpaid.aggregate.count,
        approvedUnpaidAmount: round(sum(data.approvedUnpaid.aggregate)),
        paidLast30Count: data.paidLast30.aggregate.count,
        paidLast30Amount: round(num(data.paidLast30.aggregate?.sum?.amount_paid)),
        rejectedCount: data.rejected.aggregate.count,
        avgDaysToPay: daysToPay.length
          ? Math.round((daysToPay.reduce((a: number, b: number) => a + b, 0) / daysToPay.length) * 10) / 10
          : 0,
      };
    },

    async invoices(
      _: unknown,
      { filter, sort, page = 1, pageSize = 25 }: any,
    ) {
      const where = buildWhere(filter);
      const orderBy = buildOrderBy(sort);
      const data = await hasura(
        `query Invoices($where: invoices_bool_exp!, $orderBy: [invoices_order_by!], $limit: Int!, $offset: Int!) {
           invoices(where: $where, order_by: $orderBy, limit: $limit, offset: $offset) { ${INVOICE_SEL} }
           invoices_aggregate(where: $where) { aggregate { count } }
         }`,
        { where, orderBy, limit: pageSize, offset: (page - 1) * pageSize },
      );
      let rows = data.invoices.map(mapInvoice);
      // amount sort is on base amount server-side; refine by amount+tax here
      if (sort?.field === "amount") {
        const s = sort.dir === "DESC" ? -1 : 1;
        rows = [...rows].sort((a: any, b: any) => s * (a.amount + a.taxAmount - b.amount - b.taxAmount));
      }
      return { rows, total: data.invoices_aggregate.aggregate.count, page, pageSize };
    },

    async invoice(_: unknown, { id }: { id: string }) {
      const data = await hasura(
        `query One($id: uuid!) { invoices_by_pk(id: $id) { ${INVOICE_SEL} } }`,
        { id },
      );
      return mapInvoice(data.invoices_by_pk);
    },

    async invoiceSummary(_: unknown, { id }: { id: string }) {
      const r = await fetch(`${GENAI_URL}/summarize-invoice`, {
        method: "POST",
        headers: { "content-type": "application/json", ...internalServiceHeaders() },
        body: JSON.stringify({ invoice_id: id, company_id: requireCompanyId() }),
      });
      if (!r.ok) throw new Error(`genai-service /summarize-invoice returned ${r.status}`);
      const j = await r.json();
      return j.summary ?? "";
    },

    async vendors() {
      const data = await hasura(`
        query {
          vendors(order_by: { name: asc }) {
            id name tax_id payment_terms_days email
            invoices { amount tax_amount payment_status due_date payments { paid_at } }
          }
        }
      `);
      return data.vendors.map(vendorStats);
    },

    async vendor(_: unknown, { id }: { id: string }) {
      const data = await hasura(
        `query V($id: uuid!) {
           vendors_by_pk(id: $id) {
             id name tax_id payment_terms_days
             invoices { amount tax_amount payment_status due_date payments { paid_at } }
           }
         }`,
        { id },
      );
      return data.vendors_by_pk ? vendorStats(data.vendors_by_pk) : null;
    },

    async vendorExposure(_: unknown, { vendorId }: { vendorId?: string | null }) {
      const scope = vendorId ? `(where: { id: { _eq: "${vendorId}" } })` : "";
      const data = await hasura(`
        query {
          vendors${scope} {
            id name
            invoices_aggregate(where: { payment_status: { _neq: "paid" } }) {
              aggregate { sum { amount tax_amount } }
            }
          }
        }
      `);
      return data.vendors
        .map((v: any) => ({
          vendorId: v.id,
          vendorName: v.name,
          outstanding: round(
            num(v.invoices_aggregate.aggregate.sum?.amount) +
              num(v.invoices_aggregate.aggregate.sum?.tax_amount),
          ),
        }))
        .sort((a: any, b: any) => b.outstanding - a.outstanding);
    },

    async customers() {
      const data = await hasura(`
        query {
          customers(order_by: { name: asc }) {
            id name tax_id payment_terms_days email credit_limit gstin address state
            invoices { amount tax_amount payment_status due_date payments { paid_at } }
          }
        }
      `);
      return data.customers.map(customerStats);
    },

    async customer(_: unknown, { id }: { id: string }) {
      const data = await hasura(
        `query C($id: uuid!) {
           customers_by_pk(id: $id) {
             id name tax_id payment_terms_days email credit_limit gstin address state
             invoices { amount tax_amount payment_status due_date payments { paid_at } }
           }
         }`,
        { id },
      );
      return data.customers_by_pk ? customerStats(data.customers_by_pk) : null;
    },

    async customerExposure(_: unknown, { customerId }: { customerId?: string | null }) {
      const scope = customerId ? `(where: { id: { _eq: "${customerId}" } })` : "";
      const data = await hasura(`
        query {
          customers${scope} {
            id name
            invoices_aggregate(where: { payment_status: { _neq: "paid" } }) {
              aggregate { sum { amount tax_amount } }
            }
          }
        }
      `);
      return data.customers
        .map((c: any) => ({
          customerId: c.id,
          customerName: c.name,
          outstanding: round(
            num(c.invoices_aggregate.aggregate.sum?.amount) +
              num(c.invoices_aggregate.aggregate.sum?.tax_amount),
          ),
        }))
        .sort((a: any, b: any) => b.outstanding - a.outstanding);
    },

    async inflowStats(_: unknown, { customerId }: { customerId?: string | null }) {
      const scope = customerId ? `, customer_id: { _eq: "${customerId}" }` : "";
      const today = iso(TODAY);
      const cutoff = iso(new Date(TODAY.getTime() - 30 * 86_400_000));
      const R = `direction: { _eq: "receivable" }`;
      const data = await hasura(`
        query {
          outstanding: invoices_aggregate(where: { ${R}, payment_status: { _neq: "paid" } ${scope} }) {
            aggregate { count sum { amount tax_amount } }
          }
          overdue: invoices_aggregate(where: { ${R}, payment_status: { _neq: "paid" }, due_date: { _lt: "${today}" } ${scope} }) {
            aggregate { count sum { amount tax_amount } }
          }
          draft: invoices_aggregate(where: { ${R}, collection_status: { _eq: "draft" } ${scope} }) { aggregate { count } }
          disputed: invoices_aggregate(where: { ${R}, collection_status: { _eq: "disputed" } ${scope} }) { aggregate { count } }
          collected: invoices(where: { ${R}, payment_status: { _eq: "paid" } ${scope} }, limit: 500) {
            invoice_date due_date amount tax_amount
            payments(order_by: { paid_at: asc_nulls_last }, limit: 1) { paid_at }
          }
        }
      `);
      const sum = (a: any) => num(a?.sum?.amount) + num(a?.sum?.tax_amount);
      type Collected = { toCollect: number; gross: number; recent: boolean };
      const collected: Collected[] = ((data.collected ?? []) as any[])
        .map((i: any): Collected | null => {
          const p = i.payments?.[0]?.paid_at;
          return p
            ? { toCollect: dayDiff(p, i.invoice_date), gross: num(i.amount) + num(i.tax_amount), recent: p >= cutoff }
            : null;
        })
        .filter((x): x is Collected => x != null);
      const daysToCollect = collected.map((c) => c.toCollect).filter((n: number) => n >= 0);
      const settledLast30 = collected.filter((c) => c.recent);
      const avg = (xs: number[]) =>
        xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
      return {
        outstandingCount: data.outstanding.aggregate.count,
        outstandingAmount: round(sum(data.outstanding.aggregate)),
        overdueCount: data.overdue.aggregate.count,
        overdueAmount: round(sum(data.overdue.aggregate)),
        draftCount: data.draft.aggregate.count,
        disputedCount: data.disputed.aggregate.count,
        settledLast30Count: settledLast30.length,
        settledLast30Amount: round(settledLast30.reduce((s, c) => s + c.gross, 0)),
        avgDaysToCollect: avg(daysToCollect),
        dso: avg(daysToCollect), // ponytail: mean days-to-collect as DSO proxy
      };
    },

    async cashForecast() {
      // Predicted cash-move date = due_date + predicted_delay_days (0 if no model row).
      const data = await hasura(`
        query {
          invoices(where: { payment_status: { _neq: "paid" } }, limit: 2000) {
            direction due_date amount tax_amount
            delayPrediction { predicted_delay_days }
          }
        }
      `);
      const buckets = [
        { label: "0–7 days", max: 7 },
        { label: "8–14 days", max: 14 },
        { label: "15–30 days", max: 30 },
        { label: "30+ days", max: Infinity },
      ].map((b) => ({ label: b.label, inflow: 0, outflow: 0, net: 0 }));
      const edges = [7, 14, 30, Infinity];
      for (const row of data.invoices as any[]) {
        const gross = num(row.amount) + num(row.tax_amount);
        const delay = num(row.delayPrediction?.predicted_delay_days);
        const days = dayDiff(
          iso(new Date(new Date(row.due_date).getTime() + delay * 86_400_000)),
          iso(TODAY),
        );
        const idx = edges.findIndex((e) => days <= e);
        const b = buckets[idx < 0 ? buckets.length - 1 : idx];
        if (row.direction === "receivable") b.inflow += gross;
        else b.outflow += gross;
      }
      let netTotal = 0;
      for (const b of buckets) {
        b.inflow = round(b.inflow);
        b.outflow = round(b.outflow);
        b.net = round(b.inflow - b.outflow);
        netTotal += b.net;
      }
      return { buckets, netTotal: round(netTotal) };
    },

    async ask(_: unknown, { prompt }: { prompt: string }) {
      // /query (not /summarize) — the hybrid router: exact totals/filters go
      // through a normal DB query same as before, but a genuinely semantic
      // question ("invoices that mention a penalty clause") also searches
      // invoice_embeddings (pgvector) for meaning-based matches, not just
      // keyword filters. Falls back to a DB-only answer if embeddings are
      // unavailable (see genai-service's _safe_semantic).
      let summary = "The assistant service is unavailable right now.";
      let ids: string[] = [];
      try {
        const r = await fetch(`${GENAI_URL}/query`, {
          method: "POST",
          headers: { "content-type": "application/json", ...internalServiceHeaders() },
          body: JSON.stringify({ question: prompt, company_id: requireCompanyId() }),
        });
        const j = await r.json();
        summary = j.answer ?? summary;
        ids = j.invoice_ids ?? [];
      } catch {
        return { text: summary, invoices: [] };
      }
      let invoices: any[] = [];
      if (ids.length) {
        const data = await hasura(
          `query Refs($ids: [uuid!]!) { invoices(where: { id: { _in: $ids } }) { ${INVOICE_SEL} } }`,
          { ids },
        );
        invoices = data.invoices.map(mapInvoice);
      }
      return { text: summary, invoices };
    },

    async companySettings() {
      requireRole("finance_user", "admin");
      const data = await hasura(
        `query CompanySettings($id: uuid!) { companies_by_pk(id: $id) { ${COMPANY_SEL} } }`,
        { id: requireCompanyId() },
        { admin: true },
      );
      return mapCompanySettings(data.companies_by_pk);
    },

    async mlModelStatus() {
      requireRole("admin");
      const res = await fetch(`${ML_SERVICE_URL}/models?company_id=${requireCompanyId()}`, {
        headers: internalServiceHeaders(),
      });
      if (!res.ok) throw new Error(`ml-service /models returned ${res.status}`);
      const data = await res.json();
      return { duplicate: mapMlModel(data.duplicate), delay: mapMlModel(data.delay) };
    },

    async mlDriftStatus() {
      requireRole("admin");
      const res = await fetch(`${ML_SERVICE_URL}/drift?company_id=${requireCompanyId()}`, {
        headers: internalServiceHeaders(),
      });
      if (!res.ok) throw new Error(`ml-service /drift returned ${res.status}`);
      const data = await res.json();
      return [data.duplicate, data.delay].filter(Boolean).map(mapMlDriftReport);
    },

    async mlRetrainHistory(_: unknown, { limit }: { limit?: number | null }) {
      requireRole("admin");
      const res = await fetch(
        `${ML_SERVICE_URL}/retrain-history?limit=${limit ?? 20}&company_id=${requireCompanyId()}`,
        { headers: internalServiceHeaders() },
      );
      if (!res.ok) throw new Error(`ml-service /retrain-history returned ${res.status}`);
      const data = await res.json();
      return (data as any[]).map(mapMlRetrainEvent);
    },

    async reviewQueue(_: unknown, { status }: { status?: string | null }) {
      requireRole("finance_user", "admin");
      const data = await hasura(
        `query ReviewQueue($status: String) {
           review_queue(where: { status: { _eq: $status } }, order_by: { created_at: desc }) {
             id status issues created_at invoice_draft
           }
         }`,
        { status: status ?? "pending" },
      );
      return data.review_queue.map(mapReviewQueueItem);
    },

    async demoRequests(_: unknown, { limit }: { limit?: number | null }) {
      requireRole("admin");
      const data = await hasura(
        `query DemoRequests($limit: Int!) {
           demo_requests(order_by: { created_at: desc }, limit: $limit) {
             id company_name contact_name work_email company_size message created_at
           }
         }`,
        { limit: limit ?? 20 },
        { admin: true },
      );
      return data.demo_requests.map(mapDemoRequest);
    },
  },

  Mutation: {
    async approveInvoices(_: unknown, { ids }: { ids: string[] }) {
      requireRole("approver", "admin");
      const companyId = requireCompanyId();
      const data = await hasura(
        // admin: the frontend's approve writes invoices.approval_status directly,
        // which Hasura's `approver` role isn't granted — the BFF gate above is
        // the authority here. company_id filter/set: {admin:true} bypasses
        // Hasura's own tenant filtering, so this resolver enforces it instead.
        `mutation Approve($ids: [uuid!]!, $companyId: uuid!, $rows: [approvals_insert_input!]!) {
           update_invoices(
             where: { id: { _in: $ids }, company_id: { _eq: $companyId }, approval_status: { _eq: "pending" } }
             _set: { approval_status: "approved" }
           ) { returning { ${INVOICE_SEL} } }
           insert_approvals(objects: $rows) { affected_rows }
         }`,
        {
          ids,
          companyId,
          rows: ids.map((id) => ({
            invoice_id: id, company_id: companyId, approver: "you", level: 1, status: "approved",
            acted_at: new Date().toISOString(),
          })),
        },
        { admin: true },
      );
      return data.update_invoices.returning.map(mapInvoice);
    },

    async setApproval(
      _: unknown,
      { id, status, note }: { id: string; status: string; note?: string | null },
    ) {
      requireRole("approver", "admin");
      const s = status.toLowerCase();
      const companyId = requireCompanyId();
      const data = await hasura(
        `mutation SetApproval($id: uuid!, $companyId: uuid!, $row: [approvals_insert_input!]!, $status: String!) {
           update_invoices(where: { id: { _eq: $id }, company_id: { _eq: $companyId } }, _set: { approval_status: $status }) {
             returning { ${INVOICE_SEL} }
           }
           insert_approvals(objects: $row) { affected_rows }
         }`,
        {
          id, status: s, companyId,
          row: [{ invoice_id: id, company_id: companyId, approver: "you", level: 1, status: s, acted_at: new Date().toISOString(), }],
        },
        { admin: true }, // writes invoices.approval_status — see approveInvoices
      );
      void note;
      return mapInvoice(data.update_invoices.returning[0]);
    },

    async reviewDuplicate(
      _: unknown,
      { invoiceId, status }: { invoiceId: string; status: string },
    ) {
      requireRole("finance_user", "approver", "admin");
      const companyId = requireCompanyId();
      const data = await hasura(
        `mutation Review($id: uuid!, $companyId: uuid!, $status: String!) {
           update_duplicate_flags(
             where: { invoice_id: { _eq: $id }, company_id: { _eq: $companyId } }
             _set: { reviewed_status: $status }
           ) { affected_rows }
           invoices_by_pk(id: $id) { ${INVOICE_SEL} company_id }
         }`,
        { id: invoiceId, status, companyId },
        { admin: true }, // duplicate_flags has no per-role update perm
      );
      if (data.invoices_by_pk?.company_id && data.invoices_by_pk.company_id !== companyId) {
        throw new Error("Invoice not found");
      }
      return mapInvoice(data.invoices_by_pk);
    },

    async recordPayment(
      _: unknown,
      { invoiceId, paidAt, amountPaid }: { invoiceId: string; paidAt: string; amountPaid: number },
    ) {
      requireRole("finance_user", "admin");
      const companyId = requireCompanyId();
      // A payable can only be paid once approval has cleared. A receivable has no
      // approval step — recording a receipt is always allowed. Enforced here too,
      // not just in the UI — this is a money write.
      const gate = await hasura<{
        invoices_by_pk: {
          approval_status: string;
          direction: string;
          company_id: string;
          invoice_number: string;
          customer: { name: string; email: string | null } | null;
        } | null;
      }>(
        `query PayGate($id: uuid!) {
           invoices_by_pk(id: $id) { approval_status direction company_id invoice_number customer { name email } }
         }`,
        { id: invoiceId },
        { admin: true },
      );
      if (gate.invoices_by_pk?.company_id !== companyId) throw new Error("Invoice not found");
      const isReceivable = gate.invoices_by_pk?.direction === "receivable";
      const approval = gate.invoices_by_pk?.approval_status;
      if (!isReceivable && approval !== "approved") {
        throw new Error(
          approval === "rejected"
            ? "This invoice was rejected and can't be paid."
            : "This invoice isn't approved yet — it can't be paid until approval completes.",
        );
      }
      const extra = isReceivable ? `, collection_status: "settled"` : "";
      const data = await hasura(
        `mutation Pay($p: payments_insert_input!, $id: uuid!, $companyId: uuid!) {
           insert_payments_one(object: $p) { id paid_at amount_paid }
           update_invoices(where: { id: { _eq: $id }, company_id: { _eq: $companyId } }, _set: { payment_status: "paid"${extra} }) { affected_rows }
         }`,
        {
          p: { invoice_id: invoiceId, company_id: companyId, paid_at: paidAt, amount_paid: amountPaid },
          id: invoiceId,
          companyId,
        },
        { admin: true }, // one atomic insert-payment + mark-paid; BFF-gated above
      );
      const p = data.insert_payments_one;

      // Best-effort receipt confirmation — never blocks or fails the payment
      // itself if the email can't be sent.
      const customer = gate.invoices_by_pk?.customer;
      if (isReceivable && customer?.email) {
        fetch(`${NOTIFICATION_URL}/notify/payment-received`, {
          method: "POST",
          headers: { "content-type": "application/json", ...internalServiceHeaders() },
          body: JSON.stringify({
            customer_email: customer.email,
            customer_name: customer.name,
            invoice_number: gate.invoices_by_pk?.invoice_number,
            amount: amountPaid,
            paid_at: paidAt,
          }),
        }).catch((err) => {
          console.error(`recordPayment: failed to send payment-received email for invoice ${invoiceId}`, err);
        });
      }

      return { id: p.id, paidAt: p.paid_at, amountPaid: num(p.amount_paid) };
    },

    async createInvoice(_: unknown, { input }: { input: any }) {
      requireRole("finance_user"); // invoice entry is finance_user's job, not admin's
      const companyId = requireCompanyId();
      const o: any = { ...toInsert(input), company_id: companyId };
      const partyCol = o.direction === "receivable" ? "customer_id" : "vendor_id";
      const partyId = o.direction === "receivable" ? o.customer_id : o.vendor_id;
      const dup = await hasura(
        `query Dup($p: uuid!, $n: String!, $companyId: uuid!) {
           invoices(where: { ${partyCol}: { _eq: $p }, invoice_number: { _eq: $n }, company_id: { _eq: $companyId } }, limit: 1) {
             invoice_number
           }
         }`,
        { p: partyId, n: o.invoice_number, companyId },
        { admin: true },
      );
      if (dup.invoices.length > 0) {
        throw new Error(
          `Invoice "${o.invoice_number}" already exists for this ${
            o.direction === "receivable" ? "customer" : "vendor"
          } — duplicate not added.`,
        );
      }
      const data = await hasura(
        `mutation Create($o: invoices_insert_input!) { insert_invoices_one(object: $o) { ${INVOICE_SEL} } }`,
        { o },
        { admin: true },
      );
      return mapInvoice(data.insert_invoices_one);
    },

    async generateAndSendInvoice(_: unknown, { input }: { input: any }) {
      requireRole("finance_user", "admin");
      const companyId = requireCompanyId();

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
        { admin: true },
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
          o: {
            invoice_number: String(input.invoiceNumber),
            description: input.notes ? String(input.notes).trim() : null,
            direction: "receivable",
            customer_id: input.customerId,
            company_id: companyId,
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
        { admin: true },
      );
      const invoiceRow = data.insert_invoices_one;

      await hasura(
        `mutation Items($rows: [invoice_line_items_insert_input!]!) { insert_invoice_line_items(objects: $rows) { affected_rows } }`,
        { rows: lineItems.map((li) => lineItemInsertRow(li, invoiceRow.id, companyId)) },
        { admin: true },
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
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`${NOTIFICATION_URL}/notify/send-invoice`, {
              method: "POST",
              headers: { "content-type": "application/json", ...internalServiceHeaders() },
              body: JSON.stringify({
                customer_email: customer.email,
                customer_name: customer.name,
                invoice_number: String(input.invoiceNumber),
                pdf_base64: pdf.toString("base64"),
              }),
              signal: controller.signal,
            }).finally(() => clearTimeout(timer));
            if (!res.ok) {
              console.error(`generateAndSendInvoice: notify service returned ${res.status} for invoice ${input.invoiceNumber}`);
            }
          } catch (err) {
            // Notification service timeout or network error — invoice remains created
            console.error(`generateAndSendInvoice: failed to send email for invoice ${input.invoiceNumber}`, err);
          }
        }
      } catch (err) {
        // rendering failed — the invoice itself is still created and tracked
        console.error(`generateAndSendInvoice: PDF render failed for invoice ${input.invoiceNumber}`, err);
      }

      return mapInvoice(invoiceRow);
    },

    async resendInvoice(_: unknown, { id }: { id: string }) {
      requireRole("finance_user", "admin");
      const companyId = requireCompanyId();

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
        { admin: true },
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
    },

    async deleteInvoice(_: unknown, { id }: { id: string }) {
      requireRole("finance_user", "admin");
      const data = await hasura(
        `mutation DeleteInvoice($id: uuid!, $companyId: uuid!) {
           delete_invoices(where: { id: { _eq: $id }, company_id: { _eq: $companyId } }) {
             returning { id }
           }
         }`,
        { id, companyId: requireCompanyId() },
        { admin: true }, // invoices has no per-role delete perm; BFF-gated above
      );
      if (!data.delete_invoices.returning.length) throw new Error("Invoice not found");
      return true;
    },

    async createVendor(
      _: unknown,
      { name, taxId, paymentTermsDays, email }: {
        name: string;
        taxId?: string | null;
        paymentTermsDays?: number | null;
        email?: string | null;
      },
    ) {
      requireRole("finance_user", "admin");
      const clean = String(name ?? "").trim();
      if (!clean) throw new Error("Vendor name is required");
      const data = await hasura(
        `mutation AddVendor($o: vendors_insert_input!) {
           insert_vendors_one(object: $o) { id name tax_id payment_terms_days email }
         }`,
        {
          o: {
            name: clean,
            tax_id: (taxId ?? "").trim() || null,
            payment_terms_days: paymentTermsDays ?? 30,
            email: cleanEmail(email),
            company_id: requireCompanyId(),
          },
        },
        { admin: true }, // vendors has no per-role insert perm; BFF-gated above
      );
      return mapVendor(data.insert_vendors_one);
    },

    updateVendorEmail: (_: unknown, a: { id: string; email?: string | null }) =>
      setPartyEmail("vendors", a),

    async createCustomer(
      _: unknown,
      { name, taxId, email, paymentTermsDays, creditLimit }: {
        name: string;
        taxId?: string | null;
        email?: string | null;
        paymentTermsDays?: number | null;
        creditLimit?: number | null;
      },
    ) {
      requireRole("finance_user", "admin");
      const clean = String(name ?? "").trim();
      if (!clean) throw new Error("Customer name is required");
      const data = await hasura(
        `mutation AddCustomer($o: customers_insert_input!) {
           insert_customers_one(object: $o) {
             id name tax_id payment_terms_days email credit_limit
           }
         }`,
        {
          o: {
            name: clean,
            tax_id: (taxId ?? "").trim() || null,
            payment_terms_days: paymentTermsDays ?? 30,
            email: cleanEmail(email),
            credit_limit: creditLimit == null ? null : Number(creditLimit),
            company_id: requireCompanyId(),
          },
        },
        { admin: true }, // customers has no per-role insert perm; BFF-gated above
      );
      return mapCustomer(data.insert_customers_one);
    },

    updateCustomerEmail: (_: unknown, a: { id: string; email?: string | null }) =>
      setPartyEmail("customers", a),

    async updateCustomerTaxDetails(
      _: unknown,
      { id, gstin, address, state }: { id: string; gstin?: string | null; address?: string | null; state?: string | null },
    ) {
      requireRole("finance_user", "admin");
      const data = await hasura(
        `mutation SetCustomerTax($id: uuid!, $companyId: uuid!, $gstin: String, $address: String, $state: String) {
           update_customers(
             where: { id: { _eq: $id }, company_id: { _eq: $companyId } }
             _set: { gstin: $gstin, address: $address, state: $state }
           ) {
             returning { id name tax_id payment_terms_days email credit_limit gstin address state }
           }
         }`,
        {
          id,
          gstin: gstin?.trim() || null,
          address: address?.trim() || null,
          state: state?.trim() || null,
          companyId: requireCompanyId(),
        },
        { admin: true },
      );
      if (!data.update_customers.returning.length) throw new Error("Customer not found");
      return mapCustomer(data.update_customers.returning[0]);
    },

    async setCollectionStatus(
      _: unknown,
      { id, status }: { id: string; status: string },
    ) {
      requireRole("finance_user", "admin");
      const s = String(status).toLowerCase();
      if (!["draft", "sent", "disputed", "settled"].includes(s))
        throw new Error(`Unknown collection status: ${status}`);
      const data = await hasura(
        `mutation SetColl($id: uuid!, $companyId: uuid!, $s: String!) {
           update_invoices(
             where: { id: { _eq: $id }, company_id: { _eq: $companyId }, direction: { _eq: "receivable" } }
             _set: { collection_status: $s }
           ) { returning { ${INVOICE_SEL} } }
         }`,
        { id, s, companyId: requireCompanyId() },
        { admin: true },
      );
      const row = data.update_invoices.returning[0];
      if (!row) throw new Error("Receivable not found");
      return mapInvoice(row);
    },

    async updateCompanySettings(
      _: unknown,
      { name, aliases }: { name: string; aliases: string[] },
    ) {
      requireRole("admin");
      const clean = String(name ?? "").trim();
      const cleanAliases = (aliases ?? []).map((a) => String(a).trim()).filter(Boolean);
      const data = await hasura(
        `mutation SetCompany($id: uuid!, $name: String!, $aliases: [String!]!) {
           update_companies_by_pk(pk_columns: { id: $id }, _set: { name: $name, aliases: $aliases }) {
             ${COMPANY_SEL}
           }
         }`,
        { id: requireCompanyId(), name: clean, aliases: cleanAliases },
        { admin: true },
      );
      return mapCompanySettings(data.update_companies_by_pk);
    },

    async saveCompanySignature(_: unknown, { dataUrl }: { dataUrl: string }) {
      requireRole("finance_user", "admin");
      if (!safeImageSrc(dataUrl)) {
        throw new Error("Signature must be an image data URL under 2MB");
      }
      const data = await hasura(
        `mutation SetSignature($id: uuid!, $url: String!) {
           update_companies_by_pk(pk_columns: { id: $id }, _set: { signature_data_url: $url }) {
             ${COMPANY_SEL}
           }
         }`,
        { id: requireCompanyId(), url: dataUrl },
        { admin: true },
      );
      return mapCompanySettings(data.update_companies_by_pk);
    },

    async saveCompanyLogo(_: unknown, { dataUrl }: { dataUrl: string }) {
      requireRole("finance_user", "admin");
      if (!safeImageSrc(dataUrl)) {
        throw new Error("Logo must be an image data URL under 2MB");
      }
      const data = await hasura(
        `mutation SetLogo($id: uuid!, $url: String!) {
           update_companies_by_pk(pk_columns: { id: $id }, _set: { logo_data_url: $url }) {
             ${COMPANY_SEL}
           }
         }`,
        { id: requireCompanyId(), url: dataUrl },
        { admin: true },
      );
      return mapCompanySettings(data.update_companies_by_pk);
    },

    async updateCompanyTaxDetails(
      _: unknown,
      args: {
        gstin?: string | null;
        pan?: string | null;
        address?: string | null;
        state?: string | null;
        bankAccountName?: string | null;
        bankName?: string | null;
        bankAccountNumber?: string | null;
        bankIfsc?: string | null;
        bankSwift?: string | null;
      },
    ) {
      requireRole("finance_user", "admin");
      const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);
      const data = await hasura(
        `mutation SetCompanyTax(
           $id: uuid!, $gstin: String, $pan: String, $address: String, $state: String,
           $bankAccountName: String, $bankName: String, $bankAccountNumber: String, $bankIfsc: String, $bankSwift: String
         ) {
           update_companies_by_pk(
             pk_columns: { id: $id }
             _set: {
               gstin: $gstin, pan: $pan, address: $address, state: $state,
               bank_account_name: $bankAccountName, bank_name: $bankName,
               bank_account_number: $bankAccountNumber, bank_ifsc: $bankIfsc, bank_swift: $bankSwift
             }
           ) { ${COMPANY_SEL} }
         }`,
        {
          id: requireCompanyId(),
          gstin: clean(args.gstin),
          pan: clean(args.pan),
          address: clean(args.address),
          state: clean(args.state),
          bankAccountName: clean(args.bankAccountName),
          bankName: clean(args.bankName),
          bankAccountNumber: clean(args.bankAccountNumber),
          bankIfsc: clean(args.bankIfsc),
          bankSwift: clean(args.bankSwift),
        },
        { admin: true },
      );
      return mapCompanySettings(data.update_companies_by_pk);
    },

    async setReviewQueueStatus(_: unknown, { id, status }: { id: string; status: string }) {
      requireRole("finance_user", "admin");
      // review_queue's update_permission for finance_user only grants the
      // `status` column — no {admin:true} needed, Hasura's own perms are enough.
      const data = await hasura(
        `mutation SetReviewQueueStatus($id: uuid!, $status: String!) {
           update_review_queue_by_pk(pk_columns: { id: $id }, _set: { status: $status }) {
             id status issues created_at invoice_draft
           }
         }`,
        { id, status },
      );
      return mapReviewQueueItem(data.update_review_queue_by_pk);
    },

    async triggerDriftCheck() {
      requireRole("admin");
      const companyId = requireCompanyId();
      const res = await fetch(`${ML_SERVICE_URL}/drift/check`, {
        method: "POST",
        headers: { "content-type": "application/json", ...internalServiceHeaders() },
        body: JSON.stringify({ company_id: companyId }),
      });
      if (!res.ok) throw new Error(`ml-service /drift/check returned ${res.status}`);
      const data = (await res.json())[companyId] ?? {};
      return [data.duplicate, data.delay].filter(Boolean).map(mapMlDriftReport);
    },

    async triggerModelRetrain(_: unknown, { modelName }: { modelName: string }) {
      requireRole("admin");
      const companyId = requireCompanyId();
      const res = await fetch(`${ML_SERVICE_URL}/retrain`, {
        method: "POST",
        headers: { "content-type": "application/json", ...internalServiceHeaders() },
        body: JSON.stringify({ model_name: modelName, company_id: companyId }),
      });
      if (!res.ok) throw new Error(`ml-service /retrain returned ${res.status}`);
      const result = await res.json();
      const history = await fetch(`${ML_SERVICE_URL}/retrain-history?limit=1&company_id=${companyId}`, {
        headers: internalServiceHeaders(),
      });
      const [latest] = await history.json();
      return latest
        ? mapMlRetrainEvent(latest)
        : {
            id: result.event_id ?? "unknown",
            modelName,
            triggeredBy: "manual",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: result.status,
            oldVersion: null,
            newVersion: result.version ?? null,
            oldMetrics: null,
            newMetrics: null,
            error: result.detail ?? null,
          };
    },

    async deleteDemoRequest(_: unknown, { id }: { id: string }) {
      requireRole("admin");
      const data = await hasura(
        `mutation DeleteDemoRequest($id: uuid!) { delete_demo_requests_by_pk(id: $id) { id } }`,
        { id },
        { admin: true },
      );
      return Boolean(data.delete_demo_requests_by_pk);
    },

    async importInvoices(_: unknown, { rows }: { rows: any[] }) {
      requireRole("finance_user"); // invoice import is finance_user's job, not admin's
      const companyId = requireCompanyId();
      const vendorIds: Set<string> = new Set(
        (await hasura(`query { vendors { id } }`)).vendors.map((v: any) => v.id),
      );
      const existingKeys: Set<string> = new Set(
        (
          await hasura(`query { invoices(limit: 10000) { vendor_id invoice_number } }`)
        ).invoices.map((r: any) => `${r.vendor_id}|${r.invoice_number}`),
      );
      const errors: { row: number; message: string }[] = [];
      const valid: any[] = [];
      const seen = new Set<string>();
      rows.forEach((input, i) => {
        const problem = validateInvoiceInput(input, vendorIds);
        if (problem) {
          errors.push({ row: i + 1, message: problem });
          return;
        }
        const key = `${input.vendorId}|${String(input.invoiceNumber)}`;
        if (existingKeys.has(key) || seen.has(key)) {
          errors.push({
            row: i + 1,
            message: `Duplicate invoice "${input.invoiceNumber}" for this vendor — skipped`,
          });
          return;
        }
        seen.add(key);
        valid.push({ ...toInsert(input), company_id: companyId });
      });
      let created = 0;
      if (valid.length) {
        const data = await hasura(
          `mutation Import($o: [invoices_insert_input!]!) { insert_invoices(objects: $o) { affected_rows } }`,
          { o: valid },
          { admin: true },
        );
        created = data.insert_invoices.affected_rows;
      }
      return { created, failed: errors.length, errors };
    },
  },
};

function vendorStats(v: any) {
  const list = v.invoices ?? [];
  const paid = list.filter((i: any) => i.payment_status === "paid");
  const lateness = paid.map((i: any) => {
    const paidAt = i.payments?.[0]?.paid_at;
    return paidAt ? Math.max(0, dayDiff(paidAt, i.due_date)) : 0;
  });
  const avgDelayDays = lateness.length
    ? Math.round((lateness.reduce((a: number, b: number) => a + b, 0) / lateness.length) * 10) / 10
    : 0;
  const onTime = lateness.filter((d: number) => d === 0).length;
  return {
    vendor: {
      id: v.id, name: v.name, taxId: v.tax_id ?? null,
      paymentTermsDays: v.payment_terms_days ?? null, email: v.email ?? null, invoices: [],
    },
    totalInvoices: list.length,
    totalExposure: round(list.reduce((s: number, i: any) => s + grossOutstanding(i), 0)),
    avgDelayDays,
    onTimePct: paid.length ? Math.round((onTime / paid.length) * 100) : 100,
  };
}

function customerStats(c: any) {
  const list = c.invoices ?? [];
  const paid = list.filter((i: any) => i.payment_status === "paid");
  const lateness = paid.map((i: any) => {
    const paidAt = i.payments?.[0]?.paid_at;
    return paidAt ? Math.max(0, dayDiff(paidAt, i.due_date)) : 0;
  });
  const avgDelayDays = lateness.length
    ? Math.round((lateness.reduce((a: number, b: number) => a + b, 0) / lateness.length) * 10) / 10
    : 0;
  const onTime = lateness.filter((d: number) => d === 0).length;
  return {
    customer: { ...mapCustomer(c), invoices: [] },
    totalInvoices: list.length,
    totalExposure: round(list.reduce((s: number, i: any) => s + grossOutstanding(i), 0)),
    avgDelayDays,
    onTimePct: paid.length ? Math.round((onTime / paid.length) * 100) : 100,
  };
}

function toInsert(input: any) {
  const direction = String(input.direction ?? "PAYABLE").toLowerCase();
  const o: Record<string, unknown> = {
    invoice_number: String(input.invoiceNumber),
    description: input.description ? String(input.description).trim() : null,
    extracted_text: input.extractedText ? String(input.extractedText) : null,
    direction,
    invoice_date: String(input.invoiceDate),
    due_date: String(input.dueDate),
    amount: Number(input.amount),
    tax_amount: Number(input.taxAmount ?? 0),
    department: String(input.department),
    source: ["manual", "csv", "ocr"].includes(input.source) ? input.source : "manual",
  };
  if (direction === "receivable") {
    if (!input.customerId) throw new Error("A receivable needs a customer");
    o.customer_id = String(input.customerId);
    o.collection_status = String(input.collectionStatus ?? "DRAFT").toLowerCase();
  } else {
    if (!input.vendorId) throw new Error("A payable needs a vendor");
    o.vendor_id = String(input.vendorId);
    if (input.purchaseOrderId) o.po_id = String(input.purchaseOrderId);
  }
  return o;
}
