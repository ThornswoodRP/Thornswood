# Staff scene tools

The self-only commands are for Playtesters on both Dev and Main. `/killall`
requires Admin. Existing staff moderation permissions stay as they are.
The shared command boundary checks the proven chat connection, current launcher
join pass, the command's tier and the requesting actor's profile. No browser
message, console string or client-reported role grants access.

The server owns the state. The owner receives only the flight and damage
protection switches; observers receive the visibility switch. Native client
calls follow changes to those properties once, rather than a repair loop.
Server damage protection uses the fork's runtime `isGodMode` property;
it refuses health loss and direct death before either is published. Enabling
it never resurrects an already dead character. It is not saved across a
server restart or a change in actor runtime authority.

This requires the paired [native API change](https://github.com/ThornswoodRP/skymp/pull/175),
tested at `17ca822f8747b75c384f26266aa3ebb3f9f92d9a`. An older server binding
does not grant god mode; the tool refuses the unavailable API. The engine pin
and paired deployment remain the coordinator's review step.

- `/fly on|off` controls collision-free flight with the usual movement keys.
- `/phase` moves the current character a short distance forward in the same
  cell. The native location is confirmed before success is recorded. It starts
  a fresh stuck trail without clearing combat history or cooldowns, and does
  not open or unlock doors.
- `/godmode on|off` enables flight, damage protection and lethal validated
  attacks for the current character. Hunger, thirst, Rest and temperature
  pause and impose no penalties or crafting refusal. Their saved values
  remain intact and resume normally when the mode ends. Flight still obeys
  restraints. Attacks retain the server's ownership, equipment, range and
  timing checks; a healing or zero-damage spell does not become an attack.
- `/invisible on|off` hides the character's rendered body and nearby/party
  name tags. It does not change NPC perception or combat rules.
- `/cleareffects` ends the current character's alcohol and drug effects,
  including their pending crashes, hangover and withdrawal. It does not clear
  injuries, diseases, learned spells or unrelated magic effects.
- `/killall` ends nearby hostile, ordinary NPCs under server authority, within
  about 20 metres and in the same cell, at most 40 in one use. People's
  characters, named/unique, essential, protected, town and unreadable actors
  are excluded. It reports and records successful and failed targets.

Flight and phasing are refused while frozen, cuffed or in a locked jail.
Flight is revoked when any of those conditions begins. Modes are also revoked
on logout, loss of the Playtester tier, expiry of the join pass or actor reassignment.
Every successful command and each revocation uses the existing staff audit.
Client errors are logged rather than reported as successful native actions.

`staff-tools.ts` registers its implemented words and tier-specific help in
the command catalog. Both the catalog and the module use the shared
`staff.authorizeTool` boundary. The tools accept no arbitrary target,
property or native method name. `/testhelp` and `/adminhelp` list only the
commands available at their tier.

## Verification

Run `node game/tests/test-scenario-staff-scene-tools.js` for the whole-gamemode
queued route, and `node game/tests/test-6628-staff-tools.js` for strict native
property-script, restraint and NPC-selection counterfactuals.

The behavioral harness exercises unauthorized and mismatched actors, expired
passes, constrained movement, state changes, revocation and fail-closed NPC
selection. Native owner/observer scripts run against a recording platform in
that harness. Real game acceptance still requires two observers for visibility,
movement and protected damage, and a scene containing an ordinary hostile NPC,
a protected NPC and another person's character for the bounded NPC action.
