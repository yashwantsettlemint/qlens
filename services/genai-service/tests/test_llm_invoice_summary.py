"""Runnable check:  python tests/test_llm_invoice_summary.py (offline path)"""

import app.config as config
from app.llm import summarise_invoice


def run() -> None:
    assert config.OFFLINE, "test expects no AZURE_OPENAI_*/LLM_BASE_URL set"

    payable = {
        "invoice_number": "VER/2526/108",
        "direction": "payable",
        "amount": 2100000,
        "tax_amount": 240000,
        "department": "Logistics",
        "due_date": "2026-09-05",
        "vendor": {"name": "Vertex Cables and Conduits"},
        "lineItems": [],
    }
    s = summarise_invoice(payable)
    assert "Vertex Cables and Conduits" in s
    assert "billed by" in s
    assert "2,340,000" in s  # amount + tax, comma-formatted

    receivable = {
        "invoice_number": "2026-27/004",
        "direction": "receivable",
        "amount": 2343000,
        "tax_amount": 421740,
        "department": "IT",
        "due_date": "2026-06-03",
        "customer": {"name": "State Bank of India"},
        "lineItems": [],
    }
    s = summarise_invoice(receivable)
    assert "State Bank of India" in s
    assert "owed to" in s

    print("genai-service llm invoice summary (offline): all checks passed")


if __name__ == "__main__":
    run()
