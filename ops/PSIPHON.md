# Optional Psiphon upstream

The administrator selects WARP or Psiphon in Google routing settings. The same
domain and account filters apply to IKE and all Xray inbounds. User quota remains
in the existing collectors; gateway traffic is an additional observation, not a
second debit. The displayed gateway totals include both providers' history.

The Linux x86_64 ConsoleClient is downloaded from the official
[Psiphon-Labs binaries repository](https://github.com/Psiphon-Labs/psiphon-tunnel-core-binaries),
pinned to commit `e02a99daa375567d2df20740bb3d4673eaec11fe` and SHA-256
`d83dcaa632b265536852e2d97c45eb4831960f8dbcb2d8638293d5958483705b`.
Psiphon is GPL-3.0 software; its license and corresponding source are available
from [Psiphon-Labs](https://github.com/Psiphon-Labs/psiphon-tunnel-core).

`psiphon-network.json` contains public free-network bootstrap parameters, based
on the public [client configuration example](https://github.com/MohammadForoutan/psiphon-linux-cli-conduit/blob/master/configs/psiphon.config).
No third-party installer or executable is used. Remote server lists retain their
RSA signature verification. DSL discovery is disabled because this bootstrap
does not supply the separate server-entry signature key; verification is not
disabled. Network discovery values may need updating if the provider changes.

The dedicated unprivileged service listens on loopback port 40002 only. The
installer does not activate user routing. The existing routing daemon starts
the selected upstream when enabled. Selecting a different provider keeps the
same domain filters and failure policy. Reconnection can return the same exit
IP; access to Google is not guaranteed by tunnel health alone.

Full backups carry `/etc/zvpn/psiphon.json`, the systemd unit, the policy, and
the matching installer source. Restore reinstalls the pinned client and builds
a fresh local discovery cache. Active tunnels and a particular egress IP cannot
be transferred. Linux architectures other than x86_64 currently keep WARP and
report Psiphon as unavailable.
