# auth-service

**Mock** login for local dev. Issues Hasura-shaped HS256 JWTs signed with
`HASURA_GRAPHQL_JWT_SECRET` (the same value Hasura verifies against). No real
identity provider — replace for anything beyond local.

| Method | Path | Body / header | Returns |
|---|---|---|---|
| POST | `/login` | `{username, password}` | `{access_token, token_type, expires_in, role}` |
| GET | `/me` | `Authorization: Bearer <token>` | decoded claims |
| GET | `/health` | — | `{status:"ok"}` |

Token claims include:
```json
"https://hasura.io/jwt/claims": {
  "x-hasura-default-role": "<role>",
  "x-hasura-allowed-roles": ["<role>"],
  "x-hasura-user-id": "<username>"
}
```

Dev users (override with `AUTH_USERS` JSON): `kavya/kavya` (finance_user),
`priya.nair/priya` & `rahul.menon/rahul` (approver), `anjali.rao/anjali` (admin),
`genai-bot/genai` (genai_readonly).

## Config

| Var | Default |
|---|---|
| `HASURA_GRAPHQL_JWT_SECRET` | (required) `{"type":"HS256","key":"..."}` |
| `AUTH_TOKEN_TTL_SECONDS` | `3600` |
| `AUTH_USERS` | built-in dev list |

## Run

```bash
python -m venv .venv && . .venv/Scripts/activate
pip install -e ../../packages/shared-types -e .
python tests/test_auth.py
uvicorn app.main:app --port 8095
# then:  curl -s localhost:8095/login -d '{"username":"kavya","password":"kavya"}' -H 'content-type: application/json'
```

In the stack: host port **8095**, container 8005.
