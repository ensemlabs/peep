import io
import uuid

import pytest
from PIL import Image

from app.routers.files import content_disposition, parse_range
from app.services import media, storage
from tests.conftest import active_client, new_conversation, sql


def png_bytes(w=400, h=200, color=(200, 30, 30)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), color).save(out, "PNG")
    return out.getvalue()


async def upload(c, data: bytes, name: str, mime: str | None = None, **form):
    files = {"file": (name, data, mime)} if mime else {"file": (name, data)}
    return await c.post("/api/files", files=files, data=form or None)


# --- parse_range -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "header,expected",
    [
        (None, ("full", 0, 99)),
        ("bytes=0-1", ("partial", 0, 1)),
        ("bytes=5-", ("partial", 5, 99)),
        ("bytes=-10", ("partial", 90, 99)),
        ("bytes=-1000", ("partial", 0, 99)),
        ("bytes=90-5000", ("partial", 90, 99)),
        ("bytes=0-0", ("partial", 0, 0)),
        ("bytes=100-", ("unsatisfiable", 0, 0)),
        ("bytes=500-600", ("unsatisfiable", 0, 0)),
        ("bytes=-0", ("unsatisfiable", 0, 0)),
        ("bytes=0-1,5-6", ("full", 0, 99)),
        ("bytes=5-2", ("full", 0, 99)),
        ("garbage", ("full", 0, 99)),
        ("items=0-1", ("full", 0, 99)),
        ("bytes=-", ("full", 0, 99)),
        ("bytes=a-b", ("full", 0, 99)),
    ],
)
def test_parse_range(header, expected):
    assert parse_range(header, 100) == expected


def test_content_disposition():
    assert content_disposition("image", "a.png", force_download=False, inline_ok=True).startswith("inline;")
    assert content_disposition("image", "a.png", force_download=True, inline_ok=True).startswith("attachment;")
    assert content_disposition("file", "a.py", force_download=False, inline_ok=True).startswith("attachment;")
    cd = content_disposition("file", 'tệp "x".txt', force_download=True, inline_ok=True)
    assert 'filename="t_p _x_.txt"' in cd and "filename*=UTF-8''t%E1%BB%87p%20%22x%22.txt" in cd


# --- media unit tests ------------------------------------------------------------------------


def test_sanitize_filename():
    assert media.sanitize_filename("../../etc/passwd") == "passwd"
    assert media.sanitize_filename("C:\\dir\\evil.exe") == "evil.exe"
    assert media.sanitize_filename("a\x00b\r\n.txt") == "ab.txt"
    assert media.sanitize_filename("") == "file"
    assert media.sanitize_filename(None) == "file"
    assert media.sanitize_filename("...") == "file"
    long = media.sanitize_filename("x" * 500 + ".png")
    assert len(long) == 200 and long.endswith(".png")


def test_classify():
    png = io.BytesIO(png_bytes())
    assert media.classify(png, "a.png", "image/png")["kind"] == "image"
    assert media.classify(io.BytesIO(png_bytes()), "a.txt", "text/plain")["kind"] == "file"
    # claims png but is not an image
    assert media.classify(io.BytesIO(b"not an image"), "a.png", "image/png")["kind"] == "file"
    svg = io.BytesIO(b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    assert media.classify(svg, "a.svg", "image/svg+xml") == {
        "kind": "file", "mime": "application/octet-stream", "width": None, "height": None,
    }
    assert media.classify(io.BytesIO(b"x"), "a.html", "text/html")["mime"] == "application/octet-stream"
    assert media.classify(io.BytesIO(b"x"), "a.webm", "video/webm")["kind"] == "video"
    assert media.classify(io.BytesIO(b"x"), "a.webm", "audio/webm")["kind"] == "audio"
    assert media.classify(io.BytesIO(b"x"), "a.mp3", "audio/mpeg")["kind"] == "audio"
    assert media.classify(io.BytesIO(b"x"), "a.mp3", "application/octet-stream")["kind"] == "audio"
    assert media.classify(io.BytesIO(b"x"), "a.mkv", "video/x-matroska")["kind"] == "video"
    assert media.classify(io.BytesIO(b"x"), "a.exe", "video/mp4")["kind"] == "file"
    assert media.classify(io.BytesIO(b"x"), "a.py", "text/x-python") == {
        "kind": "file", "mime": "text/x-python", "width": None, "height": None,
    }


def test_pixel_cap(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    assert media.classify(io.BytesIO(png_bytes(100, 100)), "a.png", "image/png")["kind"] == "file"


# --- upload / metadata -----------------------------------------------------------------------


async def test_upload_image_meta_thumb_and_content(make_client):
    c, user = await active_client(make_client)
    data = png_bytes(1600, 800)
    r = await upload(c, data, "Red Apple.png", "image/png")
    assert r.status_code == 201
    meta = r.json()["file"]
    fid = meta["id"]
    assert meta == {
        "id": fid, "kind": "image", "mime": "image/png", "filename": "Red Apple.png", "size": len(data),
        "width": 1600, "height": 800, "url": f"/api/files/{fid}/content",
        "thumb_url": f"/api/files/{fid}/thumb", "download_url": f"/api/files/{fid}/content?download=1",
    }
    r = await c.get(meta["url"])
    assert r.status_code == 200 and r.content == data
    th = await c.get(meta["thumb_url"])
    assert th.status_code == 200 and th.headers["content-type"] == "image/webp"
    t = Image.open(io.BytesIO(th.content))
    assert t.size == (768, 384)  # aspect kept, longest side 768
    row = (await sql("SELECT object_key, thumb_key, sha256, source FROM files"))[0]
    assert row[0] == f"u/{user.id}/{fid}/Red Apple.png" and row[1] == f"thumbs/{fid}.webp" and row[3] == "upload"
    assert await storage.head(row[0]) and await storage.head(row[1])


async def test_exif_rotation_applied_to_thumb(make_client):
    c, _ = await active_client(make_client)
    im = Image.new("RGB", (400, 100), "blue")
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 CW when displayed
    out = io.BytesIO()
    im.save(out, "JPEG", exif=exif)
    meta = (await upload(c, out.getvalue(), "r.jpg", "image/jpeg")).json()["file"]
    t = Image.open(io.BytesIO((await c.get(meta["thumb_url"])).content))
    assert t.size == (100, 400)


async def test_upload_non_image_has_no_thumb(make_client):
    c, _ = await active_client(make_client)
    meta = (await upload(c, b"print(1)\n", "x.py", "text/x-python")).json()["file"]
    assert meta["kind"] == "file" and "thumb_url" not in meta and "width" not in meta
    assert (await c.get(f"/api/files/{meta['id']}/thumb")).status_code == 404


async def test_upload_validation(make_client):
    c, _ = await active_client(make_client)
    r = await upload(c, b"", "empty.txt")
    assert r.status_code == 422 and r.json()["error"]["code"] == "empty_file"
    r = await c.post("/api/files", files={"other": ("a.txt", b"x")})
    assert r.status_code == 422
    r = await c.post("/api/files", json={"a": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    r = await upload(c, b"x", "a.txt", conversation_id="not-a-uuid")
    assert r.status_code == 422
    r = await upload(c, b"x", "a.txt", conversation_id=str(uuid.uuid4()))
    assert r.status_code == 404
    conv = await new_conversation(c)
    r = await upload(c, b"x", "a.txt", conversation_id=conv)
    assert r.status_code == 201
    assert str((await sql("SELECT conversation_id FROM files"))[0][0]) == conv


async def test_upload_size_limit(make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    c, _ = await active_client(make_client)
    r = await upload(c, b"x" * (1024 * 1024 + 1), "big.bin")
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"
    assert (await sql("SELECT count(*) FROM files"))[0][0] == 0
    r = await upload(c, b"x" * (1024 * 1024), "ok.bin")
    assert r.status_code == 201


async def test_upload_requires_active_user(make_client):
    from tests.conftest import create_user, login

    await create_user("p@example.com", status="pending")
    c = make_client()
    await login(c, "p@example.com")
    r = await upload(c, b"x", "a.txt")
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_pending"


# --- content endpoint ------------------------------------------------------------------------

CONTENT = bytes(range(256)) * 4  # 1024 bytes


async def _video(c, name="clip.webm", mime="video/webm"):
    return (await upload(c, CONTENT, name, mime)).json()["file"]


async def test_range_responses(make_client):
    c, _ = await active_client(make_client)
    meta = await _video(c)
    url = meta["url"]

    r = await c.get(url)
    assert r.status_code == 200 and r.content == CONTENT
    h = r.headers
    assert h["accept-ranges"] == "bytes" and h["content-length"] == "1024" and h["content-type"] == "video/webm"
    assert h["cache-control"] == "private, max-age=3600" and h["x-content-type-options"] == "nosniff"
    assert h["etag"].startswith('"') and h["etag"].endswith('"')
    assert h["content-disposition"].startswith("inline;")

    cases = {
        "bytes=0-1": (206, CONTENT[0:2], "bytes 0-1/1024"),
        "bytes=5-": (206, CONTENT[5:], "bytes 5-1023/1024"),
        "bytes=-10": (206, CONTENT[-10:], "bytes 1014-1023/1024"),
        "bytes=1000-5000": (206, CONTENT[1000:], "bytes 1000-1023/1024"),
    }
    for rng, (status, body, cr) in cases.items():
        r = await c.get(url, headers={"Range": rng})
        assert (r.status_code, r.content, r.headers["content-range"]) == (status, body, cr), rng
        assert r.headers["content-length"] == str(len(body))
        assert r.headers["accept-ranges"] == "bytes"

    r = await c.get(url, headers={"Range": "bytes=2000-"})
    assert r.status_code == 416 and r.headers["content-range"] == "bytes */1024"
    for rng in ("bytes=0-1,5-6", "nonsense"):
        r = await c.get(url, headers={"Range": rng})
        assert r.status_code == 200 and r.content == CONTENT and "content-range" not in r.headers


async def test_etag_304(make_client):
    c, _ = await active_client(make_client)
    meta = await _video(c)
    etag = (await c.get(meta["url"])).headers["etag"]
    r = await c.get(meta["url"], headers={"If-None-Match": etag})
    assert r.status_code == 304 and r.content == b""


async def test_disposition_rules(make_client):
    c, _ = await active_client(make_client)
    img = (await upload(c, png_bytes(), "p.png", "image/png")).json()["file"]
    svg = (await upload(c, b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "x.svg", "image/svg+xml")).json()["file"]
    html = (await upload(c, b"<script>alert(1)</script>", "x.html", "text/html")).json()["file"]
    audio = (await upload(c, CONTENT, "a.mp3", "audio/mpeg")).json()["file"]
    py = (await upload(c, b"print(1)", "x.py", "text/x-python")).json()["file"]
    uni = (await upload(c, b"x", "tệp tin.txt", "text/plain")).json()["file"]

    async def disp(meta, **params):
        r = await c.get(meta["url"], params=params)
        assert r.status_code == 200
        return r.headers["content-disposition"], r.headers["content-type"], r

    assert (await disp(img))[0].startswith("inline;")
    assert (await disp(img, download=1))[0].startswith("attachment;")
    assert (await disp(audio))[0].startswith("inline;")
    for meta in (svg, html):
        cd, ctype, r = await disp(meta)
        assert cd.startswith("attachment;") and ctype == "application/octet-stream"
        assert r.headers["x-content-type-options"] == "nosniff"
    assert (await disp(py))[0].startswith("attachment;")
    cd, _, _ = await disp(uni, download=1)
    assert "filename*=UTF-8''t%E1%BB%87p%20tin.txt" in cd and 'filename="t_p tin.txt"' in cd
    assert svg["kind"] == "file" and html["kind"] == "file"


async def test_ownership_404(make_client):
    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    meta = (await upload(a, png_bytes(), "p.png", "image/png")).json()["file"]
    for url in (meta["url"], meta["thumb_url"], meta["download_url"]):
        assert (await a.get(url)).status_code == 200
        r = await b.get(url)
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert (await a.get(f"/api/files/{uuid.uuid4()}/content")).status_code == 404
    anon = make_client()
    assert (await anon.get(meta["url"])).status_code == 401


async def test_missing_object_is_404_not_500(make_client):
    c, _ = await active_client(make_client)
    meta = await _video(c)
    await storage.delete_prefix("u/")
    assert (await c.get(meta["url"])).status_code == 404


async def test_delete_unsent_upload(make_client):
    c, user = await active_client(make_client)
    cid = await new_conversation(c)
    meta = (await upload(c, png_bytes(), "p.png", "image/png", conversation_id=cid)).json()["file"]
    obj, thumb = (await sql("SELECT object_key, thumb_key FROM files"))[0]
    before = (await c.get("/api/context", params={"conversation_id": cid})).json()
    assert before["used_tokens"] > 0
    assert (await c.delete(f"/api/files/{meta['id']}")).status_code == 204
    assert await storage.head(obj) is None and await storage.head(thumb) is None
    assert (await sql("SELECT count(*) FROM files"))[0][0] == 0
    assert (await c.get(meta["url"])).status_code == 404
    assert (await c.get("/api/context", params={"conversation_id": cid})).json()["used_tokens"] == 0
    assert (await c.delete(f"/api/files/{meta['id']}")).status_code == 404


async def test_delete_attached_or_generated_file_is_409(make_client):
    from tests.conftest import send_message

    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    meta = (await upload(c, png_bytes(), "p.png", "image/png")).json()["file"]
    r, _ = await send_message(c, cid, "x", model="replay:error-demo", attachment_ids=[meta["id"]])
    assert r.status_code == 200
    r = await c.delete(f"/api/files/{meta['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "file_in_use"
    assert (await c.get(meta["url"])).status_code == 200
    gen = (await sql("SELECT id FROM files WHERE source = 'generated' LIMIT 1")) or []
    if gen:
        assert (await c.delete(f"/api/files/{gen[0][0]}")).status_code == 409


async def test_delete_file_ownership_and_pending(make_client):
    from tests.conftest import create_user, login

    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    meta = (await upload(a, b"x", "a.txt", "text/plain")).json()["file"]
    r = await b.delete(f"/api/files/{meta['id']}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert (await a.get(meta["url"])).status_code == 200
    await create_user("p@example.com", status="pending")
    p = make_client()
    await login(p, "p@example.com")
    r = await p.delete(f"/api/files/{meta['id']}")
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_pending"
    assert (await make_client().delete(f"/api/files/{meta['id']}")).status_code == 401


async def test_delete_survives_s3_failure(make_client, monkeypatch):
    c, _ = await active_client(make_client)
    meta = (await upload(c, b"x", "a.txt", "text/plain")).json()["file"]

    async def boom(keys):
        raise RuntimeError("s3 down")

    monkeypatch.setattr(storage, "delete_keys", boom)
    assert (await c.delete(f"/api/files/{meta['id']}")).status_code == 204
    assert (await sql("SELECT count(*) FROM files"))[0][0] == 0


async def test_context_counts_drafts_only_of_the_requested_conversation(make_client):
    c, _ = await active_client(make_client)
    chat_a, chat_b = await new_conversation(c), await new_conversation(c)
    await upload(c, png_bytes(), "a.png", "image/png", conversation_id=chat_a)
    await upload(c, png_bytes(), "new.png", "image/png")  # no conversation: belongs to a new chat

    def att(body):
        return {b["key"]: b for b in body["breakdown"]}["attachments"]["tokens"]

    assert att((await c.get("/api/context", params={"conversation_id": chat_a})).json()) > 0
    assert att((await c.get("/api/context", params={"conversation_id": chat_b})).json()) == 0
    assert att((await c.get("/api/context")).json()) > 0  # new chat: uploads with no conversation
