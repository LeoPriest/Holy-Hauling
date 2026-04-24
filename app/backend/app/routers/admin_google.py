from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from google_auth_oauthlib.flow import Flow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.app_setting import AppSetting
from app.models.user import User

router = APIRouter(prefix="/admin/google", tags=["admin-google"])

_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


def _make_flow() -> Flow:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
    redirect_uri = os.environ.get(
        "GOOGLE_OAUTH_REDIRECT_URI",
        "http://localhost:8000/admin/google/callback",
    )
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail="Google OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
        )
    return Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        },
        scopes=_SCOPES,
        redirect_uri=redirect_uri,
    )


@router.get("/connect")
async def google_connect(
    current_user: User = Depends(require_role("admin")),
):
    """Return the Google OAuth consent URL for the admin to open."""
    flow = _make_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return {"url": auth_url}


@router.get("/callback")
async def google_callback(
    code: str,
    db: AsyncSession = Depends(get_db),
):
    """Exchange the OAuth code for a refresh token and persist it.

    Called by Google's redirect — no JWT required on this endpoint since
    the code itself is the short-lived credential from Google.
    """
    flow = _make_flow()
    flow.fetch_token(code=code)
    refresh_token = flow.credentials.refresh_token
    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="No refresh token returned. Revoke this app's access in your Google account and try again.",
        )
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == "google_refresh_token")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = refresh_token
    else:
        db.add(AppSetting(key="google_refresh_token", value=refresh_token))
    await db.commit()
    return {"connected": True, "message": "Google Calendar connected. You can close this tab."}


@router.get("/status")
async def google_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Return whether a Google refresh token is currently stored."""
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == "google_refresh_token")
    )
    row = result.scalar_one_or_none()
    return {"connected": bool(row and row.value)}
