"""Проверки выпуска без настоящей сборки, коммитов и запросов к GitHub.

Запуск: python -m unittest discover -s scripts -p test_release.py
"""

import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import release


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.package = self.root / "package.json"
        self.original = b'\xef\xbb\xbf{\r\n  "name": "folder-video",\r\n  "version": "1.0.19"\r\n}\r\n'
        self.package.write_bytes(self.original)
        self.setup = self.root / "out/make/squirrel.windows/x64/folder-video-setup.exe"
        self.setup.parent.mkdir(parents=True)
        self.setup.write_bytes(b"old installer")
        self.calls = []
        self.responses = {}
        self.build_error = None
        self.stack.enter_context(patch.multiple(
            release, ROOT=self.root, PACKAGE_JSON=self.package, SETUP_EXE=self.setup
        ))
        self.stack.enter_context(patch.object(release.sys, "platform", "win32"))
        self.stack.enter_context(patch.object(release.platform, "machine", return_value="AMD64"))
        self.stack.enter_context(patch.object(release.shutil, "which", return_value="tool.exe"))
        self.stack.enter_context(patch.object(release, "run", side_effect=self.fake_run))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def fake_run(self, cmd, **kwargs):
        self.calls.append(cmd)
        if cmd == ["bun", "run", "make"]:
            self.assertFalse(self.setup.exists(), "Старый установщик должен быть удалён")
            if self.build_error:
                raise self.build_error
            version = json.loads(self.package.read_text(encoding="utf-8-sig"))["version"]
            self.setup.write_bytes(f"installer {version}".encode())
        response = self.responses.get(tuple(cmd), "")
        if isinstance(response, Exception):
            raise response
        return subprocess.CompletedProcess(cmd, 0, stdout=response)

    def test_dry_run_builds_new_version_and_restores_exact_package(self):
        release.main(["--dry-run"])
        self.assertEqual(self.package.read_bytes(), self.original)
        asset = self.root / "out/make/folder-video-setup-1.0.20.exe"
        self.assertEqual(asset.read_bytes(), b"installer 1.0.20")
        self.assertEqual(self.calls, [["bun", "run", "make"]])

    def test_failed_build_restores_package_and_removes_stale_installer(self):
        self.build_error = subprocess.CalledProcessError(1, ["bun", "run", "make"])
        with self.assertRaises(subprocess.CalledProcessError):
            release.main(["--dry-run"])
        self.assertEqual(self.package.read_bytes(), self.original)
        self.assertFalse(self.setup.exists())
        self.assertFalse((self.root / "out/make/folder-video-setup-1.0.20.exe").exists())

    def test_failed_asset_copy_restores_package(self):
        with patch.object(release.shutil, "copy2", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                release.main([])
        self.assertEqual(self.package.read_bytes(), self.original)
        self.assertFalse(any(cmd[:2] == ["git", "add"] for cmd in self.calls))

    def test_release_publishes_versioned_asset_and_stable_link(self):
        notes = 'Первая строка\nВторая: "текст" и `код`'
        release.main(["--version", "1.1.0", "--notes", notes])
        self.assertEqual(self.package.read_bytes(), self.original.replace(b"1.0.19", b"1.1.0"))
        tag = "folder-video-v1.1.0"
        self.assertIn(["git", "commit", "-m", f"chore: релиз {tag}",
                       "--only", "--", "package.json"], self.calls)
        self.assertIn(["git", "push", "origin", "HEAD"], self.calls)
        self.assertIn(["git", "push", "origin", tag], self.calls)
        creation = next(cmd for cmd in self.calls if cmd[:4] == ["gh", "release", "create", tag])
        self.assertIn(str(self.root / "out/make/folder-video-setup-1.1.0.exe"), creation)
        self.assertEqual(creation[creation.index("--notes") + 1], notes)
        upload = next(cmd for cmd in self.calls if cmd[:3] == ["gh", "release", "upload"])
        self.assertEqual(upload[3:5], [release.STABLE_TAG, str(self.setup)])
        self.assertIn("--clobber", upload)

    def test_draft_does_not_publish_stable_link(self):
        release.main(["--draft"])
        creation = next(cmd for cmd in self.calls if cmd[:3] == ["gh", "release", "create"])
        self.assertIn("--draft", creation)
        self.assertFalse(any(release.STABLE_TAG in cmd for cmd in self.calls))

    def test_existing_stable_release_is_edited(self):
        api = ("gh", "api", "--paginate", f"repos/{release.RELEASES_REPO}/releases",
               "--jq", ".[].tag_name")
        self.responses[api] = "okoshko-latest\nfolder-video-latest\n"
        release.main([])
        self.assertTrue(any(cmd[:4] == ["gh", "release", "edit", release.STABLE_TAG]
                            for cmd in self.calls))
        self.assertFalse(any(cmd[:4] == ["gh", "release", "create", release.STABLE_TAG]
                             for cmd in self.calls))

    def test_invalid_or_old_version_does_not_build_or_write(self):
        for version in ("1.0.19", "1.0.18", "01.1.0", "1.2", "1.2.3-beta", "1.2.3\n"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                release.main(["--version", version, "--dry-run"])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.package.read_bytes(), self.original)

    def test_dirty_repository_does_not_build_or_write(self):
        self.responses[("git", "status", "--porcelain")] = " M app.js\n"
        with self.assertRaisesRegex(RuntimeError, "закоммитьте"):
            release.main([])
        self.assertEqual(self.package.read_bytes(), self.original)
        self.assertFalse(any(cmd[0] == "bun" for cmd in self.calls))

    def test_existing_remote_tag_does_not_build_or_write(self):
        self.responses[("git", "ls-remote", "--tags", "origin",
                        "refs/tags/folder-video-v1.0.20")] = "abc\trefs/tags/folder-video-v1.0.20\n"
        with self.assertRaisesRegex(RuntimeError, "уже существует"):
            release.main([])
        self.assertEqual(self.package.read_bytes(), self.original)
        self.assertFalse(any(cmd[0] == "bun" for cmd in self.calls))

    def test_stable_lookup_failure_does_not_create_or_overwrite_release(self):
        api = ("gh", "api", "--paginate", f"repos/{release.RELEASES_REPO}/releases",
               "--jq", ".[].tag_name")
        self.responses[api] = subprocess.CalledProcessError(1, list(api))
        with self.assertRaises(subprocess.CalledProcessError):
            release.publish_stable(self.setup, "1.0.20")
        self.assertEqual(self.calls, [list(api)])


if __name__ == "__main__":
    unittest.main()
