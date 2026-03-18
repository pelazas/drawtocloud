import asyncio
import io
import logging
import math
from typing import Any

from grandalf.graphs import Edge as GEdge
from grandalf.graphs import Graph as GGraph
from grandalf.graphs import Vertex
from grandalf.layouts import SugiyamaLayout
from PIL import Image, ImageDraw, ImageFont

from supabase_client import supabase

logger = logging.getLogger(__name__)

# Canvas dimensions (standard OG image size)
CANVAS_W = 1200
CANVAS_H = 630
BG_COLOR = "#02040c"

# Drawable area (leave room for title at top, branding at bottom)
MARGIN_TOP = 70
MARGIN_BOTTOM = 50
MARGIN_X = 60

# Node dimensions
NODE_W = 140
NODE_H = 50
ACCENT_W = 3  # left accent bar width

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

NODE_FILL = "#1F2937"
NODE_BORDER = "#374151"
EDGE_COLOR = "#6B7280"
LABEL_COLOR = "#FFFFFF"
TITLE_COLOR = "#FFFFFF"
BRAND_GRAY = "#9CA3AF"
BADGE_COLOR = "#6B7280"


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _compute_layout(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, tuple[float, float]]:
    """Use grandalf Sugiyama layout to compute node positions.

    Returns dict of node_id -> (cx, cy) in canvas coordinates,
    scaled and centered within the drawable area.
    """
    if not nodes:
        return {}

    vertices: dict[str, Vertex] = {}
    for node in nodes:
        nid = node.get("id")
        if not nid:
            continue
        v = Vertex(nid)
        v.view = type("View", (), {"w": NODE_W, "h": NODE_H})()
        vertices[nid] = v

    g_edges: list[GEdge] = []
    for edge in edges:
        src = edge.get("source") or edge.get("from")
        tgt = edge.get("target") or edge.get("to")
        if not src or not tgt:
            continue
        if src not in vertices or tgt not in vertices:
            continue
        g_edges.append(GEdge(vertices[src], vertices[tgt]))

    graph = GGraph(list(vertices.values()), g_edges)

    # Layout each connected component separately
    for component in graph.C:
        sug = SugiyamaLayout(component)
        sug.init_all()
        sug.draw()

    # Extract raw positions from grandalf and offset disconnected components
    raw: dict[str, tuple[float, float]] = {}
    component_offset_x = 0.0
    for component in graph.C:
        comp_positions: dict[str, tuple[float, float]] = {}
        for v in component.sV:
            if hasattr(v, "view") and v.view is not None and hasattr(v.view, "xy"):
                comp_positions[v.data] = (v.view.xy[0], v.view.xy[1])

        if not comp_positions:
            continue

        # Offset this component so it doesn't overlap previous ones
        comp_xs = [p[0] for p in comp_positions.values()]
        comp_min_x = min(comp_xs)
        comp_max_x = max(comp_xs)
        shift = component_offset_x - comp_min_x

        for nid, (px, py) in comp_positions.items():
            raw[nid] = (px + shift, py)

        component_offset_x += (comp_max_x - comp_min_x) + NODE_W + 40

    if not raw:
        return {}

    # Single node: center it
    if len(raw) == 1:
        nid = next(iter(raw))
        return {nid: (CANVAS_W / 2, (MARGIN_TOP + CANVAS_H - MARGIN_BOTTOM) / 2)}

    # Compute bounding box of raw positions
    xs = [p[0] for p in raw.values()]
    ys = [p[1] for p in raw.values()]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    raw_w = max_x - min_x or 1
    raw_h = max_y - min_y or 1

    # Target drawable area
    draw_w = CANVAS_W - 2 * MARGIN_X - NODE_W
    draw_h = CANVAS_H - MARGIN_TOP - MARGIN_BOTTOM - NODE_H

    # Uniform scale to fit
    scale = min(draw_w / raw_w, draw_h / raw_h)

    # Center offset
    scaled_w = raw_w * scale
    scaled_h = raw_h * scale
    offset_x = MARGIN_X + NODE_W / 2 + (draw_w - scaled_w) / 2
    offset_y = MARGIN_TOP + NODE_H / 2 + (draw_h - scaled_h) / 2

    positions: dict[str, tuple[float, float]] = {}
    for nid, (rx, ry) in raw.items():
        px = offset_x + (rx - min_x) * scale
        py = offset_y + (ry - min_y) * scale
        positions[nid] = (px, py)

    return positions


def _bezier_points(
    x0: float, y0: float, x1: float, y1: float, segments: int = 20
) -> list[tuple[float, float]]:
    """Sample points along a quadratic bezier from (x0,y0) to (x1,y1).

    Control point is offset 25px perpendicular to the line midpoint
    to create a visible curve.
    """
    mx = (x0 + x1) / 2
    my = (y0 + y1) / 2

    dx = x1 - x0
    dy = y1 - y0
    length = math.hypot(dx, dy) or 1

    # Perpendicular unit vector
    perp_x = -dy / length
    perp_y = dx / length

    # Offset control point 25px perpendicular to the midpoint
    offset = 25
    cx = mx + perp_x * offset
    cy = my + perp_y * offset

    points: list[tuple[float, float]] = []
    for i in range(segments + 1):
        t = i / segments
        inv = 1 - t
        px = inv * inv * x0 + 2 * inv * t * cx + t * t * x1
        py = inv * inv * y0 + 2 * inv * t * cy + t * t * y1
        points.append((px, py))
    return points


def _draw_arrowhead(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    angle: float,
    color: tuple[int, int, int],
    size: int = 8,
) -> None:
    """Draw a filled triangle arrowhead pointing in the given angle direction."""
    half_base = size / 2.5
    # Tip of arrow is at (x, y), base extends backwards
    tip = (x, y)
    left = (
        x - size * math.cos(angle) + half_base * math.sin(angle),
        y - size * math.sin(angle) - half_base * math.cos(angle),
    )
    right = (
        x - size * math.cos(angle) - half_base * math.sin(angle),
        y - size * math.sin(angle) + half_base * math.cos(angle),
    )
    draw.polygon([tip, left, right], fill=color)


def _render_thumbnail(
    title: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> bytes:
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), _hex_to_rgb(BG_COLOR))
    draw = ImageDraw.Draw(img)

    title_font = _load_font(24)
    label_font = _load_font(14)
    brand_font = _load_font(14)
    badge_font = _load_font(12)

    # --- Title ---
    draw.text((40, 30), title[:60], fill=_hex_to_rgb(TITLE_COLOR), font=title_font)

    # --- Layout ---
    positions = _compute_layout(nodes, edges)

    # Build lookup for node data
    node_data: dict[str, dict[str, Any]] = {}
    for node in nodes:
        nid = node.get("id")
        if nid:
            node_data[nid] = node.get("data") or {}

    # --- Edges (draw before nodes so nodes sit on top) ---
    edge_color_rgb = _hex_to_rgb(EDGE_COLOR)
    for edge in edges:
        src = edge.get("source") or edge.get("from")
        tgt = edge.get("target") or edge.get("to")
        if not src or not tgt:
            continue
        if src not in positions or tgt not in positions:
            continue

        sx, sy = positions[src]
        tx, ty = positions[tgt]
        # From bottom-center of source to top-center of target
        start_y = sy + NODE_H / 2
        end_y = ty - NODE_H / 2

        points = _bezier_points(sx, start_y, tx, end_y)
        # Draw curve as polyline
        if len(points) >= 2:
            draw.line(points, fill=edge_color_rgb, width=2)

            # Arrowhead at target end
            p_last = points[-1]
            p_prev = points[-2]
            angle = math.atan2(p_last[1] - p_prev[1], p_last[0] - p_prev[0])
            _draw_arrowhead(draw, p_last[0], p_last[1], angle, edge_color_rgb)

    # --- Nodes ---
    fill_rgb = _hex_to_rgb(NODE_FILL)
    border_rgb = _hex_to_rgb(NODE_BORDER)
    label_rgb = _hex_to_rgb(LABEL_COLOR)

    for nid, (cx, cy) in positions.items():
        x = cx - NODE_W / 2
        y = cy - NODE_H / 2

        data = node_data.get(nid, {})
        category = data.get("category", "")
        accent_color = CATEGORY_COLORS.get(category, DEFAULT_COLOR)
        label = str(data.get("label", nid))[:20]

        # Node body (filled rounded rect)
        draw.rounded_rectangle(
            [x, y, x + NODE_W, y + NODE_H],
            radius=8,
            fill=fill_rgb,
            outline=border_rgb,
            width=1,
        )

        # Left accent bar
        accent_rgb = _hex_to_rgb(accent_color)
        draw.rectangle(
            [x, y + 4, x + ACCENT_W, y + NODE_H - 4],
            fill=accent_rgb,
        )

        # Center label
        try:
            bbox = draw.textbbox((0, 0), label, font=label_font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
        except AttributeError:
            text_w, text_h = draw.textsize(label, font=label_font)

        draw.text(
            (x + (NODE_W - text_w) / 2, y + (NODE_H - text_h) / 2),
            label,
            fill=label_rgb,
            font=label_font,
        )

    # --- Branding: "drawtocloud" ---
    brand_gray_rgb = _hex_to_rgb(BRAND_GRAY)
    brand_white_rgb = _hex_to_rgb(TITLE_COLOR)
    bx = 40
    by = CANVAS_H - 40

    draw.text((bx, by), "draw", fill=brand_gray_rgb, font=brand_font)
    try:
        draw_bbox = draw.textbbox((bx, by), "draw", font=brand_font)
        to_x = draw_bbox[2]
    except AttributeError:
        to_x = bx + 30  # fallback

    draw.text((to_x, by), "to", fill=brand_white_rgb, font=brand_font)
    try:
        to_bbox = draw.textbbox((to_x, by), "to", font=brand_font)
        cloud_x = to_bbox[2]
    except AttributeError:
        cloud_x = to_x + 14

    draw.text((cloud_x, by), "cloud", fill=brand_gray_rgb, font=brand_font)

    # --- Metadata badge: "{N} services" ---
    node_count = len(positions)
    if node_count > 0:
        badge_text = f"{node_count} service{'s' if node_count != 1 else ''}"
        badge_rgb = _hex_to_rgb(BADGE_COLOR)
        try:
            badge_bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
            badge_w = badge_bbox[2] - badge_bbox[0]
        except AttributeError:
            badge_w = len(badge_text) * 7  # rough fallback

        draw.text(
            (CANVAS_W - 40 - badge_w, CANVAS_H - 40),
            badge_text,
            fill=badge_rgb,
            font=badge_font,
        )

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
        loop = asyncio.get_running_loop()
        png_bytes = await loop.run_in_executor(
            None, _render_thumbnail, title, nodes, edges
        )

        def _do_upload() -> str:
            supabase.storage.from_("thumbnails").upload(
                f"{project_id}.png",
                png_bytes,
                {"content-type": "image/png", "upsert": "true"},
            )
            return supabase.storage.from_("thumbnails").get_public_url(f"{project_id}.png")

        url: str = await loop.run_in_executor(None, _do_upload)
        return url
    except Exception:
        logger.warning("Thumbnail generation/upload failed for project_id=%s", project_id, exc_info=True)
        return None
