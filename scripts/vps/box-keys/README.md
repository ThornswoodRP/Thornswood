# Box keys main carries

One file per machine that has its own Administrator key to the box and got
it from main, not from One: `<name>.json`, with the key's public half and the
SHA-256 of its bridge token, never the private half or the token itself.

    {"name": "oracle-hermes", "public": "ssh-ed25519 AAAA...", "token_sha256": "<64 hex>"}

A merge here, then `pwsh scripts/vps/Box-Run.ps1 -Line 'Grant-BoxKey -Name <name>'`,
puts the key on the box (scripts/vps/Grant-BoxKey.ps1 says what it may touch).
The holder made both halves and the token itself; the Oracle VM's install does
it for Patrick's own Hermes (TWHermesAgents deploy/install.sh, 6b) and puts the
public ones on the ops ledger. Taking a key away is
`Grant-BoxAccess.ps1 -Name <name> -Remove` on One, with its file out of main.
