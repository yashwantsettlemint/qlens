"""auth-service — DB-backed accounts, issues Hasura-shaped JWTs.

  POST /register         {company_name, username, email, password} -> TokenResponse (new company + admin)
  POST /login            {username, password}     -> TokenResponse
  POST /refresh          Authorization: Bearer ..  -> a fresh token (while the old one is still valid)
  GET  /me               Authorization: Bearer ..  -> decoded claims
  GET  /users            Authorization: Bearer ..  -> this admin's company's users
  POST /users            Authorization: Bearer ..  -> create a user directly, in this admin's company
  POST /invites          Authorization: Bearer ..  -> invite a teammate by email (admin only)
  POST /invites/accept   {token, username, password} -> TokenResponse (joins the inviting company)
  GET  /health

The token carries the `https://hasura.io/jwt/claims` block Hasura expects
(now including `x-hasura-company-id`); send it as `Authorization: Bearer
<token>` to Hasura (or set NEXT_PUBLIC_HASURA_JWT in the web app).
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from shared_types.jwt import decode_hasura_jwt, mint_hasura_jwt

from .email import send_invite_email
from .users import (
    User,
    accept_invite,
    authenticate,
    create_invite,
    create_user,
    list_users,
    register_company,
    set_user_active,
)

TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "3600"))

# Hasura's role literally named "admin" is a reserved super-role that bypasses
# every permission check (including company_id filtering) regardless of what
# permissions are or aren't configured for it — so the app's own "admin"
# business role must never be minted as Hasura role "admin", or every admin
# account (which is exactly what every company's registration creates) would
# see every other company's data. "company_admin" is a normal, permissioned
# Hasura role (see hasura/metadata) scoped by company_id like any other.
_HASURA_ROLE = {"admin": "company_admin"}

app = FastAPI(title="auth-service", version="0.2.0")
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


class RegisterRequest(BaseModel):
    company_name: str
    username: str
    email: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str
    email: str = ""


class SetActiveRequest(BaseModel):
    active: bool


class InviteRequest(BaseModel):
    email: str
    role: str


class AcceptInviteRequest(BaseModel):
    token: str
    username: str
    password: str


class UserResponse(BaseModel):
    username: str
    role: str
    email: str = ""


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    role: str


class InviteResponse(BaseModel):
    email: str
    role: str
    invite_link: str


def _mint(user: User) -> TokenResponse:
    hasura_role = _HASURA_ROLE.get(user.role, user.role)
    token = mint_hasura_jwt(
        hasura_role,
        user.username,
        ttl_seconds=TTL_SECONDS,
        extra_claims={"app_role": user.role},
        extra_hasura_claims={"x-hasura-company-id": user.company_id},
    )
    return TokenResponse(access_token=token, expires_in=TTL_SECONDS, role=user.role)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest) -> TokenResponse:
    try:
        _company, user = register_company(req.company_name, req.username, req.password, req.email)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _mint(user)


@app.post("/login", response_model=TokenResponse)
def login(req: LoginRequest) -> TokenResponse:
    user = authenticate(req.username, req.password)
    if user is None:
        raise HTTPException(401, "invalid username or password")
    return _mint(user)


@app.get("/users")
def users(authorization: str = Header(default="")) -> dict:
    company_id = _require_admin(authorization)
    return {"users": list_users(company_id)}


@app.post("/users", response_model=UserResponse)
def create_user_route(req: CreateUserRequest, authorization: str = Header(default="")) -> UserResponse:
    company_id = _require_admin(authorization)
    try:
        user = create_user(company_id, req.username, req.password, req.role, req.email)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return UserResponse(username=user.username, role=user.role, email=user.email)


@app.patch("/users/{username}")
def set_user_active_route(username: str, req: SetActiveRequest, authorization: str = Header(default="")) -> dict:
    company_id = _require_admin(authorization)
    claims = _claims_from(authorization)
    caller_username = claims.get("https://hasura.io/jwt/claims", {}).get("x-hasura-user-id", "")
    if not req.active and username == caller_username:
        raise HTTPException(400, "You can't deactivate your own account")
    try:
        return set_user_active(company_id, username, req.active)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/invites", response_model=InviteResponse)
def create_invite_route(req: InviteRequest, authorization: str = Header(default="")) -> InviteResponse:
    company_id = _require_admin(authorization)
    claims = _claims_from(authorization)
    invited_by_username = claims.get(
        "https://hasura.io/jwt/claims", {}
    ).get("x-hasura-user-id", "")
    try:
        invite = create_invite(company_id, invited_by_username, req.email, req.role)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    link = send_invite_email(invite.email, invite.token, company_name=invite.company_name)
    return InviteResponse(email=invite.email, role=invite.role, invite_link=link)


@app.post("/invites/accept", response_model=TokenResponse)
def accept_invite_route(req: AcceptInviteRequest) -> TokenResponse:
    try:
        user = accept_invite(req.token, req.username, req.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _mint(user)


@app.get("/me")
def me(authorization: str = Header(default="")) -> dict:
    return _claims_from(authorization)


@app.post("/refresh", response_model=TokenResponse)
def refresh(authorization: str = Header(default="")) -> TokenResponse:
    """Re-issue a token while the current one is still valid. Once it has
    expired the client must log in again (no offline grace — keep it simple)."""
    claims = _claims_from(authorization)
    ns = claims.get("https://hasura.io/jwt/claims", {})
    hasura_role = ns.get("x-hasura-default-role", "")
    app_role = claims.get("app_role", hasura_role)  # older tokens predating app_role
    user_id = ns.get("x-hasura-user-id") or claims.get("sub", "")
    company_id = ns.get("x-hasura-company-id", "")
    if not (hasura_role and user_id and company_id):
        raise HTTPException(401, "token missing hasura claims")
    token = mint_hasura_jwt(
        hasura_role,
        user_id,
        ttl_seconds=TTL_SECONDS,
        extra_claims={"app_role": app_role},
        extra_hasura_claims={"x-hasura-company-id": company_id},
    )
    return TokenResponse(access_token=token, expires_in=TTL_SECONDS, role=app_role)


def _claims_from(authorization: str) -> dict:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing Bearer token")
    try:
        return decode_hasura_jwt(authorization.split(" ", 1)[1])
    except Exception as exc:  # expired / bad signature -> 401, not 500
        raise HTTPException(401, f"invalid token: {exc}")


def _require_admin(authorization: str) -> str:
    """Returns the caller's company_id if they're an admin, else 403s."""
    claims = _claims_from(authorization)
    if claims.get("app_role") != "admin":
        raise HTTPException(403, "admin role required")
    ns = claims.get("https://hasura.io/jwt/claims", {})
    company_id = ns.get("x-hasura-company-id")
    if not company_id:
        raise HTTPException(401, "token missing company")
    return company_id
