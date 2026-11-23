"""Streaming splitter that moves a leading <think>...</think> (or <thought>...) block out of content.

Only an opening tag at the very start of the response (after optional whitespace) is recognised, and only once:
literal tags later in the answer (a code sample, an HTML snippet) stay plain text.
"""

Seg = tuple[str, str]  # ("thinking" | "text", str)


class ThinkTagSplitter:
    def __init__(self, tag_names: list[str]):
        self._open = {f"<{t}>": f"</{t}>" for t in tag_names}
        self._buf = ""
        self._phase = "start"  # start -> inside -> after (or start -> after when no tag leads the response)
        self._close = ""
        self._strip_ws = False  # drop whitespace right after the closing tag

    def feed(self, text: str) -> list[Seg]:
        self._buf += text
        return self._drain(final=False)

    def flush(self) -> list[Seg]:
        return self._drain(final=True)

    def _drain(self, final: bool) -> list[Seg]:
        out: list[Seg] = []
        while self._buf:
            if self._phase == "start":
                s = self._buf.lstrip()
                if not s:
                    if final:
                        out.append(("text", self._buf))
                        self._buf = ""
                    break  # only whitespace so far: undecided
                hit = next((t for t in self._open if s.startswith(t)), None)
                if hit:
                    self._buf, self._close, self._phase = s[len(hit) :], self._open[hit], "inside"
                    continue
                if not final and any(t.startswith(s) for t in self._open):
                    break  # may still become an opening tag: hold back
                self._phase = "after"
            elif self._phase == "inside":
                idx = self._buf.find(self._close)
                if idx >= 0:
                    if idx:
                        out.append(("thinking", self._buf[:idx]))
                    self._buf = self._buf[idx + len(self._close) :]
                    self._phase, self._strip_ws = "after", True
                    continue
                hold = 0
                if not final:  # keep a possible partial closing tag at the end
                    for k in range(min(len(self._close) - 1, len(self._buf)), 0, -1):
                        if self._buf.endswith(self._close[:k]):
                            hold = k
                            break
                emit = self._buf[: len(self._buf) - hold]
                if emit:
                    out.append(("thinking", emit))
                self._buf = self._buf[len(self._buf) - hold :]
                break
            else:
                if self._strip_ws:
                    self._buf = self._buf.lstrip()
                    if not self._buf:
                        break
                    self._strip_ws = False
                out.append(("text", self._buf))
                self._buf = ""
        return _merge(out)


def _merge(segs: list[Seg]) -> list[Seg]:
    merged: list[Seg] = []
    for k, t in segs:
        if merged and merged[-1][0] == k:
            merged[-1] = (k, merged[-1][1] + t)
        else:
            merged.append((k, t))
    return merged
