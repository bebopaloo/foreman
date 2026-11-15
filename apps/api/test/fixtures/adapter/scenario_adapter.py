"""A synthetic adapter for the fetch tests. It answers from scenario.json and logs each call."""

import json
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
scenario = json.loads((here / "scenario.json").read_text())

args = sys.argv[1:]
command = args[4:]  # after: --host <host> --repo <repo>
key = " ".join(command)

with (here / "calls.jsonl").open("a") as log:
    log.write(json.dumps({"command": key, "host": args[1], "repo": args[3]}) + "\n")

# A key with a "<owner>/<name> " prefix answers for that repo only.
answer = scenario.get(f"{args[3]} {key}", scenario.get(key))
if answer is None:
    sys.stderr.write(json.dumps({"error": "unexpected command"}))
    sys.exit(1)
if "error" in answer:
    sys.stderr.write(json.dumps({"error": answer["error"]}))
    sys.exit(1)
sys.stdout.write(json.dumps(answer["ok"]))
