"""Optional Chrome/Brave Native Messaging helper using yt-dlp + FFmpeg.

Each action is initiated by an explicit click in the extension. Nothing listens on a port.
No credentials, cookies, DRM bypass, or scripted page capture.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import urlsplit

ALLOWED_HOSTS = ("instagram.com", "youtube.com", "youtube-nocookie.com", "youtu.be")
MAX_MESSAGE = 64 * 1024
output_lock = threading.Lock()
active = {}
active_lock = threading.Lock()


def allowed_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        return False
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            return False
        hostname = (parsed.hostname or "").lower().strip(".")
        if not any(hostname == item or hostname.endswith("." + item) for item in ALLOWED_HOSTS):
            return False
        return bool(parsed.netloc)
    except (TypeError, ValueError):
        return False


def write_message(payload):
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with output_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def read_message():
    size_bytes = sys.stdin.buffer.read(4)
    if len(size_bytes) != 4:
        return None
    size = struct.unpack("<I", size_bytes)[0]
    if size <= 0 or size > MAX_MESSAGE:
        raise ValueError("Invalid native message size.")
    data = sys.stdin.buffer.read(size)
    if len(data) != size:
        return None
    return json.loads(data.decode("utf-8"))


def downloads_directory():
    folder = Path.home() / "Downloads" / "MediaFinder"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def command_for(url):
    ytdlp = shutil.which("yt-dlp")
    ffmpeg = shutil.which("ffmpeg")
    if not ytdlp:
        raise RuntimeError("yt-dlp não encontrado. Instale com: scoop install yt-dlp")
    if not ffmpeg:
        raise RuntimeError("FFmpeg não encontrado. Instale com: scoop install ffmpeg")
    directory = downloads_directory()
    return [
        ytdlp, "--ignore-config", "--no-playlist", "--no-overwrites",
        "--restrict-filenames",
        "--newline", "--merge-output-format", "mp4",
        "--format", "bv+ba/b",
        "--ffmpeg-location", str(Path(ffmpeg).parent),
        "--paths", str(directory),
        "--output", "%(title).100B__%(id)s.%(ext)s",
        "--", url
    ]


def parse_percent(line):
    match = re.search(r"\[download\]\s+([\d.]+)%", line)
    if not match:
        return None
    return min(99, max(0, int(float(match.group(1)))))


def run_download(job_id, url):
    process = None
    try:
        command = command_for(url)
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            bufsize=1, shell=False
        )
        with active_lock:
            active[job_id] = process
        write_message({"id": job_id, "type": "started", "message": "Processando vídeo com yt-dlp/FFmpeg..."})
        last = ""
        for line in process.stdout:
            percent = parse_percent(line)
            if percent is not None:
                write_message({"id": job_id, "type": "progress", "progress": percent,
                               "message": "Baixando e preparando as faixas..."})
            elif "[Merger]" in line or "[ffmpeg]" in line:
                write_message({"id": job_id, "type": "progress", "progress": 99,
                               "message": "Montando áudio e vídeo em MP4..."})
            elif "ERROR:" in line:
                last = line.strip()[-350:]
        code = process.wait()
        if code == 0:
            write_message({"id": job_id, "type": "complete", "message": "Download finalizado. Verifique Downloads/MediaFinder."})
        elif code < 0:
            write_message({"id": job_id, "type": "error", "message": "Processo encerrado."})
        else:
            write_message({"id": job_id, "type": "error",
                           "message": last or "Falha do yt-dlp. A fonte pode exigir login, ter expirado ou não permitir download."})
    except Exception as exc:
        write_message({"id": job_id, "type": "error", "message": str(exc)[:350]})
    finally:
        with active_lock:
            active.pop(job_id, None)


def main():
    while True:
        try:
            msg = read_message()
        except (ValueError, UnicodeError, json.JSONDecodeError):
            break
        if msg is None:
            break
        job_id = str(msg.get("id", ""))[:64] if isinstance(msg, dict) else ""
        if not re.fullmatch(r"[\w-]{1,64}", job_id):
            write_message({"type": "error", "id": job_id, "message": "ID inválido."})
            continue
        if msg.get("cmd") == "cancel":
            with active_lock:
                process = active.get(job_id)
            if process is not None:
                process.terminate()
            continue
        if msg.get("cmd") != "download" or not allowed_url(msg.get("url")):
            write_message({"type": "error", "id": job_id, "message": "URL não permitida para o assistente local."})
            continue
        with active_lock:
            already = job_id in active
        if already:
            write_message({"type": "error", "id": job_id, "message": "Download já iniciado."})
            continue
        threading.Thread(target=run_download, args=(job_id, msg["url"]), daemon=True).start()


if __name__ == "__main__":
    main()
