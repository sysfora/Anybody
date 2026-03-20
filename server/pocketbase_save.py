"""PocketBase via official pocketbase SDK (admin + collections).

Supports both PocketBase ≤ v0.22 (POST /api/admins/auth-with-password)
and PocketBase ≥ v0.23 (POST /api/collections/_superusers/auth-with-password).
The new endpoint is tried first; old endpoint is the fallback.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx
from pocketbase import PocketBase
from pocketbase.errors import ClientResponseError

logger = logging.getLogger("dummy_ws")

COLLECTION_PROJECTS = "projects"
COLLECTION_MESSAGES = "project_messages"


def _pocketbase_base_url() -> str:
    return (
        os.environ.get("POCKETBASE_URL")
        or os.environ.get("NEXT_PUBLIC_POCKETBASE_URL")
        or ""
    ).rstrip("/")


def _connect_sync(base: str, email: str, password: str) -> PocketBase:
    """Authenticate and return a PocketBase client with a valid token.

    Tries the PocketBase v0.23+ superusers endpoint first, then falls back
    to the legacy admins endpoint for older servers.
    """
    pb = PocketBase(base)

    # PocketBase v0.23+: superusers collection endpoint
    try:
        r = httpx.post(
            f"{base}/api/collections/_superusers/auth-with-password",
            json={"identity": email, "password": password},
            timeout=30.0,
        )
        if r.status_code == 200:
            data = r.json()
            pb.auth_store.save(data["token"], data.get("record"))
            logger.info("pocketbase: authenticated via _superusers endpoint")
            return pb
        logger.debug(
            "pocketbase: _superusers endpoint returned %s, trying legacy path",
            r.status_code,
        )
    except Exception as exc:
        logger.debug("pocketbase: _superusers attempt failed (%s)", exc)

    # PocketBase ≤ v0.22: legacy admins endpoint
    pb.admins.auth_with_password(email, password)
    logger.info("pocketbase: authenticated via legacy admins endpoint")
    return pb


@asynccontextmanager
async def pocketbase_admin() -> AsyncIterator[PocketBase]:
    base = _pocketbase_base_url()
    email = os.environ.get("POCKETBASE_SUPERADMIN_EMAIL")
    password = os.environ.get("POCKETBASE_SUPERADMIN_PASSWORD")
    if not base or not email or not password:
        logger.warning(
            "pocketbase: skip (missing POCKETBASE_URL / admin credentials)"
        )
        raise RuntimeError("pocketbase not configured")

    try:
        pb = await asyncio.to_thread(_connect_sync, base, email, password)
    except ClientResponseError as e:
        logger.warning(
            "pocketbase: admin auth HTTP %s (%s). Streaming without DB.",
            e.status,
            e.url or base,
        )
        raise RuntimeError("pocketbase admin auth failed") from e
    except Exception as e:
        logger.warning(
            "pocketbase: admin auth error (%s). Streaming without DB.", e
        )
        raise RuntimeError("pocketbase admin auth failed") from e

    try:
        yield pb
    finally:
        def _close() -> None:
            try:
                pb.http_client.close()
            except Exception:
                pass

        await asyncio.to_thread(_close)


async def create_message_with_client(
    pb: PocketBase,
    project_id: str,
    role: str,
    content: str,
    *,
    request_id: str = "",
    thinking: str = "",
) -> str | None:
    body: dict[str, Any] = {
        "project": project_id,
        "role": role,
        "content": content or "",
    }
    if request_id:
        body["request_id"] = request_id
    if thinking:
        body["thinking"] = thinking

    def _create() -> str:
        rec = pb.collection(COLLECTION_MESSAGES).create(body_params=body)
        return str(rec.id)

    try:
        return await asyncio.to_thread(_create)
    except Exception:
        logger.exception(
            "pocketbase: create message failed project_id=%s", project_id
        )
    return None


async def create_project_message(
    project_id: str,
    role: str,
    content: str,
    *,
    request_id: str = "",
    thinking: str = "",
) -> str | None:
    if not project_id:
        return None
    try:
        async with pocketbase_admin() as pb:
            return await create_message_with_client(
                pb,
                project_id,
                role,
                content,
                request_id=request_id,
                thinking=thinking,
            )
    except RuntimeError:
        return None
    except Exception:
        logger.exception(
            "pocketbase: create message failed project_id=%s", project_id
        )
    return None


async def patch_project_message(
    message_id: str,
    *,
    content: str | None = None,
    thinking: str | None = None,
) -> bool:
    if not message_id:
        return False
    body: dict[str, Any] = {}
    if content is not None:
        body["content"] = content
    if thinking is not None:
        body["thinking"] = thinking
    if not body:
        return True

    def _patch(pb: PocketBase) -> None:
        pb.collection(COLLECTION_MESSAGES).update(
            message_id, body_params=body
        )

    try:
        async with pocketbase_admin() as pb:
            await asyncio.to_thread(_patch, pb)
        return True
    except Exception:
        logger.exception(
            "pocketbase: patch message failed message_id=%s", message_id
        )
    return False


async def patch_project_message_with_client(
    pb: PocketBase,
    message_id: str,
    *,
    content: str | None = None,
    thinking: str | None = None,
) -> bool:
    if not message_id:
        return False
    body: dict[str, Any] = {}
    if content is not None:
        body["content"] = content
    if thinking is not None:
        body["thinking"] = thinking
    if not body:
        return True

    def _patch() -> None:
        pb.collection(COLLECTION_MESSAGES).update(
            message_id, body_params=body
        )

    try:
        await asyncio.to_thread(_patch)
        return True
    except Exception:
        logger.exception(
            "pocketbase: patch message failed message_id=%s", message_id
        )
    return False


async def patch_project_record_with_client(
    pb: PocketBase,
    project_id: str,
    *,
    html: str | None = None,
    status: str | None = None,
) -> bool:
    if not project_id:
        return False
    body: dict[str, Any] = {}
    if html is not None:
        body["html"] = html
    if status is not None:
        body["status"] = status
    if not body:
        return True

    def _patch() -> None:
        pb.collection(COLLECTION_PROJECTS).update(
            project_id, body_params=body
        )

    try:
        await asyncio.to_thread(_patch)
        return True
    except Exception:
        logger.exception(
            "pocketbase: patch project failed project_id=%s", project_id
        )
    return False


async def save_project_html(
    project_id: str,
    html: str,
    *,
    status: str | None = "completed",
) -> bool:
    if not project_id or not isinstance(html, str):
        return False
    body: dict[str, Any] = {"html": html}
    if status is not None:
        body["status"] = status

    def _save(pb: PocketBase) -> None:
        pb.collection(COLLECTION_PROJECTS).update(
            project_id, body_params=body
        )

    try:
        async with pocketbase_admin() as pb:
            await asyncio.to_thread(_save, pb)
        logger.info("pocketbase: saved html for project_id=%s", project_id)
        return True
    except RuntimeError:
        logger.warning(
            "pocketbase: save skipped for project_id=%s (auth/url)",
            project_id,
        )
        return False
    except Exception:
        logger.exception(
            "pocketbase: failed to save project_id=%s", project_id
        )
    return False
