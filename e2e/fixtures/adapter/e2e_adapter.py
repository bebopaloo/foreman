"""A synthetic forge and tracker adapter for the e2e API. It answers from scenario.json and logs each call.

It opens no network connection: any attempt to connect stops the command.
"""

import json
import os
import socket
import sys
from pathlib import Path


def refuse_connection(*_args, **_kwargs):
    raise OSError("the synthetic adapter opens no network connection")


socket.socket.connect = refuse_connection
socket.socket.connect_ex = refuse_connection

here = Path(__file__).resolve().parent
scenario = json.loads((here / "scenario.json").read_text())

args = sys.argv[1:]  # --host <host> --repo <repo> <command...>
host, repo, command = args[1], args[3], args[4:]
key = " ".join(command)

with (here / "calls.jsonl").open("a") as log:
    log.write(
        json.dumps(
            {
                "command": key,
                "host": host,
                "repo": repo,
                "script": str(Path(__file__).resolve()),
                "pid": os.getpid(),
            }
        )
        + "\n"
    )

# A key with a "<owner>/<name> " prefix answers for that repo only.
answer = scenario.get(f"{repo} {key}", scenario.get(key))
if answer is None and command == ["repo"]:
    owner, name = repo.split("/")
    answer = {
        "ok": {
            "host": host,
            "owner": owner,
            "name": name,
            "url": f"https://{host}/{repo}",
            "default_branch": "main",
        }
    }
if answer is None and command[:2] == ["file", "get"]:
    answer = {"error": f"file not found: {command[2]} at {command[4]}"}
if answer is None:
    sys.stderr.write(json.dumps({"error": "unexpected command"}))
    sys.exit(1)
if "error" in answer:
    sys.stderr.write(json.dumps({"error": answer["error"]}))
    sys.exit(1)
sys.stdout.write(json.dumps(answer["ok"]))
