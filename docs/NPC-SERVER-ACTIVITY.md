# Shared NPC activity

The server owns the retained winning placed identities and their movement,
combat, health and return timers. The population policy runs before loading,
including later saved-form loads. Main and dev both start this controller:
`game/gamemode.js` starts it when `thornswoodServer` is main or dev (or unset,
which reads as main), since 6e4488e4 on 3 October.

A cut actor is never made on the server, and since #2468 it is meant never to
be drawn in anybody's game either. Until then each person's game loaded every
placed actor of a cell from the plugins, and the client's world cleaner
removed the ones the server does not own one per frame, so a cut guard or
filler stood there for a moment. `Thornswood-Last.esp` (made from `game/data/last-plugin.recipe`, #2791) overrides
every cut placed actor initially disabled, with no enable parent, built by
`scripts/mods/Build-LastPlugin.py` from this catalogue; the server's reader
skips a disabled reference too (measured on 12 Oct with the built server
addon: 5,038 actors made with the plugin at the end of the load order, none
of them a cut one, against 11,273 without it and without the cut list). The
plugin is the servers' last plugin and ships from this repository like the
content plugin (#2486), so the gamemode no longer hands the server a cut list
of its own (`tests/test-2468-last-plugin.js` holds the two together). The
native acceptance run with the plugin and no list, 13 Oct: all 5,072 kept
identities loaded and controlled before and after a gamemode reload, none of
the 9,596 cut ones, peak 1,477 MiB.

The 48-plugin catalogue contains 14,641 placements: 5,072 retained and 9,569
excluded. Named pets and enemies are cut even without a Unique flag. Fourteen
old Justiciars and the embassy soldier are excluded too. Remnant patrols are
not placed by this catalogue. Traders, outside transport services, ecological
wildlife and generic hostile encounters remain under habitat caps.
Authored corpses are excluded from live encounters.
The native eligibility filter excludes mannequins and permits retained vampires
and their traders. Humans, profiles and connected identities are protected.

[Population counts and locations](NPC-POPULATION.md),
[exact NPC spawn coordinates](NPC-SPAWNS.csv),
[hunting yields and access gates](HUNTING-SPOTS.csv),
[existing fishing locations](FISHING-SPOTS.csv) and
[hanging game locations](HANGING-GAME-SPOTS.csv) come from these inputs.
The existing fishing placements are a source inventory, before the new fishery
allocation, poles, traps and scarce quest gates in the Fisher specification.

The hunting list reads no plugin: it is every retained animal from
`game/data/npc-population.json` with what `game/data/hunts.json` gives for its
body. A population rebuild writes it, and so does
`python scripts/dev/Build-ResourceLocations.py --hunting-only` after a hunt
table rebuild. `game/tests/test-1874-hunting-spots.js` fails the build when it is not
what those two tables say.

Loading advances one candidate every 10 ms. Native record and navigation indexes
are prepared during startup. Navigation preparation shares raw geometry and a
spatial index across overlapping regions, yields after bounded work, and creates
reciprocal portal links only when a route needs them. Background activity continues
with no connections. Nearby activity uses the same authority and state.

An NPC nobody can see that only wanders takes one step every 15 seconds, and
its first step at once (#3181, Patrick's C on 22 Oct 2026: NPCs nobody can see
are updated less often, never paused). Such a step covers up to 15 seconds of
walking, still no further than the next point of its path. Before, the pass
over the cast stepped each of them as fast as its 4 ms every 20 ms allowed,
about every 5 seconds: with nobody on, dev's 4,820 took about 59,000 moving
steps a minute on 22 Oct, and those steps were most of the 0.18 of a core
dev's JavaScript thread was busy. The first try, a step every 4 seconds, was
no fewer steps than that, and the profiles showed it. An NPC in a fight or a flight nobody can see is
stepped every 100 ms, as often as one somebody can see, and one within 4,096
units of somebody is stepped as before. The minute report counts the
background steps.

Each NPC waits its turn in a queue ordered by when it is due, and a pass takes
only the ones that are due. The first version walked the whole cast in order
and skipped whoever was not due yet. Dev's second profile on 22 Oct, with
4,820 NPCs and nobody on, found that walk cost more than the steps it saved:
`backgroundTick` took 1,984 ms in 120 s, against 593 ms before the change.
With the 15 second turn, dev's third profile (6:35 AM) found 0.129 of a core,
down from 0.191, and about 19,200 moving steps a minute.

The runtime's other tasks run only while they have work. Loading navigation
meshes, searching for walkable ground, preparing an NPC and stepping the NPCs
somebody can see each start when something hands them work, and stop when
their queue is empty. Until 22 Oct each one set its next turn whatever it found,
so with nobody on and every mesh loaded, the mesh task still woke every 2 ms
and the other three every 10 or 100 ms. Dev's 6:35 AM profile put that waking,
its timers and the minute line's count of each run at about 2.5 s of the
15.5 s its JavaScript thread was busy in 120 s (#3181).

Movement follows walkable triangles in the local region. It retains the saved
height above the navigation surface and crosses only verified reciprocal edges.
Missing or corrupt geometry, an unsuitable saved position, or a displacement
outside the prepared region pauses activity. The NPC remains loaded and owned by
the server. A reliable stopped snapshot prevents continued walking extrapolation.
Dead, disabled, and immobile NPCs also pause safely.

An NPC the game placed off walkable ground (a goat on a ledge, a horker on a
rock, a deer just past a mesh edge) is set down on the walkable point nearest
its placement, searched out to 8,192 units, the way the game moves an actor
onto its navmesh. It happens only while nobody is within 4,096 units, and only
in a tick that read where everybody is. When that point is past its home
radius, the point becomes its home. An ambush (a base named ...Ambush..., such
as a draugr in a burial alcove) waits where it was placed until somebody comes
within 1,024 units, then walks straight out onto the floor beside it; one more
than 256 units from any floor (a pipe or a ceiling the game empties by script)
stays put. A race that swims and cannot walk (the slaughterfish) moves only over
water triangles, at its height above the bed and never higher than the depth it
was placed at. The searches run a few tiles at a time on their own tick. The
catalogue leaves out the game's test worldspaces and its test and holding
interiors. Issue #2067 has the measurements.

Movement also respects the authored home radius, including local routes on slopes
and inside small home ranges. Dynamic encounters and farm births must pass habitat
and shared density checks before their creation is reported as successful.
Destroyed dynamic identities release their slots; bodies awaiting return retain
theirs.

A creature made by `/spawn` or `/spawnat` is outside the habitat caps and is
temporary unless the command ends in `keep` (#2623, Djinn, 17 Oct: "A creature
spawned by a staff member should never be made permanent unless we want to
make it permanent"). Its private marker `thornswoodNpcCommanded` is
`{run}` for a temporary one, naming the run of the server it was made in
(`serverRunId`, kept across a gamemode reload), or `{keep:true}`. A temporary
one's body lies the normal time when it dies (a hunted animal
`HUNT_TUNING.bodySeconds`, anything else the engine's 25 seconds, never a kept
spawn's 45 minutes), so it can be skinned and looted; when the engine would
stand it up, `mp.onRespawn` refuses that and it is taken out of the world. One
still standing from an
earlier run is not admitted at the next start: `removeSpawned` marks its
record deleted, destroys it, and the population and the runtime (`forget`)
let go of its id. The plain `true` every spawn carried before is read as
temporary, since nobody chose to keep it, so those go the first time the
gamemode loads with this change, a deploy included. Whether a creature that
dies is temporary is read off its own marker (`isTemporarySpawn`), so one
that dies in the seconds after a gamemode reload is removed too. Who may add
`keep` to `/spawn` is the one switch `SPAWN_KEEP_WHO`: `'playtester'` (testers
and staff, Djinn's choice on 17 Oct) or `'staff'`.

Native inherited aggression, confidence, and current faction membership inform
target selection. Common membership and ally or friend reactions suppress
spontaneous hostility. Accepted damage can provoke temporary retaliation.
Confidence zero flees along safe local navigation. Targets are read again before
an attack; disconnected human identities and profiles are protected immediately.
Melee uses owned equipped weapons, or unarmed damage, with the existing native
reach, cooldown, damage, block, health, and death pipeline. Health, death, attack,
and terminal stop messages are reliable. Ordinary movement is unreliable, with
one message per directly connected observer.

Authority and private activity progress survive world saves. An NPC's
activity record is written when it is taken on and when a fight or a flight
starts or ends, never as it only wanders (#3180): each write saves the actor's
whole record to disk, and until 22 Oct 2026 every NPC was written every 30
seconds, about 5,000 files every 32 seconds on each server with nobody on.
So after a server restart a wandering NPC starts where it was last written,
inside its home, rather than where it had walked to. Temporary combat
targets are not persisted. Saved faction removals, including an empty faction
list, remain removed after reconstruction.

A gamemode reload in a running server (a gamemode-only dev deploy, #3196)
keeps the engine, its actors and where they stand, and the NPCs carry on
through it (#3296, Patrick's C on #3196: "the NPC runtime also hands its NPCs
straight to the new copy, so they never pause"). The old runtime and
population stop and hand over what they know: each NPC enrolled, owned and
prepared with its state and policy, the navigation meshes read and their tile
index, the `due` queue, the NPCs held off walkable ground and the searches
under way, the habitat counts and the loading cursor. The new ones go on from
that, so no batch is read again, no NPC is owned or configured again and no
mesh is read again; only each merchant's purse is read by the new purse
service. Before, the new runtime took the whole cast back from nothing, about
3 minutes 50 seconds on dev in which the NPCs stood still. What is handed
over is data only: the new load looks each triangle up again in its own
navigation and starts each search again, so nothing of the old load's code
stays in memory. It is taken only when both loads have the same NPC code and
catalogue: a SHA-256 of the population policy, catalogue and runtime blocks
and the NPC SERVER STARTUP block, read from the file that is loading, and of
the catalogue the merchant roles made. Any difference takes the full load and
server.log says "Shared NPC runtime starts over" with the reason; a carried
load says "Shared NPC runtime carried on from the previous gamemode load"
with its counts. `game/tests/test-3296-npc-handover.js` holds all of it. A
server restart still loads the cast from the saved world, as above.

Fixed cave and dungeon tiers scale maximum health and outgoing weapon or spell
damage. Tier 1 uses the source baseline, tier 2 uses 1.25 health and 1.10 damage,
tier 3 uses 1.50 health and 1.20 damage, and tier 4 uses 2.00 health and 1.35 damage.
Bandit camps and giant camps have separate source baselines without camp tiers.
Health percentages and return deadlines survive saves. Loading a newer saved
deadline invalidates an older pending return timer. Invalid saved values fail
before publishing resurrection. Native life generations distinguish each actual
return, so missed callbacks cannot award another dressing of the same corpse.
Fishing and hanging racks use shared persisted waits.

This is shared local activity and melee combat. It does not implement every
vanilla package, doorway transition, flying behavior, ranged projectile, magic
decision, or authored work and sleep schedule. NPCs without safe local navigation
remain stationary rather than moving through unverified geometry. Merchant
economy, custom quest offers and the new fishery content remain separate
capabilities. Exact guild relocation is deferred.

Verification uses the native suite, the shared runtime fixtures, and an offline
run against the installed 48-plugin load order. The offline acceptance fixture
requires all retained identities owned and accounted for within five simulated
minutes, actual activity before and after a gamemode reload, no record
rewritten while its mode stays the same, saved sequence recovery, stationary position preservation, and less than 2 GiB RSS. Scheduled
activity callbacks must finish within 50 ms. A single cold native record load is
indivisible and has a separate 100 ms ceiling; it cannot accumulate into a batch.
No game or launcher is started by these checks. A real dev restart and a later
two-person session are separate evidence for persistence and visible agreement.

The original full-cast baseline contained 11,253 native identities. The dev proof
below is the run before the fifteen old Thalmor were removed from the catalogue.
The mannequin-only filter admits 11,388 before the cut; all 5,087 retained source
identities were eligible in that run.
The policy excludes 6,301 native eligible identities
and 9,554 catalogue identities overall. The recorded population run owned all
5,087 before and after reload. After reload, 4,750 were active and 337 remained
safely stationary. All 4,732 eligible identities moved during the final activity
window. Eleven attackers landed accepted attacks before reload. Peak RSS was
1,798.16 MiB, the worst callback 28.46 ms and the worst cold load 9.47 ms.
This final run used the enabled ElysiumEstate.esp file and verified the policy
and encounter tiers before and after reload.
