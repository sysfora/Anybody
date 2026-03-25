# ── build stage ──────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Install dependencies into a separate prefix so they are easy to copy.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Copy installed packages from the builder stage.
COPY --from=builder /install /usr/local

# Copy application source.
COPY ws_app.py pocketbase_save.py ai_service.py ./
COPY prompts/ ./prompts/

# The server reads environment variables at runtime.
# Pass them via --env-file or -e flags when running the container.
# Example:
#   docker run --env-file .env -p 5000:5000 anybody-ws
#
# Required variables (see server/.env for reference):
#   ANTHROPIC_API_KEY
#   POCKETBASE_URL
#   POCKETBASE_SUPERADMIN_EMAIL
#   POCKETBASE_SUPERADMIN_PASSWORD
#   WS_SECRET  ← must match WS_SECRET in the Next.js .env (never NEXT_PUBLIC)

EXPOSE 5000

CMD ["uvicorn", "ws_app:app", "--host", "0.0.0.0", "--port", "5000"]
