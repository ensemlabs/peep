"""Streaming extractor for markdown data-URI images: ![alt](data:image/png;base64,....)

Gemini returns generated images inline as one (possibly multi-MB) content delta. This splits a text stream
into plain text and decoded images, holding back only what could still turn out to be an image.
"""

import base64
import binascii
import re
from typing import Literal

Segment = tuple  # ("text", str) | ("image", alt, mime, bytes)

INVALID = "[invalid image]"
_MAX_ALT = 200
_MAX_PAYLOAD_CHARS = 150 * 1024 * 1024
_TARGET = "data:image/"
_B64_OK = re.compile(r"[A-Za-z0-9+/=]*")
_HEADER = re.compile(r"([A-Za-z0-9.+-]{1,32});base64,")
_HEADER_PARTIAL = re.compile(r"[A-Za-z0-9.+-]{0,32}(;(b(a(s(e(6(4(,)?)?)?)?)?)?)?)?")


class StreamingImageExtractor:
    def __init__(self) -> None:
        self._buf = ""  # undecided text, starting at "![" when _state == "head"
        self._state: Literal["text", "payload"] = "text"
        self._alt = ""
        self._mime = ""
        self._chunks: list[str] = []
        self._chars = 0
        self._bad = False

    # -- public --------------------------------------------------------------------------------

    def feed(self, text: str) -> list[Segment]:
        out: list[Segment] = []
        self._buf += text
        self._advance(out)
        return _merge(out)

    def flush(self) -> list[Segment]:
        """End of stream: release everything held back."""
        out: list[Segment] = []
        if self._state == "payload":
            out.append(("text", INVALID))
            self._reset_payload()
        elif self._buf:
            out.append(("text", self._buf))
        self._buf = ""
        return _merge(out)

    # -- internals -----------------------------------------------------------------------------

    def _reset_payload(self) -> None:
        self._state = "text"
        self._chunks = []
        self._chars = 0
        self._bad = False

    def _advance(self, out: list[Segment]) -> None:
        while True:
            if self._state == "payload":
                if not self._consume_payload(out):
                    return
                continue
            buf = self._buf
            i = buf.find("![")
            if i < 0:
                if buf.endswith("!"):
                    self._emit(out, buf[:-1])
                    self._buf = "!"
                else:
                    self._emit(out, buf)
                    self._buf = ""
                return
            if i:
                self._emit(out, buf[:i])
                self._buf = buf = buf[i:]
            verdict = self._parse_head(buf)
            if verdict == "hold":
                return
            if verdict == "no":
                self._emit(out, "![")
                self._buf = buf[2:]
            # verdict "yes": _parse_head switched to payload state and trimmed self._buf

    def _parse_head(self, buf: str) -> str:
        """Decide whether buf (starting with '![') begins a data-URI image: yes / no / hold."""
        close = buf.find("]", 2)
        if close < 0:
            window = buf[2 : 2 + _MAX_ALT + 1]
            if "\n" in window or len(buf) > 2 + _MAX_ALT:
                return "no"
            return "hold"
        alt = buf[2:close]
        if "\n" in alt or len(alt) > _MAX_ALT:
            return "no"
        rest = buf[close + 1 :]
        if not rest:
            return "hold"
        if rest[0] != "(":
            return "no"
        rest = rest[1:]
        if len(rest) < len(_TARGET):
            return "hold" if _TARGET.startswith(rest) else "no"
        if not rest.startswith(_TARGET):
            return "no"
        tail = rest[len(_TARGET) :]
        m = _HEADER.match(tail)
        if not m:
            return "hold" if _HEADER_PARTIAL.fullmatch(tail) else "no"
        self._alt = alt
        self._mime = "image/" + m.group(1).lower()
        self._buf = tail[m.end() :]
        self._state = "payload"
        return "yes"

    def _consume_payload(self, out: list[Segment]) -> bool:
        """Consume payload chars from self._buf. Returns True if the image ended (continue scanning)."""
        piece = self._buf
        end = piece.find(")")
        body = piece if end < 0 else piece[:end]
        if not _B64_OK.fullmatch(body):
            self._bad = True
        self._chunks.append(body)
        self._chars += len(body)
        if self._chars > _MAX_PAYLOAD_CHARS:
            self._bad = True
            self._chunks = []  # stop buffering; keep discarding until ')'
        if end < 0:
            self._buf = ""
            return False
        self._buf = piece[end + 1 :]
        payload = "".join(self._chunks)
        alt, mime, bad = self._alt, self._mime, self._bad
        self._reset_payload()
        data = b""
        if not bad:
            try:
                data = base64.b64decode(payload, validate=True)
            except (binascii.Error, ValueError):
                bad = True
        if bad or not data:
            out.append(("text", INVALID))
        else:
            out.append(("image", alt, mime, data))
        return True

    @staticmethod
    def _emit(out: list[Segment], text: str) -> None:
        if text:
            out.append(("text", text))


def _merge(segments: list[Segment]) -> list[Segment]:
    merged: list[Segment] = []
    for seg in segments:
        if seg[0] == "text" and merged and merged[-1][0] == "text":
            merged[-1] = ("text", merged[-1][1] + seg[1])
        else:
            merged.append(seg)
    return merged
