import io
from unittest.mock import MagicMock, patch, AsyncMock
from PIL import Image

import pytest


NODES = [
    {"id": "vpc", "data": {"label": "VPC", "category": "network"}},
    {"id": "alb", "data": {"label": "Load Balancer", "category": "compute"}},
    {"id": "rds", "data": {"label": "RDS PostgreSQL", "category": "database"}},
]
EDGES = [
    {"source": "alb", "target": "rds"},
    {"source": "vpc", "target": "alb"},
]


@pytest.fixture
def mock_supabase_storage():
    """Mock supabase.storage so tests don't hit the network."""
    mock_storage = MagicMock()
    mock_bucket = MagicMock()
    mock_storage.from_.return_value = mock_bucket
    mock_bucket.upload.return_value = MagicMock()
    mock_bucket.get_public_url.return_value = "https://example.supabase.co/storage/v1/object/public/thumbnails/test-id.png"
    return mock_storage, mock_bucket


@pytest.mark.asyncio
async def test_returns_public_url_on_success(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("test-id", "My App", NODES, EDGES)

    assert url == "https://example.supabase.co/storage/v1/object/public/thumbnails/test-id.png"


@pytest.mark.asyncio
async def test_upload_called_with_correct_path(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        await generate_and_upload_thumbnail("proj-123", "My App", NODES, EDGES)

    mock_storage.from_.assert_called_with("thumbnails")
    call_args = mock_bucket.upload.call_args
    assert call_args[0][0] == "proj-123.png"
    # third arg options must have upsert as string "true"
    options = call_args[0][2]
    assert options.get("upsert") == "true"
    assert options.get("content-type") == "image/png"


@pytest.mark.asyncio
async def test_upload_receives_valid_png_bytes(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        await generate_and_upload_thumbnail("proj-abc", "My App", NODES, EDGES)

    png_bytes = mock_bucket.upload.call_args[0][1]
    assert isinstance(png_bytes, bytes)
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic bytes


@pytest.mark.asyncio
async def test_returns_none_on_upload_error():
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage.from_.return_value.upload.side_effect = Exception("network error")
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("proj-err", "My App", NODES, EDGES)

    assert url is None


@pytest.mark.asyncio
async def test_empty_nodes_does_not_crash():
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage.from_.return_value.upload.return_value = MagicMock()
        mock_sb.storage.from_.return_value.get_public_url.return_value = "https://example.com/thumb.png"
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("proj-empty", "My App", [], [])

    # An empty diagram still produces a (blank) thumbnail — upload is called
    assert mock_sb.storage.from_.return_value.upload.called


@pytest.mark.asyncio
async def test_skips_edges_with_unknown_nodes(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    bad_edges = [{"source": "ghost", "target": "phantom"}]
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        # Must not raise even with unresolvable edge endpoints
        url = await generate_and_upload_thumbnail("proj-ghost", "My App", NODES, bad_edges)

    assert mock_bucket.upload.called  # still produced a PNG


@pytest.mark.asyncio
async def test_nodes_beyond_canvas_do_not_crash(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    # 30 nodes — exceeds canvas height at standard grid sizes
    many_nodes = [
        {"id": f"node-{i}", "data": {"label": f"Service {i}", "category": "compute"}}
        for i in range(30)
    ]
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("proj-many", "Big App", many_nodes, [])

    assert mock_bucket.upload.called


@pytest.mark.asyncio
async def test_node_missing_data_key_does_not_crash(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    bad_nodes = [{"id": "x"}]  # no "data" key
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        await generate_and_upload_thumbnail("proj-bad", "My App", bad_nodes, [])

    assert mock_bucket.upload.called


def test_render_produces_correct_dimensions():
    """Generated PNG must be exactly 1200x630."""
    from thumbnail_generator import _render_thumbnail

    png_bytes = _render_thumbnail("Test App", NODES, EDGES)
    img = Image.open(io.BytesIO(png_bytes))
    assert img.size == (1200, 630)


def test_render_single_node():
    """A single node should not crash and should produce a valid PNG."""
    from thumbnail_generator import _render_thumbnail

    single = [{"id": "s3", "data": {"label": "S3 Bucket", "category": "storage"}}]
    png_bytes = _render_thumbnail("Solo", single, [])
    img = Image.open(io.BytesIO(png_bytes))
    assert img.size == (1200, 630)


def test_render_zero_nodes():
    """Zero nodes should produce a valid PNG with just title and branding."""
    from thumbnail_generator import _render_thumbnail

    png_bytes = _render_thumbnail("Empty", [], [])
    img = Image.open(io.BytesIO(png_bytes))
    assert img.size == (1200, 630)


def test_background_color():
    """Background pixel at (0,0) should be #02040c."""
    from thumbnail_generator import _render_thumbnail

    png_bytes = _render_thumbnail("BG Test", [], [])
    img = Image.open(io.BytesIO(png_bytes))
    # Top-left corner should be the background color (RGB mode)
    assert img.getpixel((0, 0)) == (2, 4, 12)


def test_render_disconnected_nodes():
    """Disconnected nodes (no edges between them) must all appear in the output."""
    from thumbnail_generator import _render_thumbnail, _compute_layout

    disconnected = [
        {"id": "a", "data": {"label": "A", "category": "compute"}},
        {"id": "b", "data": {"label": "B", "category": "storage"}},
        {"id": "c", "data": {"label": "C", "category": "database"}},
    ]
    # Verify layout includes all nodes
    positions = _compute_layout(disconnected, [])
    assert set(positions.keys()) == {"a", "b", "c"}

    # Verify valid PNG
    png_bytes = _render_thumbnail("Disconnected", disconnected, [])
    img = Image.open(io.BytesIO(png_bytes))
    assert img.size == (1200, 630)
