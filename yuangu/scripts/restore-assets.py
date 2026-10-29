"""Restore original public game assets and verify their Git blob hashes."""
import concurrent.futures
import hashlib
import json
import pathlib
import urllib.parse
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / "asset-manifest.json").read_text())
assets = [entry for entry in manifest if not entry.get("text", False)]

def restore(entry):
    relative = pathlib.PurePosixPath(entry["path"])
    if relative.parts[0] != "dist" or ".." in relative.parts:
        raise ValueError("Invalid asset path")
    target = root / relative
    expected = entry["sha"]
    def valid(data):
        return len(data) == entry["size"] and hashlib.sha1(
            b"blob " + str(len(data)).encode() + b"\0" + data
        ).hexdigest() == expected
    if target.is_file() and valid(target.read_bytes()):
        return str(relative)
    url = "https://game.xiaoman.xyz/" + urllib.parse.quote(
        str(relative.relative_to("dist")), safe="/"
    )
    last_error = None
    for _ in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Yuangu-Asset-Restore/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
            if not valid(data):
                raise ValueError("Size or hash mismatch: " + str(relative))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            print("Verified " + str(relative), flush=True)
            return str(relative)
        except Exception as error:
            last_error = error
    raise last_error

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    verified = sorted(pool.map(restore, assets))
report = (
    "# 素材已补齐\n\n"
    f"已逐项核对 {len(verified)} 个图片、字体和音频文件，共 "
    f"{sum(entry['size'] for entry in assets)} 字节。每个文件的长度和 Git blob SHA-1 "
    "均与原始素材清单一致。\n\n"
    "来源：现有 https://game.xiaoman.xyz/ 静态游戏站。\n\n"
    "本次仅补齐素材，保留现有剧情代码。素材提交不代表线上网站已部署。\n"
)
(root / "ASSETS_PENDING.md").write_text(report)
print(f"All {len(verified)} assets verified.", flush=True)
