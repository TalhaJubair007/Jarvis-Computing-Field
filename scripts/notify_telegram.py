#!/usr/bin/env python3
"""Send a completed GitHub Actions build result and bounded artifacts to the bot owner."""
from __future__ import annotations
import json
import os
import pathlib
import urllib.error
import urllib.request

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
OWNER = os.environ.get("TELEGRAM_OWNER_ID", "")
if not TOKEN or not OWNER.isdigit():
    raise SystemExit("TELEGRAM_BOT_TOKEN and numeric TELEGRAM_OWNER_ID are required")
BASE = f"https://api.telegram.org/bot{TOKEN}/"

def telegram(method: str, fields: dict[str, str], file_path: pathlib.Path | None = None) -> None:
    if file_path is None:
        data = json.dumps(fields).encode()
        req = urllib.request.Request(BASE + method, data=data, headers={"Content-Type": "application/json"})
    else:
        boundary = "----Jarvis" + os.urandom(12).hex()
        parts: list[bytes] = []
        for key, value in fields.items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode())
        parts.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{file_path.name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode())
        parts.append(file_path.read_bytes())
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        req = urllib.request.Request(BASE + method, data=b"".join(parts), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            result = json.loads(response.read().decode())
        if not result.get("ok"):
            raise RuntimeError(result.get("description", "Telegram API error"))
    except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
        raise SystemExit(f"Telegram delivery failed: {exc}") from exc

def main() -> None:
    name = os.environ.get("BUILD_NAME", "Jarvis build")
    status = os.environ.get("BUILD_STATUS", "completed")
    conclusion = os.environ.get("BUILD_CONCLUSION", "unknown")
    url = os.environ.get("BUILD_URL", "")
    payload = pathlib.Path(os.environ.get("PAYLOAD_DIR", "payload"))
    message = f"{name}\nStatus: {status}\nResult: {conclusion}\n{url}"
    log_tail = ""
    log = payload / "build.log"
    if log.is_file():
        try:
            log_tail = log.read_text(errors="replace")[-2600:]
        except OSError:
            pass
    if conclusion != "success" and log_tail:
        message += "\n\nBuild log tail:\n" + log_tail
    telegram("sendMessage", {"chat_id": OWNER, "text": message[:3900], "disable_web_page_preview": "true"})
    # Telegram's cloud Bot API sendDocument currently accepts up to 50 MB.
    # Split outputs at 44 MiB to leave room below the provider limit.
    max_part = 44 * 1024 * 1024
    for file in sorted(payload.glob("*.zip")):
        size = file.stat().st_size
        if size <= max_part:
            telegram("sendDocument", {"chat_id": OWNER, "caption": f"Jarvis artifact: {file.name}"}, file)
            continue
        with file.open("rb") as stream:
            count = (size + max_part - 1) // max_part
            for i in range(count):
                part = payload / f"{file.name}.part{i+1:03d}-of-{count:03d}"
                part.write_bytes(stream.read(max_part))
                telegram("sendDocument", {"chat_id": OWNER, "caption": f"{file.name} part {i+1}/{count}. Reassemble parts in numeric order."}, part)
                part.unlink(missing_ok=True)

if __name__ == "__main__":
    main()
