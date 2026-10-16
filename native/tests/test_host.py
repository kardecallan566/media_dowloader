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

    def test_contextual_source_download_is_limited_to_origin_and_cdn_pair(self):
        source = "https://cdn-s01.pixel-sus-4k-image.com/stream/h/example/07.mp4"
        origin = "https://sushianimes.com.br/assistir/teste/episodio-7"
        self.assertTrue(host.allowed_source(source, origin))
        self.assertFalse(host.allowed_source(source, "https://www.instagram.com/"))
        self.assertFalse(host.allowed_source("https://127.0.0.1/file.mp4", origin))
        self.assertFalse(host.allowed_source("https://cdn-s01.pixel-sus-4k-image.com.private.test/x.mp4", origin))
        self.assertFalse(host.allowed_source("http://cdn-s01.pixel-sus-4k-image.com/x.mp4", origin))
        self.assertFalse(host.allowed_source("https://cdn-s01.pixel-sus-4k-image.com/x.html", origin))

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

    def test_missing_ffmpeg_reports_clear_error(self):
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/yt-dlp" if name == "yt-dlp" else None):
            with self.assertRaisesRegex(RuntimeError, "FFmpeg"):
                host.command_for("https://youtube.com/watch?v=abcdefghijk")

    def test_progress_parse(self):
        self.assertEqual(host.parse_percent("[download]  35.2% of 9.32MiB"), 35)
        self.assertIsNone(host.parse_percent("[Merger] Merging formats"))


if __name__ == "__main__":
    unittest.main()
