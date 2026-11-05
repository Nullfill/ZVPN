# Optional Firefox Built-in VPN upstream (experimental)

This provider is an independent TCP integration with Firefox IP Protection,
not the paid Mozilla VPN app. It uses an administrator-owned Mozilla account
and the same selected-domain/account policy as WARP and Psiphon. IKE, direct
VLESS, Netlify and Iran VLESS retain their existing shared quota collectors.
Gateway bytes remain an observation, never a second debit.

## Activation

Installation and upgrades install the native Node 20+ sidecar automatically.
It binds SOCKS on **127.0.0.1:40003** and administrative control on a Unix socket
readable/writable only by its owner and the panel service group. It does not
change the host default route. The existing provider remains selected.

In Google routing settings select Firefox, start Mozilla login, open the official
login link, then paste the **complete success URL** into the panel. Never paste
the URL into a public issue or chat. The PKCE/state attempt belongs to the
requesting administrator, expires after ten minutes and is consumed once.
Passwords and existing browser profile credentials are not accessed.

The public Mozilla Android client ID and its Mozilla-hosted redirect are used
for this experimental flow, following the public client example below. This is
not a registered ZVPN OAuth client or a supported public Mozilla integration.
If the service rejects this client/scope/redirect, stop: do not bypass account
eligibility or substitute stolen browser sessions.

Account activation obtains ProxyPass through Guardian. The access token is
sent only to Mozilla; only ProxyPass is sent to the catalog-selected Fastly proxy.
Streamed HTTP/2 CONNECT is bidirectional, uses normal TLS certificate checking,
has backpressure and a 64-client limit. No destination request is replayed after
sending application bytes. OAuth and ProxyPass renew separately, with single-flight
refresh and bounded retry. Renewals still require validation with a real account.

All catalog countries are shown. The Firefox `locked` flag is a browser UI prerequisite,
not a server authorization verdict. On 2026-11-05 Austria and Netherlands accepted
authenticated CONNECT with this account despite that flag. Countries without
non-quarantined endpoints stay disabled; the proxy still enforces account access.
Select an available country, test connectivity, then save the provider choice.
The CONNECT path must carry a successful HTTPS trace before activation. Country
`REC` selects an available location, not a guaranteed fastest server.
TCP-only operation requires QUIC blocking; there is no UDP relay in this release.
Domain exclusions and the configured block/direct failure policy remain effective.

## Account and recovery

Credentials and quota metadata are AES-256-GCM encrypted in
`/var/lib/zvpn-panel/firefox/account.enc`; the per-installation 32-byte key is
`/etc/zvpn/firefox.key`, root-owned and readable by the sidecar group only.
Account data never appears in ordinary panel settings, audit logs or status.
Status reports unknown quota fields as unknown, not zero/unlimited.
The provider's remote quota is shared by the selected accounts and is separate
from individual ZVPN balances. There is no claim of unlimited bandwidth.

Full backup includes the ciphertext, its matching key, unit and exact source.
Restore rejects an enabled-provider snapshot missing these files, reinstalls
the sidecar and repairs owner/group permissions. Restoring a snapshot without
an account clears an older destination account. TLS certificates and IKE/Xray
identities are unaffected. Live streams, OAuth attempts and ProxyPass are not
transferred; refresh-token validity and account eligibility remain external.

Disconnecting the account stops selected Firefox routing and erases local
credentials, closes active streams and cancels stale refresh results. It does
not claim server-side revocation: revoke the grant in Mozilla account settings
if required. Encrypted historical backups retain the account until removed.

## Verification

`node --test ops/firefox/core.test.mjs` covers PKCE/state, redirect/owner/expiry,
encrypted-store tampering, catalog endpoint restrictions, unknown quota, verified TLS
HTTP/2 CONNECT, bidirectional payload and denial without destination replay.
The TLS integration test requires Linux and OpenSSL. Router and full-backup
tests also exercise the fixed local port, TCP-only enforcement and recovery
requirements. These tests do not prove a real Mozilla account is entitled.

Rollout verification on 2026-11-05 completed administrator login, ProxyPass,
HTTPS egress, a forced OAuth refresh followed by a new ProxyPass, and a Gemini
HTTP 200 response without the country-error page. This proves the renewal path,
not an elapsed multi-hour expiry or service availability guarantee. The initial free-account catalog was used; expanded locations were verified separately. Never select this provider merely
because its process or TLS handshake is alive.

References:
- [Mozilla user guide](https://support.mozilla.org/en-US/kb/built-in-vpn)
- [Firefox IP Protection architecture](https://firefox-source-docs.mozilla.org/toolkit/ipprotection/Components.html)
- [Public client example, reviewed revision](https://github.com/tututu-patch/firefox-vpn-proxy/blob/92ebc0434d41105229069fde7fee3783129adf41/vpnclient/auth_browser.go)

The engine is implemented here using Node built-ins; no third-party VPN
binary or copied GPL engine is distributed. Catalog JSON is fetched over
verified HTTPS with same-origin pagination and a strict Fastly hostname
allowlist; this is not Firefox Remote Settings content-signature verification.
