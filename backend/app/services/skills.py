"""Skill packages: parsing + validation of uploaded SKILL.md / zip bundles. No code is ever executed."""

import io
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath

import yaml

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_UNPACKED_BYTES = 20 * 1024 * 1024
MAX_FILES = 200
MAX_SKILL_MD_BYTES = 1024 * 1024
MAX_FRONTMATTER_BYTES = 16 * 1024
NAME_RE = re.compile(r"^[a-z0-9-]{1,64}$")
_IGNORED = ("__MACOSX/", ".DS_Store")


class InvalidSkill(Exception):
    pass


@dataclass
class ParsedSkill:
    name: str
    description: str
    version: str | None
    files: dict[str, bytes]  # relative posix path -> content

    @property
    def size(self) -> int:
        return sum(len(v) for v in self.files.values())


def parse_frontmatter(text: str) -> dict:
    text = text.lstrip("﻿")
    m = re.match(r"---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)", text, re.S)
    if not m:
        raise InvalidSkill("SKILL.md must start with YAML frontmatter delimited by ---")
    if len(m.group(1).encode()) > MAX_FRONTMATTER_BYTES:
        raise InvalidSkill("SKILL.md frontmatter is too large")
    try:
        meta = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        raise InvalidSkill("SKILL.md frontmatter is not valid YAML") from None
    if not isinstance(meta, dict):
        raise InvalidSkill("SKILL.md frontmatter must be a mapping")
    return meta


def _validate_meta(meta: dict) -> tuple[str, str, str | None]:
    name, desc, version = meta.get("name"), meta.get("description"), meta.get("version")
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise InvalidSkill("frontmatter 'name' is required: 1-64 chars of a-z, 0-9 and '-'")
    if not isinstance(desc, str) or not desc.strip() or len(desc) > 1024:
        raise InvalidSkill("frontmatter 'description' is required (1-1024 chars)")
    if version is not None:
        if isinstance(version, bool) or not isinstance(version, (str, int, float)):
            raise InvalidSkill("frontmatter 'version' must be a string or number")
        version = str(version)[:64]
    return name, desc.strip(), version


MAX_PATH_BYTES = 512
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _safe_path(raw: str) -> str:
    if len(raw.encode("utf-8", "replace")) > MAX_PATH_BYTES or _CONTROL.search(raw):
        raise InvalidSkill("archive entry has an overlong path or control characters")
    if "\\" in raw or raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise InvalidSkill(f"unsafe path in archive: {raw!r}")
    path = PurePosixPath(raw)
    if path.is_absolute() or any(p in ("..", "") for p in path.parts):
        raise InvalidSkill(f"unsafe path in archive: {raw!r}")
    return path.as_posix()


def _read_zip(data: bytes) -> dict[str, bytes]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise InvalidSkill("not a valid zip archive") from None
    files: dict[str, bytes] = {}
    total = 0
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        infos = [i for i in infos if not any(i.filename.startswith(p) or i.filename.endswith(p) for p in _IGNORED)]
        if len(infos) > MAX_FILES:
            raise InvalidSkill(f"too many files (max {MAX_FILES})")
        for info in infos:
            mode = info.external_attr >> 16
            if mode and stat.S_ISLNK(mode):
                raise InvalidSkill(f"symbolic links are not allowed: {info.filename!r}")
            if info.flag_bits & 0x1:
                raise InvalidSkill("encrypted archives are not supported")
            path = _safe_path(info.filename)
            if info.file_size + total > MAX_UNPACKED_BYTES:
                raise InvalidSkill("archive is too large when unpacked")
            with zf.open(info) as fh:  # read with a hard cap: the declared size may lie
                content = fh.read(MAX_UNPACKED_BYTES - total + 1)
            total += len(content)
            if total > MAX_UNPACKED_BYTES:
                raise InvalidSkill("archive is too large when unpacked")
            if path in files:
                raise InvalidSkill(f"duplicate entry {path!r}")
            files[path] = content
    return files


def _strip_single_root(files: dict[str, bytes]) -> dict[str, bytes]:
    """Allow a zip of a folder: if SKILL.md is not at the root but every file shares one top directory."""
    if "SKILL.md" in files:
        return files
    tops = {p.split("/", 1)[0] for p in files}
    if len(tops) == 1 and f"{next(iter(tops))}/SKILL.md" in files:
        prefix = next(iter(tops)) + "/"
        return {p[len(prefix) :]: c for p, c in files.items()}
    return files


def parse_upload(filename: str, data: bytes) -> ParsedSkill:
    lower = filename.lower()
    if lower.endswith(".zip"):
        files = _strip_single_root(_read_zip(data))
    elif lower.endswith(".md"):
        files = {"SKILL.md": data}
    else:
        raise InvalidSkill("upload a SKILL.md file or a .zip archive")
    skill_md = files.get("SKILL.md")
    if skill_md is None:
        raise InvalidSkill("the package must contain SKILL.md at its root")
    if len(skill_md) > MAX_SKILL_MD_BYTES:
        raise InvalidSkill("SKILL.md is too large (max 1 MB)")
    try:
        text = skill_md.decode("utf-8")
    except UnicodeDecodeError:
        raise InvalidSkill("SKILL.md must be UTF-8 text") from None
    name, desc, version = _validate_meta(parse_frontmatter(text))
    return ParsedSkill(name, desc, version, files)
