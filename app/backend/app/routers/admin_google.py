from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from google_auth_oauthlib.flow import Flow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_for_create, require_active_city, require_role
from app.models.app_setting import AppSetting
from app.models.user import User

router = APIRouter(prefix="/admin/google", tags=["admin-google"])
_log = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
_STATE_KEY = "google_oauth_state"
_CODE_VERIFIER_KEY = "google_oauth_code_verifier"
_REFRESH_TOKEN_KEY = "google_refresh_token"


def _missing_oauth_env_vars() -> list[str]:
    missing: list[str] = []
    if not os.environ.get("GOOGLE_OAUTH_CLIENT_ID"):
        missing.append("GOOGLE_OAUTH_CLIENT_ID")
    if not os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET"):
        missing.append("GOOGLE_OAUTH_CLIENT_SECRET")
    return missing


def _missing_oauth_detail(missing: list[str]) -> str:
    names = ", ".join(missing)
    return (
        f"Google OAuth is not configured. Add {names} to app/backend/.env "
        "and restart the backend."
    )


def _invalid_oauth_detail() -> str | None:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()

    problems: list[str] = []
    if client_id and ".apps.googleusercontent.com" not in client_id:
        problems.append(
            "GOOGLE_OAUTH_CLIENT_ID must be the Google OAuth client ID and should end in .apps.googleusercontent.com."
        )
    if client_secret and ".apps.googleusercontent.com" in client_secret:
        problems.append(
            "GOOGLE_OAUTH_CLIENT_SECRET looks like a Google client ID, not a client secret."
        )

    if not problems:
        return None

    return (
        "Google OAuth config looks invalid. "
        + " ".join(problems)
        + " Update app/backend/.env and restart the backend."
    )


def _redirect_uri(request: Request | None = None) -> str:
    configured = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "").strip()
    if configured:
        return configured

    if request is not None:
        return str(request.url_for("google_callback"))

    app_host = os.environ.get("APP_HOST", "localhost").strip() or "localhost"
    app_port = os.environ.get("APP_PORT", "8000").strip() or "8000"
    return f"http://{app_host}:{app_port}/admin/google/callback"


def google_oauth_config_status() -> dict[str, object]:
    missing = _missing_oauth_env_vars()
    if missing:
        return {
            "configured": False,
            "missing": missing,
            "detail": _missing_oauth_detail(missing),
        }

    invalid_detail = _invalid_oauth_detail()
    if invalid_detail:
        return {
            "configured": False,
            "missing": [],
            "detail": invalid_detail,
        }

    return {
        "configured": True,
        "missing": [],
        "detail": None,
    }


def _make_flow(request: Request | None = None) -> Flow:
    status = google_oauth_config_status()
    if not bool(status["configured"]):
        raise HTTPException(status_code=503, detail=str(status["detail"]))

    redirect_uri = _redirect_uri(request)
    return Flow.from_client_config(
        {
            "web": {
                "client_id": os.environ["GOOGLE_OAUTH_CLIENT_ID"],
                "client_secret": os.environ["GOOGLE_OAUTH_CLIENT_SECRET"],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        },
        scopes=_SCOPES,
        redirect_uri=redirect_uri,
    )


def _callback_error_response(exc: Exception, redirect_uri: str) -> tuple[int, str]:
    message = str(exc).strip()
    lowered = message.lower()

    if "missing code verifier" in lowered:
        return (
            400,
            "Google rejected the OAuth PKCE verifier. "
            "Try connecting again. If it keeps happening, restart the backend and retry the Google connection flow.",
        )
    if "redirect_uri_mismatch" in lowered:
        return (
            400,
            "Google rejected the callback redirect URI. "
            f"Make sure GOOGLE_OAUTH_REDIRECT_URI exactly matches an authorized Google redirect URI: {redirect_uri}",
        )
    if "invalid_client" in lowered:
        return (
            400,
            "Google rejected the OAuth client credentials. "
            "Verify GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in app/backend/.env.",
        )
    if "invalid_grant" in lowered:
        return (
            400,
            "Google rejected the authorization code. Try connecting again. "
            f"If it keeps failing, verify GOOGLE_OAUTH_REDIRECT_URI is exactly {redirect_uri}.",
        )
    if "org_internal" in lowered or "access_denied" in lowered or "unauthorized_client" in lowered:
        return (
            400,
            "Google denied access for this account. "
            "Set the OAuth consent screen to External and add the Gmail account as a test user.",
        )

    detail = (
        "Google token exchange failed. "
        f"{message or exc.__class__.__name__}. "
        f"Verify GOOGLE_OAUTH_REDIRECT_URI is exactly {redirect_uri} and that the OAuth client secret is correct."
    )
    return 502, detail


@router.get("/connect")
async def google_connect(
    request: Request,
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Return the Google OAuth consent URL for the admin to open."""
    resolved_city_id = city_for_create(current_user, city_id)
    await require_active_city(db, resolved_city_id)
    flow = _make_flow(request)
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    result = await db.execute(
        select(AppSetting).where(AppSetting.key.in_([_STATE_KEY, _CODE_VERIFIER_KEY]))
        .where(AppSetting.city_id == resolved_city_id)
    )
    existing = {row.key: row for row in result.scalars().all()}
    state_row = existing.get(_STATE_KEY)
    if state_row:
        state_row.value = state
    else:
        db.add(AppSetting(key=_STATE_KEY, city_id=resolved_city_id, value=state))

    if flow.code_verifier:
        verifier_row = existing.get(_CODE_VERIFIER_KEY)
        if verifier_row:
            verifier_row.value = flow.code_verifier
        else:
            db.add(AppSetting(key=_CODE_VERIFIER_KEY, city_id=resolved_city_id, value=flow.code_verifier))
    await db.commit()
    return {"url": auth_url}


@router.get("/callback")
async def google_callback(
    request: Request,
    code: str,
    state: str = "",
    db: AsyncSession = Depends(get_db),
):
    """Exchange the OAuth code for a refresh token and persist it.

    Called by Google's redirect - no JWT on this endpoint (it's an open redirect
    target), but the state parameter is verified against a DB-stored value set
    during /connect to prevent CSRF.
    """
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _STATE_KEY, AppSetting.value == state)
    )
    state_row = result.scalar_one_or_none()
    code_verifier_row = None
    if state_row:
        verifier_result = await db.execute(
            select(AppSetting).where(
                AppSetting.key == _CODE_VERIFIER_KEY,
                AppSetting.city_id == state_row.city_id,
            )
        )
        code_verifier_row = verifier_result.scalar_one_or_none()
    if not state_row or state_row.value != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state - please try connecting again.")

    flow = _make_flow(request)
    flow.code_verifier = code_verifier_row.value if code_verifier_row and code_verifier_row.value else None
    redirect_uri = _redirect_uri(request)
    try:
        flow.fetch_token(code=code)
    except Exception as exc:
        _log.exception("Google OAuth token exchange failed for redirect_uri=%s", redirect_uri)
        status_code, detail = _callback_error_response(exc, redirect_uri)
        raise HTTPException(status_code=status_code, detail=detail) from exc

    refresh_token = flow.credentials.refresh_token
    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="No refresh token returned. Revoke this app's access in your Google account and try again.",
        )
    await db.delete(state_row)
    if code_verifier_row:
        await db.delete(code_verifier_row)
    await db.commit()
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _REFRESH_TOKEN_KEY, AppSetting.city_id == state_row.city_id)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = refresh_token
    else:
        db.add(AppSetting(key=_REFRESH_TOKEN_KEY, city_id=state_row.city_id, value=refresh_token))
    await db.commit()
    return {"connected": True, "message": "Google Calendar connected. You can close this tab."}


@router.get("/status")
async def google_status(
    request: Request,
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Return Google OAuth configuration and connection status."""
    status = google_oauth_config_status()
    resolved_city_id = city_for_create(current_user, city_id)
    await require_active_city(db, resolved_city_id)
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _REFRESH_TOKEN_KEY, AppSetting.city_id == resolved_city_id)
    )
    row = result.scalar_one_or_none()
    connected = bool(status["configured"] and row and row.value)
    return {
        "configured": bool(status["configured"]),
        "connected": connected,
        "missing": list(status["missing"]),
        "detail": status["detail"],
        "redirect_uri": _redirect_uri(request),
    }
