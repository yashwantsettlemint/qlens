"""Runnable check:  python tests/test_hasura_writes.py

Guards against explanation being json.dumps()'d before going into a jsonb
column — that double-encodes it into a jsonb *string* instead of an array,
which breaks every reader expecting a list (e.g. GraphQL clients get
"Expected Iterable" on DelayPrediction.explanation / DuplicateFlag.explanation).

duplicate_flags/delay_predictions write via direct psycopg now (app.db,
ml-service's own private ml_db), not a Hasura mutation — see app/db.py's
module docstring. This fakes psycopg's connection/cursor instead of _gql.
"""

import asyncio
from types import SimpleNamespace

import app.db as db
from psycopg.types.json import Jsonb


class _FakeCursor:
    def __init__(self, captured: list) -> None:
        self._captured = captured

    async def __aenter__(self) -> "_FakeCursor":
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def execute(self, query: str, params=None) -> None:
        self._captured.append((query, params))


class _FakeConn:
    def __init__(self, captured: list) -> None:
        self._captured = captured

    async def __aenter__(self) -> "_FakeConn":
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self._captured)


def run() -> None:
    captured: list = []

    async def fake_get_conn():
        return _FakeConn(captured)

    orig = db.get_conn
    db.get_conn = fake_get_conn
    try:
        match = SimpleNamespace(
            matched_invoice_id="inv-2",
            confidence_score=0.9,
            method="model",
            reason="close match",
            explanation=[{"feature": "amount_rel_gap", "contribution": 0.5}],
        )
        asyncio.run(db.write_duplicate_flag("inv-1", "company-1", match))
        # captured[0] is the DELETE, captured[1] is the INSERT — explanation is the 6th param
        insert_params = captured[-1][1]
        explanation_param = insert_params[5]
        assert isinstance(explanation_param, Jsonb), explanation_param
        assert isinstance(explanation_param.obj, list), explanation_param.obj
        assert explanation_param.obj == match.explanation

        captured.clear()
        prediction = {
            "delay_probability": 0.7,
            "predicted_delay_days": 5,
            "model_version": "xgb-test",
            "explanation": [{"feature": "vendor_ontime_rate", "contribution": -0.6}],
        }
        asyncio.run(db.write_delay_prediction("inv-1", "company-1", prediction))
        insert_params = captured[-1][1]
        explanation_param = insert_params[4]
        assert isinstance(explanation_param, Jsonb), explanation_param
        assert isinstance(explanation_param.obj, list), explanation_param.obj
        assert explanation_param.obj == prediction["explanation"]

        # missing explanation -> [] (a list), never json.dumps("[]") or None
        captured.clear()
        asyncio.run(db.write_delay_prediction("inv-1", "company-1", {**prediction, "explanation": None}))
        insert_params = captured[-1][1]
        explanation_param = insert_params[4]
        assert explanation_param.obj == [], explanation_param.obj
    finally:
        db.get_conn = orig

    print("ml-service hasura writes: all checks passed")


if __name__ == "__main__":
    run()
