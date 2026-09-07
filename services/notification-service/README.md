# notification-service

Target of the `overdue_sweep_daily` Hasura cron trigger.

| Method | Path | Returns |
|---|---|---|
| POST | `/overdue-sweep` | `{ran_at, as_of, swept, invoice_ids, digest_subject}` |
| GET | `/health` | `{status:"ok"}` |

`/overdue-sweep`: finds `payment_status = 'unpaid' AND due_date < today`, sets them to
`overdue` (one bulk `update_invoices` as admin), builds a vendor-grouped digest, and sends
it via `Notifier`. Default channel `log` (stdout). Real channels go behind `Notifier` in
`app/notify.py` — see the `TODO`.

## Config

| Var | Default |
|---|---|
| `HASURA_ENDPOINT` | `http://localhost:8088/v1/graphql` |
| `HASURA_ADMIN_SECRET` | `devsecret` |
| `NOTIFY_CHANNEL` | `log` |

## Run

```bash
python -m venv .venv && . .venv/Scripts/activate
pip install -e ../../packages/shared-types -e .
python tests/test_notify.py
uvicorn app.main:app --port 8094
curl -XPOST localhost:8094/overdue-sweep
```

In the stack: host port **8094**, container 8004.
