"""auth-service — mock login that issues Hasura-shaped JWTs.

  POST /login   {username, password}      -> {access_token, token_type, expires_in, role}
  GET  /me      Authorization: Bearer ..  -> decoded claims
  GET  /health

The token carries the `https://hasura.io/jwt/claims` block Hasura expects; send
it as `Authorization: Bearer <token>` to Hasura (or set NEXT_PUBLIC_HASURA_JWT
in the web app).
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from shared_types.jwt import decode_hasura_jwt, mint_hasura_jwt

from .users import authenticate

TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "3600"))

app = FastAPI(title="auth-service", version="0.1.0")
# Called from the browser (login page). No cookies are used, so wildcard is fine for dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("AUTH_CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    role: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/login", response_model=TokenResponse)
def login(req: LoginRequest) -> TokenResponse:
    user = authenticate(req.username, req.password)
    if user is None:
        raise HTTPException(401, "invalid username or password")
    token = mint_hasura_jwt(user.role, user.username, ttl_seconds=TTL_SECONDS)
    return TokenResponse(access_token=token, expires_in=TTL_SECONDS, role=user.role)


@app.get("/me")
def me(authorization: str = Header(default="")) -> dict:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing Bearer token")
    try:
        return decode_hasura_jwt(authorization.split(" ", 1)[1])
    except Exception as exc:  # expired / bad signature -> 401, not 500
        raise HTTPException(401, f"invalid token: {exc}")
