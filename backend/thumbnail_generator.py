import asyncio
import io
import logging
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from supabase_client import supabase

logger = logging.getLogger(__name__)

# Canvas dimensions (standard OG image size)
CANVAS_W = 1200
CANVAS_H = 630
BG_COLOR = "#0F1117"

# Grid layout constants
PADDING_X = 20
PADDING_TOP = 80   # space for title
PADDING_BOTTOM = 20
NODE_W = 160
NODE_H = 60
GAP_X = 20
GAP_Y = 20
COLS = 4

# Category → hex color
CATEGORY_COLORS: dict[str, str] = {
    "network": "#3B82F6",
    "compute": "#F97316",
    "database": "#22C55E",
    "storage": "#EAB308",
    "security": "#EF4444",
    "monitoring": "#A855F7",
}
DEFAULT_COLOR = "#6B7280"

EDGE_COLOR = "#4B5563"
LABEL_COLOR = "#FFFFFF"
TITLE_COLOR = "#FFFFFF"


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        # Pillow < 10 doesn't support size argument
        return ImageFont.load_default()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _draw_rounded_rect(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    w: int,
    h: int,
    radius: int,
    fill: tuple[int, int, int],
) -> None:
    draw.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill)


def _render_thumbnail(title: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> bytes:
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), _hex_to_rgb(BG_COLOR))
    draw = ImageDraw.Draw(img)

    title_font = _load_font(24)
    label_font = _load_font(14)

    # Draw title
    draw.text((40, 30), title[:60], fill=_hex_to_rgb(TITLE_COLOR), font=title_font)

    # Compute grid positions — ignore stored position.x/y, recompute from scratch
    positions: dict[str, tuple[int, int]] = {}  # node_id -> center (cx, cy)

    for i, node in enumerate(nodes):
        node_id = node.get("id")
        if not node_id:
            continue

        col = i % COLS
        row = i // COLS

        x = PADDING_X + col * (NODE_W + GAP_X)
        y = PADDING_TOP + row * (NODE_H + GAP_Y)

        # Skip nodes that would overflow canvas height
        if y + NODE_H > CANVAS_H - PADDING_BOTTOM:
            continue

        cx = x + NODE_W // 2
        cy = y + NODE_H // 2
        positions[node_id] = (cx, cy)

        data = node.get("data") or {}
        category = data.get("category", "")
        color = CATEGORY_COLORS.get(category, DEFAULT_COLOR)
        label = str(data.get("label", node_id))[:20]

        _draw_rounded_rect(draw, x, y, NODE_W, NODE_H, radius=8, fill=_hex_to_rgb(color))

        # Center label text in box
        try:
            bbox = draw.textbbox((0, 0), label, font=label_font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
        except AttributeError:
            text_w, text_h = draw.textsize(label, font=label_font)  # type: ignore[attr-defined]

        draw.text(
            (x + (NODE_W - text_w) // 2, y + (NODE_H - text_h) // 2),
            label,
            fill=_hex_to_rgb(LABEL_COLOR),
            font=label_font,
        )

    # Draw edges between node centers
    edge_color_rgb = _hex_to_rgb(EDGE_COLOR)
    for edge in edges:
        src = edge.get("source") or edge.get("from")
        tgt = edge.get("target") or edge.get("to")
        if not src or not tgt:
            continue
        if src not in positions or tgt not in positions:
            continue
        draw.line([positions[src], positions[tgt]], fill=edge_color_rgb, width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def generate_and_upload_thumbnail(
    project_id: str,
    title: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> str | None:
    """
    Renders a 1200x630 PNG diagram thumbnail using Pillow and uploads it to
    Supabase Storage bucket 'thumbnails'. Returns the public URL on success,
    or None on any failure. Never raises.
    """
    try:
        png_bytes = await asyncio.get_event_loop().run_in_executor(
            None, _render_thumbnail, title, nodes, edges
        )
        supabase.storage.from_("thumbnails").upload(
            f"{project_id}.png",
            png_bytes,
            {"content-type": "image/png", "upsert": "true"},
        )
        url: str = supabase.storage.from_("thumbnails").get_public_url(f"{project_id}.png")
        return url
    except Exception:
        logger.warning("Thumbnail generation/upload failed for project_id=%s", project_id, exc_info=True)
        return None
