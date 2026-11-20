"""edge-tts worker: reads one UTF-8 JSON request and writes an mp3.

Request: {"text": "...", "output": "C:\\\\...\\\\x.mp3", "voice": "...", "rate": "-4%", "pitch": "-7Hz"}
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path


async def main() -> None:
    import edge_tts

    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    communicate = edge_tts.Communicate(
        request["text"],
        request.get("voice", "zh-CN-XiaoxiaoNeural"),
        rate=request.get("rate", "-4%"),
        pitch=request.get("pitch", "-7Hz"),
        volume=request.get("volume", "+0%"),
        connect_timeout=10,
        receive_timeout=30,
    )
    await asyncio.wait_for(communicate.save(request["output"]), timeout=90)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        asyncio.run(main())
    except Exception as error:  # noqa: BLE001 - report one line to the Host
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
