import os
import json
import pathlib
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SCRIPT = ROOT / "scripts" / "local-up.sh"
COMPOSE = (ROOT / "compose.local.yaml").read_text() if (ROOT / "compose.local.yaml").exists() else ""


def run_script(home, extra_env=None, args=(), tokens_json=None):
    """Run local-up.sh with a fake docker that records its arguments.

    tokens_json is what the token step (keychain-tokens.ts) prints. A fake
    `node` prints it, so the test needs no Node version or workspace
    dependencies: the Keychain reading itself is tested in keychain-tokens.test.ts.
    With no tokens_json, the real token step runs. A fake `security` on PATH
    shadows the real one, so no test reads the real Keychain.
    """
    fake_bin = pathlib.Path(home) / "bin"
    fake_bin.mkdir(exist_ok=True)
    log = pathlib.Path(home) / "docker.log"
    docker = fake_bin / "docker"
    docker.write_text(
        '#!/usr/bin/env bash\n'
        'echo "FOREMAN_DATA_DIR=$FOREMAN_DATA_DIR FOREMAN_CLAUDE_DIR=$FOREMAN_CLAUDE_DIR '
        'FOREMAN_MARKETPLACE_DIR=$FOREMAN_MARKETPLACE_DIR $*" >> "$DOCKER_LOG"\n'
        'echo "TOKENS=${FOREMAN_TOKENS_JSON-unset}" >> "$DOCKER_LOG"\n'
    )
    docker.chmod(0o755)
    security = fake_bin / "security"
    security.write_text('#!/usr/bin/env bash\necho "item not found" >&2\nexit 44\n')
    security.chmod(0o755)
    if tokens_json is None:
        # A version-manager shim of node can be slow without a full environment, so use the real binary.
        try:
            node = subprocess.run(
                ["node", "-p", "process.execPath"], capture_output=True, text=True, check=True
            ).stdout.strip()
            node_dir = str(pathlib.Path(node).parent)
        except (OSError, subprocess.CalledProcessError):
            node_dir = str(fake_bin)
    else:
        fake_node = fake_bin / "node"
        fake_node.write_text(f"#!/usr/bin/env bash\nprintf '%s' '{tokens_json}'\n")
        fake_node.chmod(0o755)
        node_dir = str(fake_bin)
    env = {
        "PATH": f"{fake_bin}:{node_dir}:/usr/bin:/bin",
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

    def test_passes_an_empty_marketplace_folder_when_none_is_set(self):
        with tempfile.TemporaryDirectory() as home:
            _, log = run_script(home)
            self.assertIn("FOREMAN_MARKETPLACE_DIR= ", log)

    def test_passes_the_marketplace_folder_to_compose(self):
        with tempfile.TemporaryDirectory() as home:
            market = pathlib.Path(home) / "factory"
            market.mkdir()
            _, log = run_script(home, {"FOREMAN_MARKETPLACE_DIR": str(market)})
            self.assertIn(f"FOREMAN_MARKETPLACE_DIR={market} ", log)

    def test_refuses_a_marketplace_folder_that_is_not_an_absolute_path(self):
        with tempfile.TemporaryDirectory() as home:
            result, log = run_script(home, {"FOREMAN_MARKETPLACE_DIR": "factory"})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("FOREMAN_MARKETPLACE_DIR", result.stderr)
            self.assertEqual(log, "")

    def test_refuses_a_marketplace_folder_that_does_not_exist(self):
        with tempfile.TemporaryDirectory() as home:
            result, log = run_script(home, {"FOREMAN_MARKETPLACE_DIR": f"{home}/missing"})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("FOREMAN_MARKETPLACE_DIR", result.stderr)
            self.assertEqual(log, "")

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


def write_repo_list(home, *repos):
    folder = pathlib.Path(home) / ".claude-bebopaloo" / "factory"
    folder.mkdir(parents=True)
    entries = [{"path": f"/synthetic/{repo}", "repo": repo} for repo in repos]
    (folder / "repos.json").write_text(json.dumps({"repos": entries}))


class Tokens(unittest.TestCase):
    TOKEN = "github_pat_synthetic_value"
    TOKENS = '{"github.com/acme":"github_pat_synthetic_value"}'

    def test_passes_the_keychain_token_to_compose_for_the_up_command_only(self):
        with tempfile.TemporaryDirectory() as home:
            write_repo_list(home, "acme/app")
            result, log = run_script(home, tokens_json=self.TOKENS)
            self.assertEqual(result.returncode, 0, result.stderr)
            up_line = next(line for line in log.splitlines() if " up " in line)
            self.assertIn("--build", up_line)
            self.assertIn(f'TOKENS={{"github.com/acme":"{self.TOKEN}"}}', log)
            self.assertNotIn(self.TOKEN, result.stdout + result.stderr)
            # The token is in the environment of the Compose process, not in its arguments.
            self.assertNotIn(self.TOKEN, up_line)

    def test_starts_with_an_empty_object_when_no_keychain_item_exists(self):
        with tempfile.TemporaryDirectory() as home:
            write_repo_list(home, "acme/app")
            result, log = run_script(home)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("TOKENS={}", log)
            self.assertNotIn("unset", log)

    def test_runs_the_adapter_smoke_test_in_the_api_container(self):
        with tempfile.TemporaryDirectory() as home:
            _, log = run_script(home)
            self.assertIn("exec -T api node apps/api/src/adapter-smoke.ts", log)

    def test_the_smoke_test_and_reindex_get_no_token(self):
        with tempfile.TemporaryDirectory() as home:
            write_repo_list(home, "acme/app")
            _, log = run_script(home, tokens_json=self.TOKENS)
            exec_at = log.index("exec -T api")
            self.assertNotIn(self.TOKEN, log[exec_at:])
        with tempfile.TemporaryDirectory() as home:
            write_repo_list(home, "acme/app")
            _, reindex_log = run_script(
                home, tokens_json=self.TOKENS, args=("reindex",)
            )
            self.assertNotIn(self.TOKEN, reindex_log)


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

    def test_mounts_the_three_folders_read_only(self):
        self.assertIn("${FOREMAN_CLAUDE_DIR:?", COMPOSE)
        self.assertIn("${FOREMAN_DATA_DIR:?", COMPOSE)
        self.assertIn(
            "${FOREMAN_MARKETPLACE_DIR:-marketplace-none}:${FOREMAN_MARKETPLACE_DIR:-/mnt/marketplace-none}:ro",
            COMPOSE,
        )
        self.assertEqual(COMPOSE.count(":ro"), 3)

    def test_api_allows_both_loopback_origins(self):
        self.assertIn("http://127.0.0.1:${LOCAL_PORT:-47100}", COMPOSE)
        self.assertIn("http://localhost:${LOCAL_PORT:-47100}", COMPOSE)

    def test_api_gets_the_tokens_as_a_compose_secret_and_not_in_its_environment(self):
        self.assertIn("\nsecrets:\n  foreman_tokens:\n    environment: FOREMAN_TOKENS_JSON", COMPOSE)
        self.assertIn("    secrets:\n      - foreman_tokens", COMPOSE)
        environment = COMPOSE.split("  api:")[1].split("volumes:")[0]
        self.assertNotIn("FOREMAN_TOKENS_JSON", environment)

    def test_long_running_services_restart_unless_stopped(self):
        self.assertEqual(COMPOSE.count("restart: unless-stopped"), 3)


class Images(unittest.TestCase):
    def test_the_api_image_has_python_uv_gh_and_git_at_pinned_versions(self):
        dockerfile = (ROOT / "Dockerfile").read_text()
        api = dockerfile.split("FROM base AS api")[1].split("USER node")[0]
        for package in ("python3", "uv", "github-cli", "git"):
            self.assertRegex(api, rf"\b{package}=\d[\w.]*-r\d+\b")

    def test_the_web_server_sets_a_same_origin_content_security_policy(self):
        caddyfile = (ROOT / "Caddyfile").read_text()
        line = next(l for l in caddyfile.splitlines() if "Content-Security-Policy" in l)
        for directive in ("default-src 'none'", "script-src 'self'", "style-src 'self'",
                          "img-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"):
            self.assertIn(directive, line)
        self.assertNotRegex(line, r"https?:|unsafe-")


if __name__ == "__main__":
    unittest.main()
