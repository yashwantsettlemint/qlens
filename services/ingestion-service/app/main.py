"""ingestion-service — validate CSV / manual invoices, then commit through Hasura.

  POST /upload/csv          multipart file -> per-row {row, valid, errors}, no commit
  POST /upload/csv/commit   {rows:[...]}   -> re-validate + one batched insert as finance_user
  POST /upload/manual       one invoice    -> same commit path
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .hasura import HasuraError, fetch_lookups, insert_invoices
from .validation import parse_csv, validate_row

app = FastAPI(title="ingestion-service", version="0.1.0")


class RowResult(BaseModel):
    row: int
    valid: bool
    errors: list[str] = []
    data: dict | None = None  # resolved insert object when valid


class ValidateResponse(BaseModel):
    summary: dict
    rows: list[RowResult]


class CommitRequest(BaseModel):
    rows: list[dict]  # same shape as CSV rows (vendor by name)
    created_by: str = "csv-upload"
    company_id: str


class ManualInvoice(BaseModel):
    invoice_number: str
    vendor: str
    department: str
    invoice_date: str
    due_date: str
    amount: float
    tax_amount: float = 0
    source: str = "manual"
    po_number: str | None = None
    created_by: str = "manual-entry"
    company_id: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


async def _validate(rows: list[dict], default_source: str, company_id: str) -> list[RowResult]:
    vendors, pos = await fetch_lookups(company_id)
    results: list[RowResult] = []
    for i, row in enumerate(rows, start=1):
        obj, errors = validate_row(row, vendors, pos, default_source)
        results.append(RowResult(row=i, valid=not errors, errors=errors, data=obj))
    return results


@app.post("/upload/csv", response_model=ValidateResponse)
async def upload_csv(file: UploadFile = File(...), company_id: str = Form(...)) -> ValidateResponse:
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(400, "expected a .csv file")
    try:
        rows = parse_csv(await file.read())
    except Exception as exc:  # decode / parse error -> readable message, not a stack trace
        raise HTTPException(400, f"could not parse CSV: {exc}")
    if not rows:
        raise HTTPException(400, "CSV has a header but no data rows")
    results = await _validate(rows, default_source="csv", company_id=company_id)
    valid = sum(r.valid for r in results)
    return ValidateResponse(
        summary={"total": len(results), "valid": valid, "invalid": len(results) - valid},
        rows=results,
    )


@app.post("/upload/csv/commit")
async def commit_csv(req: CommitRequest) -> dict:
    if not req.rows:
        raise HTTPException(400, "no rows to commit")
    results = await _validate(req.rows, default_source="csv", company_id=req.company_id)  # never trust the caller
    invalid = [r.model_dump() for r in results if not r.valid]
    if invalid:
        raise HTTPException(422, {"message": "some rows are invalid; nothing committed", "rows": invalid})
    try:
        res = await insert_invoices([r.data for r in results], created_by=req.created_by, company_id=req.company_id)
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura rejected the insert: {exc}")
    return {"committed": res["affected_rows"], "invoices": res["returning"]}


@app.post("/upload/manual")
async def upload_manual(inv: ManualInvoice) -> dict:
    payload = inv.model_dump()
    created_by = payload.pop("created_by")
    company_id = payload.pop("company_id")
    row = {k: ("" if v is None else str(v)) for k, v in payload.items()}
    result = (await _validate([row], default_source="manual", company_id=company_id))[0]
    if not result.valid:
        raise HTTPException(422, {"message": "invoice is invalid", "errors": result.errors})
    try:
        res = await insert_invoices([result.data], created_by=created_by, company_id=company_id)
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura rejected the insert: {exc}")
    return {"committed": res["affected_rows"], "invoice": res["returning"][0]}
