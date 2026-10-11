#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
command -v python3 >/dev/null || { apt-get update -qq; apt-get install -y python3; }
python3 -c 'import cryptography' 2>/dev/null || { apt-get update -qq; apt-get install -y python3-cryptography; }
exec python3 "$(dirname "${BASH_SOURCE[0]}")/restore-full-backup.py" "$@"
