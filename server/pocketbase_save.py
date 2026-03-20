"""Persist generated HTML to PocketBase via admin REST API (used by ws_app)."""
from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("dummy_ws")


def _pocketbase_base_url() -> str:
    return (
        os.environ.get("POCKETBASE_URL")
        or os.environ.get("NEXT_PUBLIC_POCKETBASE_URL")
        or ""
    ).rstrip("/")


async def save_project_html(project_id: str, html: str) -> bool:
    """
    PATCH projects record: html + status completed.
    Requires POCKETBASE_URL or NEXT_PUBLIC_POCKETBASE_URL, POCKETBASE_SUPERADMIN_EMAIL,
    POCKETBASE_SUPERADMIN_PASSWORD in the environment (same as Next.js).
    """
    base = _pocketbase_base_url()
    email = os.environ.get("POCKETBASE_SUPERADMIN_EMAIL")
    password = os.environ.get("POCKETBASE_SUPERADMIN_PASSWORD")
    if not base or not email or not password:
        logger.warning(
            "pocketbase: skip save (missing POCKETBASE_URL / admin credentials)"
        )
        return False
    if not project_id or not isinstance(html, str):
        return False

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            auth_res = await client.post(
                f"{base}/api/admins/auth-with-password",
                json={"identity": email, "password": password},
            )
            auth_res.raise_for_status()
            token = auth_res.json().get("token")
            if not token:
                logger.error("pocketbase: auth response missing token")
                return False

            patch_res = await client.patch(
                f"{base}/api/collections/projects/records/{project_id}",
                json={"html": html, "status": "completed"},
                headers={"Authorization": token},
            )
            patch_res.raise_for_status()
        logger.info("pocketbase: saved html for project_id=%s", project_id)
        return True
    except Exception:
        logger.exception("pocketbase: failed to save project_id=%s", project_id)
        return False
