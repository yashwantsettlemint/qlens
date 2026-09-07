/**
 * Resolvers for the frontend's GraphQL contract (graphql/schema.graphql),
 * backed by the real Hasura API + genai-service. Field names / enums / computed
 * values are translated here so no component, operation, or codegen output has
 * to change. This is the Hasura-backed sibling of mock/resolvers.ts.
 */
import { hasura, GENAI_URL } from "./hasura";
import { requireRole } from "./auth";
import { validateInvoiceInput } from "../lib/validateInvoice";

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

function mapVendor(v: any) {
  return v
    ? {
        id: v.id,
        name: v.name,
        taxId: v.tax_id ?? null,
        paymentTermsDays: v.payment_terms_days ?? null,
        invoices: (v.invoices ?? []).map(mapInvoice),
      }
    : null;
}

function mapInvoice(row: any): any {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    amount: num(row.amount),
    taxAmount: num(row.tax_amount),
    department: row.department,
    approvalStatus: String(row.approval_status ?? "pending").toUpperCase(),
    paymentStatus: effectivePayment(row),
    source: row.source,
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
  id invoice_number invoice_date due_date amount tax_amount department
  approval_status payment_status source
  vendor { id name tax_id payment_terms_days }
  purchaseOrder { id po_number amount status department vendor { id name tax_id payment_terms_days } }
  duplicateFlag {
    matched_invoice_id confidence_score reviewed_status
    matchedInvoice { id invoice_number amount tax_amount invoice_date vendor { id name } }
  }
  delayPrediction { delay_probability predicted_delay_days model_version }
  approvals(order_by: { acted_at: asc_nulls_last }) { id approver level status acted_at }
  payments(order_by: { paid_at: asc_nulls_last }) { id paid_at amount_paid }
`;

// ---- filter / sort translation --------------------------------------------------

function buildWhere(f: any): Record<string, unknown> {
  if (!f) return {};
  const and: any[] = [];
  if (f.vendorId) and.push({ vendor_id: { _eq: f.vendorId } });
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

export const resolvers = {
  Query: {
    async dashboardStats(_: unknown, { vendorId }: { vendorId?: string | null }) {
      const scope = vendorId ? `vendor_id: { _eq: "${vendorId}" }` : "";
      const today = iso(TODAY);
      const data = await hasura(`
        query {
          pending: invoices_aggregate(where: { approval_status: { _eq: "pending" } ${scope ? `, ${scope}` : ""} }) {
            aggregate { count sum { amount tax_amount } }
          }
          overdue: invoices_aggregate(where: { payment_status: { _neq: "paid" }, due_date: { _lt: "${today}" } ${scope ? `, ${scope}` : ""} }) {
            aggregate { count sum { amount tax_amount } }
          }
          exposure: invoices_aggregate(where: { payment_status: { _neq: "paid" } ${scope ? `, ${scope}` : ""} }) {
            aggregate { sum { amount tax_amount } }
          }
        }
      `);
      const sum = (a: any) => num(a?.sum?.amount) + num(a?.sum?.tax_amount);
      return {
        pendingCount: data.pending.aggregate.count,
        pendingAmount: round(sum(data.pending.aggregate)),
        overdueCount: data.overdue.aggregate.count,
        overdueAmount: round(sum(data.overdue.aggregate)),
        vendorExposureTotal: round(sum(data.exposure.aggregate)),
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

    async vendors() {
      const data = await hasura(`
        query {
          vendors(order_by: { name: asc }) {
            id name tax_id payment_terms_days
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

    async ask(_: unknown, { prompt }: { prompt: string }) {
      let summary = "The assistant service is unavailable right now.";
      let ids: string[] = [];
      try {
        const r = await fetch(`${GENAI_URL}/summarize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: prompt }),
        });
        const j = await r.json();
        summary = j.summary ?? summary;
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
  },

  Mutation: {
    async approveInvoices(_: unknown, { ids }: { ids: string[] }) {
      requireRole("approver", "admin");
      const data = await hasura(
        // admin: the frontend's approve writes invoices.approval_status directly,
        // which Hasura's `approver` role isn't granted — the BFF gate above is
        // the authority here.
        `mutation Approve($ids: [uuid!]!, $rows: [approvals_insert_input!]!) {
           update_invoices(where: { id: { _in: $ids }, approval_status: { _eq: "pending" } }, _set: { approval_status: "approved" }) {
             returning { ${INVOICE_SEL} }
           }
           insert_approvals(objects: $rows) { affected_rows }
         }`,
        {
          ids,
          rows: ids.map((id) => ({
            invoice_id: id, approver: "you", level: 1, status: "approved",
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
      const data = await hasura(
        `mutation SetApproval($id: uuid!, $row: [approvals_insert_input!]!, $status: String!) {
           update_invoices(where: { id: { _eq: $id } }, _set: { approval_status: $status }) {
             returning { ${INVOICE_SEL} }
           }
           insert_approvals(objects: $row) { affected_rows }
         }`,
        {
          id, status: s,
          row: [{ invoice_id: id, approver: "you", level: 1, status: s, acted_at: new Date().toISOString(), }],
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
      const data = await hasura(
        `mutation Review($id: uuid!, $status: String!) {
           update_duplicate_flags(where: { invoice_id: { _eq: $id } }, _set: { reviewed_status: $status }) { affected_rows }
           invoices_by_pk(id: $id) { ${INVOICE_SEL} }
         }`,
        { id: invoiceId, status },
        { admin: true }, // duplicate_flags has no per-role update perm
      );
      return mapInvoice(data.invoices_by_pk);
    },

    async recordPayment(
      _: unknown,
      { invoiceId, paidAt, amountPaid }: { invoiceId: string; paidAt: string; amountPaid: number },
    ) {
      requireRole("finance_user", "admin");
      const data = await hasura(
        `mutation Pay($p: payments_insert_input!, $id: uuid!) {
           insert_payments_one(object: $p) { id paid_at amount_paid }
           update_invoices(where: { id: { _eq: $id } }, _set: { payment_status: "paid" }) { affected_rows }
         }`,
        { p: { invoice_id: invoiceId, paid_at: paidAt, amount_paid: amountPaid }, id: invoiceId },
        { admin: true }, // one atomic insert-payment + mark-paid; BFF-gated above
      );
      const p = data.insert_payments_one;
      return { id: p.id, paidAt: p.paid_at, amountPaid: num(p.amount_paid) };
    },

    async createInvoice(_: unknown, { input }: { input: any }) {
      requireRole("finance_user", "admin");
      const data = await hasura(
        `mutation Create($o: invoices_insert_input!) { insert_invoices_one(object: $o) { ${INVOICE_SEL} } }`,
        { o: toInsert(input) },
        { admin: true },
      );
      return mapInvoice(data.insert_invoices_one);
    },

    async importInvoices(_: unknown, { rows }: { rows: any[] }) {
      requireRole("finance_user", "admin");
      const vendorIds: Set<string> = new Set(
        (await hasura(`query { vendors { id } }`)).vendors.map((v: any) => v.id),
      );
      const errors: { row: number; message: string }[] = [];
      const valid: any[] = [];
      rows.forEach((input, i) => {
        const problem = validateInvoiceInput(input, vendorIds);
        if (problem) errors.push({ row: i + 1, message: problem });
        else valid.push(toInsert(input));
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
      paymentTermsDays: v.payment_terms_days ?? null, invoices: [],
    },
    totalInvoices: list.length,
    totalExposure: round(list.reduce((s: number, i: any) => s + grossOutstanding(i), 0)),
    avgDelayDays,
    onTimePct: paid.length ? Math.round((onTime / paid.length) * 100) : 100,
  };
}

function toInsert(input: any) {
  const o: Record<string, unknown> = {
    invoice_number: String(input.invoiceNumber),
    vendor_id: String(input.vendorId),
    invoice_date: String(input.invoiceDate),
    due_date: String(input.dueDate),
    amount: Number(input.amount),
    tax_amount: Number(input.taxAmount ?? 0),
    department: String(input.department),
    source: ["manual", "csv", "ocr"].includes(input.source) ? input.source : "manual",
  };
  if (input.purchaseOrderId) o.po_id = String(input.purchaseOrderId);
  return o;
}
