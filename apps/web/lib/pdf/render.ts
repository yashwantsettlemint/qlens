import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocument, type InvoiceDocumentData } from "./InvoiceDocument";

/** react-pdf resolves a non-`data:` Image src by fetching it server-side, so a
 * "logo"/"signature" URL that ever reached it would be an SSRF. Callers today pass
 * DB values already checked on write — this keeps that true for future callers. */
export function safeImageSrc(url: string | null | undefined): string | null {
  return url && url.startsWith("data:image/") && url.length <= MAX_IMAGE_CHARS ? url : null;
}

const MAX_IMAGE_CHARS = 3_000_000; // ~2MB of base64 — bounds DB rows and email attachments
const MAX_LINE_ITEMS = 200; // ponytail: flat cap, paginate properly if real invoices ever exceed it

export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  const safe: InvoiceDocumentData = {
    ...data,
    company: { ...data.company, logoDataUrl: safeImageSrc(data.company.logoDataUrl) },
    signatureDataUrl: safeImageSrc(data.signatureDataUrl),
    lineItems: data.lineItems.slice(0, MAX_LINE_ITEMS),
  };
  return renderToBuffer(InvoiceDocument(safe) as any);
}
