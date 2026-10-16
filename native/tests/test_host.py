import sys
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_missing_ffmpeg_reports_clear_error(self):
        with patch.object(host.shutil, "which", side_effect=lambda name: "/usr/bin/yt-dlp" if name == "yt-dlp" else None):
            with self.assertRaisesRegex(RuntimeError, "FFmpeg"):
                host.command_for("https://youtube.com/watch?v=abcdefghijk")

    def test_progress_parse(self):
        self.assertEqual(host.parse_percent("[download]  35.2% of 9.32MiB"), 35)
        self.assertIsNone(host.parse_percent("[Merger] Merging formats"))


if __name__ == "__main__":
    unittest.main()
