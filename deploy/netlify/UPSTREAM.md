Netlify relay adapted for ZVPN from avacocloud/XHTTP-Installer.

Source: https://github.com/avacocloud/XHTTP-Installer/blob/e36878fd1f7762a8efe4845df2872faac405f476/deploy/netlify/netlify/edge-functions/relay.js

Copyright (C) 2025 avaco_cloud. GPL-3.0. See LICENSE, COPYING and NOTICE.

ZVPN changes: restrict routing to the existing XHTTP endpoint; validate origin and session paths; preserve streaming; do not relay admin pages, cookies or proxy credentials. No server installer is included.
