# Playtest and admin commands

These tools are for testing and administration. Ordinary play keeps its existing keys and panels. The command index is [commands.md](commands.md), and the instructions for existing staff tools are [Staff commands](../guide/staff-commands.md).

## Agreed behavior

- Playtesters may use self-only test tools on both Dev and Main. Admins may use the corresponding tools on another character. Existing staff moderation permissions stay as documented.
- Renaming is admin-only, including renaming yourself.
- God mode combines flight, protection from incoming damage, lethal valid attacks, and freedom from hunger, thirst, rest and temperature penalties. Turning it off restores normal rules without erasing saved needs. It does not undo a permanent character decision.
- New commands require the existing proven chat connection, a current launcher pass, the appropriate role and ownership of the requesting character. A target's name never grants permission to act on them.
- Invalid input changes nothing. Changes persist through the ordinary authoritative state paths and have a staff record. Read-only inspection contains gameplay state, not private account data.

## Capability map

| Module | Responsibility | Depends on | Issue |
| --- | --- | --- | --- |
| command-access | Existing role, connection, pass and character ownership checks | Existing command router and staff helpers | #6628 foundation |
| command-help | Route registered tools and show role-appropriate syntax and examples | command-access | #6731 |
| person-teleport | Move only yourself to an online person; preserve restraints and combat/cooldown history | command-access, canonical location and stuck state | #6757 |
| movement-and-god-mode | Flight, phase, god mode, invisibility, effect clearing and bounded cleanup | command-access, authoritative engine behavior | #6628 |
| inspect | Read only the recorded gameplay state of yourself, or somebody else for an admin, with unavailable fields stated plainly | command-access, canonical gameplay properties | #6732 |
| restore-vitals | Restore health, magicka and stamina without reversing permanent decisions | command-access | #6733 |
| set-needs | `/setneeds <hunger\|thirst\|rest\|temperature> <0..100>` for yourself; admins add `for <person>`. Full meters are 100 and comfortable temperature is 50. One saved snapshot retains the elapsed clock and refreshes effects | command-access, canonical needs state | #6734 |
| repair-equipment | `/repairgear` restores your carried equipment below 100%; admins add `for <person>`. Preserve stronger pieces and every item extra, with pack and worn names committed together | command-access, canonical equipment state and native atomic operation | #6735 |
| rank-up | Advance an existing class or profession track through its progression rules | command-access, canonical progression | #6736 |
| change-class | Change a class and keep saved state and unlocks consistent | command-access, canonical progression | #6737 |
| change-profession | Change a profession and keep crafting access consistent | command-access, canonical progression | #6738 |
| rename | Admin-only persistent rename of yourself or another character; refresh the roster and nearby names | command-access, authoritative appearance and roster | #6739 |

Build order: command-access, then command-help and the independent tools. Engine work may proceed beside the utilities. Each tool has its own acceptance checks and does not become available merely because it is described here.

## Help and command boundary

`/testhelp` shows the self-only tools a playtester may use. `/staffhelp` shows the existing staff moderation tools. `/adminhelp` shows the admin tools as well as the lower tiers. Each command verifies the requesting role and current character before returning its list. Extra arguments produce a usage answer.

The server catalog registers only implemented commands, with their syntax, description and minimum role. Registered handlers still enforce the shared authorization boundary for every call. The ordinary help list never advertises privileged tools. Modules publish their own help entries so the available commands and their descriptions do not become separate lists that drift.

A module may document the same command once per role, for example a self-only form for playtesters and a targeting form for admins. Its route uses the lowest declared tier; the handler must still authorize the requested target. The help lists show each form only to its declared tier and above.

The existing `/give`, `/spawn`, `/tp`, `/goto`, `/bring` and `/where` behavior is reused where it already meets the request. Other commands are added in their own issues rather than hidden in the help change.

## Verification and delivery

Write a failing behavioral regression before each change. Use the existing command transport or the whole-gamemode stand-in, and test both permitted calls and denied roles, missing proof, expired passes and wrong actor ownership.

Build with `node scripts/dev/Build-Gamemode.js`, check the generated source with `node scripts/dev/Build-Gamemode.js --check`, and run each tool's focused harness plus the affected gate. Help is checked by `node game/tests/test-scenario-command-tools.js`. For the shared boundary use `node game/tests/test-6628-command-access.js` and `node tests/test-staff-commands.js`.

Every three completed issue fixes require a dev release containing those fixes. Other work continues while that release runs. Merge only after review and the exact-head checks pass; record the dev deployment result independently. Main promotion retains its separate authorization.
