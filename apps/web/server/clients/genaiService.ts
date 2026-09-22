/** Thin fetch wrappers around genai-service. Same URLs/headers/error
 * handling that used to live inline in server/resolvers.ts. */
import { GENAI_URL, internalServiceHeaders } from "../hasura";

export async function summarizeInvoice(invoiceId: string, companyId: string): Promise<string> {
  const r = await fetch(`${GENAI_URL}/summarize-invoice`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalServiceHeaders() },
    body: JSON.stringify({ invoice_id: invoiceId, company_id: companyId }),
  });
  if (!r.ok) throw new Error(`genai-service /summarize-invoice returned ${r.status}`);
  const j = await r.json();
  return j.summary ?? "";
}

export async function askAssistant(
  prompt: string,
  companyId: string,
): Promise<{ answer?: string; invoice_ids?: string[] }> {
  const r = await fetch(`${GENAI_URL}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalServiceHeaders() },
    body: JSON.stringify({ question: prompt, company_id: companyId }),
  });
  return r.json();
}
