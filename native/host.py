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
        pieces = [p for p in parsed.path.split("/") if p]
        if hostname == "youtu.be":
            return len(pieces) == 1 and bool(re.fullmatch(r"[A-Za-z0-9_-]{11}", pieces[0]))
        if hostname.endswith("youtube.com") or hostname.endswith("youtube-nocookie.com"):
            if len(pieces) == 1 and pieces[0] == "watch":
                from urllib.parse import parse_qs
                return bool(re.fullmatch(r"[A-Za-z0-9_-]{11}", parse_qs(parsed.query).get("v", [""])[0]))
            return (len(pieces) == 2 and pieces[0] in ("shorts", "live", "embed") and
                    bool(re.fullmatch(r"[A-Za-z0-9_-]{11}", pieces[1])))
        return (len(pieces) == 2 and pieces[0] in ("reel", "p", "tv") and
                bool(re.fullmatch(r"[A-Za-z0-9_-]{5,40}", pieces[1])))
    except (TypeError, ValueError):
        return False



# A narrowly scoped progressive source workflow; no arbitrary URLs or redirects to private networks.
SOURCE_PAGE_HOSTS = ("sushianimes.com.br", "www.sushianimes.com.br")
SOURCE_CDN_HOSTS = ("cdn-s01.pixel-sus-4k-image.com",)
def allowed_source(url, referrer):
    try:
        src = urlsplit(url)
        page = urlsplit(referrer)
        if src.scheme != "https" or page.scheme != "https":
            return False
        if src.username or src.password or src.port or page.username or page.password or page.port:
            return False
        if (src.hostname or "").lower() not in SOURCE_CDN_HOSTS:
            return False
        if (page.hostname or "").lower() not in SOURCE_PAGE_HOSTS:
            return False
        if not src.path.lower().endswith((".mp4", ".webm")):
            return False
        if not page.path.startswith("/") or not page.path.strip("/"):
            return False
        return True
    except (ValueError, TypeError):
        return False


def command_for_source(url, referrer):
    if not allowed_source(url, referrer):
        raise RuntimeError("Fonte não autorizada para download contextual. Confira a página de origem.")
    tool = shutil.which("yt-dlp")
    if not tool:
        raise RuntimeError("yt-dlp não instalado.")
    directory = downloads_directory()
    return [tool, "--ignore-config", "--no-playlist", "--no-overwrites",
            "--newline", "--restrict-filenames",
            "--referer", referrer,
            "--paths", str(directory),
            "--output", "%(title).90B__%(id)s.%(ext)s", "--", url]


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


def command_for(url, cookies_browser=None):
    if not allowed_url(url):
        raise RuntimeError("Abra uma publicação ou Reel específico, não a página inicial.")
    if cookies_browser not in (None, "brave"):
        raise RuntimeError("Navegador de sessão não permitido.")
    ytdlp = shutil.which("yt-dlp")
    ffmpeg = shutil.which("ffmpeg")
    if not ytdlp:
        raise RuntimeError("yt-dlp não encontrado. Instale com: scoop install yt-dlp")
    if not ffmpeg:
        raise RuntimeError("FFmpeg não encontrado. Instale com: scoop install ffmpeg")
    directory = downloads_directory()
    arguments = [
        ytdlp, "--ignore-config", "--no-playlist", "--no-overwrites",
        "--restrict-filenames",
        "--newline", "--merge-output-format", "mp4",
        "--format", "bv+ba/b",
        "--ffmpeg-location", str(Path(ffmpeg).parent),
        "--paths", str(directory),
        "--output", "%(title).100B__%(id)s.%(ext)s"
    ]
    if cookies_browser == "brave":
        arguments.extend(["--cookies-from-browser", "brave"])
    arguments.extend(["--", url])
    return arguments


def parse_percent(line):
    match = re.search(r"\[download\]\s+([\d.]+)%", line)
    if not match:
        return None
    return min(99, max(0, int(float(match.group(1)))))


def run_download(job_id, url, cookies_browser=None, source_referrer=None):
    process = None
    try:
        command = command_for_source(url, source_referrer) if source_referrer else command_for(url, cookies_browser)
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            bufsize=1, shell=False
        )
        with active_lock:
            active[job_id] = process
        write_message({"id": job_id, "type": "started", "message": "Processando vídeo com yt-dlp/FFmpeg..."})
        last = ""
        auth_error = False
        browser_cookie_error = False
        for line in process.stdout:
            normalized = line.casefold()
            if any(mark in normalized for mark in ("login required", "log in", "login to", "cookies-to-yt-dlp", "login_required")):
                auth_error = True
            if any(mark in normalized for mark in ("failed to decrypt", "could not decrypt", "cookie database", "dpapi", "cookie extraction")):
                browser_cookie_error = True
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
            if browser_cookie_error and cookies_browser:
                reason = ("Não foi possível ler a sessão do Brave. O navegador pode proteger cookies ou o perfil pode estar inacessível.")
            elif auth_error and not cookies_browser:
                reason = ("Esta publicação exige login. Para conteúdo autorizado, marque 'Usar sessão do Brave' e tente novamente. A leitura pode falhar por proteções do navegador.")
            elif auth_error:
                reason = ("Mesmo com a sessão do Brave, o Instagram não autorizou o download desta publicação.")
            elif source_referrer and any(flag in last.casefold() for flag in
                ("403", "forbidden", "blocked", "cloudflare", "access denied")):
                reason = ("O servidor recusou a transferência fora do player original (HTTP 403/bloqueio). A extensão não contorna restrições do CDN.")
            elif "unsupported url" in last.casefold():
                reason = ("URL não suportada. Abra o Reel/post na sua página específica, não no feed.")
            else:
                reason = last[:250] if last else "O site não forneceu um vídeo baixável ou a URL expirou."
            write_message({"id": job_id, "type": "error", "message": reason})
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
        cmd = msg.get("cmd")
        referrer = msg.get("referrer")
        if cmd == "downloadSource":
            if not allowed_source(msg.get("url"), referrer):
                write_message({"type": "error", "id": job_id, "message": "Fonte ou página de origem não permitida."})
                continue
        elif cmd == "download":
            if not allowed_url(msg.get("url")):
                write_message({"type": "error", "id": job_id, "message": "URL não permitida para o assistente local."})
                continue
        else:
            write_message({"type": "error", "id": job_id, "message": "Comando desconhecido."})
            continue
        with active_lock:
            already = job_id in active
        if already:
            write_message({"type": "error", "id": job_id, "message": "Download já iniciado."})
            continue
        cookies_browser = msg.get("cookiesBrowser")
        if cookies_browser not in (None, "brave"):
            write_message({"type": "error", "id": job_id, "message": "Opção de sessão inválida."})
            continue
        if cmd == "downloadSource" and cookies_browser is not None:
            write_message({"type": "error", "id": job_id, "message": "Cookies não são usados em downloads de fontes de terceiros."})
            continue
        threading.Thread(target=run_download,
            args=(job_id, msg["url"], cookies_browser, referrer if cmd == "downloadSource" else None),
            daemon=True).start()


if __name__ == "__main__":
    main()
