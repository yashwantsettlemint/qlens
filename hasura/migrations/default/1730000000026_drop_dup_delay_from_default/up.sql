-- duplicate_flags/delay_predictions moved to ml-service's own ml_db (see
-- infra/postgres-init and services/ml-service/app/db.py). This was the
-- riskiest move in the split — they used to be a Hasura relationship joined
-- straight into the invoice list/detail query; the web app now fetches them
-- in a separate batch call and stitches them onto the invoice rows
-- (apps/web/server/predictions.ts). Data must be copied over and row counts
-- verified before this runs — see the up-migration note in
-- 1730000000025 for the same pattern (embeddings, ml ops).
DROP TABLE IF EXISTS duplicate_flags;
DROP TABLE IF EXISTS delay_predictions;
