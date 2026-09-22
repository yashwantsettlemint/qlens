/** Thin fetch wrappers around ml-service. Same URLs/headers/error handling
 * that used to live inline in server/resolvers.ts — callers still do their
 * own mapMl*() mapping (server/mappers.ts). */
import { ML_SERVICE_URL, internalServiceHeaders } from "../hasura";

export async function getModels(companyId: string): Promise<{ duplicate: any; delay: any }> {
  const res = await fetch(`${ML_SERVICE_URL}/models?company_id=${companyId}`, {
    headers: internalServiceHeaders(),
  });
  if (!res.ok) throw new Error(`ml-service /models returned ${res.status}`);
  return res.json();
}

export async function getDrift(companyId: string): Promise<{ duplicate: any; delay: any }> {
  const res = await fetch(`${ML_SERVICE_URL}/drift?company_id=${companyId}`, {
    headers: internalServiceHeaders(),
  });
  if (!res.ok) throw new Error(`ml-service /drift returned ${res.status}`);
  return res.json();
}

export async function getRetrainHistory(companyId: string, limit: number): Promise<any[]> {
  const res = await fetch(
    `${ML_SERVICE_URL}/retrain-history?limit=${limit}&company_id=${companyId}`,
    { headers: internalServiceHeaders() },
  );
  if (!res.ok) throw new Error(`ml-service /retrain-history returned ${res.status}`);
  return res.json();
}

/** Drift-check response is keyed by company_id; unwraps to just this company's report. */
export async function checkDrift(companyId: string): Promise<{ duplicate: any; delay: any }> {
  const res = await fetch(`${ML_SERVICE_URL}/drift/check`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalServiceHeaders() },
    body: JSON.stringify({ company_id: companyId }),
  });
  if (!res.ok) throw new Error(`ml-service /drift/check returned ${res.status}`);
  return (await res.json())[companyId] ?? {};
}

export async function retrain(
  companyId: string,
  modelName: string,
): Promise<{ status?: string; version?: string; detail?: string; event_id?: string }> {
  const res = await fetch(`${ML_SERVICE_URL}/retrain`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalServiceHeaders() },
    body: JSON.stringify({ model_name: modelName, company_id: companyId }),
  });
  if (!res.ok) throw new Error(`ml-service /retrain returned ${res.status}`);
  return res.json();
}

// ---- duplicate_flags / delay_predictions — moved to ml-service's own
// private ml_db, no longer a Hasura relationship on invoices. Batched by id
// (one call per page load, not per row) — see server/predictions.ts.

export async function getDuplicateFlags(companyId: string, invoiceIds: string[]): Promise<Record<string, any>> {
  if (!invoiceIds.length) return {};
  const res = await fetch(
    `${ML_SERVICE_URL}/duplicate-flags?company_id=${companyId}&invoice_ids=${invoiceIds.join(",")}`,
    { headers: internalServiceHeaders() },
  );
  if (!res.ok) throw new Error(`ml-service /duplicate-flags returned ${res.status}`);
  return res.json();
}

export async function getDelayPredictions(companyId: string, invoiceIds: string[]): Promise<Record<string, any>> {
  if (!invoiceIds.length) return {};
  const res = await fetch(
    `${ML_SERVICE_URL}/delay-predictions?company_id=${companyId}&invoice_ids=${invoiceIds.join(",")}`,
    { headers: internalServiceHeaders() },
  );
  if (!res.ok) throw new Error(`ml-service /delay-predictions returned ${res.status}`);
  return res.json();
}

export async function reviewDuplicateFlag(companyId: string, invoiceId: string, status: string): Promise<void> {
  const res = await fetch(`${ML_SERVICE_URL}/duplicate-flags/review`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalServiceHeaders() },
    body: JSON.stringify({ invoice_id: invoiceId, company_id: companyId, status }),
  });
  if (!res.ok) throw new Error(`ml-service /duplicate-flags/review returned ${res.status}`);
}
