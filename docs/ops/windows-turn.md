# Windows TURN relay preparation

Refs #6561. Activation is held until the VPS IP cutover is verified. No public listener, firewall, service, routing, DNS or Main change is made by preparation.

Use the official coturn native x64 artifact pinned in `records/turn/coturn-windows.json`. The tag source and successful MSVC push run are recorded, along with both archive hashes and every selected runtime file. The upstream tag is unsigned and no artifact attestation was supplied; trust is the official repository/run provenance plus the GitHub artifact digest. Its executable reports 4.19.0 because that exact source retains the same fallback build version. Do not substitute binaries based on the display version.

The native package includes its dependency DLLs and runs without a runtime/SDK installation. It is a foreground console program, with no Windows Service Control Manager implementation in the pinned source. The deployment plan uses the existing Thornswood task-SID owner launcher, LOCAL SERVICE with only SeChangeNotifyPrivilege, and no SYSTEM fallback. Protected code/config are read-only to the task SID; only its log/state directory is writable.

The controlled task must run from its protected config directory and use a relative config basename: upstream `find_config_file` recognizes only slash/tilde absolute paths, so Windows drive-letter paths silently fall back to defaults. The process arguments also carry the nonsecret exact bind, UDP-only and auth-required constraints. Missing/wrong config, hash drift or unexpected listeners are refusals, not fallback modes. Coturn 4.19 DTLS and CLI are opt-in; obsolete no-dtls/no-cli options are not used.

Existing Oracle limits are preserved: UDP listener3478, media49160–49191, user-quota8, total-quota32, max-bps65536 and bps-capacity2097152. Each relay receives a separate secret, with the old Oracle credential configuration retained for rollback. A username is currently the issuer’s numeric expiry, so user-quota limits a credential bucket; it must not be described as a unique identity or IP quota. Existing HMAC-SHA1/expiry issuer behavior stays unchanged.

Before activation, finish security/dependency review and record the isolated acceptance. After cutover, prove the new address/reply source, exact allowed UDP ingress/range, secret ACLs and controlled task identity. Then swap only the Dev issuer, run public two-host actual relay media, and let the reviewed normal Dev release proceed. Main requires separate preparation and acceptance; it receives no Dev key/task/range by copying.

Retain the verified upstream archive in the protected deployment tool store and the installed versioned package/manifest for durable rollback. Future installs must use that pinned retained archive or a newly reviewed pin: an expiring upstream CI artifact alone is not a durable installer source.
