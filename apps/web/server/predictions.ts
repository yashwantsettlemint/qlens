/**
 * Attaches duplicateFlag/delayPrediction onto already-mapped invoice rows.
 * These used to be a Hasura relationship joined into the same query as the
 * invoice row (server/mappers.ts's old INVOICE_SEL) — duplicate_flags/
 * delay_predictions moved to ml-service's own private ml_db, so this is now
 * a second, batched call (one per page of invoices, by id — never per row)
 * plus a small follow-up Hasura lookup for any matched invoice's summary
 * fields, mirroring the shape the old relationship selected.
 */
import { hasura } from "./hasura";
import * as mlService from "./clients/mlService";
import { mapDuplicateFlag, mapDelayPrediction, MATCHED_INVOICE_SEL } from "./mappers";

export async function attachPredictions<T extends { id: string }>(rows: T[], companyId: string): Promise<T[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [dupFlags, delays] = await Promise.all([
    mlService.getDuplicateFlags(companyId, ids),
    mlService.getDelayPredictions(companyId, ids),
  ]);

  const matchedIds = Array.from(
    new Set(Object.values(dupFlags).map((f: any) => f.matched_invoice_id).filter(Boolean)),
  );
  let matchedById: Record<string, any> = {};
  if (matchedIds.length) {
    const data = await hasura(
      `query MatchedInvoices($ids: [uuid!]!) { invoices(where: { id: { _in: $ids } }) { ${MATCHED_INVOICE_SEL} } }`,
      { ids: matchedIds },
    );
    matchedById = Object.fromEntries(data.invoices.map((inv: any) => [inv.id, inv]));
  }

  return rows.map((row) => ({
    ...row,
    duplicateFlag: mapDuplicateFlag(dupFlags[row.id], matchedById[dupFlags[row.id]?.matched_invoice_id]),
    delayPrediction: mapDelayPrediction(delays[row.id]),
  }));
}
