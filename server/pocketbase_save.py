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


def _is_size_validation_error(exc: Exception) -> bool:
    """Return True when the PocketBase error is a field-size constraint failure."""
    try:
        from pocketbase.errors import ClientResponseError

        if isinstance(exc, ClientResponseError):
            data = getattr(exc, "data", {}) or {}
            fields = data.get("data", {})
            return any(
                (v or {}).get("code") == "validation_max_text_constraint"
                for v in fields.values()
            )
    except Exception:
        pass
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

    def _patch(b: dict) -> None:
        pb.collection(COLLECTION_PROJECTS).update(project_id, body_params=b)

    try:
        await asyncio.to_thread(_patch, body)
        return True
    except Exception as exc:
        # If the html field exceeds the PocketBase field-size limit, retry
        # saving only the status so the project never stays stuck in
        # "generating".  Raise the field limit in PocketBase admin to fix
        # properly (Collections → projects → html → Max length).
        if _is_size_validation_error(exc) and "html" in body and status is not None:
            logger.warning(
                "pocketbase: html too large for projects.html field "
                "(%d chars) — saving status only for project_id=%s. "
                "Increase the field's Max length in PocketBase admin.",
                len(html or ""),
                project_id,
            )
            try:
                await asyncio.to_thread(_patch, {"status": status})
                return True
            except Exception:
                logger.exception(
                    "pocketbase: status-only patch also failed project_id=%s",
                    project_id,
                )
        else:
            logger.exception(
                "pocketbase: patch project failed project_id=%s", project_id
            )
    return False


async def fetch_project_html(pb: PocketBase, project_id: str) -> str:
    """Return the current ``html`` field value for a project, or empty string."""
    if not project_id:
        return ""

    def _fetch() -> str:
        record = pb.collection(COLLECTION_PROJECTS).get_one(project_id)
        return str(getattr(record, "html", "") or "")

    try:
        return await asyncio.to_thread(_fetch)
    except Exception:
        logger.exception("pocketbase: fetch html failed project_id=%s", project_id)
    return ""


async def fetch_project_history(
    pb: PocketBase,
    project_id: str,
    *,
    max_messages: int = 20,
) -> list[dict]:
    """Return the last ``max_messages`` messages for a project as OpenAI-style
    chat dicts: ``[{"role": "user"|"assistant", "content": "..."}]``.

    Messages with no content are skipped.  Only ``user`` and ``assistant``
    roles are returned (system messages are handled separately via the prompt
    file).
    """
    if not project_id:
        return []

    def _fetch() -> list[dict]:
        records = pb.collection(COLLECTION_MESSAGES).get_full_list(
            query_params={
                "filter": f'project = "{project_id}"',
                "sort": "created",
                "perPage": max_messages,
            }
        )
        history: list[dict] = []
        for r in records:
            role = str(getattr(r, "role", "") or "")
            content = str(getattr(r, "content", "") or "").strip()
            if role in ("user", "assistant") and content:
                history.append({"role": role, "content": content})
        # Keep only the last max_messages entries
        return history[-max_messages:]

    try:
        return await asyncio.to_thread(_fetch)
    except Exception:
        logger.exception(
            "pocketbase: fetch history failed project_id=%s", project_id
        )
    return []


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
