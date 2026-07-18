"""Parse structured XML-like AI responses for Agent and Modify flows.

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
- Do not modify code inside <file> or inside <<<FIND>>> / <<<REPLACE>>> blocks.
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
class ModifyStructuredResponse:
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


def parse_agent_response(response: str) -> AgentStructuredResponse:
    file_data = _extract_file(response)
    return AgentStructuredResponse(
        plan=_extract_between(response, "<plan>", "</plan>").strip(),
        message=_extract_between(response, "<message>", "</message>").strip(),
        footer=_extract_between(response, "<footer>", "</footer>").strip(),
        status=_extract_status(response),
        file={"name": file_data["name"], "content": file_data["content"]},
    )


def parse_modify_response(response: str) -> ModifyStructuredResponse:
    file_data = _extract_file(response)
    return ModifyStructuredResponse(
        plan=_extract_between(response, "<plan>", "</plan>").strip(),
        message=_extract_between(response, "<message>", "</message>").strip(),
        footer=_extract_between(response, "<footer>", "</footer>").strip(),
        status=_extract_status(response),
        patches=_extract_patches(response),
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


def validate_modify_response(parsed: ModifyStructuredResponse) -> None:
    missing: list[str] = []
    if not parsed.plan:
        missing.append("plan")
    if not parsed.message:
        missing.append("message")
    if not parsed.footer:
        missing.append("footer")
    if not parsed.status:
        missing.append("status")
    if not parsed.patches and not parsed.file.get("content"):
        missing.append("patch or file")
    if missing:
        raise ValueError(f"Missing tag(s): {', '.join(missing)}")


def _strip_file_and_patch(response: str) -> str:
    out = response
    for m in list(_FILE_OPEN_RE.finditer(response)):
        out = out.replace(m.group(0), "<file-placeholder/>")
        close = response.lower().find("</file>", m.end())
        if close != -1:
            out = out.replace(response[m.end() : close + len("</file>")], "")
    patch_start = out.find("<patch>")
    patch_end = out.find("</patch>")
    if patch_start != -1 and patch_end != -1:
        out = out[:patch_start] + "<patch-placeholder/>" + out[patch_end + len("</patch>") :]
    return out


def validate_response_xml_fragments(response: str, mode: Literal["agent", "modify"]) -> bool:
    wrapper = f"<root>{_strip_file_and_patch(response)}</root>"
    try:
        root = ET.fromstring(wrapper)
    except ET.ParseError:
        return False
    for tag in ("plan", "message", "footer", "status"):
        if root.find(tag) is None:
            return False
    if mode == "agent":
        return _FILE_OPEN_RE.search(response) is not None
    return bool(_extract_patches(response)) or _FILE_OPEN_RE.search(response) is not None


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


class ModifyStreamParser(_XmlSectionStreamParserBase):
    """Stream Modify responses; accumulates patches and optional full-file fallback."""

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
            if "</patch>" in self._patch_buf:
                self._close_patch()
            else:
                self._consume_patch_lines()
            if self._buf:
                return self.feed("")
            return []
        events = super().feed(text)
        if self._state == "patch":
            if "</patch>" in self._patch_buf:
                self._close_patch()
            else:
                self._consume_patch_lines()
            if self._buf:
                events.extend(self.feed(""))
        return events

    def flush(self) -> list[tuple[SegmentType, str]]:
        if self._state == "patch" and self._patch_buf:
            if "</patch>" in self._patch_buf:
                self._close_patch()
            else:
                self._consume_patch_text(self._patch_buf)
                self._patch_buf = ""
                self._state = "idle"
        events = super().flush()
        if self._buf:
            events.extend(super().feed(""))
            self._buf = ""
        return events

    def _try_enter_section(self) -> bool:
        idx = self._buf.find("<patch>")
        if idx != -1:
            self._patch_buf = self._buf[idx + len("<patch>") :]
            self._buf = ""
            self._state = "patch"
            self._patch_substate = "body"
            self._find_acc = ""
            self._replace_acc = ""
            return True
        return super()._try_enter_section()

    def _close_patch(self) -> None:
        body, _, rest = self._patch_buf.partition("</patch>")
        self._consume_patch_text(body)
        self._patch_buf = ""
        self._state = "idle"
        self._buf = rest + self._buf

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

    def _consume_patch_lines(self) -> None:
        while "\n" in self._patch_buf:
            line, self._patch_buf = self._patch_buf.split("\n", 1)
            self._process_patch_line(line + "\n")

    def _consume_patch_text(self, text: str) -> None:
        for line in text.splitlines(keepends=True):
            self._process_patch_line(line)
        if text and not text.endswith("\n"):
            self._process_patch_line(text)

    def _process_patch_line(self, line: str) -> None:
        stripped = line.strip()
        if stripped == "<<<FIND>>>":
            self._patch_substate = "find"
            self._find_acc = ""
            return
        if stripped == "<<<REPLACE>>>":
            self._patch_substate = "replace"
            self._replace_acc = ""
            return
        if stripped == "<<<END>>>":
            self.patches.append((self._find_acc, self._replace_acc))
            self._find_acc = ""
            self._replace_acc = ""
            self._patch_substate = "body"
            return
        if self._patch_substate == "find":
            self._find_acc += line
        elif self._patch_substate == "replace":
            self._replace_acc += line


StreamParser = AgentStreamParser
ContinuationParser = ContinuationStreamParser
