# notification-service

Target of the `overdue_sweep_daily` Hasura cron trigger.

| Method | Path | Returns |
|---|---|---|
| POST | `/overdue-sweep` | `{ran_at, as_of, swept, invoice_ids, digest_subject}` |
| GET | `/health` | `{status:"ok"}` |

`/overdue-sweep`: finds `payment_status = 'unpaid' AND due_date < today`, sets them to
`overdue` (one bulk `update_invoices` as admin), builds a vendor-grouped digest, and sends
it via `Notifier`. `NOTIFY_CHANNEL` picks the channel: `log` (stdout, default), `slack`
(incoming webhook), or `email` (SMTP). Slack / email that aren't fully configured log a
warning and fall back to stdout rather than raising.

## Config

| Var | Default | For |
|---|---|---|
| `HASURA_ENDPOINT` | `http://localhost:8088/v1/graphql` | |
| `HASURA_ADMIN_SECRET` | `devsecret` | |
| `NOTIFY_CHANNEL` | `log` | `log` \| `slack` \| `email` |
| `SLACK_WEBHOOK_URL` | — | `slack` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_STARTTLS` | — / `587` / — / — / `1` | `email` |
| `EMAIL_FROM` / `EMAIL_TO` | `SMTP_USER` / — | `email` (`EMAIL_TO` comma-separated) |

## Run

```bash
python -m venv .venv && . .venv/Scripts/activate
pip install -e ../../packages/shared-types -e .
python tests/test_notify.py
uvicorn app.main:app --port 8094
curl -XPOST localhost:8094/overdue-sweep
```

In the stack: host port **8094**, container 8004.
