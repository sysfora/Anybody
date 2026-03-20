# Dummy Socket.IO server (chat demo)

Streams fake **reasoning** and **HTML** over Socket.IO when the chat UI emits `user_message`.

## Setup

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Environment (PocketBase persistence)

When the client sends `project_id` (PocketBase `projects` record id), the server saves the generated HTML to that record (`html` + `status: completed`) using the **admin** API. Set the same variables as your Next.js app (e.g. in repo root `.env` — load them before `uvicorn`, or export in the shell):

| Variable | Description |
|----------|-------------|
| `POCKETBASE_URL` or `NEXT_PUBLIC_POCKETBASE_URL` | PocketBase base URL (no trailing slash) |
| `POCKETBASE_SUPERADMIN_EMAIL` | Superadmin email |
| `POCKETBASE_SUPERADMIN_PASSWORD` | Superadmin password |

If these are missing, streaming still works; the DB save is skipped.

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

## Streaming speed

In `ws_app.py`, adjust `THINKING_DELAY_S`, `CODE_DELAY_S`, and chunk sizes at the top of the file if you want faster or slower demo streaming.

## Events

| Direction | Event | Payload |
|-----------|--------|---------|
| Client → server | `user_message` | `{ text, request_id, project_id? }` — optional `project_id` = PocketBase projects record id for saving HTML server-side |
| Client → server | `stop_generation` | `{ request_id: string }` — cancels the in-flight stream for that id |
| Server → client | `thinking_chunk` | `{ request_id, chunk }` |
| Server → client | `code_chunk` | `{ request_id, chunk }` |
| Server → client | `assistant_reply` | `{ request_id, message }` |
| Server → client | `generation_done` | `{ request_id }` |
| Server → client | `generation_error` | `{ request_id, message }` |
| Server → client | `generation_stopped` | `{ request_id }` — emitted when the stream was cancelled (client or disconnect) |
