"""Restore Motion Studio source from the immutable compressed text payload.
This branch keeps Motion Studio isolated from Mesa de Corte.
"""
from pathlib import Path
import base64
import gzip
import json

root = Path(__file__).resolve().parent
payload = (root / "app-data.b64").read_text(encoding="utf-8").strip()
files = json.loads(gzip.decompress(base64.b64decode(payload)).decode("utf-8"))
allowed = {"app", "static"}
for relative, text in files.items():
    dest = Path(relative)
    if not dest.parts or (dest.parts[0] not in allowed and relative != "requirements.txt"):
        raise ValueError(f"Unexpected path: {relative}")
    if dest.is_absolute() or ".." in dest.parts:
        raise ValueError(f"Unsafe path: {relative}")
    target = root / dest
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
print(f"Restored {len(files)} Motion Studio source files")
