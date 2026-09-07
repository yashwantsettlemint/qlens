"""Enums and constants shared across the invoice-tracker Python services.

Values match the Postgres schema (hasura/migrations) exactly — these strings go
straight into GraphQL mutations, so keep them in sync with the migration.
"""

from __future__ import annotations

from enum import Enum

__all__ = [
    "ApprovalStatus",
    "PaymentStatus",
    "InvoiceSource",
    "DuplicateMethod",
    "ReviewedStatus",
    "POStatus",
    "HasuraRole",
    "DEPARTMENTS",
    "DUPLICATE_AMOUNT_TOLERANCE",
    "DUPLICATE_DAY_WINDOW",
    "DUPLICATE_FUZZY_THRESHOLD",
]


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class PaymentStatus(str, Enum):
    UNPAID = "unpaid"
    PAID = "paid"
    OVERDUE = "overdue"


class InvoiceSource(str, Enum):
    MANUAL = "manual"
    CSV = "csv"
    OCR = "ocr"


class DuplicateMethod(str, Enum):
    RULE_BASED = "rule_based"
    ML = "ml"


class ReviewedStatus(str, Enum):
    UNREVIEWED = "unreviewed"
    CONFIRMED_DUPLICATE = "confirmed_duplicate"
    FALSE_POSITIVE = "false_positive"


class POStatus(str, Enum):
    OPEN = "open"
    PARTIAL = "partial"
    CLOSED = "closed"


class HasuraRole(str, Enum):
    FINANCE_USER = "finance_user"
    APPROVER = "approver"
    ADMIN = "admin"
    GENAI_READONLY = "genai_readonly"


DEPARTMENTS: list[str] = [
    "Procurement",
    "IT",
    "Facilities",
    "Marketing",
    "Logistics",
    "HR",
]

# Rule-based duplicate-detection tuning (ml-service). Kept here so ingestion and
# ml agree on what "obviously duplicate" means.
DUPLICATE_AMOUNT_TOLERANCE = 0.01  # 1%
DUPLICATE_DAY_WINDOW = 30  # invoice_date proximity
DUPLICATE_FUZZY_THRESHOLD = 85  # rapidfuzz score 0-100 on invoice_number
