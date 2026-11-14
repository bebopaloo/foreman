import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import check_release_separation as check  # noqa: E402

DEPLOY = """
on:
  push:
    branches: [production]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo deploy
"""


def workflow(environment_lines):
    return (
        "on: pull_request\n"
        "jobs:\n"
        "  build:\n"
        "    runs-on: ubuntu-latest\n"
        f"{environment_lines}\n"
        "    steps:\n"
        "      - run: echo hi\n"
    )


class CheckReleaseSeparation(unittest.TestCase):
    def run_check(self, files):
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in files.items():
                (pathlib.Path(tmp) / name).write_text(text)
            return check.check_directory(tmp)

    def test_valid_set_passes(self):
        files = {
            "deploy-production.yml": DEPLOY,
            "ci.yml": workflow("    environment: staging"),
            "plain.yml": workflow("    # no environment"),
        }
        self.assertEqual(self.run_check(files), [])

    def test_production_deploy_on_pull_request_fails(self):
        text = DEPLOY.replace("push:\n    branches: [production]", "pull_request:")
        self.assertTrue(self.run_check({"deploy-production.yml": text}))

    def test_production_deploy_from_main_fails(self):
        text = DEPLOY.replace("[production]", "[main]")
        self.assertTrue(self.run_check({"deploy-production.yml": text}))

    def test_production_deploy_with_extra_push_filter_fails(self):
        text = DEPLOY.replace("[production]", "[production]\n    tags: ['*']")
        self.assertTrue(self.run_check({"deploy-production.yml": text}))

    def test_production_deploy_without_trigger_fails(self):
        text = DEPLOY.split("jobs:")[1]
        self.assertTrue(self.run_check({"deploy-production.yml": "jobs:" + text}))

    def test_other_workflow_forms_of_production_fail(self):
        forms = {
            "plain": "    environment: production",
            "quoted": "    environment: 'production'",
            "case": "    environment: Production",
            "flow mapping with url": "    environment: { name: production, url: x }",
            "flow mapping url first": "    environment: {url: x, name: production}",
            "block mapping url first": (
                "    environment:\n      url: x\n      name: production"
            ),
            "block mapping name first": (
                "    environment:\n      name: production\n      url: x"
            ),
        }
        for label, line in forms.items():
            with self.subTest(label):
                problems = self.run_check({"other.yml": workflow(line)})
                self.assertEqual(len(problems), 1, problems)
                self.assertIn("production", problems[0])

    def test_expression_environment_fails(self):
        for line in (
            "    environment: ${{ 'production' }}",
            "    environment:\n      name: ${{ vars.TARGET }}",
        ):
            with self.subTest(line):
                problems = self.run_check({"other.yml": workflow(line)})
                self.assertEqual(len(problems), 1, problems)
                self.assertIn("expression", problems[0])

    def test_unreadable_environment_fails(self):
        problems = self.run_check({"other.yml": workflow("    environment: [production]")})
        self.assertEqual(len(problems), 1, problems)

    def test_invalid_yaml_fails(self):
        self.assertTrue(self.run_check({"other.yml": "jobs: [unclosed"}))

    def test_real_workflows_pass(self):
        root = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"
        self.assertEqual(check.check_directory(root), [])


if __name__ == "__main__":
    unittest.main()
