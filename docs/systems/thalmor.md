# The Thalmor

Outlaws. The Expulsion was 4E 209. It is 4E 252. They have been
illegal in Skyrim for 43 years. There is no embassy for them to run
to, no immunity, and no order from home. The Dominion is an enemy of
the Accord, and so is anyone carrying a Justiciar's work.

The history is on the site, in the world page. This page is what that
means when somebody is standing in it.

The Empire's house in Solitude is not theirs. See
[The Imperial Embassy](embassy.md).

## A person who is Thalmor

It is a life, not a class and not a profession. You still pick those
on K. The robes are not a race lock. An Altmer, a Bosmer, or anyone
else the race page allows can wear them. Wearing them does not change
your race.

Thalmor robes, Thalmor armour, and Justiciar weapons are not found in
the world. They are not in a chest and not on a body. A person on the
remnant roll may craft them. The roll is an application, the same
kind as a Jarl, not a button on K. The references are on
[Cut items](cut-items.md), marked thalmor, so they can come back for
an event.

Wearing Justiciar robes, Thalmor armour, or carrying a Dominion flag
in a hold is a hostile marker. A guard, and any person acting as one,
may start a fight on sight. Starting the fight does not need a yes.
Ending the character, a hand, an eye, or a scar they did not choose
still does. See [Death](death.md).

They do not enforce the law. Talos is lawful everywhere in Skyrim.
A Thalmor who punishes that worship is committing the crime, not
judging one. Magic is not their business. See
[Magic and the College](magic.md).

There is no Thalmor faction the server will set on a character to
make the world friendly. The old embassy in Haafingar was emptied.
Claiming a ruin's door does not found a new one. A claim is still a
claim, and the court can take it. See [Property](property.md).

## Patrols

A small cast, not every Thalmor the game placed.

A patrol is 2 to 4. They are on the roads between holds. They do not
spawn inside a walled city. At most 3 patrols in the province at
once, and only one on a given road.

They are not people. They do not wake in a temple. Killing one is a
warrior's work if the killer is a warrior, the same as a bandit. See
[Warrior](professions/warrior.md).

They drop no coin and no world weapon the spoils rule would have to
strip. The fight is the point. A robe left on the ground is still
world gear, and world gear is not a mint and not a free armoury. See
[Gold](gold.md).

They are part of the cast that stays, and the server runs them the
way it runs the rest of that cast: see
[People who are not people](npcs.md).

## What you cannot do

You cannot be a Justiciar in the open and also be under the King's
peace. Article the Fifth of the Accord is the law: neither side
harbours, funds, employs, or carries one.

You cannot use the embassy as a door. The Ambassador hands a Thalmor
over as readily as a Jarl does.

You cannot be the Dominion's official voice. There is no official
voice. The Remnant runs gold and poison under other names. That is
roleplay on top of this page, and it does not turn the coin they
spend into a second mint.

## Where this is

The lore is on the site. An admin writes the remnant roll with
`/remnant add` once the application is accepted, and `/remnant remove`.
Those are staff commands, and the person named is told in their own
chat. Only somebody on the roll makes the Thalmor robes, boots, gloves
and hood and the Justiciar weapons, and the world does not hand them
out. The robes are not race locked, as the race page says.

A character wearing any of those pieces, or the game's own Thalmor
robes, reads Thalmor to the server. Nothing acts on that by itself.
There are no NPC guards: a hold's guards are people in a guard role,
and to them a Thalmor marker is a reason to start a fight, not a rule
that starts one (see
[People who are not people](npcs.md#who-does-not-stay)). The server knows no item
that is a Dominion flag, so a flag is not read yet.

The patrols are staff settings in `game/data/thalmor-patrols.json`
(carried inside gamemode.js by `scripts/dev/Build-StaffData.js`, because the
server runs the gamemode with no `game/data` beside it, #2873; run it after a
change and deploy the gamemode):
whether any patrol is out at all, the most roads with one at once (and,
if staff set one, a different most for a world stage, read at each start
from the world stage the staff confirmed), and
for each road its points (one member each, 2 to 4), the record each
member is made from, how long a dead one takes to come back, and how far
one strays. It ships off, with three candidate roads from the cut
Immersive Patrols II Justiciar placements in the Pale, Haafingar and
Hjaalmarch. A road off Tamriel's ground, with fewer than 2 or more than
4 points, or with a point beside a walled town or village is refused.
At each start the server stands up any member that is missing, at its
own point, and takes down the members of a road staff turned off. If the
world stage cannot be read at a start, nobody is stood up or taken down
that start, and the members already out stay. A world stage in that list
that the war has no stage for (a typo) is named in the server log at
start and never used. A dead
member comes back at its point after the return time; nothing stacks a
second group. A member keeps to its stretch of road, inside its leash;
there is no route between holds. A body cannot be opened, so it gives no
coin. The patrols are part of the cast that stays, beside the traders
and the transport workers on [People who are not people](npcs.md).

The war is what people make of it (Patrick, 17 October, #513). The server holds
the tools and never plays it out by itself. It keeps one stage for the
whole province, and a restart does not reset it. The stages are a list
staff write, each with a name, its words, and who is behind it if they
say so. Today the only stage is peace, so nothing in the world changes.
A stage's id is 1 to 32 lower case letters, digits and dashes, the same
rule the patrol file uses for the stage ids it gives a cap to, so every
stage can have one. A stage whose id breaks it is left out of the list.
No timer moves a stage. Every move is kept on record with when and who,
so a change meant to last is never lost.

The server can also put a notice on a hold's board in the name of an
office, such as the Crown or a Jarl, never a person. It costs nothing,
no gold moves, and the people standing at that board are told once.
Staff move the world from a card on the Office page of K: one of them
proposes a stage, and staff confirm it with a second press or drop it,
and every press goes in the staff log. A stage can carry a notice that
goes up on the boards when the move is confirmed.
The patrols above are #1390's. A stage can set its own most for them
(#2697), read at each start from the stage staff confirmed.
