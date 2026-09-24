-- Overdue-receivable reminders (notification-service POST /customer-reminders):
-- when the last one went out and how many so far, so a customer is nagged
-- every N days until the invoice is paid, not every sweep.
ALTER TABLE invoices
  ADD COLUMN last_reminder_on date,
  ADD COLUMN reminder_count integer NOT NULL DEFAULT 0;
