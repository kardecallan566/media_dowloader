"""Optional Chrome/Brave Native Messaging helper using yt-dlp + FFmpeg.

Each action is initiated by an explicit click in the extension. Nothing listens on a port.
Optional browser sessions are used only with explicit user opt-in. No DRM bypass.
"""
import json
import os
import re
import shutil
import queue
import time
import struct
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import urlsplit

ALLOWED_HOSTS = ("instagram.com", "youtube.com", "youtube-nocookie.com", "youtu.be", "pinterest.com")
MAX_MESSAGE = 64 * 1024
output_lock = threading.Lock()
active = {}
active_lock = threading.Lock()
cancelled_jobs = set()
IDLE_TIMEOUT_SECONDS = 120
MAX_JOB_SECONDS = 45 * 60
HEARTBEAT_SECONDS = 8


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
        if hostname == "pinterest.com" or hostname.endswith(".pinterest.com"):
            return (len(pieces) == 2 and pieces[0] == "pin" and
                    bool(re.fullmatch(r"[0-9]{6,30}", pieces[1])))
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
SOURCE_HOST_PAIRS = {
    "sushianimes.com.br": {"cdn-s01.pixel-sus-4k-image.com": (".mp4", ".webm")},
    "topanimes.net": {"doce-de-leite-vegano.b-cdn.net": (".m3u8",)},
}
def normalized_source_host(host):
    return (host or "").lower().removeprefix("www.")
def source_expired(url, now=None):
    """Only inspect recognized integer expiry timestamps; never guess token internals."""
    from urllib.parse import parse_qs
    from time import time as wall_clock
    query = parse_qs(urlsplit(url).query)
    values = query.get("expires")
    if not values or not values[0].isdigit():
        return False
    timestamp = int(values[0])
    return timestamp > 1_000_000_000 and timestamp <= int(now if now is not None else wall_clock()) + 15

def allowed_source(url, referrer):
    try:
        src = urlsplit(url)
        page = urlsplit(referrer)
        if src.scheme != "https" or page.scheme != "https":
            return False
        if src.username or src.password or src.port or page.username or page.password or page.port:
            return False
        page_host = normalized_source_host(page.hostname)
        cdns = SOURCE_HOST_PAIRS.get(page_host)
        if not cdns:
            return False
        extensions = cdns.get(normalized_source_host(src.hostname))
        if not extensions or not src.path.lower().endswith(extensions):
            return False
        if not page.path.startswith("/") or not page.path.strip("/"):
            return False
        return True
    except (ValueError, TypeError):
        return False


def command_for_source(url, referrer):
    if not allowed_source(url, referrer):
        raise RuntimeError("Fonte não autorizada para download contextual. Confira a página de origem.")
    if source_expired(url):
        raise RuntimeError("Link temporário HLS expirou. Atualize a página e capture a playlist novamente.")
    tool = shutil.which("yt-dlp")
    if not tool:
        raise RuntimeError("yt-dlp não instalado.")
    directory = downloads_directory()
    arguments = [tool, "--ignore-config", "--no-playlist", "--no-overwrites",
                 "--socket-timeout", "25", "--retries", "2", "--fragment-retries", "2",
                 "--newline", "--restrict-filenames", "--referer", referrer,
                 "--paths", str(directory),
                 "--output", "%(title).90B__%(id)s.%(ext)s",
                 "--print", "after_move:filepath"]
    if urlsplit(url).path.lower().endswith(".m3u8"):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("FFmpeg é necessário para processar o HLS.")
        arguments.extend(["--ffmpeg-location", str(Path(ffmpeg).parent),
                          "--remux-video", "mp4"])
    arguments.extend(["--", url])
    return arguments


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
    if cookies_browser not in (None, "brave", "firefox"):
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
        "--socket-timeout", "25", "--retries", "2", "--fragment-retries", "2",
        "--restrict-filenames",
        "--newline", "--merge-output-format", "mp4",
        "--format", "bv+ba/b",
        "--ffmpeg-location", str(Path(ffmpeg).parent),
        "--paths", str(directory),
        "--output", "%(title).100B__%(id)s.%(ext)s",
        "--print", "after_move:filepath"
    ]
    if cookies_browser in ("brave", "firefox"):
        arguments.extend(["--cookies-from-browser", cookies_browser])
    arguments.extend(["--", url])
    return arguments



def verify_saved_video(filename):
    """Accept only a non-empty playable video in the configured Downloads folder."""
    destination = downloads_directory().resolve()
    candidate = Path(filename.strip().strip('"')).resolve()
    if candidate != destination and destination not in candidate.parents:
        raise RuntimeError("O arquivo informado não está na pasta permitida.")
    if not candidate.is_file() or candidate.stat().st_size < 16384:
        raise RuntimeError("O arquivo final não existe ou está pequeno demais para ser vídeo.")
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("FFprobe não encontrado (instale FFmpeg). Não foi possível validar a saída.")
    probe = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries",
         "stream=codec_type:format=duration", "-of", "json", str(candidate)],
        stdin=subprocess.DEVNULL, capture_output=True,
        text=True, encoding="utf-8", errors="replace", timeout=30, shell=False
    )
    if probe.returncode != 0:
        raise RuntimeError("FFprobe não conseguiu abrir o arquivo: " + (probe.stderr or "")[-150:])
    info = json.loads(probe.stdout)
    if not any(stream.get("codec_type") == "video" for stream in info.get("streams", [])):
        raise RuntimeError("O arquivo salvo não contém uma faixa de vídeo.")
    duration = info.get("format", {}).get("duration")
    if duration is not None and (float(duration) < 0.5):
        raise RuntimeError("A duração do vídeo salvo é inválida.")
    return candidate


def parse_percent(line):
    match = re.search(r"\[download\]\s+([\d.]+)%", line)
    if not match:
        return None
    return min(99, max(0, int(float(match.group(1)))))


def classify_failure(output):
    """Classify errors without exposing browser cookie data or signed media URLs."""
    lower = "\n".join(output).casefold()
    cookie_patterns = (
        "could not copy", "cookie database", "failed to decrypt",
        "could not decrypt", "unable to decrypt", "app-bound",
        "failed to extract cookies", "error decrypting", "dpapi",
    )
    if any(pattern in lower for pattern in cookie_patterns):
        if ("cookie" in lower or "dpapi" in lower or "decrypt" in lower):
            return "COOKIES_UNAVAILABLE"
    if any(phrase in lower for phrase in (
        "login required", "login_required", "log in to", "login to",
        "cookies-to-yt-dlp", "authentication required", "please log in",
    )):
        return "AUTH_REQUIRED"
    if "unsupported url" in lower:
        return "INVALID_SOURCE"
    if any(phrase in lower for phrase in ("http error 403", "forbidden", "access denied", "blocked", "cloudflare")):
        return "ACCESS_DENIED"
    return "DOWNLOAD_FAILED"


def failure_message(code, cookie_failed=False, browser=None):
    if code == "COOKIES_UNAVAILABLE":
        return ("O navegador protege a leitura da sessão. Não é possível extrair os cookies "
                "com segurança por este método. Tente sem sessão, ou use um navegador "
                "compatível no qual você esteja autenticado.")
    if cookie_failed and code == "AUTH_REQUIRED":
        return ("O Brave protegeu os cookies e a tentativa pública exigiu login. "
                "O assistente não consegue acessar esta publicação por esses métodos. "
                "Use uma opção de download autorizada pela plataforma.")
    if code == "AUTH_REQUIRED":
        return ("Esta publicação exige login ou permissão. Sem acesso autorizado, "
                "não é possível baixar o arquivo.")
    if code == "ACCESS_DENIED":
        return ("O servidor recusou a transferência. Atualize o player para obter um link válido; o assistente não ignora controles "
                "de acesso ou desafios de proteção.")
    if code == "INVALID_SOURCE":
        return "Endereço de vídeo inválido ou não suportado."
    if cookie_failed:
        return ("Não foi possível ler a sessão do Brave; o download sem cookies também não "
                "foi concluído. Verifique a disponibilidade pública da publicação.")
    return "Não foi possível baixar o vídeo. Confirme o link e as permissões de acesso."


def stop_process(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10, check=False)
    else:
        process.terminate()
    try:
        process.wait(timeout=6)
    except subprocess.TimeoutExpired:
        process.kill()


def watchdog_reason(idle_seconds, elapsed_seconds,
                    idle_limit=IDLE_TIMEOUT_SECONDS, total_limit=MAX_JOB_SECONDS):
    if elapsed_seconds >= total_limit:
        return "MAX_DURATION"
    if idle_seconds >= idle_limit:
        return "NO_ACTIVITY"
    return None


def run_ytdlp_attempt(job_id, command):
    process = subprocess.Popen(
        command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
        bufsize=1, shell=False
    )
    with active_lock:
        active[job_id] = process
        # Preserve cancellation if it arrived while the subprocess was starting.
    output = []
    file_path = None
    save_root = str(downloads_directory().resolve()).casefold()
    lines = queue.Queue()
    finished = object()

    def read_process():
        try:
            for line in process.stdout:
                lines.put(line)
        finally:
            lines.put(finished)

    threading.Thread(target=read_process, daemon=True).start()
    started_at = last_activity = last_heartbeat = time.monotonic()
    ending = False
    failure = None
    last_percent = 0
    while not ending:
        now = time.monotonic()
        with active_lock:
            was_cancelled = job_id in cancelled_jobs
        if was_cancelled:
            stop_process(process)
            failure = "CANCELED"
            break
        reason = watchdog_reason(now - last_activity, now - started_at)
        if reason:
            stop_process(process)
            failure = "TIMEOUT"
            break
        if now - last_heartbeat >= HEARTBEAT_SECONDS:
            last_heartbeat = now
            write_message({"id": job_id, "type": "progress", "progress": last_percent,
                           "message": "Aguardando resposta da fonte... "
                                      + str(int(now - last_activity)) + " s sem progresso"})
        try:
            item = lines.get(timeout=1)
        except queue.Empty:
            continue
        if item is finished:
            ending = True
            continue
        line = item
        last_activity = time.monotonic()
        stripped = line.strip().strip('"')
        if stripped.casefold().startswith(save_root):
            file_path = stripped
        output.append(line[-600:])
        if len(output) > 35:
            output.pop(0)
        percentage = parse_percent(line)
        if percentage is not None:
            last_percent = percentage
            write_message({"id": job_id, "type": "progress", "progress": percentage,
                           "message": "Baixando vídeo..."})
        elif "[Merger]" in line or "[ffmpeg]" in line:
            write_message({"id": job_id, "type": "progress", "progress": 99,
                           "message": "Montando áudio e vídeo..."})
    if failure:
        result_code = -15 if failure == "CANCELED" else 124
    else:
        try:
            result_code = process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            stop_process(process)
            result_code = 124
    with active_lock:
        if active.get(job_id) is process:
            active.pop(job_id, None)
        cancelled_jobs.discard(job_id)
    return result_code, file_path, failure or classify_failure(output) 


def run_download(job_id, url, cookies_browser=None, source_referrer=None):
    try:
        if source_referrer:
            attempts = [(command_for_source(url, source_referrer), None)]
        else:
            attempts = [(command_for(url, cookies_browser), cookies_browser)]
        cookie_failed = False
        for attempt_number in range(2):
            if attempt_number >= len(attempts):
                break
            command, current_browser = attempts[attempt_number]
            write_message({"id": job_id, "type": "started",
                           "message": "Iniciando yt-dlp/FFmpeg..."})
            returncode, file_path, error_code = run_ytdlp_attempt(job_id, command)
            if returncode == 0:
                try:
                    if not file_path:
                        raise RuntimeError("O assistente não recebeu o caminho do vídeo salvo.")
                    verified = verify_saved_video(file_path)
                    text = "Vídeo validado e salvo em " + str(verified.parent)
                    if cookie_failed:
                        text = "Download público concluído sem usar cookies. " + text
                    write_message({"id": job_id, "type": "complete", "message": text})
                except Exception as error:
                    write_message({"id": job_id, "type": "error",
                                   "code": "OUTPUT_INVALID", "message": str(error)[:300]})
                return
            if error_code == "TIMEOUT" or returncode == 124:
                write_message({"id": job_id, "type": "error", "code": "SOURCE_TIMEOUT",
                               "message": "A fonte parou de responder por 2 minutos. A transferência foi encerrada; recarregue a página antes de tentar novamente."})
                return
            if returncode < 0 or error_code == "CANCELED":
                write_message({"id": job_id, "type": "error",
                               "code": "CANCELED", "message": "Processo cancelado."})
                return
            if current_browser and error_code == "COOKIES_UNAVAILABLE" and not source_referrer:
                cookie_failed = True
                write_message({"id": job_id, "type": "warning", "code": error_code,
                               "message": "Leitura da sessão indisponível. Tentando o vídeo público sem cookies..."})
                attempts.append((command_for(url, None), None))
                continue
            message = failure_message(error_code, cookie_failed, current_browser)
            write_message({"id": job_id, "type": "error", "code": error_code,
                           "message": message})
            return
    except Exception as error:
        write_message({"id": job_id, "type": "error", "code": "ASSISTANT_ERROR",
                       "message": str(error)[:300]})
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
                cancelled_jobs.add(job_id)
                process = active.get(job_id)
            if process is not None:
                stop_process(process)
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
        if cookies_browser not in (None, "brave", "firefox"):
            write_message({"type": "error", "id": job_id, "message": "Opção de sessão inválida."})
            continue
        if cmd == "downloadSource" and cookies_browser is not None:
            write_message({"type": "error", "id": job_id, "message": "Cookies não são usados em downloads de fontes de terceiros."})
            continue
        threading.Thread(target=run_download,
            args=(job_id, msg["url"], cookies_browser, referrer if cmd == "downloadSource" else None),
            daemon=True).start()


if __name__ == "__main__":
    try:
        main()
    finally:
        with active_lock:
            processes=list(active.values())
        for process in processes:
            try:
                stop_process(process)
            except (OSError, subprocess.TimeoutExpired):
                pass
