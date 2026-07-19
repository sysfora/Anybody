"""
Socket.IO server: streams AI-generated thinking + HTML; persists to PocketBase.

Generation continues if the client disconnects (tasks keyed by request_id).
Reconnecting clients can call subscribe_project to rejoin a live stream.

Run: uvicorn ws_app:app --host 0.0.0.0 --port 5000 --reload

AI model selection
------------------
API keys are read from the PocketBase ``api_Keys`` collection on each AI call.
Models are tried in ascending priority order; on token-limit, rate-limit, or
overload errors the service automatically falls back to the next model.

Set POCKETBASE_URL (or NEXT_PUBLIC_POCKETBASE_URL) + superadmin credentials
to enable both persistence and AI key loading.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac as hmac_mod
import logging
import os
import re
import time
from pathlib import Path

import httpx
from diff_match_patch import diff_match_patch as _DiffMatchPatch

try:
    from dotenv import load_dotenv

    _repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(_repo_root / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

import socketio
from pocketbase import PocketBase

from ai_service import AIAllFailedError, AINoKeysError, AIService
from xml_response_parser import (
    AgentStreamParser,
    ContinuationStreamParser,
    PatchStepStreamParser,
    REPAIR_PROMPT,
    parse_agent_response,
    parse_patch_step_response,
    validate_agent_response,
    validate_patch_step_response,
)
from pocketbase_save import (
    create_message_with_client,
    fetch_project_history,
    fetch_project_html,
    patch_project_message_with_client,
    patch_project_record_with_client,
    pocketbase_admin,
    save_project_html,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ws_app")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WS_SECRET: str = os.environ.get("WS_SECRET", "")

THINKING_FLUSH_CHARS = 400
HTML_FLUSH_CHARS = 2500

# ---------------------------------------------------------------------------
# Load prompt files
# ---------------------------------------------------------------------------

_PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def _load_prompt(filename: str) -> str:
    try:
        return (_PROMPTS_DIR / filename).read_text(encoding="utf-8").strip()
    except OSError:
        logger.warning("ws_app: prompt file not found: %s", filename)
        return ""


AGENT_PROMPT: str = _load_prompt("Agent Prompt.txt")
MODIFY_PROMPT: str = _load_prompt("Modify Prompt.txt")
MODIFY_FALLBACK_PROMPT: str = _load_prompt("Modify Fallback Prompt.txt")
OPTIMIZER_PROMPT: str = _load_prompt("Prompt Optimizer.txt")

# Injected as the system prompt for continuation calls (resuming cut-off HTML).
CONTINUATION_SYSTEM = (
    "You are resuming an HTML file generation that was cut off mid-output.\n"
    "Output ONLY the remaining HTML starting from exactly where the previous "
    "response stopped — do NOT repeat any HTML that has already been generated.\n"
    "Do NOT reopen <file> or add any tags other than the closing tags below.\n"
    "When the file is complete, close with </file> then <status>DONE</status>."
)

MAX_CONTINUATION_ATTEMPTS = 3

# Agentic small-patch modify loop: each step is one small AI call + patch
# application. MAX_AGENTIC_STEPS bounds how many small edits one turn can
# make; MAX_STEP_RETRIES bounds how many times a *single* step is retried
# (with failure feedback to the model) before the whole turn escalates to
# the full-file regeneration safety net.
MAX_AGENTIC_STEPS: int = int(os.environ.get("MODIFY_MAX_STEPS", "12"))
MAX_STEP_RETRIES: int = int(os.environ.get("MODIFY_MAX_STEP_RETRIES", "3"))

# ---------------------------------------------------------------------------
# AI service (lazy-loaded singleton)
# ---------------------------------------------------------------------------

_ai_service: AIService = AIService()


# ---------------------------------------------------------------------------
# Socket.IO app
# ---------------------------------------------------------------------------

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)
_sio_asgi_inner = socketio.ASGIApp(sio)

_generation_tasks: dict[str, asyncio.Task] = {}

# In-flight state per project_id so reconnecting clients can receive a
# catch-up snapshot and join the live broadcast room.
# Shape: { project_id: { request_id, thinking_acc, html_acc, reply } }
_active_generations: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# Server-side project preview generation queue
# ---------------------------------------------------------------------------
#
# Client-side preview capture is intentionally removed. Instead, whenever the
# client submits a new prompt for a project, we enqueue a preview job.
# A single background worker generates previews sequentially and only when
# the project is not currently in "generating" state.
#
# Notes:
# - This is an in-memory queue (good enough for local/dev).
# - If a new prompt arrives while a preview render is in-flight, the job is
#   marked stale via `queued_at` and will be regenerated later.
_preview_jobs_lock = asyncio.Lock()
_preview_jobs: dict[str, dict] = {}
_preview_worker_task: asyncio.Task | None = None

PREVIEW_WORKER_MAX_ATTEMPTS: int = int(os.environ.get("PREVIEW_WORKER_MAX_ATTEMPTS", "3"))
PREVIEW_WORKER_IDLE_SLEEP_S: float = float(os.environ.get("PREVIEW_WORKER_IDLE_SLEEP_S", "2.0"))
PREVIEW_WORKER_WAIT_FOR_PAINT_S: float = float(os.environ.get("PREVIEW_WORKER_WAIT_FOR_PAINT_S", "3.0"))
PREVIEW_WORKER_SCAN_INTERVAL_S: float = float(os.environ.get("PREVIEW_WORKER_SCAN_INTERVAL_S", "600"))
PREVIEW_WORKER_MIN_AGE_S: float = float(os.environ.get("PREVIEW_WORKER_MIN_AGE_S", "3600"))


def _iso_utc(dt: float) -> str:
    import datetime

    d = datetime.datetime.fromtimestamp(dt, tz=datetime.timezone.utc)
    # PocketBase accepts RFC3339-like strings
    return d.replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def _maybe_scan_projects_without_preview() -> None:
    """
    Enqueue projects that:
    - are completed
    - are older than PREVIEW_WORKER_MIN_AGE_S
    - have no `preview` stored yet
    """
    cutoff_ts = time.time() - PREVIEW_WORKER_MIN_AGE_S

    async with pocketbase_admin() as pb:
        # Best-effort: query by status+age, then filter locally for missing preview
        # to avoid depending on PocketBase filter semantics for null.
        projects = await asyncio.to_thread(
            lambda: pb.collection("projects").get_full_list(
                query_params={
                    "filter": 'status="completed"',
                    "sort": "-created",
                    "perPage": 200,
                }
            )
        )

        for project in projects:
            project_id = str(getattr(project, "id", "") or "")
            if not project_id:
                continue
            preview_val = getattr(project, "preview", None)
            if isinstance(preview_val, str) and preview_val.strip():
                continue
            # Age check: created may be `created` or `dateCreated` depending on schema.
            created_raw = getattr(project, "created", None) or getattr(
                project, "dateCreated", None
            )
            created_ts: float | None = None
            if created_raw is not None:
                import datetime as _dt

                try:
                    if isinstance(created_raw, _dt.datetime):
                        c = created_raw
                        if c.tzinfo is None:
                            c = c.replace(tzinfo=_dt.timezone.utc)
                        created_ts = c.timestamp()
                    elif isinstance(created_raw, str) and created_raw.strip():
                        # PocketBase usually returns RFC3339 (e.g. 2026-03-25T12:34:56.789Z)
                        c = _dt.datetime.fromisoformat(
                            created_raw.replace("Z", "+00:00")
                        )
                        created_ts = c.timestamp()
                except Exception:
                    created_ts = None

            # If we can't determine age, skip (safer than generating immediately).
            if created_ts is None:
                continue
            if created_ts > cutoff_ts:
                continue

            # Only enqueue if HTML exists; the worker will re-check status=generating.
            html_val = getattr(project, "html", "") or ""
            if not str(html_val).strip():
                continue
            await _enqueue_preview(
                project_id, require_updated_since_enqueue=False
            )


def _ensure_preview_worker_running() -> None:
    global _preview_worker_task
    if _preview_worker_task is None or _preview_worker_task.done():
        _preview_worker_task = asyncio.create_task(_preview_worker_loop())


async def _enqueue_preview(
    project_id: str, *, require_updated_since_enqueue: bool = True
) -> None:
    """Queue a server-side preview render for *project_id*.

    When *require_updated_since_enqueue* is True (user just sent a prompt), the
    worker waits until ``projects.updated`` is >= enqueue time so we do not
    screenshot HTML before the final patch lands.

    Backfill scans set this to False: completed projects have ``updated`` in the
    past, so the timestamp guard would otherwise block forever.
    """
    if not project_id:
        return
    now = time.time()
    async with _preview_jobs_lock:
        job = _preview_jobs.get(project_id)
        if job:
            job["queued_at"] = now
            job["attempts"] = int(job.get("attempts", 0))
            job["state"] = "queued"
            job["require_updated_since_enqueue"] = bool(
                job.get("require_updated_since_enqueue", False)
                or require_updated_since_enqueue
            )
        else:
            _preview_jobs[project_id] = {
                "queued_at": now,
                "attempts": 0,
                "state": "queued",  # queued | generating
                "require_updated_since_enqueue": require_updated_since_enqueue,
            }
    _ensure_preview_worker_running()


async def _render_html_to_preview_jpeg(html: str) -> bytes:
    """
    Render HTML to a 1280x720 JPEG using Playwright.
    """
    # Lazy import so dev environments without Playwright can still run WS.
    from playwright.async_api import async_playwright

    viewport = {"width": 1280, "height": 720}
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-gpu", "--no-sandbox"],
        )
        context = await browser.new_context(viewport=viewport, device_scale_factor=1)
        page = await context.new_page()

        async def _route(route, request):
            url = request.url
            # Avoid DNS stalls for placeholder images; the rest of the page can still render.
            if "via.placeholder.com" in url or "placeholder.com" in url:
                await route.abort()
                return
            await route.continue_()

        await page.route("**/*", _route)
        await page.set_content(html, wait_until="load")

        # Force a white background like the previous client-side capture.
        await page.add_style_tag(content="html, body { background: #ffffff !important; color-scheme: light; }")
        await page.wait_for_timeout(int(PREVIEW_WORKER_WAIT_FOR_PAINT_S * 1000))

        jpeg_bytes = await page.screenshot(
            type="jpeg",
            quality=80,
            clip={"x": 0, "y": 0, "width": 1280, "height": 720},
        )
        await context.close()
        await browser.close()
        return jpeg_bytes


async def _upload_preview_to_next(project_id: str, jpeg_bytes: bytes) -> None:
    # Prefer explicit envs, then fall back to using the PocketBase origin as
    # the likely host for the Next app (common in this repo's deployments).
    raw_app_url = (
        os.environ.get("PREVIEW_APP_URL")
        or os.environ.get("NEXT_PUBLIC_APP_URL")
        or ""
    ).strip()
    raw_pb_url = (
        os.environ.get("POCKETBASE_URL") or os.environ.get("NEXT_PUBLIC_POCKETBASE_URL") or ""
    ).strip()

    def _origin(url: str) -> str:
        from urllib.parse import urlparse

        u = urlparse(url)
        if not u.scheme or not u.netloc:
            return ""
        return f"{u.scheme}://{u.netloc}".rstrip("/")

    app_url = (raw_app_url and _origin(raw_app_url)) or (_origin(raw_pb_url)) or "http://localhost:3000"
    secret = os.environ.get("PREVIEW_WORKER_SECRET") or ""
    headers: dict[str, str] = {}
    if secret:
        headers["x-preview-worker-secret"] = secret

    timeout_s = 120.0
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        preview_api_url = f"{app_url}/api/projects/preview"
        try:
            resp = await client.post(
                preview_api_url,
                data={"project_id": project_id},
                files={"preview": ("preview.jpg", jpeg_bytes, "image/jpeg")},
                headers=headers,
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            # Add URL context so logs point at misconfigured env.
            raise RuntimeError(
                f"preview upload failed url={preview_api_url} project_id={project_id}"
            ) from e


async def _preview_worker_loop() -> None:
    logger.info("ws_app: preview worker started")
    # Run one backfill scan soon after startup; later scans use the interval.
    next_scan_at = time.time()
    while True:
        try:
            if time.time() >= next_scan_at:
                await _maybe_scan_projects_without_preview()
                next_scan_at = time.time() + PREVIEW_WORKER_SCAN_INTERVAL_S
            await _preview_worker_tick()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("ws_app: preview worker tick failed")
            await asyncio.sleep(5.0)


async def _preview_worker_tick() -> None:
    async with _preview_jobs_lock:
        candidate_ids = [
            project_id
            for project_id, job in _preview_jobs.items()
            if job.get("state") in ("queued", "generating")
        ]

    if not candidate_ids:
        await asyncio.sleep(PREVIEW_WORKER_IDLE_SLEEP_S)
        return

    chosen_project_id: str | None = None
    chosen_html: str = ""
    chosen_expected_queued_at: float | None = None

    # Fetch project states in the same PocketBase admin session.
    async with pocketbase_admin() as pb:
        for project_id in candidate_ids:
            try:
                project = pb.collection("projects").get_one(project_id)
            except Exception:
                logger.exception("ws_app: preview worker failed fetching project_id=%s", project_id)
                continue

            status = str(getattr(project, "status", "") or "").lower()
            if status == "generating":
                continue

            html = str(getattr(project, "html", "") or "")
            if not html.strip():
                logger.warning("ws_app: preview worker: empty html project_id=%s", project_id)
                continue

            # If HTML was updated *after* we enqueued this job, it's safe to render.
            # This avoids rendering a stale preview during the small window where
            # `status` might still be `completed` but the generation hasn't patched
            # `html` yet.
            updated_raw = getattr(project, "updated", None) or getattr(
                project, "dateUpdated", None
            )
            updated_ts: float | None = None
            if updated_raw is not None:
                import datetime as _dt

                try:
                    if isinstance(updated_raw, _dt.datetime):
                        u = updated_raw
                        if u.tzinfo is None:
                            u = u.replace(tzinfo=_dt.timezone.utc)
                        updated_ts = u.timestamp()
                    elif isinstance(updated_raw, str) and updated_raw.strip():
                        u = _dt.datetime.fromisoformat(
                            updated_raw.replace("Z", "+00:00")
                        )
                        updated_ts = u.timestamp()
                except Exception:
                    updated_ts = None

            async with _preview_jobs_lock:
                job = _preview_jobs.get(project_id)
                if not job or job.get("state") not in ("queued", "generating"):
                    continue
                chosen_expected_queued_at = float(job.get("queued_at", 0))
                require_updated = job.get("require_updated_since_enqueue", True)

                if (
                    require_updated
                    and updated_ts is not None
                    and updated_ts < chosen_expected_queued_at
                ):
                    # User-prompt enqueue: wait until HTML is patched after queue time.
                    # (Backfill jobs set require_updated_since_enqueue=False.)
                    continue
                chosen_project_id = project_id
                chosen_html = html
                job["state"] = "generating"
            break

    if not chosen_project_id or chosen_expected_queued_at is None:
        await asyncio.sleep(PREVIEW_WORKER_IDLE_SLEEP_S)
        return

    try:
        jpeg_bytes = await _render_html_to_preview_jpeg(chosen_html)
        await _upload_preview_to_next(chosen_project_id, jpeg_bytes)
    except Exception:
        logger.exception("ws_app: preview render/upload failed project_id=%s", chosen_project_id)
        async with _preview_jobs_lock:
            job = _preview_jobs.get(chosen_project_id)
            if not job:
                return
            job["attempts"] = int(job.get("attempts", 0)) + 1
            if int(job["attempts"]) >= PREVIEW_WORKER_MAX_ATTEMPTS:
                _preview_jobs.pop(chosen_project_id, None)
            else:
                job["state"] = "queued"
        return

    # If a new prompt arrived after we queued the job, `queued_at` changes and
    # we must not publish a stale preview.
    async with _preview_jobs_lock:
        job = _preview_jobs.get(chosen_project_id)
        if not job:
            return
        current_queued_at = float(job.get("queued_at", 0))
        if current_queued_at != chosen_expected_queued_at:
            job["state"] = "queued"
            # Count as an attempt; the next render will use the latest HTML.
            job["attempts"] = int(job.get("attempts", 0)) + 1
            return

        _preview_jobs.pop(chosen_project_id, None)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def _validate_ws_token(token: str) -> bool:
    """Validate a HMAC-SHA256 signed token issued by /api/ws-token.

    Token format: "<expiresAt>.<hmac-sha256-hex>"
    Returns True when the secret is not configured (dev mode).
    """
    if not WS_SECRET:
        return True
    try:
        expires_at_str, mac = token.rsplit(".", 1)
        if int(expires_at_str) < time.time():
            return False
        expected = hmac_mod.new(
            WS_SECRET.encode(),
            expires_at_str.encode(),
            hashlib.sha256,
        ).hexdigest()
        return hmac_mod.compare_digest(mac, expected)
    except Exception:
        return False


@sio.event
async def connect(sid, _environ, auth):
    token = (auth or {}).get("token", "")
    if not _validate_ws_token(token):
        logger.warning("Unauthorized connection attempt rejected: %s", sid)
        raise ConnectionRefusedError("Unauthorized")
    logger.info("client connected %s", sid)
    _ensure_preview_worker_running()


@sio.event
async def disconnect(sid):
    logger.info("client disconnected %s (generation tasks keep running)", sid)


# ---------------------------------------------------------------------------
# Dummy fallback (used when no AI keys are configured)
# ---------------------------------------------------------------------------


def _build_dummy_html(user_text: str) -> str:
    import html as _html

    safe = _html.escape(user_text.strip() or "(empty prompt)")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dummy preview</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ font-family: system-ui, sans-serif; margin: 0; padding: 2rem;
           background: #fafafa; color: #111; line-height: 1.5; }}
    @media (prefers-color-scheme: dark) {{
      body {{ background: #0a0a0a; color: #fafafa; }}
      .card {{ background: #171717; border-color: #262626; }}
    }}
    h1 {{ font-size: 1.25rem; font-weight: 600; margin: 0 0 1rem; }}
    .card {{ padding: 1rem 1.25rem; background: #fff; border: 1px solid #e5e5e5;
             border-radius: 0.5rem; max-width: 40rem; }}
    .label {{ font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
              color: #737373; margin-bottom: 0.5rem; }}
    .prompt {{ white-space: pre-wrap; word-break: break-word; }}
    footer {{ margin-top: 2rem; font-size: 0.8rem; color: #737373; }}
  </style>
</head>
<body>
  <main>
    <h1>Dummy server output — add API keys in PocketBase to enable real AI</h1>
    <div class="card">
      <div class="label">Your message</div>
      <p class="prompt">{safe}</p>
    </div>
    <footer>Add api_Keys records in PocketBase to enable real generation.</footer>
  </main>
</body>
</html>"""


async def _stream_dummy(
    sid: str,
    user_text: str,
    request_id: str,
    emit_target: str,
    *,
    thinking_acc_ref: list[str],
    html_acc_ref: list[str],
) -> str:
    """Emit the dummy thinking + HTML stream; return the reply text."""
    THINKING_CHARS_PER_CHUNK = 2
    THINKING_DELAY_S = 0.08
    CODE_CHUNK_MIN = 8
    CODE_CHUNK_MAX = 18
    CODE_DELAY_S = 0.07

    thinking_lines = [
        f'Parsing user intent: "{user_text[:120]}{"…" if len(user_text) > 120 else ""}"\n\n',
        "No AI keys configured — serving placeholder HTML.\n\n",
        "Add records to the api_Keys collection in PocketBase to enable real generation.\n",
    ]
    for line in thinking_lines:
        for i in range(0, len(line), THINKING_CHARS_PER_CHUNK):
            chunk = line[i : i + THINKING_CHARS_PER_CHUNK]
            thinking_acc_ref[0] += chunk
            await sio.emit(
                "thinking_chunk",
                {"request_id": request_id, "chunk": chunk},
                room=emit_target,
            )
            await asyncio.sleep(THINKING_DELAY_S)

    doc = _build_dummy_html(user_text)
    span = len(doc) // 35 if len(doc) > 35 else len(doc)
    step = max(CODE_CHUNK_MIN, min(CODE_CHUNK_MAX, span))
    for i in range(0, len(doc), step):
        chunk = doc[i : i + step]
        html_acc_ref[0] += chunk
        await sio.emit(
            "code_chunk",
            {"request_id": request_id, "chunk": chunk},
            room=emit_target,
        )
        await asyncio.sleep(CODE_DELAY_S)

    return (
        "Streamed placeholder HTML (no AI keys). "
        "Add records to api_Keys in PocketBase to enable real generation."
    )


# ---------------------------------------------------------------------------
# Core generation
# ---------------------------------------------------------------------------


async def _stream_generation(
    sid: str,
    user_text: str,
    request_id: str,
    project_id: str | None = None,
    user_message_id: str | None = None,
    attachments: list[dict] | None = None,
) -> None:
    assistant_message_id: str | None = None
    cm = None
    cm_keys = None
    pb = None
    pb_keys = None
    thinking_acc = ""
    html_acc = ""
    since_thinking_flush = 0
    since_html_flush = 0
    reply_text = ""

    emit_target = f"project-{project_id}" if project_id else sid

    try:
        # ── PocketBase setup ───────────────────────────────────────────────
        if project_id:
            try:
                cm = pocketbase_admin()
                pb = await cm.__aenter__()
            except RuntimeError:
                logger.warning("ws_app: PocketBase not configured — streaming without DB")
                cm = None
                pb = None

        # PocketBase client for loading ``api_Keys`` (same connection as project DB when set).
        pb_keys = pb
        if pb_keys is None:
            try:
                cm_keys = pocketbase_admin()
                pb_keys = await cm_keys.__aenter__()
            except RuntimeError:
                logger.warning("ws_app: PocketBase not configured — AI keys unavailable")
                cm_keys = None
                pb_keys = None
            except Exception:
                logger.exception("ws_app: failed to open PocketBase for API keys")
                cm_keys = None
                pb_keys = None

        # Fetch the current HTML before resetting — used to detect modification mode.
        existing_html = ""
        if project_id and pb:
            existing_html = await fetch_project_html(pb, project_id)
            if existing_html is None:
                # Could not confirm whether the project already has HTML — do
                # NOT fall through to full generation, since that would treat
                # a real project as brand-new and overwrite existing work.
                # Abort cleanly instead; no messages/status were touched yet.
                logger.warning(
                    "ws_app: aborting request_id=%s — could not load existing "
                    "HTML for project_id=%s", request_id, project_id,
                )
                await sio.emit(
                    "generation_error",
                    {
                        "request_id": request_id,
                        "message": "Could not load the current project state — please try again.",
                    },
                    room=emit_target,
                )
                return

        if project_id and pb:
            if not user_message_id:
                await create_message_with_client(
                    pb, project_id, "user", user_text, request_id=request_id
                )
            else:
                logger.info(
                    "ws_app: skipping user message creation — already created id=%s",
                    user_message_id,
                )
            assistant_message_id = await create_message_with_client(
                pb, project_id, "assistant", "", request_id=request_id
            )
            await patch_project_record_with_client(
                pb, project_id, status="generating"
            )

        # Register in-flight state and join the project broadcast room.
        if project_id:
            _active_generations[project_id] = {
                "request_id": request_id,
                "thinking_acc": "",
                "html_acc": "",
                "reply": "",
            }
            await sio.enter_room(sid, f"project-{project_id}")

        # ── AI generation ──────────────────────────────────────────────────
        use_ai = False
        if pb_keys is not None:
            agent_keys = await AIService.fetch_keys_for_type(pb_keys, "Agent")
            use_ai = bool(agent_keys)

        if use_ai:
            ta_holder = {"val": thinking_acc}
            ha_holder = {"val": html_acc}
            reply_text = await _run_ai_generation(
                service=_ai_service,
                user_text=user_text,
                existing_html=existing_html,
                attachments=attachments or [],
                request_id=request_id,
                project_id=project_id,
                emit_target=emit_target,
                pb=pb,
                pb_ai=pb_keys,
                assistant_message_id=assistant_message_id,
                thinking_acc_holder=ta_holder,
                html_acc_holder=ha_holder,
                since_thinking_holder={"val": since_thinking_flush},
                since_html_holder={"val": since_html_flush},
            )
            thinking_acc = ta_holder["val"]
            html_acc = ha_holder["val"]
        else:
            # Mutable single-element lists act as pass-by-reference holders
            ta_ref = [thinking_acc]
            ha_ref = [html_acc]
            reply_text = await _stream_dummy(
                sid,
                user_text,
                request_id,
                emit_target,
                thinking_acc_ref=ta_ref,
                html_acc_ref=ha_ref,
            )
            thinking_acc = ta_ref[0]
            html_acc = ha_ref[0]

        # ── Persist final state ────────────────────────────────────────────
        if assistant_message_id and pb:
            await patch_project_message_with_client(
                pb,
                assistant_message_id,
                content=reply_text,
                thinking=thinking_acc,
            )

        if project_id and pb:
            await patch_project_record_with_client(
                pb, project_id, html=html_acc, status="completed"
            )
        elif project_id:
            await save_project_html(project_id, html_acc, status="completed")

        if project_id and project_id in _active_generations:
            _active_generations[project_id]["reply"] = reply_text

        await sio.emit(
            "assistant_reply",
            {"request_id": request_id, "message": reply_text},
            room=emit_target,
        )
        await sio.emit("generation_done", {"request_id": request_id}, room=emit_target)

    except asyncio.CancelledError:
        if assistant_message_id and pb:
            await patch_project_message_with_client(
                pb,
                assistant_message_id,
                content="Generation stopped.",
                thinking=thinking_acc,
            )
        if project_id and pb:
            await patch_project_record_with_client(
                pb, project_id, html=html_acc, status="cancelled"
            )
        await sio.emit(
            "generation_stopped", {"request_id": request_id}, room=emit_target
        )
        logger.info("ws_app: generation cancelled request_id=%s", request_id)
        raise

    except Exception as e:
        logger.exception("ws_app: generation failed request_id=%s", request_id)
        if assistant_message_id and pb:
            await patch_project_message_with_client(
                pb,
                assistant_message_id,
                content=f"Generation failed: {e}",
                thinking=thinking_acc,
            )
        if project_id and pb:
            # Keep existing_html if the current generation produced nothing —
            # this ensures the user still sees the previous working page.
            saved_html = html_acc if html_acc.strip() else existing_html
            await patch_project_record_with_client(
                pb, project_id, html=saved_html, status="error"
            )
        await sio.emit(
            "generation_error",
            {"request_id": request_id, "message": str(e)},
            room=emit_target,
        )

    finally:
        if project_id:
            _active_generations.pop(project_id, None)
        if cm_keys is not None:
            await cm_keys.__aexit__(None, None, None)
        if cm is not None:
            await cm.__aexit__(None, None, None)


OPTIMIZER_MAX_CHARS = 250


async def _maybe_optimize_prompt(
    service: AIService, user_text: str, pb: PocketBase
) -> str:
    """Return an optimized version of ``user_text`` when it is short enough.

    The optimizer is skipped for prompts >= OPTIMIZER_MAX_CHARS characters
    (they are already detailed enough) and also when no Optimizer keys exist.
    """
    if len(user_text) >= OPTIMIZER_MAX_CHARS:
        return user_text
    if not await AIService.fetch_keys_for_type(pb, "Optimizer"):
        logger.debug("ws_app: optimizer skipped — no Optimizer keys configured")
        return user_text
    try:
        optimized = await service.complete(
            [{"role": "user", "content": user_text}],
            "Optimizer",
            pb,
            system=OPTIMIZER_PROMPT,
            max_tokens=1024,
        )
        optimized = optimized.strip()
        if optimized:
            logger.info(
                "ws_app: prompt optimized (%d → %d chars)", len(user_text), len(optimized)
            )
            return optimized
    except Exception:
        logger.warning("ws_app: optimizer failed — using original prompt", exc_info=True)
    return user_text


async def _maybe_repair_agent_response(
    service: AIService, response: str, pb: PocketBase
) -> str | None:
    """Ask a cheap model to restore XML tags without changing code content."""
    try:
        parsed = parse_agent_response(response)
        validate_agent_response(parsed)
        return None
    except ValueError:
        pass

    if not await AIService.fetch_keys_for_type(pb, "Optimizer"):
        logger.debug("ws_app: response repair skipped — no Optimizer keys configured")
        return None

    try:
        repaired = await service.complete(
            [{"role": "user", "content": REPAIR_PROMPT.format(response=response)}],
            "Optimizer",
            pb,
            max_tokens=16384,
        )
        repaired = repaired.strip()
        if repaired:
            logger.info("ws_app: attempted agent response tag repair")
            return repaired
    except Exception:
        logger.warning("ws_app: agent response repair failed", exc_info=True)
    return None


async def _maybe_repair_patch_step_response(
    service: AIService, response: str, pb: PocketBase
) -> str | None:
    """Ask a cheap model to restore XML tags on a malformed patch-step
    response, without touching the FIND/REPLACE/file content."""
    try:
        parsed = parse_patch_step_response(response)
        validate_patch_step_response(parsed)
        return None
    except ValueError:
        pass

    if not await AIService.fetch_keys_for_type(pb, "Optimizer"):
        logger.debug("ws_app: patch-step repair skipped — no Optimizer keys configured")
        return None

    try:
        repaired = await service.complete(
            [{"role": "user", "content": REPAIR_PROMPT.format(response=response)}],
            "Optimizer",
            pb,
            max_tokens=16384,
        )
        repaired = repaired.strip()
        if repaired:
            logger.info("ws_app: attempted patch-step response tag repair")
            return repaired
    except Exception:
        logger.warning("ws_app: patch-step response repair failed", exc_info=True)
    return None


class _AssistantVisibleMessageNormalizer:
    """Normalize visible assistant chat text while streaming.

    - Drops leading newlines before any real content.
    - Collapses runs of two or more newlines to a single newline.
    - Trailing newlines are discarded (not emitted); call :meth:`finish` at end.
    """

    def __init__(self) -> None:
        self._leading = True
        self._hold = ""
        self._after_newline = False

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        s = self._hold + chunk
        self._hold = ""
        if self._leading:
            stripped = s.lstrip("\n")
            if not stripped:
                return ""
            s = stripped
            self._leading = False
            self._after_newline = False

        pieces: list[str] = []
        i = 0
        while i < len(s):
            if s[i] != "\n":
                pieces.append(s[i])
                self._after_newline = False
                i += 1
                continue
            j = i
            while j < len(s) and s[j] == "\n":
                j += 1
            if j == len(s):
                self._hold = s[i:j]
                break
            if not self._after_newline:
                pieces.append("\n")
                self._after_newline = True
            i = j
        return "".join(pieces)

    def finish(self) -> None:
        self._hold = ""


# ---------------------------------------------------------------------------
# Patch matching — tiered, from strictest/safest to fuzziest
# ---------------------------------------------------------------------------
#
# 1. Exact substring match (unique)         — zero risk, deterministic.
# 2. Whitespace-tolerant match (unique)     — handles indentation/line-ending
#    drift while still splicing in an exact, unmodified span.
# 3. Anchored fuzzy match (diff-match-patch) — last resort for minor content
#    drift (a changed/misremembered character), bounded to a small search
#    window for speed and gated by a strict post-apply verification so an
#    unreliable fuzzy match is rejected rather than risking corruption.
#
# Tier 3 deliberately does NOT try to be maximally fuzzy: testing showed that
# widening diff-match-patch's search distance to be location-independent is
# both catastrophically slow on realistic documents and, worse, can silently
# corrupt content when the "old" text it thinks it's replacing doesn't quite
# match reality (e.g. duplicating characters). Tiers 1-2 already handle the
# overwhelming majority of real drift (whitespace) with zero corruption risk;
# tier 3 only needs to catch the rare remaining case, so it can afford to be
# conservative and simply fail (triggering a retry) when unsure.

_WS_RUN_RE = re.compile(r"\s+")

_ANCHOR_LEAD_MARGIN = 24
_ANCHOR_TRAIL_MARGIN = 400
_ANCHOR_MIN_LINE_LEN = 6


def _whitespace_tolerant_pattern(find_text: str) -> re.Pattern[str]:
    """Build a regex matching *find_text* while tolerating differences in
    *runs* of whitespace — the single most common way an AI's "verbatim"
    copy of a FIND block drifts from the real source (re-indentation,
    CRLF/LF, extra or missing blank lines)."""
    parts = [p for p in _WS_RUN_RE.split(find_text) if p != ""]
    if not parts:
        return re.compile(re.escape(find_text))
    return re.compile(r"\s+".join(re.escape(p) for p in parts), re.DOTALL)


def _locate_span(html: str, find_text: str) -> tuple[int, int] | str:
    """Locate the ``(start, end)`` span of *find_text* inside *html*.

    Returns the span on a confident, unique match, or ``"ambiguous"`` /
    ``"not_found"`` when it can't be trusted.
    """
    if not find_text.strip():
        return "not_found"

    count = html.count(find_text)
    if count == 1:
        start = html.index(find_text)
        return start, start + len(find_text)
    if count > 1:
        return "ambiguous"

    try:
        matches = list(_whitespace_tolerant_pattern(find_text).finditer(html))
    except re.error:
        matches = []
    if len(matches) == 1:
        return matches[0].start(), matches[0].end()
    if len(matches) > 1:
        return "ambiguous"

    return "not_found"


def _find_anchor_offset(html: str, find_text: str) -> tuple[int, int] | None:
    """Cheaply estimate where *find_text* should start inside *html* even
    though it isn't present verbatim.

    Used to bound the fuzzy search window below to a small region — locating
    an anchor via plain substring search keeps the fuzzy match fast and safe
    on large documents, instead of a distance-unbounded Bitap scan (which
    testing showed can take 60+ seconds on an 8KB document).

    Returns ``(offset_in_html, offset_in_find_text)`` for the same anchor
    text, or ``None`` if nothing in *find_text* can be uniquely located.
    """
    lines = [ln for ln in find_text.splitlines() if ln.strip()]
    lines.sort(key=lambda ln: -len(ln.strip()))
    for ln in lines:
        stripped = ln.strip()
        if len(stripped) < _ANCHOR_MIN_LINE_LEN:
            continue
        if html.count(stripped) == 1:
            html_off = html.index(stripped)
            ft_off = find_text.index(ln) + ln.index(stripped)
            return html_off, ft_off
    for n in (80, 60, 40, 25):
        prefix = find_text[:n].strip()
        if len(prefix) >= 10 and html.count(prefix) == 1:
            return html.index(prefix), find_text.index(prefix)
    return None


def _apply_patch_fuzzy(html: str, find_text: str, replace_text: str) -> tuple[str, bool, str]:
    """Tier-3 fuzzy patch application. See module note above for rationale."""
    anchor = _find_anchor_offset(html, find_text)
    if anchor is None:
        return html, False, "not_found"
    html_off, ft_off = anchor
    expected_start = html_off - ft_off

    win_start = max(0, expected_start - _ANCHOR_LEAD_MARGIN)
    win_end = min(len(html), expected_start + len(find_text) + _ANCHOR_TRAIL_MARGIN)
    window = html[win_start:win_end]

    dmp = _DiffMatchPatch()
    dmp.Match_Threshold = 0.2
    dmp.Match_Distance = 1000
    dmp.Patch_Margin = 8

    try:
        patches = dmp.patch_make(find_text, replace_text)
        new_window, results = dmp.patch_apply(patches, window)
    except Exception:
        logger.warning("ws_app: fuzzy patch_apply raised", exc_info=True)
        return html, False, "not_found"

    if not results or not all(results):
        return html, False, "not_found"
    if replace_text.strip() and replace_text.strip() not in new_window:
        return html, False, "unverified"

    return html[:win_start] + new_window + html[win_end:], True, "ok"


def _apply_one_patch(html: str, find_text: str, replace_text: str) -> tuple[str, bool, str]:
    """Apply a single FIND/REPLACE block using the tiered matcher above."""
    find_norm = find_text.strip("\r\n")
    replace_norm = replace_text.strip("\r\n")
    if not find_norm.strip():
        return html, False, "empty_find"

    located = _locate_span(html, find_norm)
    if isinstance(located, tuple):
        start, end = located
        return html[:start] + replace_norm + html[end:], True, "ok"
    if located == "ambiguous":
        return html, False, "ambiguous"

    return _apply_patch_fuzzy(html, find_norm, replace_norm)


def _apply_patch_group(
    html: str, patches: list[tuple[str, str]]
) -> tuple[str, bool, str, str]:
    """Apply every FIND/REPLACE block of one step, in order, each chained
    onto the result of the previous one.

    Returns ``(new_html, success, reason, failing_find_text)``. On failure,
    *html* is returned unchanged (no partial application).
    """
    current = html
    for find_text, replace_text in patches:
        current, ok, reason = _apply_one_patch(current, find_text, replace_text)
        if not ok:
            return html, False, reason, find_text
    return current, True, "ok", ""


# ---------------------------------------------------------------------------
# AI generation (full + patch modes)
# ---------------------------------------------------------------------------


async def _run_ai_generation(
    *,
    service: AIService,
    user_text: str,
    existing_html: str,
    attachments: list[dict],
    request_id: str,
    project_id: str | None,
    emit_target: str,
    pb,
    pb_ai,
    assistant_message_id: str | None,
    thinking_acc_holder: dict,
    html_acc_holder: dict,
    since_thinking_holder: dict,
    since_html_holder: dict,
) -> str:
    """Drive real AI streaming; returns the full visible message text.

    * No existing HTML  → full generation (Agent Prompt).
    * Existing HTML     → full-file edit (Modify Prompt): the model is given
      the current file as context and asked to return the complete updated
      file, the same reliable mechanism as brand-new generation. This
      replaced an earlier FIND/REPLACE patch mechanism that was prone to
      silent failures whenever the model's "verbatim" copy of the FIND text
      drifted by even a stray whitespace character.

    Both branches stream thinking_chunk / message_chunk / code_chunk live
    and transparently resume via the continuation mechanism if the model's
    output is cut off mid-file.
    """

    # ── Shared emit helpers ────────────────────────────────────────────────

    _message_acc = [""]  # mutable container so closures can update it
    _msg_nl = _AssistantVisibleMessageNormalizer()

    async def _emit_thinking(chunk: str) -> None:
        thinking_acc_holder["val"] += chunk
        since_thinking_holder["val"] += len(chunk)
        if project_id and project_id in _active_generations:
            _active_generations[project_id]["thinking_acc"] = thinking_acc_holder["val"]
        await sio.emit(
            "thinking_chunk",
            {"request_id": request_id, "chunk": chunk},
            room=emit_target,
        )
        if (
            assistant_message_id
            and pb
            and since_thinking_holder["val"] >= THINKING_FLUSH_CHARS
        ):
            since_thinking_holder["val"] = 0
            await patch_project_message_with_client(
                pb, assistant_message_id, thinking=thinking_acc_holder["val"]
            )

    async def _emit_message(chunk: str) -> None:
        """Stream a visible chat message chunk to the client."""
        normalized = _msg_nl.feed(chunk)
        if not normalized:
            return
        _message_acc[0] += normalized
        await sio.emit(
            "message_chunk",
            {"request_id": request_id, "chunk": normalized},
            room=emit_target,
        )

    async def _emit_code(chunk: str) -> None:
        html_acc_holder["val"] += chunk
        since_html_holder["val"] += len(chunk)
        if project_id and project_id in _active_generations:
            _active_generations[project_id]["html_acc"] = html_acc_holder["val"]
        await sio.emit(
            "code_chunk",
            {"request_id": request_id, "chunk": chunk},
            room=emit_target,
        )
        if project_id and pb and since_html_holder["val"] >= HTML_FLUSH_CHARS:
            since_html_holder["val"] = 0
            await patch_project_record_with_client(
                pb, project_id, html=html_acc_holder["val"], status="generating"
            )

    # ── Common setup ───────────────────────────────────────────────────────
    # Conversation history (strip last user turn — we supply it ourselves)
    history: list[dict] = []
    raw_history: list[dict] = []
    if project_id and pb:
        raw_history = await fetch_project_history(pb, project_id, max_messages=20)
        history = list(raw_history)
        if history and history[-1].get("role") == "user":
            history = history[:-1]
        # Remove leading assistant turns (e.g. the "Project remixed" marker
        # added by the remix API).  All providers require conversations to
        # start with a user message; a leading assistant turn causes errors or
        # makes the model ignore the HTML context and generate from scratch.
        while history and history[0].get("role") == "assistant":
            history = history[1:]

    # A project is a modification if it already has HTML, OR if it was remixed
    # (detected by the "Project remixed" assistant marker as the only history
    # entry, meaning no real user exchange has happened yet).
    _is_remixed = (
        len(raw_history) == 1
        and raw_history[0].get("role") == "assistant"
        and raw_history[0].get("content", "").strip().lower() == "project remixed"
    )
    is_modification = bool(existing_html and existing_html.strip()) or _is_remixed
    # Optimizer only runs on short new prompts, not on modifications
    prompt = (
        user_text
        if is_modification
        else await _maybe_optimize_prompt(service, user_text, pb_ai)
    )

    def _make_user_message(text: str) -> dict:
        """Return an OpenAI-style user message, multimodal when attachments exist.

        Text-based attachments (kind="text") are appended inline to the prompt
        so every model can read them without vision support.
        Image attachments (kind="image") are added as multimodal content blocks.
        """
        if not attachments:
            return {"role": "user", "content": text}

        # 1. Append text-file contents directly into the prompt string.
        text_parts = [text]
        image_blocks: list[dict] = []

        for att in attachments:
            kind = att.get("kind", "")
            name = att.get("name", "attachment")
            if kind == "text":
                file_text = att.get("text", "")
                text_parts.append(
                    f"\n\n--- Attachment: {name} ---\n{file_text}\n--- End of {name} ---"
                )
            elif kind == "image":
                mime = att.get("mimeType", "image/jpeg")
                b64 = att.get("base64", "")
                if b64:
                    image_blocks.append(
                        {"type": "image", "media_type": mime, "data": b64}
                    )

        full_text = "".join(text_parts)

        # 2. If no images, plain string content is enough (works on all models).
        if not image_blocks:
            return {"role": "user", "content": full_text}

        # 3. With images, build a multimodal content list.
        parts: list[dict] = [{"type": "text", "text": full_text}] + image_blocks
        return {"role": "user", "content": parts}

    async def _stream_full_file(system_prompt: str, chat_messages: list[dict]) -> bool:
        """Stream one plan/message/file/footer/status response and
        transparently resume via continuation if it's cut off mid-file.

        Shared by both branches below — full-file generation (brand-new
        project) and full-file editing (modification) differ only in the
        system prompt and in whether the current HTML is included in the
        user message, so they can safely share one streaming+continuation
        implementation instead of maintaining two parallel ones.

        Returns True if the file was completed (closed with ``</file>`` and
        ``<status>DONE</status>``), False if every continuation attempt was
        exhausted while still cut off.
        """
        parser = AgentStreamParser()
        raw_response_acc = [""]

        try:
            async for ai_chunk in service.complete_stream(
                chat_messages, "Agent", pb_ai, system=system_prompt
            ):
                t, content = ai_chunk["type"], ai_chunk["content"]
                if t == "model":
                    logger.info("ws_app: generating with %s", content)
                elif t == "thinking":
                    await _emit_thinking(content)
                elif t == "text":
                    raw_response_acc[0] += content
                    for seg_type, seg_content in parser.feed(content):
                        if seg_type == "thinking":
                            await _emit_thinking(seg_content)
                        elif seg_type == "message":
                            await _emit_message(seg_content)
                        elif seg_type == "code":
                            await _emit_code(seg_content)

            for seg_type, seg_content in parser.flush():
                if seg_type == "thinking":
                    await _emit_thinking(seg_content)
                elif seg_type == "message":
                    await _emit_message(seg_content)
                elif seg_type == "code":
                    await _emit_code(seg_content)

        except (AINoKeysError, AIAllFailedError) as exc:
            raise RuntimeError(str(exc)) from exc

        if not parser.is_done and raw_response_acc[0].strip():
            repaired = await _maybe_repair_agent_response(
                service, raw_response_acc[0], pb_ai
            )
            if repaired:
                raw_response_acc[0] = repaired
                structured = parse_agent_response(repaired)
                try:
                    validate_agent_response(structured)
                    if structured.file["content"] and not html_acc_holder["val"]:
                        await _emit_code(structured.file["content"])
                    if structured.plan and not thinking_acc_holder["val"]:
                        await _emit_thinking(structured.plan + "\n")
                    if structured.message and not _message_acc[0]:
                        await _emit_message(structured.message)
                    if structured.footer:
                        await _emit_message("\n" + structured.footer)
                    parser.is_done = structured.status == "DONE"
                except ValueError:
                    logger.warning("ws_app: repaired response still invalid")

        # ── Continuation: resume if the HTML was cut off mid-generation ──────
        generation_complete = parser.is_done
        cont_attempt = 0

        while (
            not generation_complete
            and getattr(parser, "in_file", parser._state == "file")
            and html_acc_holder["val"]
            and cont_attempt < MAX_CONTINUATION_ATTEMPTS
        ):
            cont_attempt += 1
            partial_html = html_acc_holder["val"]
            logger.info(
                "ws_app: HTML cut off at %d chars — continuation attempt %d/%d",
                len(partial_html), cont_attempt, MAX_CONTINUATION_ATTEMPTS,
            )
            await _emit_thinking(
                f"\n[Output cut off — switching model and continuing "
                f"(attempt {cont_attempt}/{MAX_CONTINUATION_ATTEMPTS})...]\n"
            )

            cont_messages = chat_messages + [
                {
                    "role": "assistant",
                    "content": f'<file name="index.html">\n{partial_html}',
                },
                {
                    "role": "user",
                    "content": (
                        "Your previous response was cut off before the HTML was "
                        "complete. Please CONTINUE the HTML from exactly where you "
                        "stopped. Output ONLY the remaining HTML — do NOT repeat "
                        "anything already written and do NOT reopen <file>. "
                        "When finished, close with </file> then "
                        "<status>DONE</status>."
                    ),
                },
            ]

            cont_parser = ContinuationStreamParser()
            try:
                async for ai_chunk in service.complete_stream(
                    cont_messages, "Agent", pb_ai, system=CONTINUATION_SYSTEM
                ):
                    t, content = ai_chunk["type"], ai_chunk["content"]
                    if t == "model":
                        logger.info(
                            "ws_app: continuation attempt %d using %s",
                            cont_attempt, content,
                        )
                    elif t == "thinking":
                        await _emit_thinking(content)
                    elif t == "text":
                        for seg_type, seg_content in cont_parser.feed(content):
                            if seg_type == "thinking":
                                await _emit_thinking(seg_content)
                            elif seg_type == "code":
                                await _emit_code(seg_content)

                for seg_type, seg_content in cont_parser.flush():
                    if seg_type == "code":
                        await _emit_code(seg_content)

                if cont_parser.is_done:
                    generation_complete = True
                    break

                parser = cont_parser  # type: ignore[assignment]

            except (AINoKeysError, AIAllFailedError):
                logger.warning(
                    "ws_app: all models exhausted during continuation attempt %d",
                    cont_attempt,
                )
                break

        return generation_complete

    async def _run_patch_step_loop() -> bool:
        """Agentic small-patch loop for modifying an existing file.

        Calls the model repeatedly; each response is ONE small step
        containing either a ``<patch>`` (FIND/REPLACE blocks, applied via
        the tiered matcher above) or, as an escape hatch, a full ``<file>``
        rewrite for just that step. Emits ``patch_applied`` after each
        successfully-applied step so the frontend can animate that specific
        change live, instead of waiting for the whole turn to finish.

        Returns True once the model reports ``<status>DONE</status>`` (or
        the step budget is exhausted after making at least some verified
        progress). Returns False only when a step's patch/file repeatedly
        fails to apply even after feedback-guided retries — the caller
        should then fall back to a full-file regeneration for the turn.
        """
        current_html = html_acc_holder["val"] or existing_html
        completed_summaries: list[str] = []
        step_index = 0
        retries_this_step = 0
        extra_feedback = ""

        while step_index < MAX_AGENTIC_STEPS:
            if step_index == 0:
                recap = ""
            else:
                done_list = "\n".join(f"- {s}" for s in completed_summaries)
                recap = (
                    f"\n\nSteps already completed in this request:\n{done_list}\n\n"
                    "Continue with the NEXT small step. If every requested "
                    "change has now been made, respond with "
                    "<status>DONE</status> instead of another patch."
                )
            user_content_text = (
                f"Current page HTML:\n```html\n{current_html}\n```\n\n"
                f"User request: {prompt}{recap}{extra_feedback}"
            )
            call_user_msg = _make_user_message(user_content_text)
            chat_messages = (
                (history + [call_user_msg]) if step_index == 0 else [call_user_msg]
            )
            extra_feedback = ""

            parser = PatchStepStreamParser()
            raw_response_acc = [""]
            # PatchStepStreamParser emits <message> AND <footer> content as
            # the same "message" segment type (both are simple visible-text
            # sections) — accumulate this step's share locally, in addition
            # to live-streaming it via _emit_message, so we have a per-step
            # summary for the "already completed" recap on later steps.
            step_message_acc = [""]

            try:
                async for ai_chunk in service.complete_stream(
                    chat_messages, "Agent", pb_ai, system=MODIFY_PROMPT
                ):
                    t, content = ai_chunk["type"], ai_chunk["content"]
                    if t == "model":
                        logger.info(
                            "ws_app: modify step %d generating with %s",
                            step_index, content,
                        )
                    elif t == "thinking":
                        await _emit_thinking(content)
                    elif t == "text":
                        raw_response_acc[0] += content
                        for seg_type, seg_content in parser.feed(content):
                            if seg_type == "thinking":
                                await _emit_thinking(seg_content)
                            elif seg_type == "message":
                                step_message_acc[0] += seg_content
                                await _emit_message(seg_content)
                            # "code" (the <file> escape hatch) is intentionally
                            # NOT streamed live here — it's only surfaced once
                            # complete, via patch_applied below, so a half
                            # written full-file rewrite never flashes into the
                            # code panel during what's meant to be a small step.

                for seg_type, seg_content in parser.flush():
                    if seg_type == "thinking":
                        await _emit_thinking(seg_content)
                    elif seg_type == "message":
                        step_message_acc[0] += seg_content
                        await _emit_message(seg_content)

            except (AINoKeysError, AIAllFailedError) as exc:
                raise RuntimeError(str(exc)) from exc

            patches = parser.patches
            step_full_html = parser.full_html
            status = "DONE" if parser.is_done else ("CONTINUE" if parser.wants_continuation else "")
            step_message = step_message_acc[0]

            if not patches and not step_full_html.strip() and not status:
                repaired = await _maybe_repair_patch_step_response(
                    service, raw_response_acc[0], pb_ai
                )
                if repaired:
                    try:
                        reparsed = parse_patch_step_response(repaired)
                        validate_patch_step_response(reparsed)
                        patches = reparsed.patches
                        step_full_html = reparsed.file.get("content", "")
                        status = reparsed.status
                        if not step_message.strip():
                            combined = " ".join(
                                s for s in (reparsed.message, reparsed.footer) if s
                            )
                            if combined:
                                step_message = combined
                                await _emit_message(combined)
                    except ValueError:
                        logger.warning("ws_app: repaired patch-step response still invalid")

            if not patches and not step_full_html.strip():
                retries_this_step += 1
                logger.warning(
                    "ws_app: modify step %d produced neither patch nor file "
                    "(retry %d/%d)",
                    step_index, retries_this_step, MAX_STEP_RETRIES,
                )
                if retries_this_step > MAX_STEP_RETRIES:
                    return False
                extra_feedback = (
                    "\n\nYour previous response did not include a valid "
                    "<patch> or <file> block. Please resend this step with one."
                )
                continue

            if step_full_html.strip():
                new_html = step_full_html
                apply_ok, fail_reason, failing_find = True, "", ""
            else:
                new_html, apply_ok, fail_reason, failing_find = _apply_patch_group(
                    current_html, patches
                )

            if not apply_ok:
                retries_this_step += 1
                logger.warning(
                    "ws_app: modify step %d patch application failed "
                    "reason=%s (retry %d/%d)",
                    step_index, fail_reason, retries_this_step, MAX_STEP_RETRIES,
                )
                if retries_this_step > MAX_STEP_RETRIES:
                    return False
                reason_hint = {
                    "ambiguous": (
                        "That FIND text matches multiple locations in the "
                        "current HTML. Add a few more surrounding lines so it "
                        "uniquely identifies one spot."
                    ),
                    "not_found": (
                        "That FIND text could not be located in the current "
                        "HTML. Copy it again exactly (verbatim, including "
                        "whitespace) from the HTML shown above."
                    ),
                    "unverified": (
                        "That patch could not be applied with full "
                        "confidence. Copy the FIND text again exactly from "
                        "the current HTML shown above."
                    ),
                    "empty_find": "The FIND text was empty. Provide the exact text to find.",
                }.get(fail_reason, "That patch could not be applied. Please try again.")
                extra_feedback = (
                    f"\n\nYour last step's patch failed to apply "
                    f"(FIND text started with: {failing_find.strip()[:200]!r}). "
                    f"{reason_hint}"
                )
                continue

            # ── Success — commit this step's change ─────────────────────
            retries_this_step = 0
            current_html = new_html
            html_acc_holder["val"] = current_html
            if project_id and project_id in _active_generations:
                _active_generations[project_id]["html_acc"] = current_html

            summary = step_message.strip() or "Applied a change."
            completed_summaries.append(summary)
            step_index += 1

            await sio.emit(
                "patch_applied",
                {"request_id": request_id, "step": step_index, "html": current_html},
                room=emit_target,
            )
            if project_id and pb:
                await patch_project_record_with_client(
                    pb, project_id, html=current_html, status="generating"
                )

            if status != "CONTINUE":
                # DONE, or no explicit status after a successfully-applied
                # step — stop rather than loop indefinitely on ambiguity.
                return True

        logger.warning(
            "ws_app: modify loop hit MAX_AGENTIC_STEPS=%d while still "
            "CONTINUE — stopping with the progress made so far",
            MAX_AGENTIC_STEPS,
        )
        return True

    # ── Branch A: full generation (brand-new project) ─────────────────────
    if not is_modification:
        chat_messages = history + [_make_user_message(prompt)]
        await _stream_full_file(AGENT_PROMPT, chat_messages)

        _msg_nl.finish()
        reply = _message_acc[0].strip("\r\n")
        return reply or "Done! Let me know if you'd like any changes."

    # ── Branch B: agentic small-patch loop (modification) ──────────────────
    #
    # Each AI call returns exactly one small patch (or, rarely, a full-file
    # escape hatch for that step) which is applied and shown live before the
    # next call is made. If patch application keeps failing even after
    # feedback-guided retries, fall back to one full-file regeneration for
    # the turn — never leave the file partially/incorrectly edited.
    patch_loop_ok = await _run_patch_step_loop()

    if not patch_loop_ok:
        logger.warning(
            "ws_app: modify request_id=%s patch loop escalated to full-file "
            "fallback", request_id,
        )
        await _emit_thinking(
            "\n[Small-patch editing could not apply cleanly — regenerating "
            "the full file as a safety net...]\n"
        )
        fallback_user_text = (
            f"Current page HTML:\n```html\n{html_acc_holder['val'] or existing_html}\n```\n\n"
            f"User request: {prompt}"
        )
        fallback_messages = history + [_make_user_message(fallback_user_text)]
        completed = await _stream_full_file(MODIFY_FALLBACK_PROMPT, fallback_messages)
        new_html = html_acc_holder["val"]

        if not completed or not new_html.strip():
            logger.warning(
                "ws_app: modify request_id=%s fallback did not complete a "
                "full file (completed=%s, len=%d) — keeping last-known-good HTML",
                request_id, completed, len(new_html),
            )
            html_acc_holder["val"] = new_html.strip() or existing_html
            await _emit_message(
                "\n\n⚠️ I couldn't complete that change. Please try again or "
                "rephrase your request."
            )

    _msg_nl.finish()
    reply = _message_acc[0].strip("\r\n")
    return reply or "Done! Let me know if you'd like any further changes."


# ---------------------------------------------------------------------------
# Socket.IO event handlers
# ---------------------------------------------------------------------------


@sio.on("subscribe_project")
async def subscribe_project(sid, data):
    """Reconnecting client rejoins a live generation stream."""
    if not isinstance(data, dict):
        return
    project_id = (data.get("project_id") or "").strip()
    if not project_id:
        await sio.emit("project_snapshot", {"active": False}, room=sid)
        return

    gen = _active_generations.get(project_id)
    if not gen:
        await sio.emit("project_snapshot", {"active": False}, room=sid)
        return

    snapshot = {
        "active": True,
        "request_id": gen["request_id"],
        "thinking": gen["thinking_acc"],
        "html": gen["html_acc"],
        "reply": gen["reply"],
    }
    await sio.enter_room(sid, f"project-{project_id}")
    await sio.emit("project_snapshot", snapshot, room=sid)
    logger.info(
        "subscribe_project sid=%s project=%s thinking=%d html=%d",
        sid,
        project_id,
        len(gen["thinking_acc"]),
        len(gen["html_acc"]),
    )


@sio.on("user_message")
async def user_message(sid, data):
    if not isinstance(data, dict):
        return
    text = (data.get("text") or "").strip()
    request_id = data.get("request_id") or "unknown"
    raw_pid = data.get("project_id")
    project_id = (
        raw_pid.strip() if isinstance(raw_pid, str) and raw_pid.strip() else None
    )
    user_message_id = (data.get("user_message_id") or "").strip() or None
    attachments = data.get("attachments") or []

    logger.info(
        "user_message sid=%s request_id=%s len=%d project_id=%s attachments=%d",
        sid,
        request_id,
        len(text),
        project_id or "-",
        len(attachments),
    )

    if request_id in _generation_tasks and not _generation_tasks[request_id].done():
        logger.warning("duplicate request_id=%s ignored", request_id)
        if project_id:
            await _enqueue_preview(project_id)
        return

    if project_id:
        await _enqueue_preview(project_id)

    t = asyncio.create_task(
        _stream_generation(sid, text, request_id, project_id, user_message_id, attachments)
    )
    _generation_tasks[request_id] = t

    def _cleanup(_: asyncio.Task) -> None:
        _generation_tasks.pop(request_id, None)

    t.add_done_callback(_cleanup)


@sio.on("stop_generation")
async def stop_generation(sid, data):
    if not isinstance(data, dict):
        return
    request_id = data.get("request_id")
    if not request_id:
        return
    task = _generation_tasks.get(request_id)
    if task and not task.done():
        task.cancel()
        logger.info("stop_generation sid=%s request_id=%s", sid, request_id)


# ---------------------------------------------------------------------------
# ASGI entry (lifespan starts preview worker without waiting for Socket.IO)
# ---------------------------------------------------------------------------


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                try:
                    _ensure_preview_worker_running()
                except Exception:
                    logger.exception("ws_app: preview worker failed to start at lifespan")
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
        return
    await _sio_asgi_inner(scope, receive, send)
