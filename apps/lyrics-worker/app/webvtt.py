from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class TimedWord:
    text: str
    start: float
    end: float


def format_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{milliseconds:03d}"


def _separator(previous: str, current: str) -> str:
    if not previous or not current:
        return ""
    return " " if previous[-1].isascii() and current[0].isascii() else ""


def _group_words(words: list[TimedWord]) -> list[list[TimedWord]]:
    groups: list[list[TimedWord]] = []
    current: list[TimedWord] = []
    for word in words:
        if current:
            previous = current[-1]
            should_break = (
                len(current) >= 8
                or word.end - current[0].start > 6
                or word.start - previous.end > 1.25
                or previous.text.rstrip().endswith((".", "?", "!", "。", "？", "！"))
            )
            if should_break:
                groups.append(current)
                current = []
        current.append(word)
    if current:
        groups.append(current)
    return groups


def build_webvtt(words: list[TimedWord], language: str | None = None) -> str:
    usable = [word for word in words if word.text.strip() and word.end > word.start >= 0]
    header = "WEBVTT"
    if language:
        header += f"\nKind: captions\nLanguage: {language}"
    blocks = [header]
    for group in _group_words(usable):
        start = group[0].start
        end = max(group[-1].end, start + 0.05)
        payload = escape(group[0].text.strip())
        previous_text = group[0].text.strip()
        for word in group[1:]:
            text = word.text.strip()
            timestamp = min(max(word.start, start + 0.001), end - 0.001)
            payload += f"<{format_timestamp(timestamp)}>{_separator(previous_text, text)}{escape(text)}"
            previous_text = text
        blocks.append(f"{format_timestamp(start)} --> {format_timestamp(end)}\n{payload}")
    return "\n\n".join(blocks) + "\n"
