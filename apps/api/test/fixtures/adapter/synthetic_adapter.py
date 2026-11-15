"""A synthetic adapter for the runner tests. It records its call and obeys control.json."""

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

here = Path(__file__).resolve().parent
control = json.loads((here / "control.json").read_text()) if (here / "control.json").exists() else {}

(here / "record.json").write_text(
    json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd(), "env": dict(os.environ)})
)

if control.get("hang"):
    child = subprocess.Popen(["sleep", "60"])
    (here / "child.pid").write_text(str(child.pid))
    time.sleep(60)

if control.get("signal"):
    os.kill(os.getpid(), signal.SIGKILL)

if control.get("stdout_bytes"):
    sys.stdout.write("x" * control["stdout_bytes"])
    sys.stdout.flush()
if control.get("stderr_bytes"):
    sys.stderr.write("x" * control["stderr_bytes"])
    sys.stderr.flush()

if control.get("stderr") is not None:
    sys.stderr.write(control["stderr"])
if control.get("stdout") is not None:
    sys.stdout.write(control["stdout"])
sys.exit(control.get("exit", 0))
