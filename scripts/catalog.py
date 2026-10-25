#!/usr/bin/env python3
"""Generate static release metadata. Python standard library only; no pip install."""
import argparse
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPOSITORY = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}/(?!\.{1,2}$)[A-Za-z0-9_.-]+\Z")
IDENTIFIER = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")


class ApiError(RuntimeError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def request_json(path, token=None, opener=urlopen, sleep=time.sleep):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "mugen-catalog",
               "X-GitHub-Api-Version": "2026-03-10"}
    if token:
        headers["Authorization"] = "Bearer " + token
    for attempt in range(3):
        try:
            with opener(Request("https://api.github.com" + path, headers=headers), timeout=30) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise ValueError("GitHub API応答が大きすぎます")
                return json.loads(raw)
        except HTTPError as error:
            status = error.code
            reset, retry = error.headers.get("x-ratelimit-reset", "不明"), error.headers.get("retry-after", "不明")
            error.close()
            if status >= 500 and attempt < 2:
                sleep(2 ** attempt)
                continue
            if status in (403, 429):
                raise ApiError(status, f"API制限または権限エラー: HTTP {status}, reset={reset}, retry-after={retry}") from None
            raise ApiError(status, f"GitHub API HTTP {status}") from None
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise ApiError(None, "GitHub APIに接続できません") from None
            sleep(2 ** attempt)
    raise ApiError(None, "API再試行上限")


def validate_characters(characters):
    if not isinstance(characters, list):
        raise ValueError("characters.json は配列にしてください")
    identifiers = set()
    for c in characters:
        if (not isinstance(c, dict) or not isinstance(c.get("id"), str)
                or not IDENTIFIER.fullmatch(c["id"]) or c["id"] in identifiers
                or not isinstance(c.get("name"), str) or not c["name"].strip()
                or not isinstance(c.get("repository"), str) or not REPOSITORY.fullmatch(c["repository"])):
            raise ValueError("配布ファイルの設定が不正、またはidが重複しています")
        if c.get("category", "characters") not in ("characters", "other"):
            raise ValueError("category は characters または other を指定してください")
        if "assetPattern" in c or not isinstance(c.get("asset"), str) or not c["asset"].lower().endswith(".zip"):
            raise ValueError("asset に固定のZIPファイル名を指定してください。assetPattern は使用しません")
        identifiers.add(c["id"])
    return characters


def encode_segment(value):
    if not isinstance(value, str) or not value or value in (".", "..") or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError("不正なタグまたはファイル名です")
    return quote(value, safe="!~*'()")


def timestamp(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("日時にタイムゾーンがありません")
    return result.astimezone(timezone.utc)


def matches(filename, character):
    if not isinstance(filename, str) or not filename.lower().endswith(".zip"):
        return False
    return filename == character["asset"]


def generate(characters, api=request_json):
    files, warnings = [], []
    for c in validate_characters(characters):
        base = "/repos/" + c["repository"]
        try:
            repository = api(base)
        except ApiError as error:
            if error.status == 404:
                raise ValueError(c["repository"] + ": 公開リポジトリが見つかりません") from None
            raise
        if repository.get("private") is not False:
            raise ValueError(c["repository"] + ": 公開リポジトリのみ利用できます")
        try:
            release = api(base + "/releases/latest")
        except ApiError as error:
            if error.status != 404:
                raise
            warnings.append(c["name"] + ": 安定版Releaseがないため掲載していません")
            continue
        if (release.get("draft") is not False or release.get("prerelease") is not False
                or type(release.get("id")) is not int or release["id"] <= 0):
            raise ValueError(c["repository"] + ": 安定版Releaseの応答が不正です")
        assets = []
        for page in range(1, 12):
            entries = api(f"{base}/releases/{release['id']}/assets?per_page=100&page={page}")
            if not isinstance(entries, list):
                raise ValueError("アセット一覧の応答が不正です")
            assets.extend(entries)
            if len(entries) < 100:
                break
        else:
            raise ValueError("アセット一覧が上限を超えました")
        candidates = [a for a in assets if a.get("state") == "uploaded" and matches(a.get("name"), c)]
        if len(candidates) != 1:
            raise ValueError(f"{c['repository']}: ZIPの候補が{len(candidates)}件です。asset と最新Releaseの添付名を確認してください")
        a = candidates[0]
        if (type(a.get("id")) is not int or a["id"] <= 0
                or type(a.get("size")) is not int or not 0 < a["size"] < 2 * 1024 ** 3):
            raise ValueError("アセットID・サイズが不正です")
        tag, filename = encode_segment(release.get("tag_name")), encode_segment(a["name"])
        # Versioned IDs prevent an old open page from fetching a newer release
        # through the relay after the catalog has been updated.
        revision = hashlib.sha256(json.dumps([c["id"], c["repository"].lower(), release["tag_name"], a["name"], a["id"]],
                                           ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()[:20]
        identifier = c["id"][:40] + "--" + revision
        updated = max(timestamp(a["updated_at"]), timestamp(release["published_at"]))
        files.append({"id": identifier, "characterId": c["id"], "name": c["name"],
                      "category": c.get("category", "characters"),
                      "repository": c["repository"], "tag": release["tag_name"], "filename": a["name"],
                      "size": a["size"], "updatedAt": updated.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                      "downloadUrl": f"https://github.com/{c['repository']}/releases/download/{tag}/{filename}",
                      "releaseUrl": f"https://github.com/{c['repository']}/releases/tag/{tag}"})
    return {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "files": files, "warnings": warnings}


def save_catalog(catalog, output):
    output = Path(output)
    temporary = output.with_suffix(output.suffix + ".tmp")
    encoded = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    if len(encoded.encode("utf-8")) > 1024 * 1024:
        raise ValueError("一覧がWorkerの上限1 MiBを超えました")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(output)
    return catalog


def write_catalog(config, output, api=request_json):
    catalog = generate(json.loads(Path(config).read_text(encoding="utf-8")), api)
    return save_catalog(catalog, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="characters.json")
    parser.add_argument("--output", default="docs/catalog.json")
    args = parser.parse_args()
    try:
        catalog = write_catalog(args.config, args.output, lambda path: request_json(path, token=os.environ.get("GITHUB_TOKEN")))
        print(f"{len(catalog['files'])}件の一覧を生成しました")
        for warning in catalog["warnings"]:
            print(warning, file=sys.stderr)
    except (ValueError, KeyError, TypeError, OSError, ApiError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
