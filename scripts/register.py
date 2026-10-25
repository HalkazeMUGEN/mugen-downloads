#!/usr/bin/env python3
"""Register a latest ZIP URL and generate the site catalog; standard library only."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

if __package__:
    from .catalog import ApiError, REPOSITORY, generate, request_json, save_catalog, validate_characters
else:
    from catalog import ApiError, REPOSITORY, generate, request_json, save_catalog, validate_characters


def parse_download_url(value):
    value = value.strip()
    if re.search(r"[\x00-\x20\x7f]", value) or "?" in value or "#" in value:
        raise ValueError("URLに空白・制御文字・クエリ・フラグメントは指定できません")
    parts = urlsplit(value)
    if parts.scheme != "https" or parts.netloc.lower() != "github.com":
        raise ValueError("https://github.com/ から始まるURLを指定してください")
    match = re.fullmatch(r"/([^/]+/[^/]+)/releases/latest/download/([^/]+)", parts.path)
    if not match or not REPOSITORY.fullmatch(match[1]):
        raise ValueError("OWNER/REPOSITORY/releases/latest/download/固定名.zip のURLを指定してください")
    if re.search(r"%(?![0-9a-fA-F]{2})", match[2]):
        raise ValueError("ZIP名のURLエンコードが不正です")
    filename = unquote(match[2], encoding="utf-8", errors="strict")
    if not filename.lower().endswith(".zip") or re.search(r"[\x00-\x1f\x7f/\\]", filename):
        raise ValueError("固定のZIPファイル名を指定してください")
    return match[1], filename


def register(characters, url, name="", category="keep"):
    validate_characters(characters)
    if category not in ("keep", "characters", "other"):
        raise ValueError("分類は keep・characters・other から選択してください")
    repository, filename = parse_download_url(url)
    name = name.strip()
    if re.search(r"[\x00-\x1f\x7f]", name):
        raise ValueError("表示名に制御文字は指定できません")
    entries = [dict(c) for c in characters]
    matches = [c for c in entries if c["repository"].lower() == repository.lower()]
    if len(matches) > 1:
        raise ValueError("同じリポジトリが複数登録されています。characters.jsonを整理してください")
    if matches:
        entry = matches[0]
        entry["asset"] = filename
        if name:
            entry["name"] = name
    else:
        slug = re.sub(r"[^a-z0-9-]+", "-", repository.lower()).strip("-")[:47]
        suffix = hashlib.sha256(repository.lower().encode("utf-8")).hexdigest()[:12]
        base = slug + "-" + suffix
        identifier = base
        used = {c["id"] for c in entries}
        number = 2
        while identifier in used:
            tail = "-" + str(number)
            identifier = base[:64 - len(tail)] + tail
            number += 1
        entry = {"id": identifier, "name": name or filename[:-4] or repository.split("/")[1],
                 "repository": repository, "asset": filename}
        entries.append(entry)
    if category != "keep":
        entry["category"] = category
    elif not matches:
        entry["category"] = "characters"
    validate_characters(entries)
    return entries, entry["id"]


def prepare_publish(config, output, url, name="", api=request_json, category="keep"):
    config = Path(config)
    original = config.read_text(encoding="utf-8")
    characters = json.loads(original)
    updated, identifier = register(characters, url, name, category)
    catalog = generate(updated, api)
    if not any(f["characterId"] == identifier for f in catalog["files"]):
        raise ValueError("登録対象に安定版Releaseがありません。ZIPを添付してlatestとして公開してください")
    # Validate every repository before touching the registration file.
    # Git commit/push happen later in the workflow, before Pages deployment.
    save_catalog(catalog, output)
    if updated != characters:
        temporary = config.with_suffix(config.suffix + ".tmp")
        temporary.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(config)
    return identifier, catalog


def main():
    try:
        identifier, catalog = prepare_publish(
            "characters.json", "docs/catalog.json", os.environ.get("RELEASE_URL", ""),
            os.environ.get("DISPLAY_NAME", ""),
            lambda path: request_json(path, token=os.environ.get("GITHUB_TOKEN")),
            category=os.environ.get("CATEGORY", "keep"))
        print(f"登録ID: {identifier} / {len(catalog['files'])}件の一覧を生成しました")
        for warning in catalog["warnings"]:
            print(warning, file=sys.stderr)
    except (ValueError, KeyError, TypeError, OSError, ApiError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
