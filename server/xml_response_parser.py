"""Parse structured XML-like AI responses (plan/message/file/footer/status).

Used for both brand-new generation and full-file edits — both flows return
the same tag structure, they only differ in the system prompt and whether
the current HTML is included as context.

Streaming uses explicit tag boundaries (safe for raw HTML inside ``<file>``).
Full-response parsing uses the same boundary extraction — not a whole-document
XML parse, which would break on unescaped ``<`` in HTML.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal
from xml.etree import ElementTree as ET

SegmentType = Literal["thinking", "message", "code"]

_MAX_CLOSE_TAG_LEN = len("</message>")

_FILE_OPEN_RE = re.compile(
    r'<file\s+name=["\']([^"\']+)["\']\s*>',
    re.IGNORECASE,
)
_STATUS_RE = re.compile(
    r"<status>\s*(DONE|CONTINUE)\s*</status>",
    re.IGNORECASE,
)
_PATCH_BLOCK_RE = re.compile(
    r"<<<FIND>>>(.*?)<<<REPLACE>>>(.*?)<<<END>>>",
    re.DOTALL,
)

REPAIR_PROMPT = """Fix the following response.

Rules:
- Do not modify code inside <file>.
- Do not modify HTML.
- Only restore missing or malformed XML-like tags and section order.
- Never add markdown code fences.

Response:

{response}
"""


@dataclass
class AgentStructuredResponse:
    plan: str = ""
    message: str = ""
    footer: str = ""
    status: str = ""
    file: dict[str, str] = field(default_factory=lambda: {"name": "", "content": ""})


@dataclass
class PatchStepStructuredResponse:
    """One step of the agentic small-patch modify loop."""

    plan: str = ""
    message: str = ""
    footer: str = ""
    status: str = ""
    patches: list[tuple[str, str]] = field(default_factory=list)
    file: dict[str, str] = field(default_factory=lambda: {"name": "", "content": ""})


def _extract_between(text: str, open_tag: str, close_tag: str) -> str:
    start = text.find(open_tag)
    if start == -1:
        return ""
    start += len(open_tag)
    end = text.find(close_tag, start)
    if end == -1:
        return ""
    return text[start:end]


def _extract_file(text: str) -> dict[str, str]:
    m = _FILE_OPEN_RE.search(text)
    if not m:
        return {"name": "", "content": ""}
    name = m.group(1)
    content_start = m.end()
    close = text.lower().find("</file>", content_start)
    if close == -1:
        return {"name": name, "content": text[content_start:]}
    return {"name": name, "content": text[content_start:close]}


def _extract_status(text: str) -> str:
    m = _STATUS_RE.search(text)
    return m.group(1).upper() if m else ""


def _extract_patches(text: str) -> list[tuple[str, str]]:
    patch_body = _extract_between(text, "<patch>", "</patch>")
    if not patch_body:
        return []
    return [(m.group(1), m.group(2)) for m in _PATCH_BLOCK_RE.finditer(patch_body)]


def parse_patch_step_response(response: str) -> PatchStepStructuredResponse:
    file_data = _extract_file(response)
    return PatchStepStructuredResponse(
        plan=_extract_between(response, "<plan>", "</plan>").strip(),
        message=_extract_between(response, "<message>", "</message>").strip(),
        footer=_extract_between(response, "<footer>", "</footer>").strip(),
        status=_extract_status(response),
        patches=_extract_patches(response),
        file={"name": file_data["name"], "content": file_data["content"]},
    )


def validate_patch_step_response(parsed: PatchStepStructuredResponse) -> None:
    missing: list[str] = []
    if not parsed.message:
        missing.append("message")
    if not parsed.status:
        missing.append("status")
    if not parsed.patches and not parsed.file.get("content"):
        missing.append("patch or file")
    if missing:
        raise ValueError(f"Missing tag(s): {', '.join(missing)}")


def parse_agent_response(response: str) -> AgentStructuredResponse:
    file_data = _extract_file(response)
    return AgentStructuredResponse(
        plan=_extract_between(response, "<plan>", "</plan>").strip(),
        message=_extract_between(response, "<message>", "</message>").strip(),
        footer=_extract_between(response, "<footer>", "</footer>").strip(),
        status=_extract_status(response),
        file={"name": file_data["name"], "content": file_data["content"]},
    )


def validate_agent_response(parsed: AgentStructuredResponse) -> None:
    missing: list[str] = []
    if not parsed.plan:
        missing.append("plan")
    if not parsed.message:
        missing.append("message")
    if not parsed.footer:
        missing.append("footer")
    if not parsed.status:
        missing.append("status")
    if not parsed.file.get("content"):
        missing.append("file")
    if missing:
        raise ValueError(f"Missing tag(s): {', '.join(missing)}")


def _strip_file(response: str) -> str:
    out = response
    for m in list(_FILE_OPEN_RE.finditer(response)):
        out = out.replace(m.group(0), "<file-placeholder/>")
        close = response.lower().find("</file>", m.end())
        if close != -1:
            out = out.replace(response[m.end() : close + len("</file>")], "")
    return out


def validate_response_xml_fragments(response: str) -> bool:
    """Sanity-check that *response* is well-formed plan/message/footer/status
    XML fragments (ignoring the ``<file>`` body, which may contain raw,
    unescaped HTML) plus a ``<file>`` tag. Used by callers that want a
    structural check without a full streaming parse."""
    wrapper = f"<root>{_strip_file(response)}</root>"
    try:
        root = ET.fromstring(wrapper)
    except ET.ParseError:
        return False
    for tag in ("plan", "message", "footer", "status"):
        if root.find(tag) is None:
            return False
    return _FILE_OPEN_RE.search(response) is not None


class _XmlSectionStreamParserBase:
    """Shared tag-boundary streaming logic."""

    def __init__(self) -> None:
        self._buf = ""
        self._state = "idle"
        self.is_done = False

    def feed(self, text: str) -> list[tuple[SegmentType, str]]:
        self._buf += text
        events: list[tuple[SegmentType, str]] = []
        while True:
            progressed = False

            if self._state == "idle":
                progressed = self._try_enter_section() or self._try_status()
            else:
                seg_type = self._segment_for_state()
                close_tag = self._close_tag_for_state()
                if close_tag and close_tag in self._buf:
                    idx = self._buf.index(close_tag)
                    chunk = self._buf[:idx]
                    if chunk and seg_type:
                        events.extend(self._emit_section(seg_type, chunk))
                    self._buf = self._buf[idx + len(close_tag) :]
                    self._on_close_section()
                    progressed = True
                else:
                    hold = _MAX_CLOSE_TAG_LEN - 1
                    if len(self._buf) > hold:
                        safe = self._buf[:-hold]
                        self._buf = self._buf[-hold:]
                        if safe and seg_type:
                            events.extend(self._emit_section(seg_type, safe))
                            progressed = True
                    break

            if not progressed:
                break

        return events

    def flush(self) -> list[tuple[SegmentType, str]]:
        events: list[tuple[SegmentType, str]] = []
        if self._state == "idle" and self._buf:
            while self._try_status() or self._try_enter_section():
                pass
        if self._state not in ("idle", "done"):
            seg_type = self._segment_for_state()
            if self._buf and seg_type:
                events.extend(self._emit_section(seg_type, self._buf))
            self._buf = ""
        elif self._state == "idle" and self._buf:
            # Unrecognized trailing text — discard per output contract.
            self._buf = ""
        return events

    def _emit_section(
        self, seg_type: SegmentType, content: str
    ) -> list[tuple[SegmentType, str]]:
        return [(seg_type, content)]

    def _segment_for_state(self) -> SegmentType | None:
        if self._state == "plan":
            return "thinking"
        if self._state in ("message", "footer"):
            return "message"
        if self._state == "file":
            return "code"
        return None

    def _close_tag_for_state(self) -> str | None:
        return {
            "plan": "</plan>",
            "message": "</message>",
            "file": "</file>",
            "footer": "</footer>",
        }.get(self._state)

    def _on_close_section(self) -> None:
        self._state = "idle"

    def _try_status(self) -> bool:
        m = _STATUS_RE.search(self._buf)
        if not m:
            return False
        status = m.group(1).upper()
        self._buf = self._buf[m.end() :]
        if status == "DONE":
            self.is_done = True
            self._state = "done"
        return True

    def _try_enter_section(self) -> bool:
        candidates: list[tuple[int, str, str]] = []

        for tag, state in (
            ("<plan>", "plan"),
            ("<message>", "message"),
            ("<footer>", "footer"),
        ):
            idx = self._buf.find(tag)
            if idx != -1:
                candidates.append((idx, state, tag))

        fm = _FILE_OPEN_RE.search(self._buf)
        if fm:
            candidates.append((fm.start(), "file", fm.group(0)))

        if not candidates:
            return False

        candidates.sort(key=lambda x: x[0])
        idx, state, opener = candidates[0]
        self._buf = self._buf[idx + len(opener) :]
        self._state = state
        return True


class AgentStreamParser(_XmlSectionStreamParserBase):
    """Stream Agent responses: plan → thinking, message/footer → message, file → code."""

    @property
    def in_file(self) -> bool:
        return self._state == "file"


class ContinuationStreamParser(_XmlSectionStreamParserBase):
    """Resume generation cut off inside ``<file>`` — emits code until ``</file>``."""

    def __init__(self) -> None:
        super().__init__()
        self._state = "file"

    @property
    def in_file(self) -> bool:
        return self._state == "file"

    def _try_enter_section(self) -> bool:
        if self._state == "file":
            fm = _FILE_OPEN_RE.search(self._buf)
            if fm:
                self._buf = self._buf[fm.end() :]
                return True
            return False
        return super()._try_enter_section()


class PatchStepStreamParser(_XmlSectionStreamParserBase):
    """Stream one step of the agentic small-patch modify loop.

    Accumulates ``<patch>`` FIND/REPLACE blocks and supports the ``<file>``
    escape hatch for when patching isn't feasible for a given step. Unlike
    :class:`AgentStreamParser`, ``<status>CONTINUE</status>`` is a normal,
    meaningful outcome here (not just DONE) — it's what drives the agentic
    loop to call the model again for the next step.
    """

    _PATCH_HOLD = max(len("<<<FIND>>>"), len("<<<REPLACE>>>"), len("<<<END>>>")) - 1

    def __init__(self) -> None:
        super().__init__()
        self._patch_buf = ""
        self._find_acc = ""
        self._replace_acc = ""
        self._patch_substate: Literal["body", "find", "replace"] = "body"
        self._file_acc = ""
        self.patches: list[tuple[str, str]] = []
        self.full_html: str = ""
        self.wants_continuation = False

    @property
    def in_file(self) -> bool:
        return self._state == "file"

    @property
    def partial_file_content(self) -> str:
        """Accumulated ``<file>`` content, including when ``</file>`` was
        never seen (i.e. the response was cut off mid-file)."""
        return self._file_acc

    def feed(self, text: str) -> list[tuple[SegmentType, str]]:
        if self._state == "patch":
            self._patch_buf += text
            self._drain_patch(final=False)
            if self._buf:
                return self.feed("")
            return []
        events = super().feed(text)
        if self._state == "patch":
            self._drain_patch(final=False)
            if self._buf:
                events.extend(self.feed(""))
        return events

    def flush(self) -> list[tuple[SegmentType, str]]:
        if self._state == "patch":
            self._drain_patch(final=True)
        events = super().flush()
        if self._buf:
            events.extend(super().feed(""))
            self._buf = ""
        return events

    def _try_enter_section(self) -> bool:
        patch_idx = self._buf.find("<patch>")
        other_idx = self._earliest_other_section_idx()
        if patch_idx != -1 and (other_idx is None or patch_idx < other_idx):
            self._patch_buf = self._buf[patch_idx + len("<patch>") :]
            self._buf = ""
            self._state = "patch"
            self._patch_substate = "body"
            self._find_acc = ""
            self._replace_acc = ""
            return True
        return super()._try_enter_section()

    def _earliest_other_section_idx(self) -> int | None:
        indices = []
        for tag in ("<plan>", "<message>", "<footer>"):
            idx = self._buf.find(tag)
            if idx != -1:
                indices.append(idx)
        fm = _FILE_OPEN_RE.search(self._buf)
        if fm:
            indices.append(fm.start())
        return min(indices) if indices else None

    def _drain_patch(self, *, final: bool) -> None:
        """Consume ``self._patch_buf`` (raw text inside ``<patch>...</patch>``),
        scanning for the ``<<<FIND>>>`` / ``<<<REPLACE>>>`` / ``<<<END>>>``
        markers and the closing ``</patch>`` tag. Any bytes not yet safely
        past a possible partial-marker boundary are held back for the next
        chunk, unless ``final`` (end of stream) is set.
        """
        while True:
            close_idx = self._patch_buf.find("</patch>")

            if self._patch_substate == "body":
                marker_idx = self._patch_buf.find("<<<FIND>>>")
                if marker_idx != -1 and (close_idx == -1 or marker_idx < close_idx):
                    self._patch_buf = self._patch_buf[marker_idx + len("<<<FIND>>>") :]
                    self._patch_substate = "find"
                    self._find_acc = ""
                    continue
                if close_idx != -1:
                    self._buf = self._patch_buf[close_idx + len("</patch>") :] + self._buf
                    self._patch_buf = ""
                    self._state = "idle"
                    return
                if not final:
                    hold = self._PATCH_HOLD
                    if len(self._patch_buf) > hold:
                        self._patch_buf = self._patch_buf[-hold:]
                return

            marker = "<<<REPLACE>>>" if self._patch_substate == "find" else "<<<END>>>"
            marker_idx = self._patch_buf.find(marker)
            if marker_idx != -1 and (close_idx == -1 or marker_idx < close_idx):
                chunk = self._patch_buf[:marker_idx]
                if self._patch_substate == "find":
                    self._find_acc += chunk
                    self._patch_substate = "replace"
                    self._replace_acc = ""
                else:
                    self._replace_acc += chunk
                    self.patches.append((self._find_acc, self._replace_acc))
                    self._find_acc = ""
                    self._replace_acc = ""
                    self._patch_substate = "body"
                self._patch_buf = self._patch_buf[marker_idx + len(marker) :]
                continue

            if close_idx != -1:
                # ``</patch>`` arrived before the marker we were waiting for —
                # treat the remaining body as belonging to the open segment so
                # nothing is silently dropped, then close the tag.
                chunk = self._patch_buf[:close_idx]
                if self._patch_substate == "find":
                    self._find_acc += chunk
                else:
                    self._replace_acc += chunk
                    self.patches.append((self._find_acc, self._replace_acc))
                self._find_acc = ""
                self._replace_acc = ""
                self._patch_substate = "body"
                self._buf = self._patch_buf[close_idx + len("</patch>") :] + self._buf
                self._patch_buf = ""
                self._state = "idle"
                return

            if final:
                chunk = self._patch_buf
                if self._patch_substate == "find":
                    self._find_acc += chunk
                else:
                    self._replace_acc += chunk
                self._patch_buf = ""
                return

            hold = self._PATCH_HOLD
            if len(self._patch_buf) > hold:
                safe = self._patch_buf[:-hold]
                self._patch_buf = self._patch_buf[-hold:]
                if self._patch_substate == "find":
                    self._find_acc += safe
                else:
                    self._replace_acc += safe
            return

    def _try_status(self) -> bool:
        m = _STATUS_RE.search(self._buf)
        if not m:
            return False
        status = m.group(1).upper()
        self._buf = self._buf[m.end() :]
        if status == "DONE":
            self.is_done = True
            self._state = "done"
        elif status == "CONTINUE":
            self.wants_continuation = True
            self._state = "done"
        return True

    def _emit_section(
        self, seg_type: SegmentType, content: str
    ) -> list[tuple[SegmentType, str]]:
        if self._state == "file":
            self._file_acc += content
            return []
        return super()._emit_section(seg_type, content)

    def _on_close_section(self) -> None:
        if self._state == "file":
            self.full_html = self._file_acc
            self._file_acc = ""
        super()._on_close_section()


StreamParser = AgentStreamParser
ContinuationParser = ContinuationStreamParser
