"""
Combines the ready-made caption from the sheet with your site link.
Keep this as its own module so it's easy to extend later
(e.g. add hashtags, add an AI-generated intro line, A/B test formats, etc.)
"""


def _parts(raw_caption: str, link: str, title: str) -> tuple[str, str, str]:
    raw_caption = (raw_caption or "").strip()
    link = (link or "").strip()
    title = (title or "").strip()

    return raw_caption, link, title


def build_caption(raw_caption: str, link: str, title: str = "") -> str:
    """Build the Telegram HTML caption."""
    raw_caption, link, title = _parts(raw_caption, link, title)

    parts = []
    if title:
        parts.append(f"<b>{title}</b>")
    if raw_caption:
        parts.append(raw_caption)
    if link:
        parts.append(f"🔗 {link}")

    return "\n\n".join(parts)


def build_bale_caption(raw_caption: str, link: str, title: str = "") -> str:
    """Build the same caption using Bale's Markdown-style bold syntax."""
    raw_caption, link, title = _parts(raw_caption, link, title)

    parts = []
    if title:
        parts.append(f"*{title}*")
    if raw_caption:
        parts.append(raw_caption)
    if link:
        parts.append(f"🔗 {link}")

    return "\n\n".join(parts)
