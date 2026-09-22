"""Drift detection for both ML models.

Two independent signals, both compared against what was recorded at
training time (see ml/train.py / ml/train_duplicates.py `_baseline_stats` +
`metrics`, stored in the model pickle):

  * **Feature drift** (delay model only) — Population Stability Index
    between the training-time feature histograms and a sample of recently
    created invoices. Cheap: just the invoice row itself, no per-party
    history fetch. `vendor_ontime_rate` is excluded (see `_delay_feature_rows`).
  * **Performance drift** (both models) — re-scores the model against real
    recent outcomes (paid invoices for delay, human-reviewed duplicate_flags
    for duplicates) using the exact same `--from-hasura` loaders training
    already has, and diffs ROC-AUC/accuracy against the metrics recorded at
    training time.

No new dependency — PSI is plain numpy; the Hasura loaders are reused as-is.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import numpy as np

from . import db, hasura
from .config import PERFORMANCE_DROP_THRESHOLD, PSI_THRESHOLD
from .duplicates import _load_model as _load_duplicate_model
from .delay import _load_model as _load_delay_model
from .features import FEATURE_NAMES, assemble_features

# vendor_ontime_rate needs a per-party history fetch we don't do in a batch
# feature-drift scan; the batch sample below uses the same 0.7 unknown-party
# prior for every row, which would make PSI meaningless for this one feature.
_FEATURE_DRIFT_NAMES = [n for n in FEATURE_NAMES if n != "vendor_ontime_rate"]


def _psi(bin_edges: list[float], bin_freqs: list[float], recent_values: list[float]) -> float:
    """Population Stability Index between the training histogram
    (`bin_edges`/`bin_freqs`) and `recent_values`, binned onto the same edges."""
    if not recent_values:
        return 0.0
    edges = np.array(bin_edges, dtype=float)
    counts, _ = np.histogram(recent_values, bins=edges)
    actual = counts / max(1, len(recent_values))
    expected = np.array(bin_freqs, dtype=float)
    eps = 1e-4
    actual = np.clip(actual, eps, None)
    expected = np.clip(expected, eps, None)
    return round(float(np.sum((actual - expected) * np.log(actual / expected))), 4)


async def _delay_feature_rows(company_id: str) -> dict[str, list[float]]:
    rows = await hasura.fetch_recent_invoices(company_id, limit=500)
    cols: dict[str, list[float]] = {name: [] for name in FEATURE_NAMES}
    for inv in rows:
        inv_date = date.fromisoformat(str(inv["invoice_date"])[:10])
        approvals = ((inv.get("approvals_aggregate") or {}).get("aggregate") or {}).get("count") or 0
        feats = assemble_features(
            vendor_ontime_rate=0.7,
            amount=float(inv["amount"]),
            department=str(inv.get("department") or ""),
            approval_chain_length=int(approvals),
            invoice_day_of_month=inv_date.day,
            tax_amount=float(inv.get("tax_amount") or 0),
            po_matched=bool(inv.get("po_id")),
            is_receivable=str(inv.get("direction") or "payable") == "receivable",
        )
        for name in FEATURE_NAMES:
            cols[name].append(feats[name])
    return cols


async def _delay_feature_drift(baseline_stats: dict, company_id: str) -> dict[str, float]:
    if not baseline_stats:
        return {}
    cols = await _delay_feature_rows(company_id)
    return {
        name: _psi(baseline_stats[name]["bin_edges"], baseline_stats[name]["bin_freqs"], cols[name])
        for name in _FEATURE_DRIFT_NAMES
        if name in baseline_stats
    }


async def _delay_performance(company_id: str) -> dict:
    from sklearn.metrics import accuracy_score, roc_auc_score

    from ml.train import _load_from_hasura, _rows_to_matrix

    try:
        df = await _load_from_hasura(company_id)
    except SystemExit as exc:
        return {"status": "insufficient_data", "detail": str(exc)}
    x = _rows_to_matrix(df)
    model = _load_delay_model(company_id)
    proba = model["clf"].predict_proba(x)[:, 1]
    pred = (proba >= 0.5).astype(int)
    y_cls = df["paid_late"].to_numpy(dtype=int)
    auc = float(roc_auc_score(y_cls, proba)) if len(set(y_cls)) > 1 else None
    accuracy = float(accuracy_score(y_cls, pred))
    return {"status": "ok", "roc_auc": auc, "accuracy": round(accuracy, 4), "n_rows": len(df)}


async def _duplicate_performance(company_id: str) -> dict:
    from sklearn.metrics import accuracy_score, roc_auc_score

    from ml.train_duplicates import _load_from_hasura, _matrix

    try:
        df = await _load_from_hasura(company_id)
    except SystemExit as exc:
        return {"status": "insufficient_data", "detail": str(exc)}
    x = _matrix(df)
    model = _load_duplicate_model(company_id)
    proba = model["clf"].predict_proba(x)[:, 1]
    threshold = float(model.get("threshold", 0.5))
    pred = (proba >= threshold).astype(int)
    y = df["is_duplicate"].to_numpy(dtype=int)
    auc = float(roc_auc_score(y, proba)) if len(set(y)) > 1 else None
    accuracy = float(accuracy_score(y, pred))
    return {"status": "ok", "roc_auc": auc, "accuracy": round(accuracy, 4), "n_rows": len(df)}


def _performance_drift_detected(rolling: dict, baseline_metrics: dict) -> tuple[bool, list[str]]:
    if rolling.get("status") != "ok":
        return False, []
    notes = []
    detected = False
    for key in ("roc_auc", "accuracy"):
        live, base = rolling.get(key), baseline_metrics.get(key)
        if live is None or base is None:
            continue
        drop = base - live
        if drop > PERFORMANCE_DROP_THRESHOLD:
            detected = True
            notes.append(f"{key} dropped {drop:.3f} ({base:.3f} -> {live:.3f})")
    return detected, notes


async def check_drift(model_name: str, company_id: str) -> dict:
    """Runs both drift checks for one model ("delay" | "duplicate") and
    returns a report matching the ml_drift_reports row shape (not yet
    persisted — see check_all_drift)."""
    if model_name == "delay":
        model = _load_delay_model(company_id)
        baseline_stats = model.get("baseline_stats") or {}
        feature_psi = await _delay_feature_drift(baseline_stats, company_id)
        rolling = await _delay_performance(company_id)
    elif model_name == "duplicate":
        model = _load_duplicate_model(company_id)
        feature_psi = {}  # pairwise features aren't meaningful to drift-check in batch
        rolling = await _duplicate_performance(company_id)
    else:
        raise ValueError(f"unknown model_name {model_name!r}")

    baseline_metrics = model.get("metrics") or {}
    perf_drift, perf_notes = _performance_drift_detected(rolling, baseline_metrics)
    feature_drift_names = [name for name, psi in feature_psi.items() if psi > PSI_THRESHOLD]
    drift_detected = perf_drift or bool(feature_drift_names)

    notes = list(perf_notes)
    if feature_drift_names:
        notes.append(f"feature drift on: {', '.join(feature_drift_names)}")
    if rolling.get("status") == "insufficient_data":
        notes.append(f"performance drift skipped: {rolling.get('detail')}")

    return {
        "model_name": model_name,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "drift_detected": drift_detected,
        "feature_psi": feature_psi,
        "rolling_metrics": rolling,
        "baseline_metrics": baseline_metrics,
        "notes": "; ".join(notes) if notes else None,
    }


async def check_all_drift(auto_retrain: bool, company_id: str) -> dict:
    """Checks both of this company's models, persists a report row for each,
    and — when `auto_retrain` — kicks off a retrain for any model found
    drifted."""
    from . import retrain as retrain_module  # local import: avoids importing
    # ml/* (xgboost training deps) unless a check actually runs

    reports = {}
    for model_name in ("duplicate", "delay"):
        report = await check_drift(model_name, company_id)
        await db.insert_drift_report(report, company_id)
        reports[model_name] = report
        if auto_retrain and report["drift_detected"]:
            reports[model_name]["retrain"] = await retrain_module.retrain_model(
                model_name, "drift", company_id
            )
    return reports
