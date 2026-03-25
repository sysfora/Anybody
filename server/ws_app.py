"""
Socket.IO server: streams AI-generated thinking + HTML; persists to PocketBase.

Generation continues if the client disconnects (tasks keyed by request_id).
Reconnecting clients can call subscribe_project to rejoin a live stream.

Run: uvicorn ws_app:app --host 0.0.0.0 --port 5000 --reload

AI model selection
------------------
API keys are loaded from the PocketBase ``api_Keys`` collection on first use.
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

try:
    from dotenv import load_dotenv

    _repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(_repo_root / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

import socketio

from ai_service import AIAllFailedError, AINoKeysError, AIService, ContinuationParser, ModifyStreamParser, StreamParser
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
OPTIMIZER_PROMPT: str = _load_prompt("Prompt Optimizer.txt")

# Injected as the system prompt for continuation calls (resuming cut-off HTML).
CONTINUATION_SYSTEM = (
    "You are resuming an HTML file generation that was cut off mid-output.\n"
    "Output ONLY the remaining HTML starting from exactly where the previous "
    "response stopped — do NOT repeat any HTML that has already been generated.\n"
    "Do NOT add a new ```html fence opener — just continue the raw HTML content.\n"
    "When the file is complete, close the code block with ``` on its own line "
    "and end with &&&DONE&&& on its own line."
)

MAX_CONTINUATION_ATTEMPTS = 3

# ---------------------------------------------------------------------------
# AI service (lazy-loaded singleton)
# ---------------------------------------------------------------------------

_ai_service: AIService = AIService()
_ai_keys_loaded = False
_ai_load_lock = asyncio.Lock()


async def _ensure_ai_loaded() -> AIService:
    """Load API keys from PocketBase on first call, then return the service."""
    global _ai_keys_loaded
    if _ai_keys_loaded:
        return _ai_service
    async with _ai_load_lock:
        if _ai_keys_loaded:
            return _ai_service
        try:
            async with pocketbase_admin() as pb:
                await _ai_service.load_keys(pb)
            _ai_keys_loaded = True
        except RuntimeError:
            logger.warning("ws_app: PocketBase not configured — AI keys not loaded")
        except Exception:
            logger.exception("ws_app: failed to load AI keys")
    return _ai_service


# ---------------------------------------------------------------------------
# Socket.IO app
# ---------------------------------------------------------------------------

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)
app = socketio.ASGIApp(sio)

_generation_tasks: dict[str, asyncio.Task] = {}

# In-flight state per project_id so reconnecting clients can receive a
# catch-up snapshot and join the live broadcast room.
# Shape: { project_id: { request_id, thinking_acc, html_acc, reply } }
_active_generations: dict[str, dict] = {}


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
    pb = None
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

        # Fetch the current HTML before resetting — used to detect modification mode.
        existing_html = ""
        if project_id and pb:
            existing_html = await fetch_project_html(pb, project_id)

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
        service = await _ensure_ai_loaded()
        use_ai = bool(service.get_keys("Agent"))

        if use_ai:
            ta_holder = {"val": thinking_acc}
            ha_holder = {"val": html_acc}
            reply_text = await _run_ai_generation(
                service=service,
                user_text=user_text,
                existing_html=existing_html,
                attachments=attachments or [],
                request_id=request_id,
                project_id=project_id,
                emit_target=emit_target,
                pb=pb,
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
        if cm is not None:
            await cm.__aexit__(None, None, None)


OPTIMIZER_MAX_CHARS = 250


async def _maybe_optimize_prompt(service: AIService, user_text: str) -> str:
    """Return an optimized version of ``user_text`` when it is short enough.

    The optimizer is skipped for prompts >= OPTIMIZER_MAX_CHARS characters
    (they are already detailed enough) and also when no Optimizer keys exist.
    """
    if len(user_text) >= OPTIMIZER_MAX_CHARS:
        return user_text
    if not service.get_keys("Optimizer"):
        logger.debug("ws_app: optimizer skipped — no Optimizer keys configured")
        return user_text
    try:
        optimized = await service.complete(
            [{"role": "user", "content": user_text}],
            "Optimizer",
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


# ---------------------------------------------------------------------------
# Patch utilities
# ---------------------------------------------------------------------------

MAX_PATCH_ITERATIONS = 5

# Matches <<<FIND>>>…<<<REPLACE>>>…<<<END>>> blocks (greedy-safe with DOTALL)
_PATCH_RE = re.compile(
    r"<<<FIND>>>(.*?)<<<REPLACE>>>(.*?)<<<END>>>",
    re.DOTALL,
)


def _apply_patches(html: str, response: str) -> tuple[str, int]:
    """Apply every patch block found in *response* to *html*.

    Returns ``(updated_html, number_of_patches_applied)``.
    Patches whose FIND text cannot be located are logged and skipped.
    """
    count = 0
    for m in _PATCH_RE.finditer(response):
        find_text = m.group(1).strip()
        replace_text = m.group(2).strip()
        if not find_text:
            continue
        if find_text in html:
            html = html.replace(find_text, replace_text, 1)
            count += 1
        else:
            logger.warning(
                "ws_app: patch FIND text not found in HTML (%.80r…)", find_text
            )
    return html, count


def _extract_patch_reply(response: str) -> str:
    """Return the closing message from a patch response.

    Takes the text after the last ``<<<END>>>`` block, strips markers, and
    returns the last non-empty line.
    """
    last_end = response.rfind("<<<END>>>")
    after = response[last_end + 9 :] if last_end != -1 else response
    after = re.sub(r"&&&(DONE|CONTINUE)&&&", "", after).strip()
    lines = [ln.strip() for ln in after.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


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
    assistant_message_id: str | None,
    thinking_acc_holder: dict,
    html_acc_holder: dict,
    since_thinking_holder: dict,
    since_html_holder: dict,
) -> str:
    """Drive real AI streaming; returns the full visible message text.

    * No existing HTML  → full generation (Agent Prompt).
      Streams thinking_chunk / message_chunk / code_chunk live.
    * Existing HTML     → patch loop (Modify Prompt, up to MAX_PATCH_ITERATIONS).
      Streams thinking_chunk / message_chunk live; streams patched HTML as
      code_chunks at the end of each iteration.
    """

    # ── Shared emit helpers ────────────────────────────────────────────────

    _message_acc = [""]  # mutable container so closures can update it

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
        _message_acc[0] += chunk
        await sio.emit(
            "message_chunk",
            {"request_id": request_id, "chunk": chunk},
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
    prompt = user_text if is_modification else await _maybe_optimize_prompt(service, user_text)

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

    # ── Branch A: full generation ──────────────────────────────────────────
    if not is_modification:
        parser = StreamParser()
        chat_messages = history + [_make_user_message(prompt)]

        try:
            async for ai_chunk in service.complete_stream(
                chat_messages, "Agent", system=AGENT_PROMPT
            ):
                t, content = ai_chunk["type"], ai_chunk["content"]
                if t == "model":
                    logger.info("ws_app: generating with %s", content)
                elif t == "thinking":
                    await _emit_thinking(content)
                elif t == "text":
                    for seg_type, seg_content in parser.feed(content):
                        if seg_type == "thinking":
                            await _emit_thinking(seg_content)
                        elif seg_type == "message":
                            await _emit_message(seg_content)
                        elif seg_type == "code":
                            await _emit_code(seg_content)

            for seg_type, seg_content in parser.flush():
                if seg_type == "message":
                    await _emit_message(seg_content)
                elif seg_type == "code":
                    await _emit_code(seg_content)

        except (AINoKeysError, AIAllFailedError) as exc:
            raise RuntimeError(str(exc)) from exc

        # ── Continuation: resume if the HTML was cut off mid-generation ──────
        # parser._state == "code" means the closing ``` was never received.
        # We pass the partial HTML back to the AI (potentially a different,
        # higher-context model) and ask it to continue from the exact cutoff.
        generation_complete = parser._state == "done"
        cont_attempt = 0

        while (
            not generation_complete
            and parser._state == "code"
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

            cont_messages = (
                history
                + [_make_user_message(prompt)]
                + [
                    {
                        "role": "assistant",
                        "content": f'```html file="index.html"\n{partial_html}',
                    },
                    {
                        "role": "user",
                        "content": (
                            "Your previous response was cut off before the HTML was "
                            "complete. Please CONTINUE the HTML from exactly where you "
                            "stopped. Output ONLY the remaining HTML — do NOT repeat "
                            "anything already written, do NOT add a new ```html fence. "
                            "When finished, close with ``` on its own line, then "
                            "&&&DONE&&& on its own line."
                        ),
                    },
                ]
            )

            cont_parser = ContinuationParser()
            try:
                async for ai_chunk in service.complete_stream(
                    cont_messages, "Agent", system=CONTINUATION_SYSTEM
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

                # Not done yet — loop again (cont_parser replaces parser for
                # the next iteration's state check).
                parser = cont_parser  # type: ignore[assignment]

            except (AINoKeysError, AIAllFailedError):
                logger.warning(
                    "ws_app: all models exhausted during continuation attempt %d",
                    cont_attempt,
                )
                break

        return _message_acc[0].strip() or "Done! Let me know if you'd like any changes."

    # ── Branch B: patch loop (modification) ───────────────────────────────
    current_html = existing_html
    iter_messages = list(history)

    for iteration in range(MAX_PATCH_ITERATIONS):
        if iteration == 0:
            user_content_text = (
                f"Current page HTML:\n```html\n{current_html}\n```\n\n"
                f"User request: {prompt}"
            )
            # First iteration may include image attachments (screenshot / mockup).
            call_user_msg = _make_user_message(user_content_text)
        else:
            user_content_text = (
                f"Updated HTML after your patches:\n```html\n{current_html}\n```\n\n"
                "Please continue making the remaining requested changes."
            )
            # Continuation turns are text-only — images were already sent in iter 0.
            call_user_msg = {"role": "user", "content": user_content_text}

        call_messages = iter_messages + [call_user_msg]
        parser = ModifyStreamParser()

        try:
            async for ai_chunk in service.complete_stream(
                call_messages, "Agent", system=MODIFY_PROMPT
            ):
                t, content = ai_chunk["type"], ai_chunk["content"]
                if t == "model":
                    logger.info(
                        "ws_app: modifying with %s (iter %d/%d)",
                        content, iteration + 1, MAX_PATCH_ITERATIONS,
                    )
                elif t == "thinking":
                    await _emit_thinking(content)
                elif t == "text":
                    for seg_type, seg_content in parser.feed(content):
                        if seg_type == "thinking":
                            await _emit_thinking(seg_content)
                        elif seg_type == "message":
                            await _emit_message(seg_content)

            for seg_type, seg_content in parser.flush():
                if seg_type == "thinking":
                    await _emit_thinking(seg_content)
                elif seg_type == "message":
                    await _emit_message(seg_content)

        except (AINoKeysError, AIAllFailedError) as exc:
            raise RuntimeError(str(exc)) from exc

        # Apply the patches collected by the parser.
        # Fallback: if the model ignored the patch format and returned a full
        # HTML block instead, use that directly (avoids returning unchanged HTML).
        if not parser.patches and parser.full_html:
            logger.info(
                "ws_app: iteration %d — model returned full HTML instead of "
                "patches (%d chars); using it directly",
                iteration + 1, len(parser.full_html),
            )
            current_html = parser.full_html
        else:
            patch_count = 0
            for find_text, replace_text in parser.patches:
                if not find_text:
                    continue
                if find_text in current_html:
                    current_html = current_html.replace(find_text, replace_text, 1)
                    patch_count += 1
                else:
                    # Fallback: normalize line endings and try again
                    normalized_html = current_html.replace("\r\n", "\n").replace("\r", "\n")
                    normalized_find = find_text.replace("\r\n", "\n").replace("\r", "\n")
                    if normalized_find in normalized_html:
                        idx = normalized_html.index(normalized_find)
                        current_html = (
                            current_html[:idx]
                            + replace_text
                            + current_html[idx + len(normalized_find):]
                        )
                        patch_count += 1
                        logger.info(
                            "ws_app: patch applied after line-ending normalization (%.80r…)",
                            find_text,
                        )
                    else:
                        logger.warning(
                            "ws_app: patch FIND text not found (%.80r…)", find_text
                        )
            logger.info(
                "ws_app: iteration %d — applied %d/%d patch(es)",
                iteration + 1, patch_count, len(parser.patches),
            )

        if parser.is_done or not parser.wants_continuation:
            break

        # Another iteration — give the AI context of what changed.
        # Use text-only for history entries (images already sent in iter 0).
        iter_messages.append({"role": "user", "content": user_content_text})
        iter_messages.append({"role": "assistant", "content": ""})  # placeholder

    # Stream the final patched HTML to client as code_chunks
    html_acc_holder["val"] = ""
    since_html_holder["val"] = 0
    STREAM_STEP = 40
    for i in range(0, len(current_html), STREAM_STEP):
        await _emit_code(current_html[i : i + STREAM_STEP])
        await asyncio.sleep(0.003)

    return _message_acc[0].strip() or "Done! Let me know if you'd like any further changes."


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
        return

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
