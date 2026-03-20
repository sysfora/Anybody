"""
Dummy Socket.IO server: fake thinking + streamed HTML from the user's message.
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

from pocketbase_save import save_project_html

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dummy_ws")

# Tune streaming pace (seconds between chunks) for easier UI inspection.
THINKING_CHARS_PER_CHUNK = 2
THINKING_DELAY_S = 0.11
CODE_CHUNK_MIN = 6
CODE_CHUNK_MAX = 18
CODE_DELAY_S = 0.09

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)
app = socketio.ASGIApp(sio)

_generation_tasks: dict[str, asyncio.Task] = {}


def _task_key(sid: str, request_id: str) -> str:
    return f"{sid}:{request_id}"


@sio.event
async def connect(sid, _environ):
    logger.info("client connected %s", sid)


@sio.event
async def disconnect(sid):
    logger.info("client disconnected %s", sid)
    for key, t in list(_generation_tasks.items()):
        if key.startswith(f"{sid}:") and not t.done():
            t.cancel()


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
    <footer>Generated via Python Socket.IO · not persisted</footer>
  </main>
</body>
</html>"""


async def _stream_generation(
    sid: str,
    user_text: str,
    request_id: str,
    project_id: str | None = None,
) -> None:
    thinking_lines = [
        f'Parsing user intent from: "{user_text[:120]}{"…" if len(user_text) > 120 else ""}"\n\n',
        "Selecting single-file HTML output (no build step).\n\n",
        "Drafting semantic <main>, accessible heading, and a summary card.\n\n",
        "Streaming markup to the client for live preview.\n",
    ]

    try:
        for line in thinking_lines:
            for i in range(0, len(line), THINKING_CHARS_PER_CHUNK):
                chunk = line[i : i + THINKING_CHARS_PER_CHUNK]
                await sio.emit(
                    "thinking_chunk",
                    {"request_id": request_id, "chunk": chunk},
                    room=sid,
                )
                await asyncio.sleep(THINKING_DELAY_S)

        doc = _build_fake_html(user_text)
        span = len(doc) // 35 if len(doc) > 35 else len(doc)
        step = max(CODE_CHUNK_MIN, min(CODE_CHUNK_MAX, span))
        for i in range(0, len(doc), step):
            await sio.emit(
                "code_chunk",
                {"request_id": request_id, "chunk": doc[i : i + step]},
                room=sid,
            )
            await asyncio.sleep(CODE_DELAY_S)

        if project_id:
            await save_project_html(project_id, doc)

        await sio.emit(
            "assistant_reply",
            {
                "request_id": request_id,
                "message": (
                    "Streamed a fresh `index.html` from the dummy Python server. "
                    "The preview and code panel update as chunks arrive."
                ),
            },
            room=sid,
        )
        await sio.emit("generation_done", {"request_id": request_id}, room=sid)
    except asyncio.CancelledError:
        await sio.emit(
            "generation_stopped",
            {"request_id": request_id},
            room=sid,
        )
        logger.info("generation cancelled sid=%s request_id=%s", sid, request_id)
        raise
    except Exception as e:
        logger.exception("generation failed")
        await sio.emit(
            "generation_error",
            {"request_id": request_id, "message": str(e)},
            room=sid,
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
    key = _task_key(sid, request_id)
    t = asyncio.create_task(_stream_generation(sid, text, request_id, project_id))
    _generation_tasks[key] = t

    def _cleanup(_: asyncio.Task) -> None:
        _generation_tasks.pop(key, None)

    t.add_done_callback(_cleanup)


@sio.on("stop_generation")
async def stop_generation(sid, data):
    if not isinstance(data, dict):
        return
    request_id = data.get("request_id")
    if not request_id:
        return
    key = _task_key(sid, request_id)
    task = _generation_tasks.get(key)
    if task and not task.done():
        task.cancel()
        logger.info("stop_generation sid=%s request_id=%s", sid, request_id)
