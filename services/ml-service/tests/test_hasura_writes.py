"""Runnable check:  python tests/test_hasura_writes.py

Guards against explanation being json.dumps()'d before going into a jsonb
GraphQL variable — that double-encodes it into a jsonb *string* instead of an
array, which breaks every reader expecting a list (e.g. GraphQL clients get
"Expected Iterable" on DelayPrediction.explanation / DuplicateFlag.explanation).
"""

import asyncio
from types import SimpleNamespace

import app.hasura as hasura


def run() -> None:
    captured = {}

    async def fake_gql(query, variables):
        captured["variables"] = variables
        return {}

    orig = hasura._gql
    hasura._gql = fake_gql
    try:
        match = SimpleNamespace(
            matched_invoice_id="inv-2",
            confidence_score=0.9,
            method="model",
            reason="close match",
            explanation=[{"feature": "amount_rel_gap", "contribution": 0.5}],
        )
        asyncio.run(hasura.write_duplicate_flag("inv-1", match))
        obj = captured["variables"]["obj"][0]
        assert isinstance(obj["explanation"], list), obj["explanation"]
        assert obj["explanation"] == match.explanation

        prediction = {
            "delay_probability": 0.7,
            "predicted_delay_days": 5,
            "model_version": "xgb-test",
            "explanation": [{"feature": "vendor_ontime_rate", "contribution": -0.6}],
        }
        asyncio.run(hasura.write_delay_prediction("inv-1", prediction))
        obj = captured["variables"]["obj"]
        assert isinstance(obj["explanation"], list), obj["explanation"]
        assert obj["explanation"] == prediction["explanation"]

        # missing explanation -> [] (a list), never json.dumps("[]") or None
        asyncio.run(hasura.write_delay_prediction("inv-1", {**prediction, "explanation": None}))
        obj = captured["variables"]["obj"]
        assert obj["explanation"] == [], obj["explanation"]
    finally:
        hasura._gql = orig

    print("ml-service hasura writes: all checks passed")


if __name__ == "__main__":
    run()
