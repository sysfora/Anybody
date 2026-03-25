# ── build stage ──────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Playwright downloads Chromium into this path.
# We set it so the browser binaries can be copied into the runtime image.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install dependencies into a separate prefix so they are easy to copy.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# `pip --prefix=/install` does not place packages on Python's default sys.path,
# so `python -m playwright` would fail to import. Install Playwright into the
# builder environment too (small extra cost) so we can download Chromium.
RUN python -m pip install --no-cache-dir playwright==1.58.0

# Download browser binaries during build.
RUN python -m playwright install chromium

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Playwright downloads Chromium into this path.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Avoid interactive prompts during apt-get.
ENV DEBIAN_FRONTEND=noninteractive

# Chromium runtime deps (Debian/Ubuntu slim).
# Kept as a single layer for smaller rebuilds.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-freefont-ttf \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxrender1 \
    libu2f-udev \
    libvulkan1 \
    wget \
  && rm -rf /var/lib/apt/lists/*

# Copy installed packages from the builder stage.
COPY --from=builder /install /usr/local

# Copy Playwright browser binaries from the builder stage.
COPY --from=builder /ms-playwright /ms-playwright

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
