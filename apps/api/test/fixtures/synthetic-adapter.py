import json
import sys

print(json.dumps({"echo": sys.argv[1], "python": list(sys.version_info[:3])}))
