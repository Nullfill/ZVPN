#!/usr/bin/env bash
set -euo pipefail
for file in install.sh upgrade.sh backup.sh doctor.sh ops/*.sh ops/helper/zvpn-helper; do bash -n "$file"; done
python3 -m py_compile ops/full-backup.py ops/restore-full-backup.py ops/helper/xray-apply.py ops/helper/warp_policy.py ops/helper/warp-router.py ops/helper/ike-relay.py
