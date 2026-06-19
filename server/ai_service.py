"""AI Service: priority-based model selection with automatic failover.

Loads API keys from the PocketBase ``api_Keys`` collection, selects
models by ascending priority, and automatically rotates to the next
available model on token-limit, rate-limit, or similar transient errors.

Supported providers: OpenRouter, OpenAI, Anthropic.

Usage
-----
    service = AIService()

    # Streaming (Agent type) — loads ``api_Keys`` from PocketBase on each call
    async for chunk in service.complete_stream(messages, "Agent", pb, system=PROMPT):
        if chunk["type"] == "model":
            print("Using:", chunk["content"])
        elif chunk["type"] == "thinking":
            ...  # extended-thinking tokens
        elif chunk["type"] == "text":
            ...  # visible output tokens

    # Non-streaming (Optimizer type)
    result = await service.complete(messages, "Optimizer", pb, system=PROMPT)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, AsyncIterator, Literal

import httpx
from pocketbase import PocketBase

logger = logging.getLogger("ai_service")

Provider = Literal["OpenRouter", "OpenAI", "Anthropic"]
KeyType = Literal["Optimizer", "Agent"]

COLLECTION_API_KEYS = "api_Keys"

# HTTP status codes and body keywords that should trigger model fallback
_FALLBACK_STATUS_CODES = {429, 503, 529}
_FALLBACK_ERROR_KEYWORDS = (
    "context_length_exceeded",
    "maximum context length",
    "context window",
    "token limit",
    "rate limit",
    "rate_limit_exceeded",
    "overloaded_error",
    "overloaded",
    "too many tokens",
    "prompt is too long",
    "exceeds the maximum",
    "model_not_found",
    "model not found",
    "unavailable",
    "insufficient_quota",
    "reduce the length",
)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class AIFallbackError(Exception):
    """Signals that this model failed and the next one should be tried."""


class AINoKeysError(Exception):
    """No API keys configured for the requested type."""


class AIAllFailedError(Exception):
    """Every available model has been exhausted."""


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class ApiKey:
    id: str
    api: str
    provider: Provider
    model: str
    type: KeyType
    priority: float

    @property
    def endpoint(self) -> str:
        if self.provider == "OpenRouter":
            return "https://openrouter.ai/api/v1/chat/completions"
        if self.provider == "OpenAI":
            return "https://api.openai.com/v1/chat/completions"
        if self.provider == "Anthropic":
            return "https://api.anthropic.com/v1/messages"
        raise ValueError(f"Unknown provider: {self.provider!r}")

    @property
    def auth_headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self.provider == "Anthropic":
            h["x-api-key"] = self.api
            h["anthropic-version"] = "2023-06-01"
        else:
            h["Authorization"] = f"Bearer {self.api}"
            if self.provider == "OpenRouter":
                h["HTTP-Referer"] = os.environ.get(
                    "NEXT_PUBLIC_APP_URL", "https://anycoder.sysfora.io"
                )
                h["X-Title"] = "AnyCoder"
        return h

    # ------------------------------------------------------------------
    # Multimodal content helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _to_openai_content(content: Any) -> Any:
        """Convert internal content to OpenAI/OpenRouter multimodal format."""
        if not isinstance(content, list):
            return content  # plain string — unchanged
        parts = []
        for block in content:
            btype = block.get("type")
            if btype == "text":
                parts.append({"type": "text", "text": block.get("text", "")})
            elif btype == "image":
                mime = block.get("media_type", "image/jpeg")
                data = block.get("data", "")
                parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{data}"},
                })
        return parts

    @staticmethod
    def _to_anthropic_content(content: Any) -> Any:
        """Convert internal content to Anthropic multimodal format."""
        if not isinstance(content, list):
            return content
        parts = []
        for block in content:
            btype = block.get("type")
            if btype == "text":
                parts.append({"type": "text", "text": block.get("text", "")})
            elif btype == "image":
                parts.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": block.get("media_type", "image/jpeg"),
                        "data": block.get("data", ""),
                    },
                })
        return parts

    def build_payload(
        self,
        messages: list[dict[str, Any]],
        system: str | None = None,
        stream: bool = True,
        max_tokens: int = 16384,
    ) -> dict[str, Any]:
        if self.provider == "Anthropic":
            # Anthropic: separate system prompt + no system-role messages
            sys_prompt = system or next(
                (m["content"] for m in messages if m.get("role") == "system"),
                None,
            )
            anthropic_messages = [
                {**m, "content": self._to_anthropic_content(m["content"])}
                for m in messages
                if m.get("role") != "system"
            ]
            payload: dict[str, Any] = {
                "model": self.model,
                "messages": anthropic_messages,
                "max_tokens": max_tokens,
                "stream": stream,
            }
            if sys_prompt:
                payload["system"] = sys_prompt
        else:
            # OpenAI / OpenRouter: system goes as first message
            sys_prompt = system or next(
                (m["content"] for m in messages if m.get("role") == "system"),
                None,
            )
            oai_messages = [
                {**m, "content": self._to_openai_content(m["content"])}
                for m in messages
                if m.get("role") != "system"
            ]
            if sys_prompt:
                oai_messages = [{"role": "system", "content": sys_prompt}] + oai_messages
            payload = {
                "model": self.model,
                "messages": oai_messages,
                "stream": stream,
                "max_tokens": max_tokens,
            }
        return payload



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_fallback_error(status: int, body: str | None) -> bool:
    if status in _FALLBACK_STATUS_CODES:
        return True
    if body:
        body_lower = body.lower()
        return any(kw in body_lower for kw in _FALLBACK_ERROR_KEYWORDS)
    return False


_DEFAULT_TIMEOUT = httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)


# ---------------------------------------------------------------------------
# AIService
# ---------------------------------------------------------------------------


class AIService:
    """Priority-based AI model service with automatic failover.

    Keys are read from the PocketBase ``api_Keys`` collection on every
    ``complete_stream`` / ``complete`` call (no in-memory cache).

    Model selection
    ---------------
    Keys for the requested type are sorted by ``priority`` (ascending — lower
    number = higher priority).  The service tries them in order and moves to
    the next one whenever it encounters a fallback-worthy error (token limit,
    rate limit, overload, etc.).
    """

    @staticmethod
    async def fetch_keys_for_type(pb: PocketBase, key_type: KeyType) -> list[ApiKey]:
        """Load keys of *key_type* from PocketBase, sorted by priority (ascending)."""

        def _fetch() -> list[ApiKey]:
            records = pb.collection(COLLECTION_API_KEYS).get_full_list(
                query_params={"sort": "priority,created"}
            )
            keys: list[ApiKey] = []
            for r in records:
                try:
                    keys.append(
                        ApiKey(
                            id=str(r.id),
                            api=str(getattr(r, "api", "") or ""),
                            provider=str(getattr(r, "provider", "") or ""),
                            model=str(getattr(r, "model", "") or ""),
                            type=str(getattr(r, "type", "") or ""),
                            priority=float(getattr(r, "priority", 0) or 0),
                        )
                    )
                except Exception as exc:
                    logger.warning("ai_service: skipping malformed key %s: %s", r.id, exc)
            return keys

        try:
            keys = await asyncio.to_thread(_fetch)
        except Exception:
            logger.exception("ai_service: failed to load API keys from PocketBase")
            return []

        filtered = [
            k
            for k in keys
            if k.type == key_type and k.api.strip() and k.model.strip()
        ]
        return sorted(filtered, key=lambda k: k.priority)

    # ------------------------------------------------------------------
    # Streaming completion
    # ------------------------------------------------------------------

    async def complete_stream(
        self,
        messages: list[dict[str, Any]],
        type: KeyType,
        pb: PocketBase,
        *,
        system: str | None = None,
        max_tokens: int = 16384,
    ) -> AsyncIterator[dict[str, str]]:
        """Stream AI completion with automatic model fallback.

        Yields dicts:
          ``{"type": "model",    "content": "<model> (<provider>)"}``  — once, on first token
          ``{"type": "thinking", "content": "..."}``                   — reasoning tokens
          ``{"type": "text",     "content": "..."}``                   — visible output tokens
        """
        keys = await self.fetch_keys_for_type(pb, type)
        if not keys:
            raise AINoKeysError(f"No API keys configured for type '{type}'")

        last_error: Exception | None = None
        for key in keys:
            try:
                async for chunk in self._stream_key(key, messages, system, max_tokens):
                    yield chunk
                return  # success — stop iterating models
            except AIFallbackError as exc:
                logger.warning(
                    "ai_service: %s (%s) failed → trying next model. Reason: %s",
                    key.model,
                    key.provider,
                    exc,
                )
                last_error = exc
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception(
                    "ai_service: unexpected error with %s (%s)", key.model, key.provider
                )
                last_error = exc

        raise AIAllFailedError(
            f"All {len(keys)} model(s) for type '{type}' exhausted. Last error: {last_error}"
        )

    async def _stream_key(
        self,
        key: ApiKey,
        messages: list[dict[str, Any]],
        system: str | None,
        max_tokens: int,
    ) -> AsyncIterator[dict[str, str]]:
        payload = key.build_payload(messages, system=system, stream=True, max_tokens=max_tokens)
        yielded_model_event = False

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            async with client.stream(
                "POST", key.endpoint, headers=key.auth_headers, json=payload
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    body_str = body.decode(errors="ignore")
                    if _is_fallback_error(resp.status_code, body_str):
                        raise AIFallbackError(f"HTTP {resp.status_code}: {body_str[:300]}")
                    raise RuntimeError(f"HTTP {resp.status_code}: {body_str[:300]}")

                if not yielded_model_event:
                    yield {"type": "model", "content": f"{key.model} ({key.provider})"}
                    yielded_model_event = True

                if key.provider == "Anthropic":
                    async for chunk in self._parse_anthropic_stream(resp):
                        yield chunk
                else:
                    async for chunk in self._parse_openai_stream(resp):
                        yield chunk

    async def _parse_openai_stream(
        self, resp: httpx.Response
    ) -> AsyncIterator[dict[str, str]]:
        async for line in resp.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue

            if "error" in obj:
                err_str = json.dumps(obj["error"])
                if _is_fallback_error(0, err_str):
                    raise AIFallbackError(err_str[:300])
                raise RuntimeError(err_str[:300])

            for choice in obj.get("choices") or []:
                delta = choice.get("delta") or {}
                # o1/o3-style reasoning field
                reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                if reasoning:
                    yield {"type": "thinking", "content": reasoning}
                content = delta.get("content")
                if content:
                    yield {"type": "text", "content": content}

    async def _parse_anthropic_stream(
        self, resp: httpx.Response
    ) -> AsyncIterator[dict[str, str]]:
        async for line in resp.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue

            if obj.get("type") == "error":
                err = obj.get("error") or obj
                err_str = json.dumps(err)
                if _is_fallback_error(0, err_str):
                    raise AIFallbackError(err_str[:300])
                raise RuntimeError(err_str[:300])

            if obj.get("type") == "content_block_delta":
                delta = obj.get("delta") or {}
                dtype = delta.get("type")
                if dtype == "thinking_delta":
                    text = delta.get("thinking", "")
                    if text:
                        yield {"type": "thinking", "content": text}
                elif dtype == "text_delta":
                    text = delta.get("text", "")
                    if text:
                        yield {"type": "text", "content": text}

    # ------------------------------------------------------------------
    # Non-streaming completion (Optimizer)
    # ------------------------------------------------------------------

    async def complete(
        self,
        messages: list[dict[str, Any]],
        type: KeyType,
        pb: PocketBase,
        *,
        system: str | None = None,
        max_tokens: int = 2048,
    ) -> str:
        """Non-streaming completion with automatic model fallback.

        Returns the full response text as a string.
        """
        keys = await self.fetch_keys_for_type(pb, type)
        if not keys:
            raise AINoKeysError(f"No API keys configured for type '{type}'")

        last_error: Exception | None = None
        for key in keys:
            try:
                return await self._complete_key(key, messages, system, max_tokens)
            except AIFallbackError as exc:
                logger.warning(
                    "ai_service: %s (%s) failed → trying next model. Reason: %s",
                    key.model,
                    key.provider,
                    exc,
                )
                last_error = exc
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception(
                    "ai_service: unexpected error with %s (%s)", key.model, key.provider
                )
                last_error = exc

        raise AIAllFailedError(
            f"All {len(keys)} model(s) for type '{type}' exhausted. Last error: {last_error}"
        )

    async def _complete_key(
        self,
        key: ApiKey,
        messages: list[dict[str, Any]],
        system: str | None,
        max_tokens: int,
    ) -> str:
        payload = key.build_payload(
            messages, system=system, stream=False, max_tokens=max_tokens
        )
        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            resp = await client.post(key.endpoint, headers=key.auth_headers, json=payload)
            body_str = resp.text

            if resp.status_code != 200:
                if _is_fallback_error(resp.status_code, body_str):
                    raise AIFallbackError(f"HTTP {resp.status_code}: {body_str[:300]}")
                raise RuntimeError(f"HTTP {resp.status_code}: {body_str[:300]}")

            try:
                obj = resp.json()
            except Exception:
                raise RuntimeError(f"Invalid JSON: {body_str[:300]}")

            if "error" in obj:
                err_str = json.dumps(obj["error"])
                if _is_fallback_error(0, err_str):
                    raise AIFallbackError(err_str[:300])
                raise RuntimeError(err_str[:300])

            if key.provider == "Anthropic":
                content = obj.get("content") or []
                return "".join(
                    block.get("text", "")
                    for block in content
                    if block.get("type") == "text"
                )
            else:
                choices = obj.get("choices") or []
                if not choices:
                    raise RuntimeError(f"No choices in response: {body_str[:300]}")
                return choices[0].get("message", {}).get("content") or ""
