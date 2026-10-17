import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from tempfile import TemporaryDirectory
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host


class NativeHostTests(unittest.TestCase):
    def test_allowed_known_https_pages(self):
        self.assertTrue(host.allowed_url("https://www.instagram.com/reel/ABC123/?igsh=abc"))
        self.assertTrue(host.allowed_url("https://www.youtube.com/watch?v=abcdefghijk"))
        self.assertTrue(host.allowed_url("https://youtu.be/abcdefghijk"))

    def test_reject_untrusted_scheme_local_addresses_and_host_tricks(self):
        urls = [
            "http://instagram.com/reel/a", "file:///tmp/a", "https://localhost/file",
            "https://instagram.com.attacker.example/video", "https://user:pass@youtube.com/watch",
            "https://127.0.0.1/private", "https://www.youtube.com.evil.example/x",
            "javascript:alert(1)", "https://www.instagram.com/",
            "https://www.instagram.com/explore/", "https://www.instagram.com/some_profile/",
            "https://www.youtube.com/", "https://www.youtube.com/results?search_query=hello",
            "https://www.youtube.com/watch?v=bad",
            "https://www.instagram.com/reel/123/"
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertFalse(host.allowed_url(url))

    def test_command_is_subprocess_argv_without_shell_and_no_cookies(self):
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                command = host.command_for("https://www.instagram.com/reel/ABC123/")
        self.assertEqual(command[0], "/usr/bin/yt-dlp")
        self.assertIn("--merge-output-format", command)
        self.assertIn("mp4", command)
        self.assertIn("--no-playlist", command)
        self.assertNotIn("--cookies-from-browser", command)
        self.assertEqual(command[-2], "--")
        self.assertEqual(command[-1], "https://www.instagram.com/reel/ABC123/")

    def test_brave_cookies_are_opt_in(self):
        url = "https://www.instagram.com/reel/ABC123/"
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                without = host.command_for(url)
                with_cookies = host.command_for(url, "brave")
        self.assertNotIn("--cookies-from-browser", without)
        self.assertEqual(with_cookies[with_cookies.index("--cookies-from-browser") + 1], "brave")
        with self.assertRaisesRegex(RuntimeError, "permitido"):
            host.command_for(url, "chrome")

    def test_reject_homepage_before_executing_ytdlp(self):
        with self.assertRaisesRegex(RuntimeError, "publicação|Reel"):
            host.command_for("https://www.instagram.com/")

    def test_pinterest_exact_pin_supported_without_allowing_feed_or_profile(self):
        self.assertTrue(host.allowed_url("https://www.pinterest.com/pin/123456789012345/"))
        self.assertTrue(host.allowed_url("https://br.pinterest.com/pin/123456789012345/"))
        for url in ("https://www.pinterest.com/", "https://br.pinterest.com/search/pins/?q=anime",
                    "https://www.pinterest.com/myprofile/", "https://www.pinterest.com/pin/random/",
                    "https://evilpinterest.com/pin/123456789012345/"):
            self.assertFalse(host.allowed_url(url))

    def test_contextual_source_download_is_limited_to_origin_and_cdn_pair(self):
        source = "https://cdn-s01.pixel-sus-4k-image.com/stream/h/example/07.mp4"
        origin = "https://sushianimes.com.br/assistir/teste/episodio-7"
        self.assertTrue(host.allowed_source(source, origin))
        self.assertFalse(host.allowed_source(source, "https://www.instagram.com/"))
        self.assertFalse(host.allowed_source("https://127.0.0.1/file.mp4", origin))
        self.assertFalse(host.allowed_source("https://cdn-s01.pixel-sus-4k-image.com.private.test/x.mp4", origin))
        self.assertFalse(host.allowed_source("http://cdn-s01.pixel-sus-4k-image.com/x.mp4", origin))
        self.assertFalse(host.allowed_source("https://cdn-s01.pixel-sus-4k-image.com/x.html", origin))

    def test_topanimes_hls_pair_is_explicitly_scoped(self):
        hls = "https://doce-de-leite-vegano.b-cdn.net/a/b/cdn_stream.m3u8?expires=1893456000&token=abc"
        page = "https://topanimes.net/assistir/teste/"
        self.assertTrue(host.allowed_source(hls, page))
        self.assertTrue(host.allowed_source(hls, "https://www.topanimes.net/video/"))
        self.assertFalse(host.allowed_source(hls, "https://sushianimes.com.br/ep7"))
        self.assertFalse(host.allowed_source("https://other.b-cdn.net/stream.m3u8", page))
        self.assertFalse(host.allowed_source("http://doce-de-leite-vegano.b-cdn.net/stream.m3u8", page))
        self.assertFalse(host.allowed_source("https://doce-de-leite-vegano.b-cdn.net/private", page))

    def test_expired_hls_manifest_is_not_dispatched(self):
        expired = "https://doce-de-leite-vegano.b-cdn.net/a/index.m3u8?expires=1700000000"
        self.assertTrue(host.source_expired(expired, now=1800000000))
        self.assertFalse(host.source_expired(expired, now=1600000000))
        page = "https://topanimes.net/assistir/teste/"
        with self.assertRaisesRegex(RuntimeError, "expirou"):
            host.command_for_source(expired,page)

    def test_hls_context_uses_ffmpeg_remux_without_browser_credentials(self):
        hls = "https://doce-de-leite-vegano.b-cdn.net/a/index.m3u8?expires=1893456000"
        page = "https://topanimes.net/assistir/teste/"
        with patch.object(host.shutil, "which", side_effect=lambda tool: "/usr/bin/"+tool):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                args=host.command_for_source(hls,page)
        self.assertIn("--remux-video",args)
        self.assertEqual(args[args.index("--remux-video")+1],"mp4")
        self.assertEqual(args[args.index("--referer")+1],page)
        self.assertNotIn("--cookies-from-browser",args)

    def test_watchdog_detects_stalled_and_oversized_jobs(self):
        self.assertIsNone(host.watchdog_reason(30, 120))
        self.assertEqual(host.watchdog_reason(121, 121),"NO_ACTIVITY")
        self.assertEqual(host.watchdog_reason(5, 24*60*60),"MAX_DURATION")

    def test_contextual_command_has_expected_referrer_and_no_cookies(self):
        source = "https://cdn-s01.pixel-sus-4k-image.com/stream/h/example/07.mp4"
        origin = "https://sushianimes.com.br/assistir/teste/episodio-7"
        with patch.object(host.shutil, "which", return_value="/usr/bin/yt-dlp"):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                args = host.command_for_source(source, origin)
        self.assertEqual(args[args.index("--referer") + 1], origin)
        self.assertNotIn("--cookies-from-browser", args)
        self.assertEqual(args[-2:], ["--", source])

    def test_native_output_requires_real_video_stream(self):
        with TemporaryDirectory() as directory:
            folder = Path(directory)
            video = folder / "sample.mp4"
            video.write_bytes(b"0" * 20000)
            with patch.object(host, "downloads_directory", return_value=folder):
                with patch.object(host.shutil, "which", return_value="/usr/bin/ffprobe"):
                    with patch.object(host.subprocess, "run", return_value=SimpleNamespace(
                        returncode=0, stdout='{"streams":[{"codec_type":"video"}],"format":{"duration":"12.5"}}',
                        stderr=""
                    )):
                        self.assertEqual(host.verify_saved_video(str(video)), video.resolve())
                    with patch.object(host.subprocess, "run", return_value=SimpleNamespace(
                        returncode=0, stdout='{"streams":[{"codec_type":"audio"}],"format":{"duration":"12.5"}}',
                        stderr=""
                    )):
                        with self.assertRaisesRegex(RuntimeError, "faixa de vídeo"):
                            host.verify_saved_video(str(video))

    def test_native_output_rejects_small_file_and_outside_path(self):
        with TemporaryDirectory() as directory:
            folder = Path(directory)
            tiny = folder / "tiny.mp4"
            tiny.write_bytes(b"bad")
            with patch.object(host, "downloads_directory", return_value=folder):
                with self.assertRaisesRegex(RuntimeError, "pequeno"):
                    host.verify_saved_video(str(tiny))
                with self.assertRaisesRegex(RuntimeError, "pasta permitida"):
                    host.verify_saved_video(str(folder.parent / "outside.mp4"))

    def test_cookie_failure_categories_do_not_include_normal_cookie_activity(self):
        self.assertEqual(host.classify_failure([
            "ERROR: Failed to decrypt with DPAPI. See yt-dlp issue"
        ]), "COOKIES_UNAVAILABLE")
        self.assertEqual(host.classify_failure([
            "ERROR: Could not copy brave cookie database."
        ]), "COOKIES_UNAVAILABLE")
        self.assertEqual(host.classify_failure([
            "[Cookies] Extracting cookies from brave",
            "ERROR: Login required"
        ]), "AUTH_REQUIRED")
        self.assertEqual(host.classify_failure([
            "Extracting cookies from brave", "ERROR: HTTP Error 403"
        ]), "ACCESS_DENIED")

    def test_native_retries_without_cookies_after_brave_error(self):
        url = "https://www.instagram.com/reel/ABC123/"
        messages = []
        attempts = []
        def fake_attempt(job_id, command):
            attempts.append(command)
            if len(attempts) == 1:
                return (1, None, "COOKIES_UNAVAILABLE")
            return (0, "/tmp/MediaFinder/test.mp4", "DOWNLOAD_FAILED")
        with patch.object(host, "command_for",
                          side_effect=lambda url, browser=None, quality="best", audio_profile=None: ["yt-dlp"] +
                          (["--cookies-from-browser", browser] if browser else []) + [url]):
            with patch.object(host, "run_ytdlp_attempt", side_effect=fake_attempt):
                with patch.object(host, "verify_saved_video",
                                  return_value=Path("/tmp/MediaFinder/test.mp4")):
                    with patch.object(host, "write_message",
                                      side_effect=lambda payload: messages.append(payload)):
                        host.run_download("test-123", url, "brave")
        self.assertEqual(len(attempts), 2)
        self.assertIn("--cookies-from-browser", attempts[0])
        self.assertNotIn("--cookies-from-browser", attempts[1])
        self.assertTrue(any(x["type"] == "warning" for x in messages))
        self.assertEqual(messages[-1]["type"], "complete")

    def test_private_video_public_fallback_returns_specific_error(self):
        url = "https://www.instagram.com/reel/ABC123/"
        messages = []
        with patch.object(host, "command_for",
                          side_effect=lambda url, browser=None, quality="best", audio_profile=None: ["yt-dlp", browser or "public"]):
            with patch.object(host, "run_ytdlp_attempt",
                              side_effect=[(1, None, "COOKIES_UNAVAILABLE"),
                                           (1, None, "AUTH_REQUIRED")]):
                with patch.object(host, "write_message",
                                  side_effect=lambda payload: messages.append(payload)):
                    host.run_download("test-456", url, "brave")
        self.assertEqual(messages[-1]["type"], "error")
        self.assertEqual(messages[-1]["code"], "AUTH_REQUIRED")
        self.assertIn("tentativa pública", messages[-1]["message"])

    def test_firefox_option_is_explicit_and_optional(self):
        url = "https://www.instagram.com/reel/ABC123/"
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                command = host.command_for(url, "firefox")
        self.assertEqual(command[command.index("--cookies-from-browser") + 1], "firefox")

    def test_native_quality_presets_validate_user_input(self):
        self.assertEqual(host.quality_format("best"), "bv*+ba/b")
        self.assertIn("height<=720", host.quality_format("720"))
        self.assertIn("height<=2160", host.quality_format("2160"))
        for value in ("0", "9999", "720; echo unsafe", None, 720):
            with self.assertRaises(RuntimeError):
                host.quality_format(value)

    def test_quality_used_by_native_page_and_hls(self):
        with patch.object(host.shutil, "which", side_effect=lambda executable: "/usr/bin/"+executable):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                page_cmd=host.command_for("https://www.instagram.com/reel/ABC123/", None, "720")
                source_cmd=host.command_for_source(
                    "https://doce-de-leite-vegano.b-cdn.net/video/index.m3u8?expires=1893456000",
                    "https://topanimes.net/assistir/episodio/", "480")
        self.assertIn("height<=720", page_cmd[page_cmd.index("--format")+1])
        self.assertIn("height<=480", source_cmd[source_cmd.index("--format")+1])
        self.assertEqual(page_cmd[-2], "--")

    def test_audio_format_profiles_are_restricted(self):
        self.assertEqual(host.audio_options("mp3-128"), ("mp3", "128K"))
        self.assertEqual(host.audio_options("mp3-192"), ("mp3", "192K"))
        self.assertEqual(host.audio_options("mp3-320"), ("mp3", "320K"))
        self.assertEqual(host.audio_options("m4a"), ("m4a", "0"))
        self.assertEqual(host.audio_options("opus"), ("opus", "0"))
        for invalid in ("wav", "mp3", "mp3;rm -rf /", "", None, 320):
            with self.assertRaisesRegex(RuntimeError, "áudio inválido"):
                host.audio_options(invalid)

    def test_page_audio_mp3_command_uses_best_audio_and_ffmpeg(self):
        url = "https://www.instagram.com/reel/ABC123/"
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                args = host.command_for(url, None, "best", "mp3-192")
        self.assertEqual(args[args.index("--format") + 1], "bestaudio/best")
        self.assertEqual(args[args.index("--audio-format") + 1], "mp3")
        self.assertEqual(args[args.index("--audio-quality") + 1], "192K")
        self.assertIn("--extract-audio", args)
        self.assertNotIn("--merge-output-format", args)
        self.assertNotIn("--cookies-from-browser", args)
        self.assertEqual(args[-2:], ["--", url])

    def test_contextual_hls_audio_uses_ffmpeg_and_known_referrer_only(self):
        url = "https://doce-de-leite-vegano.b-cdn.net/stream/index.m3u8?expires=1893456000"
        referrer = "https://topanimes.net/assistir/episodio/"
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            with patch.object(host, "downloads_directory", return_value=Path("/tmp/mediafinder")):
                args = host.command_for_source(url, referrer, "best", "m4a")
        self.assertIn("--extract-audio", args)
        self.assertEqual(args[args.index("--audio-format") + 1], "m4a")
        self.assertEqual(args[args.index("--referer") + 1], referrer)
        self.assertNotIn("--remux-video", args)
        self.assertNotIn("--cookies-from-browser", args)
        with self.assertRaisesRegex(RuntimeError, "Fonte não autorizada"):
            host.command_for_source(url, "https://example.org/", "best", "m4a")

    def test_ffprobe_validates_exported_audio_and_rejects_video(self):
        with TemporaryDirectory() as root:
            folder = Path(root)
            audio = folder / "track.mp3"
            audio.write_bytes(b"0" * 4096)
            with patch.object(host, "downloads_directory", return_value=folder):
                with patch.object(host.shutil, "which", return_value="/usr/bin/ffprobe"):
                    with patch.object(host.subprocess, "run", return_value=SimpleNamespace(
                        returncode=0,
                        stdout='{"streams":[{"codec_type":"audio"}],"format":{"duration":"60"}}',
                        stderr=""
                    )):
                        self.assertEqual(host.verify_saved_audio(str(audio)), audio.resolve())
                    with patch.object(host.subprocess, "run", return_value=SimpleNamespace(
                        returncode=0,
                        stdout='{"streams":[{"codec_type":"video"}],"format":{"duration":"60"}}',
                        stderr=""
                    )):
                        with self.assertRaisesRegex(RuntimeError, "faixa de áudio"):
                            host.verify_saved_audio(str(audio))
                    with patch.object(host.subprocess, "run", return_value=SimpleNamespace(
                        returncode=0,
                        stdout='{"streams":[{"codec_type":"audio"},{"codec_type":"video"}],"format":{"duration":"60"}}',
                        stderr=""
                    )):
                        with self.assertRaisesRegex(RuntimeError, "contém vídeo"):
                            host.verify_saved_audio(str(audio))

    def test_native_audio_download_reports_audio_and_uses_audio_verifier(self):
        messages = []
        url = "https://www.pinterest.com/pin/123456789012345/"
        with patch.object(host, "command_for", return_value=["yt-dlp", url]):
            with patch.object(host, "run_ytdlp_attempt", return_value=(0, "/tmp/audio.mp3", None)):
                with patch.object(host, "verify_saved_audio", return_value=Path("/tmp/audio.mp3")) as audio_check:
                    with patch.object(host, "verify_saved_video") as video_check:
                        with patch.object(host, "write_message", side_effect=messages.append):
                            host.run_download("audio-test", url, None, None, "best", "mp3-320")
        audio_check.assert_called_once_with("/tmp/audio.mp3")
        video_check.assert_not_called()
        self.assertEqual(messages[-1]["type"], "complete")
        self.assertIn("Áudio validado", messages[-1]["message"])

    def test_missing_ffmpeg_reports_clear_error(self):
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/yt-dlp" if name == "yt-dlp" else None):
            with self.assertRaisesRegex(RuntimeError, "FFmpeg"):
                host.command_for("https://youtube.com/watch?v=abcdefghijk")

    def test_progress_parse(self):
        self.assertEqual(host.parse_percent("[download]  35.2% of 9.32MiB"), 35)
        self.assertIsNone(host.parse_percent("[Merger] Merging formats"))


if __name__ == "__main__":
    unittest.main()
