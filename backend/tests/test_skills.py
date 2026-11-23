import io
import uuid
import zipfile

import pytest

from app.services import skills as skill_svc
from app.services import storage
from tests.conftest import active_client, create_user, login, sql

SKILL_MD = """---
name: code-reviewer
description: Reviews code for bugs and style.
version: 1.2
---
# Code reviewer

Use `ruff`.

```python
print("hi")
```
"""


def make_zip(entries: dict[str, bytes | str], symlink: str | None = None, prefix: str = "") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries.items():
            zf.writestr(prefix + name, content)
        if symlink:
            info = zipfile.ZipInfo(prefix + symlink)
            info.create_system = 3
            info.external_attr = (0o120777 << 16)
            zf.writestr(info, "/etc/passwd")
    return buf.getvalue()


async def up(c, name: str, data: bytes | str, **params):
    if isinstance(data, str):
        data = data.encode()
    return await c.post("/api/skills", files={"file": (name, data)}, params=params)


# --- parser unit tests -----------------------------------------------------------------------------


def test_parse_md_and_zip():
    p = skill_svc.parse_upload("SKILL.md", SKILL_MD.encode())
    assert (p.name, p.version, p.description) == ("code-reviewer", "1.2", "Reviews code for bugs and style.")
    z = skill_svc.parse_upload("pkg.zip", make_zip({"SKILL.md": SKILL_MD, "scripts/run.sh": "echo hi", "ref/a.md": "# a"}))
    assert sorted(z.files) == ["SKILL.md", "ref/a.md", "scripts/run.sh"]
    wrapped = skill_svc.parse_upload("pkg.zip", make_zip({"SKILL.md": SKILL_MD, "a.txt": "x"}, prefix="my-skill/"))
    assert sorted(wrapped.files) == ["SKILL.md", "a.txt"]  # a single top-level folder is unwrapped


@pytest.mark.parametrize(
    "name,data,match",
    [
        ("a.txt", b"x", ".md file or a .zip"),
        ("SKILL.md", b"no frontmatter", "frontmatter"),
        ("SKILL.md", b"---\nname: [unclosed\n---\n", "valid YAML"),
        ("SKILL.md", b"---\n- a\n- b\n---\n", "mapping"),
        ("SKILL.md", b"---\ndescription: x\n---\n", "name"),
        ("SKILL.md", b"---\nname: Bad_Name\ndescription: x\n---\n", "name"),
        ("SKILL.md", ("---\nname: " + "a" * 65 + "\ndescription: x\n---\n").encode(), "name"),
        ("SKILL.md", b"---\nname: ok\n---\n", "description"),
        ("SKILL.md", ("---\nname: ok\ndescription: " + "d" * 1025 + "\n---\n").encode(), "description"),
        ("SKILL.md", b"---\nname: ok\ndescription: x\nversion: [1]\n---\n", "version"),
        ("SKILL.md", b"\xff\xfe---", "UTF-8"),
        ("p.zip", b"not a zip", "valid zip"),
        ("p.zip", make_zip({"readme.md": "x"}), "SKILL.md"),
    ],
)
def test_parse_rejects(name, data, match):
    with pytest.raises(skill_svc.InvalidSkill, match=match):
        skill_svc.parse_upload(name, data)


def test_yaml_is_loaded_safely():
    evil = b"---\nname: ok\ndescription: !!python/object/apply:os.system ['echo pwned']\n---\n"
    with pytest.raises(skill_svc.InvalidSkill):
        skill_svc.parse_upload("SKILL.md", evil)


@pytest.mark.parametrize("bad", ["../evil.txt", "a/../../evil.txt", "/abs/evil.txt", "C:/evil.txt", "a\\..\\evil.txt"])
def test_zip_slip_and_absolute_paths_rejected(bad):
    with pytest.raises(skill_svc.InvalidSkill, match="unsafe path"):
        skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD, bad: "x"}))


def test_zip_symlink_rejected():
    with pytest.raises(skill_svc.InvalidSkill, match="symbolic"):
        skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD}, symlink="link"))


def test_zip_too_many_files_and_too_big(monkeypatch):
    many = {"SKILL.md": SKILL_MD, **{f"f{i}.txt": "x" for i in range(skill_svc.MAX_FILES)}}
    with pytest.raises(skill_svc.InvalidSkill, match="too many files"):
        skill_svc.parse_upload("p.zip", make_zip(many))
    monkeypatch.setattr(skill_svc, "MAX_UNPACKED_BYTES", 1000)
    with pytest.raises(skill_svc.InvalidSkill, match="too large"):
        skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD, "big.bin": b"0" * 5000}))  # compresses well: a bomb


def test_ignores_macos_junk():
    p = skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD, "__MACOSX/._SKILL.md": "x", ".DS_Store": "x"}))
    assert list(p.files) == ["SKILL.md"]


# --- API --------------------------------------------------------------------------------------------


async def test_upload_md_list_get_patch_delete(make_client):
    c, user = await active_client(make_client)
    r = await up(c, "SKILL.md", SKILL_MD)
    assert r.status_code == 201
    s = r.json()["skill"]
    assert set(s) == {"id", "name", "description", "version", "enabled", "size", "file_count", "created_at", "updated_at"}
    assert (s["name"], s["version"], s["enabled"], s["file_count"], s["size"]) == ("code-reviewer", "1.2", True, 1, len(SKILL_MD.encode()))
    assert (await c.get("/api/skills")).json() == {"items": [s]}

    d = (await c.get(f"/api/skills/{s['id']}")).json()
    assert d["skill"] == s and d["skill_md"] == SKILL_MD and d["files"] == [{"path": "SKILL.md", "size": s["size"]}]
    key = f"u/{user.id}/skills/{s['id']}/SKILL.md"
    assert await storage.head(key)

    r = await c.patch(f"/api/skills/{s['id']}", json={"enabled": False})
    assert r.json()["skill"]["enabled"] is False
    assert (await c.patch(f"/api/skills/{s['id']}", json={})).status_code == 422

    assert (await c.delete(f"/api/skills/{s['id']}")).status_code == 204
    assert await storage.head(key) is None
    assert (await c.get("/api/skills")).json() == {"items": []}
    assert (await c.get(f"/api/skills/{s['id']}")).status_code == 404


async def test_upload_zip_stores_all_files(make_client):
    c, user = await active_client(make_client)
    r = await up(c, "pkg.zip", make_zip({"SKILL.md": SKILL_MD, "scripts/run.sh": "echo hi"}))
    s = r.json()["skill"]
    assert r.status_code == 201 and s["file_count"] == 2
    assert await storage.head(f"u/{user.id}/skills/{s['id']}/scripts/run.sh")
    assert [f["path"] for f in (await c.get(f"/api/skills/{s['id']}")).json()["files"]] == ["SKILL.md", "scripts/run.sh"]


@pytest.mark.parametrize(
    "name,data",
    [
        ("pkg.zip", make_zip({"SKILL.md": SKILL_MD, "../evil": "x"})),
        ("pkg.zip", make_zip({"SKILL.md": SKILL_MD, "/etc/evil": "x"})),
        ("pkg.zip", make_zip({"SKILL.md": SKILL_MD}, symlink="l")),
        ("pkg.zip", make_zip({"SKILL.md": SKILL_MD, **{f"f{i}": "x" for i in range(250)}})),
        ("SKILL.md", b"---\nname: x\n"),
        ("notes.txt", b"hello"),
    ],
)
async def test_invalid_uploads_422_and_nothing_stored(make_client, name, data):
    c, user = await active_client(make_client)
    r = await up(c, name, data)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_skill"
    assert (await sql("SELECT count(*) FROM skills"))[0][0] == 0


async def test_missing_file_part_422(make_client):
    c, _ = await active_client(make_client)
    r = await c.post("/api/skills", files={"other": ("a.md", b"x")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_skill"


async def test_upload_size_limit(make_client, monkeypatch):
    monkeypatch.setattr(skill_svc, "MAX_UPLOAD_BYTES", 2048)
    c, _ = await active_client(make_client)
    r = await up(c, "SKILL.md", SKILL_MD + "x" * 4096)
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"


async def test_duplicate_409_and_replace(make_client):
    c, user = await active_client(make_client)
    first = (await up(c, "pkg.zip", make_zip({"SKILL.md": SKILL_MD, "old.txt": "old"}))).json()["skill"]
    await c.patch(f"/api/skills/{first['id']}", json={"enabled": False})
    r = await up(c, "SKILL.md", SKILL_MD)
    assert r.status_code == 409 and r.json()["error"]["code"] == "skill_exists"
    new_md = SKILL_MD.replace("version: 1.2", "version: 2.0")
    r = await up(c, "SKILL.md", new_md, replace="true")
    assert r.status_code == 201
    s = r.json()["skill"]
    assert s["version"] == "2.0" and s["file_count"] == 1 and s["enabled"] is False  # enabled state is kept
    assert (await c.get("/api/skills")).json()["items"] == [s]
    assert await storage.head(f"u/{user.id}/skills/{first['id']}/old.txt") is None  # old objects gone
    assert (await c.get(f"/api/skills/{s['id']}")).json()["skill_md"] == new_md


async def test_same_name_allowed_for_different_users(make_client):
    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    assert (await up(a, "SKILL.md", SKILL_MD)).status_code == 201
    assert (await up(b, "SKILL.md", SKILL_MD)).status_code == 201


async def test_ownership_404(make_client):
    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    sid = (await up(a, "SKILL.md", SKILL_MD)).json()["skill"]["id"]
    assert (await b.get("/api/skills")).json() == {"items": []}
    for r in (await b.get(f"/api/skills/{sid}"), await b.patch(f"/api/skills/{sid}", json={"enabled": False}), await b.delete(f"/api/skills/{sid}")):
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert (await a.get(f"/api/skills/{sid}")).status_code == 200


async def test_pending_403_and_unauth_401(make_client):
    await create_user("p@example.com", status="pending")
    c = make_client()
    await login(c, "p@example.com")
    sid = str(uuid.uuid4())
    for r in (
        await c.get("/api/skills"), await up(c, "SKILL.md", SKILL_MD), await c.get(f"/api/skills/{sid}"),
        await c.patch(f"/api/skills/{sid}", json={"enabled": True}), await c.delete(f"/api/skills/{sid}"),
    ):
        assert r.status_code == 403 and r.json()["error"]["code"] == "account_pending"
    assert (await make_client().get("/api/skills")).status_code == 401


async def test_admin_delete_user_removes_skills_and_plugins(make_client):
    await create_user("admin@example.com", role="admin")
    ac = make_client()
    await login(ac, "admin@example.com")
    uc, user = await active_client(make_client)
    sid = (await up(uc, "SKILL.md", SKILL_MD)).json()["skill"]["id"]
    await uc.post("/api/plugins", json={"name": "p", "transport": "http", "url": "https://mcp.example.com/mcp"})
    key = f"u/{user.id}/skills/{sid}/SKILL.md"
    assert await storage.head(key)
    assert (await ac.delete(f"/api/admin/users/{user.id}")).status_code == 204
    assert await storage.head(key) is None
    assert (await sql("SELECT count(*) FROM skills"))[0][0] == 0 and (await sql("SELECT count(*) FROM plugins"))[0][0] == 0


def test_zip_path_length_and_control_chars_rejected():
    with pytest.raises(skill_svc.InvalidSkill, match="overlong path"):
        skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD, "a/" + "x" * 600 + ".txt": "x"}))
    with pytest.raises(skill_svc.InvalidSkill, match="control characters"):
        skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD, "bad\x07name.txt": "x"}))
    with pytest.raises(skill_svc.InvalidSkill, match="control characters"):
        skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD, "tab\tname.txt": "x"}))
    ok = skill_svc.parse_upload("p.zip", make_zip({"SKILL.md": SKILL_MD, "a/" + "x" * 400 + ".txt": "x"}))
    assert len(ok.files) == 2


async def test_failed_replace_leaves_old_skill_intact(make_client, monkeypatch):
    c, user = await active_client(make_client)
    old = (await up(c, "pkg.zip", make_zip({"SKILL.md": SKILL_MD, "old.txt": "old"}))).json()["skill"]
    calls = {"n": 0}
    real = storage.put_object

    async def flaky(key, data, mime):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("s3 down")
        await real(key, data, mime)

    monkeypatch.setattr(storage, "put_object", flaky)
    new_md = SKILL_MD.replace("version: 1.2", "version: 9.9")
    r = await up(c, "pkg.zip", make_zip({"SKILL.md": new_md, "new.txt": "new"}), replace="true")
    assert r.status_code == 500
    monkeypatch.setattr(storage, "put_object", real)
    assert (await c.get("/api/skills")).json()["items"] == [old]
    d = (await c.get(f"/api/skills/{old['id']}")).json()
    assert d["skill_md"] == SKILL_MD and [f["path"] for f in d["files"]] == ["SKILL.md", "old.txt"]
    assert await storage.head(f"u/{user.id}/skills/{old['id']}/old.txt")
    # the half-uploaded new objects were cleaned up
    leftovers = [k for k in await _keys(f"u/{user.id}/skills/") if f"/{old['id']}/" not in k]
    assert leftovers == []


async def _keys(prefix: str) -> list[str]:
    import asyncio

    def listing():
        out = []
        for page in storage.s3_client().get_paginator("list_objects_v2").paginate(Bucket=storage._bucket(), Prefix=prefix):
            out += [o["Key"] for o in page.get("Contents", [])]
        return out

    return await asyncio.to_thread(listing)


async def test_delete_removes_db_first_and_survives_s3_failure(make_client, monkeypatch):
    c, user = await active_client(make_client)
    s = (await up(c, "SKILL.md", SKILL_MD)).json()["skill"]

    async def boom(prefix):
        raise RuntimeError("s3 down")

    monkeypatch.setattr(storage, "delete_prefix", boom)
    assert (await c.delete(f"/api/skills/{s['id']}")).status_code == 204  # best-effort object cleanup
    assert (await c.get("/api/skills")).json() == {"items": []}


async def test_successful_replace_removes_old_prefix_only_after_swap(make_client):
    c, user = await active_client(make_client)
    old = (await up(c, "pkg.zip", make_zip({"SKILL.md": SKILL_MD, "old.txt": "old"}))).json()["skill"]
    new = (await up(c, "SKILL.md", SKILL_MD, replace="true")).json()["skill"]
    assert new["id"] != old["id"]
    assert await _keys(f"u/{user.id}/skills/{old['id']}/") == []
    assert await _keys(f"u/{user.id}/skills/{new['id']}/") == [f"u/{user.id}/skills/{new['id']}/SKILL.md"]
