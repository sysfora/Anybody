"""
Socket.IO server: streamed thinking + HTML; persists to PocketBase in the background.
Generation continues if the client disconnects (tasks keyed by request_id only).
Reconnecting clients can call subscribe_project to rejoin a live stream.
Run: uvicorn ws_app:app --host 0.0.0.0 --port 5000 --reload
"""
from __future__ import annotations

import asyncio
import html
import logging
from pathlib import Path

try:
    from dotenv import load_dotenv

    _repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(_repo_root / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

import socketio

from pocketbase_save import (
    create_message_with_client,
    patch_project_message_with_client,
    patch_project_record_with_client,
    pocketbase_admin,
    save_project_html,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dummy_ws")

THINKING_CHARS_PER_CHUNK = 2
THINKING_DELAY_S = 0.11
CODE_CHUNK_MIN = 6
CODE_CHUNK_MAX = 18
CODE_DELAY_S = 0.09
# Flush partial state so refresh shows progress
THINKING_FLUSH_CHARS = 400
HTML_FLUSH_CHARS = 2500

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)
app = socketio.ASGIApp(sio)

_generation_tasks: dict[str, asyncio.Task] = {}

# Tracks in-flight generation state per project_id so reconnecting clients
# can receive a catch-up snapshot and join the live broadcast room.
# Shape: { project_id: { request_id, thinking_acc, html_acc, reply } }
_active_generations: dict[str, dict] = {}


@sio.event
async def connect(sid, _environ):
    logger.info("client connected %s", sid)


@sio.event
async def disconnect(sid):
    logger.info("client disconnected %s (generation tasks keep running)", sid)


def _build_fake_html(user_text: str) -> str:
    safe = html.escape(user_text.strip() or "(empty prompt)")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Streamed preview</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      font-family: system-ui, sans-serif;
      margin: 0;
      padding: 2rem;
      background: #fafafa;
      color: #111;
      line-height: 1.5;
    }}
    @media (prefers-color-scheme: dark) {{
      body {{ background: #0a0a0a; color: #fafafa; }}
      .card {{ background: #171717; border-color: #262626; }}
    }}
    h1 {{ font-size: 1.25rem; font-weight: 600; margin: 0 0 1rem; }}
    .card {{
      padding: 1rem 1.25rem;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 0.5rem;
      max-width: 40rem;
    }}
    .label {{ font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #737373; margin-bottom: 0.5rem; }}
    .prompt {{ white-space: pre-wrap; word-break: break-word; }}
    footer {{ margin-top: 2rem; font-size: 0.8rem; color: #737373; }}
  </style>
</head>
<body>
  <main>
    <h1>Dummy server output</h1>
    <div class="card">
      <div class="label">Your message</div>
      <p class="prompt">{safe}</p>
    </div>
    <footer>Generated via Python Socket.IO · persisted when project_id is set</footer>
  </main>
</body>
</html>"""


async def _stream_generation(
    sid: str,
    user_text: str,
    request_id: str,
    project_id: str | None = None,
) -> None:
    assistant_message_id: str | None = None
    cm = None
    pb = None
    thinking_acc = ""
    html_acc = ""
    since_thinking_flush = 0
    since_html_flush = 0

    # Room name for multi-client broadcasting; falls back to just the sender sid.
    emit_target = f"project-{project_id}" if project_id else sid

    reply_text = (
        "Streamed a fresh `index.html` from the dummy Python server. "
        "The preview and code panel update as chunks arrive."
    )

    try:
        if project_id:
            try:
                cm = pocketbase_admin()
                pb = await cm.__aenter__()
            except RuntimeError:
                logger.warning(
                    "pocketbase not configured; streaming without DB persistence"
                )
                cm = None
                pb = None

        if project_id and pb:
            await create_message_with_client(
                pb,
                project_id,
                "user",
                user_text,
                request_id=request_id,
            )
            assistant_message_id = await create_message_with_client(
                pb,
                project_id,
                "assistant",
                "",
                request_id=request_id,
            )
            await patch_project_record_with_client(
                pb,
                project_id,
                html="",
                status="generating",
            )

        # Register in-flight state and join the project room so all
        # subscribed clients (including reconnects) receive every event.
        if project_id:
            _active_generations[project_id] = {
                "request_id": request_id,
                "thinking_acc": "",
                "html_acc": "",
                "reply": "",
            }
            await sio.enter_room(sid, f"project-{project_id}")

        thinking_lines = [
            f'Parsing user intent from: "{user_text[:120]}{"…" if len(user_text) > 120 else ""}"\n\n',
            "Selecting single-file HTML output (no build step).\n\n",
            "Drafting semantic <main>, accessible heading, and a summary card.\n\n",
            "Streaming markup to the client for live preview.\n",
        ]

        for line in thinking_lines:
            for i in range(0, len(line), THINKING_CHARS_PER_CHUNK):
                chunk = line[i : i + THINKING_CHARS_PER_CHUNK]
                thinking_acc += chunk
                since_thinking_flush += len(chunk)

                # Keep in-memory state fresh so subscribers get accurate snapshots.
                if project_id and project_id in _active_generations:
                    _active_generations[project_id]["thinking_acc"] = thinking_acc

                await sio.emit(
                    "thinking_chunk",
                    {"request_id": request_id, "chunk": chunk},
                    room=emit_target,
                )
                if (
                    assistant_message_id
                    and pb
                    and since_thinking_flush >= THINKING_FLUSH_CHARS
                ):
                    since_thinking_flush = 0
                    await patch_project_message_with_client(
                        pb,
                        assistant_message_id,
                        thinking=thinking_acc,
                    )
                await asyncio.sleep(THINKING_DELAY_S)

        doc = _build_fake_html(user_text)
        span = len(doc) // 35 if len(doc) > 35 else len(doc)
        step = max(CODE_CHUNK_MIN, min(CODE_CHUNK_MAX, span))
        for i in range(0, len(doc), step):
            chunk = doc[i : i + step]
            html_acc += chunk
            since_html_flush += len(chunk)

            # Keep in-memory state fresh.
            if project_id and project_id in _active_generations:
                _active_generations[project_id]["html_acc"] = html_acc

            await sio.emit(
                "code_chunk",
                {"request_id": request_id, "chunk": chunk},
                room=emit_target,
            )
            if project_id and pb and since_html_flush >= HTML_FLUSH_CHARS:
                since_html_flush = 0
                await patch_project_record_with_client(
                    pb,
                    project_id,
                    html=html_acc,
                    status="generating",
                )
            await asyncio.sleep(CODE_DELAY_S)

        if assistant_message_id and pb:
            await patch_project_message_with_client(
                pb,
                assistant_message_id,
                content=reply_text,
                thinking=thinking_acc,
            )

        if project_id and pb:
            await patch_project_record_with_client(
                pb,
                project_id,
                html=html_acc,
                status="completed",
            )
        elif project_id:
            await save_project_html(project_id, html_acc, status="completed")

        # Store final reply before broadcasting so late subscribers see it.
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
                pb,
                project_id,
                html=html_acc,
                status="cancelled",
            )
        await sio.emit(
            "generation_stopped",
            {"request_id": request_id},
            room=emit_target,
        )
        logger.info("generation cancelled request_id=%s", request_id)
        raise
    except Exception as e:
        logger.exception("generation failed")
        if assistant_message_id and pb:
            await patch_project_message_with_client(
                pb,
                assistant_message_id,
                content=f"Generation failed: {e}",
                thinking=thinking_acc,
            )
        if project_id and pb:
            await patch_project_record_with_client(
                pb,
                project_id,
                html=html_acc,
                status="error",
            )
        await sio.emit(
            "generation_error",
            {"request_id": request_id, "message": str(e)},
            room=emit_target,
        )
    finally:
        # Clean up in-memory state regardless of how generation ended.
        if project_id:
            _active_generations.pop(project_id, None)
        if cm is not None:
            await cm.__aexit__(None, None, None)


@sio.on("subscribe_project")
async def subscribe_project(sid, data):
    """Called by a reconnecting/refreshed client to rejoin a live generation stream.

    Responds with a ``project_snapshot`` event containing all accumulated
    thinking and HTML so the client can restore state, then adds the client
    to the broadcast room so future chunks arrive in real time.
    """
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

    # Snapshot the current accumulated state before joining the room.
    # After entering the room, future chunks stream to this client automatically.
    snapshot = {
        "active": True,
        "request_id": gen["request_id"],
        "thinking": gen["thinking_acc"],
        "html": gen["html_acc"],
        "reply": gen["reply"],
    }
    # Enter room first so no chunks are missed between snapshot and join.
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
    project_id = raw_pid.strip() if isinstance(raw_pid, str) and raw_pid.strip() else None
    logger.info(
        "user_message sid=%s request_id=%s len=%s project_id=%s",
        sid,
        request_id,
        len(text),
        project_id or "-",
    )
    if request_id in _generation_tasks and not _generation_tasks[request_id].done():
        logger.warning("duplicate request_id=%s ignored", request_id)
        return

    t = asyncio.create_task(_stream_generation(sid, text, request_id, project_id))
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
