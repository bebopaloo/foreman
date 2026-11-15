import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SCRIPT = ROOT / "scripts" / "local-up.sh"
COMPOSE = (ROOT / "compose.local.yaml").read_text() if (ROOT / "compose.local.yaml").exists() else ""


def run_script(home, extra_env=None, args=()):
    """Run local-up.sh with a fake docker that records its arguments."""
    fake_bin = pathlib.Path(home) / "bin"
    fake_bin.mkdir(exist_ok=True)
    log = pathlib.Path(home) / "docker.log"
    docker = fake_bin / "docker"
    docker.write_text(
        '#!/usr/bin/env bash\n'
        'echo "FOREMAN_DATA_DIR=$FOREMAN_DATA_DIR FOREMAN_CLAUDE_DIR=$FOREMAN_CLAUDE_DIR $*" >> "$DOCKER_LOG"\n'
    )
    docker.chmod(0o755)
    env = {
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "HOME": home,
        "DOCKER_LOG": str(log),
        **(extra_env or {}),
    }
    result = subprocess.run(
        ["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True, cwd=ROOT
    )
    return result, (log.read_text() if log.exists() else "")


class LocalUpScript(unittest.TestCase):
    def test_creates_a_missing_data_folder_with_mode_0700_first(self):
        with tempfile.TemporaryDirectory() as home:
            result, log = run_script(home)
            data = pathlib.Path(home) / ".foreman"
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(data.is_dir())
            self.assertEqual(stat.S_IMODE(data.stat().st_mode), 0o700)
            self.assertIn("compose.local.yaml", log)
            self.assertIn("up", log)
            self.assertIn("--build", log)

    def test_keeps_the_mode_of_an_existing_data_folder(self):
        with tempfile.TemporaryDirectory() as home:
            data = pathlib.Path(home) / ".foreman"
            data.mkdir(mode=0o750)
            data.chmod(0o750)
            result, _ = run_script(home)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(stat.S_IMODE(data.stat().st_mode), 0o750)

    def test_passes_the_folders_to_compose(self):
        with tempfile.TemporaryDirectory() as home:
            _, log = run_script(home)
            self.assertIn(f"FOREMAN_DATA_DIR={home}/.foreman", log)
            self.assertIn(f"FOREMAN_CLAUDE_DIR={home}/.claude-bebopaloo", log)

    def test_refuses_the_default_claude_folder(self):
        with tempfile.TemporaryDirectory() as home:
            result, log = run_script(home, {"FOREMAN_CLAUDE_DIR": f"{home}/.claude"})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("FOREMAN_CLAUDE_DIR", result.stderr)
            self.assertEqual(log, "")

    def test_refuses_a_symlink_to_the_default_claude_folder(self):
        with tempfile.TemporaryDirectory() as home:
            (pathlib.Path(home) / ".claude").mkdir()
            (pathlib.Path(home) / "link").symlink_to(pathlib.Path(home) / ".claude")
            result, log = run_script(home, {"FOREMAN_CLAUDE_DIR": f"{home}/link"})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("FOREMAN_CLAUDE_DIR", result.stderr)
            self.assertEqual(log, "")

    def test_reindex_runs_in_the_api_container(self):
        with tempfile.TemporaryDirectory() as home:
            result, log = run_script(home, args=("reindex",))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("exec", log)
            self.assertIn("reindex.ts", log)
            self.assertFalse((pathlib.Path(home) / ".foreman").exists())


class ComposeFile(unittest.TestCase):
    def test_has_the_four_services(self):
        for name in ("db:", "migrate:", "api:", "web:"):
            self.assertIn(f"\n  {name}", COMPOSE)

    def test_web_binds_to_loopback_port_47100_only(self):
        self.assertIn('"127.0.0.1:${LOCAL_PORT:-47100}:80"', COMPOSE)
        self.assertNotIn("0.0.0.0:", COMPOSE.replace("HOST: 0.0.0.0", ""))

    def test_database_has_a_named_volume_and_no_published_port(self):
        self.assertIn("db-data:/var/lib/postgresql", COMPOSE)
        self.assertEqual(COMPOSE.count("ports:"), 1)

    def test_mounts_both_folders_read_only(self):
        self.assertIn("${FOREMAN_CLAUDE_DIR:?", COMPOSE)
        self.assertIn("${FOREMAN_DATA_DIR:?", COMPOSE)
        self.assertEqual(COMPOSE.count(":ro"), 2)

    def test_api_allows_both_loopback_origins(self):
        self.assertIn("http://127.0.0.1:${LOCAL_PORT:-47100}", COMPOSE)
        self.assertIn("http://localhost:${LOCAL_PORT:-47100}", COMPOSE)

    def test_long_running_services_restart_unless_stopped(self):
        self.assertEqual(COMPOSE.count("restart: unless-stopped"), 3)


if __name__ == "__main__":
    unittest.main()
