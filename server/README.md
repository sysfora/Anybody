# Dummy Socket.IO server (chat demo)

Streams fake **reasoning** and **HTML** over Socket.IO when the chat UI emits `user_message`. Generation is **decoupled from the browser**: closing the tab or losing the socket does **not** cancel work; the server keeps streaming and persisting to PocketBase until the job finishes or the client sends `stop_generation`.

## Setup

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Uses the official **[pocketbase](https://pypi.org/project/pocketbase/)** Python SDK (sync client; called from async code via `asyncio.to_thread`).

## Environment (PocketBase persistence)

When the client sends `project_id` (PocketBase `projects` record id), the server:

1. Creates **`project_messages`** rows: one **user** message and one **assistant** message (empty at first).
2. Sets `projects.status` to **`generating`**, clears `projects.html` for that turn, then **patches partial HTML** and assistant **`thinking`** while streaming.
3. On success: final **`html`**, assistant **`content`**, `projects.status` **`completed`**.

Set the same variables as your Next.js app (e.g. in repo root `.env` — load them before `uvicorn`, or export in the shell):

| Variable | Description |
|----------|-------------|
| `POCKETBASE_URL` or `NEXT_PUBLIC_POCKETBASE_URL` | PocketBase base URL (no trailing slash) |
| `POCKETBASE_SUPERADMIN_EMAIL` | Superadmin email |
| `POCKETBASE_SUPERADMIN_PASSWORD` | Superadmin password |

If these are missing, streaming still works; DB writes are skipped.

### `404` on `/api/admins/auth-with-password`

`POCKETBASE_URL` / `NEXT_PUBLIC_POCKETBASE_URL` must be the **origin where PocketBase serves `/api/*`**, not a generic site homepage. If auth returns **404**, the host or path is wrong (e.g. PocketBase on another subdomain, or under a subpath like `https://example.com/pb`). Fix the URL in `.env`; the Socket.IO server will log a warning and **keep streaming** without saving to the DB until the URL is correct.

Create the **`project_messages`** collection in PocketBase (see root **README** → Chat projects for field list).

## Run

```bash
# from repo root (loads root .env if you use a tool, or export vars manually)
npm run dev:ws
```

Or manually:

```bash
cd server
python3 -m uvicorn ws_app:app --host 127.0.0.1 --port 5000 --reload
```

## Frontend

- The chat UI starts **empty** (no seed thread). Every turn is driven by this server after you send a message.
- Set `NEXT_PUBLIC_WS_URL` if the server is not at `http://localhost:5000` (see `lib/socket.ts`).
- Run Next (`npm run dev`) **and** this server so the header does not show **Offline** and send is enabled.
- After a refresh, the Next app loads **messages + HTML + status** from `GET /api/projects/load` and polls while `status === generating`.

## Streaming speed

In `ws_app.py`, adjust `THINKING_DELAY_S`, `CODE_DELAY_S`, and chunk sizes at the top of the file if you want faster or slower demo streaming. Partial DB flush intervals: `THINKING_FLUSH_CHARS`, `HTML_FLUSH_CHARS`.

## Events

| Direction | Event | Payload |
|-----------|--------|---------|
| Client → server | `user_message` | `{ text, request_id, project_id? }` — optional `project_id` = PocketBase projects record id for saving HTML and messages server-side |
| Client → server | `stop_generation` | `{ request_id: string }` — cancels the in-flight stream for that **request_id** (tasks are keyed by `request_id`, not socket id) |
| Server → client | `thinking_chunk` | `{ request_id, chunk }` |
| Server → client | `code_chunk` | `{ request_id, chunk }` |
| Server → client | `assistant_reply` | `{ request_id, message }` |
| Server → client | `generation_done` | `{ request_id }` |
| Server → client | `generation_error` | `{ request_id, message }` |
| Server → client | `generation_stopped` | `{ request_id }` — emitted when the stream was cancelled via `stop_generation` |
