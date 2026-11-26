# Death

The world can kill you. Another person cannot end your character
unless everyone in the scene said yes, out of character, in plain
words, before it happens.

Going down, and getting back up still hurt, is [Injury](injury.md).
This page is the character ending, and the wake when it does not.

## The temple

If nobody agreed, you wake in a temple. That happened. Move on.

The wake is the nearest consecrated door, a temple or a Hall of the
Dead, chosen one door at a time rather than one city at a time.

A worldspace with coordinates of its own (Solstheim, Blackreach, the
Soul Cairn, Sovngarde, Apocrypha, the Forgotten Vale, the arena's
floors) is never measured against the mainland's map. A death there
wakes in the nearest Hall of the Dead, temple or inn in that same
worldspace (Patrick, 5 Oct, #1909). On Solstheim that is the temple
or the Retching Netch in Raven Rock, whichever door is nearer. No
other worldspace of its own has any of the three, so a death in one
wakes where a death in the hold of the door you came in by would
(Patrick, 5 Oct): Blackreach come into from the Reach wakes at
Markarth's temple, the Pit under Windhelm at Windhelm's. The server
writes that door on your character when you press it, so a relog keeps
it. Only somebody with no door into that worldspace written down wakes
in the Temple of Kynareth in Whiterun, the fallback, and the death log
says why (`own-world-no-door`, or `own-world-no-hold` when no hold was
known behind the door).

The wounds you already had come with you. A disease you already had
comes with you. The temple stopped the death. It did not wash a cut,
set a break, or cure a fever. See [Injury](injury.md) and
[Disease](disease.md).

The same towns you can choose at creation are the towns a wake can
land in. See [Creation](creation.md).

## While you are down

The downed clock is 3 real minutes, on the injury page.

If the world did it, and nobody stabilizes you, the wake is the
temple.

If another person did it, those 3 minutes are when the question is
asked. Silence is the temple, with the wounds you already had, and no
new loss.

## What needs a yes

Before it happens, out of character:

- Death of the character. This is the one that matters.
- Permanent harm. An eye, a hand, a scar they did not choose. A break
  that heals crooked is not this. A crooked heal is on the injury
  page, and it does not need a second agreement.
- Vampirism and lycanthropy. They rewrite a character for good, so
  they sit here and not on the disease list.
- Being cleaned out. Take something. Take a good thing. Emptying a
  house, or a pack, past that needs the yes. The property rule is the
  same one the site already states.
- Being held for hours. A scene with cuffs is a scene. An evening of
  it is not, without the yes.

A demand is not an outcome. Being offered a choice takes nothing by
itself.

There is no switch that turns any of this off for some people and on
for others.

## Staff

Staff can end a character for serious rule breaking, or in an event
its owner agreed to. That character is not used again. A new character
is allowed. Nobody else is told.

## What a kill is worth

A person killing a person counts for nothing. It does not move a
Warrior up a rank. Paying for that kill would be a bounty on the
people this server is for.

A Warrior moves by killing what is not a person, when the killer is a
person and is not themselves. A fall or a fire, where the killer is
yourself, is not a fight. No other profession is credited for a kill.
Killing is not a way to become a tailor.

An animal a hunter can work lies for 5 minutes, so the carcass can be
worked. A bandit, a guard, a draugr and a dragon stand back up after
25 seconds, which is the engine's own delay. No hunter has a verb for
them, and a wake is not written onto them. A temple spawn is for a
person.

## Where this is

The wake is in the server. At the moment of death it writes the
nearest temple. A death in any worldspace of the load order counts as
out of doors for that, the Soul Cairn and the Forgotten Vale too: the
list is read out of the plugins (#1896). Which worldspaces have
coordinates of their own, and the Halls of the Dead, temples and inns
in each, are read out of the plugins too, by
`scripts\dev\Build-WakeTable.js` into `DATA.ownWorlds` (#1909); a
worldspace is in the mainland's coordinates when its doors land within
one cell of the doors they lead to there. The sky over a worldspace of
its own is still measured against the mainland's holds (`climateOf`,
#1909). The public
rules on the site are the yes and the no above, and this page does not
replace that page.

The wounds and the diseases you had come through the wake with you,
on the record the injury page describes. The bleed stops at the death.
Going down is in the server, on the injury page. A person
killing a person already counts for nothing toward a rank. An animal
in the hunt table already lies for 5 minutes.
