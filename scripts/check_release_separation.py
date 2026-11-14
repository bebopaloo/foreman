"""Check that only deploy-production.yml uses the production environment.

A pull request and the main branch have no human review before production, so no
other workflow may use the production environment, and deploy-production.yml
runs only on a push to production or a workflow_dispatch. The check parses each
workflow as YAML, so every spelling of `environment` reads the same. It fails
on a value that it cannot read, because an unread value could hide production.

Usage: check_release_separation.py [workflows-dir]
"""

import pathlib
import sys

import yaml

PRODUCTION_WORKFLOW = "deploy-production.yml"
ALLOWED_EVENTS = {"push", "workflow_dispatch"}


def _environment_names(job_id, job):
    """Return (names, problem) for one job. A problem means the value is unreadable."""
    if not isinstance(job, dict):
        return [], f"job {job_id!r} is not a mapping"
    if "environment" not in job:
        return [], None
    env = job["environment"]
    if isinstance(env, dict):
        env = env.get("name")
        if env is None:
            return [], None  # a mapping with no name uses no named environment
    if not isinstance(env, str):
        return [], f"job {job_id!r} has an environment that the check cannot read"
    if "${{" in env:
        return [], f"job {job_id!r} sets the environment with an expression"
    return [env.strip().lower()], None


def _trigger(doc):
    # YAML 1.1 reads the key `on` as the boolean True.
    for key in (True, "on"):
        if key in doc:
            return doc[key], True
    return None, False


def _events(trigger):
    if isinstance(trigger, str):
        return {trigger}
    if isinstance(trigger, list):
        return {str(item) for item in trigger}
    if isinstance(trigger, dict):
        return {str(item) for item in trigger}
    return set()


def check_workflow(path):
    path = pathlib.Path(path)
    try:
        doc = yaml.safe_load(path.read_text())
    except yaml.YAMLError as error:
        return [f"{path}: cannot parse as YAML ({type(error).__name__})"]
    if not isinstance(doc, dict):
        return [f"{path}: is not a workflow mapping"]

    problems = []
    jobs = doc.get("jobs")
    if not isinstance(jobs, dict):
        jobs = {}
    is_production_workflow = path.name == PRODUCTION_WORKFLOW

    if not is_production_workflow:
        for job_id, job in jobs.items():
            names, problem = _environment_names(job_id, job)
            if problem:
                problems.append(f"{path}: {problem}")
            elif "production" in names:
                problems.append(
                    f"{path}: job {job_id!r} uses the production environment; "
                    f"only {PRODUCTION_WORKFLOW} may"
                )
        return problems

    trigger, found = _trigger(doc)
    events = _events(trigger)
    if not found or not events:
        problems.append(f"{path}: has no readable trigger")
    elif events - ALLOWED_EVENTS:
        problems.append(
            f"{path}: runs on {sorted(events)}; only push to production and workflow_dispatch"
        )
    elif "push" in events:
        push = trigger.get("push") if isinstance(trigger, dict) else None
        branches = push.get("branches") if isinstance(push, dict) else None
        if isinstance(branches, str):
            branches = [branches]
        extra = set(push) - {"branches"} if isinstance(push, dict) else set()
        if branches != ["production"] or extra:
            problems.append(f"{path}: a push deploys only from the production branch")
    return problems


def check_directory(directory):
    problems = []
    for path in sorted(pathlib.Path(directory).glob("*.y*ml")):
        problems.extend(check_workflow(path))
    return problems


def main(argv):
    directory = argv[1] if len(argv) > 1 else ".github/workflows"
    problems = check_directory(directory)
    for problem in problems:
        print(f"::error::{problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
