# Skill tree

The tree is the body and the magicka. It is not the profession. Everybody
has the same fifteen sub-skills. A profession decides what you can make.
The tree decides what a point in the body is worth.

Five points fill a sub-skill. Filling it grants its perk. Points past
five in one sub-skill are refused.

## What one point is worth

| Sub-skill | One point | Filled, the perk |
| --- | --- | --- |
| Vitality | +10 health | Cheat Death. Once a day, the blow that would kill you leaves you at 1 health |
| Fortitude | +10% health recovery | Troll's Blood. During a fight, health returns at 2 a second |
| Might | +0.05 melee damage | Devastating Blow. A power attack deals 25% more |
| Resilience | +10 armour | Unshakeable. Nothing staggers you while you block |
| Toughness | +10 poison resistance and +10 disease resistance | Purified Blood. Disease does not take. Poison deals 25% |
| Capacity | +10 magicka | Archmage's Vessel. Drop below a tenth of magicka and it returns to half, once a day |
| Clarity | +10% magicka recovery | Leyline Attunement. Magicka still returns while you cast, at half the usual rate |
| Potency | +5 spell power, in the schools you hold | Overcharge. One spell in five deals double, or holds twice as long |
| Ward | +5 magic resistance | Spellbreaker. 20% of the magicka in a spell that hits you is added to yours |
| Efficiency | -3 spell cost, in the schools you hold | Font of Magic. Once a day, 15 seconds where a spell costs nothing |
| Endurance | +10 stamina | Tireless. A sprint, a power attack and a shield bash cost half stamina |
| Vigor | +10% stamina recovery | Second Wind. When stamina hits 0 it fills, once every 5 minutes |
| Agility | +2 speed | Windwalker. +4 speed, and a fall deals no damage |
| Burden | +15 carry weight | Pack Mule. Being overloaded does not slow you |
| Precision | +2 critical chance | Lethal Aim. An arrow ignores half the armour it hits |

Might is a fraction added to a multiplier whose base is 1. Five points is
a quarter more melee damage, not five times. Potency and Efficiency do
nothing for someone who holds no school. They spread across the schools
that character has, under that school's own power and skill, because the
game has no single "spell damage" value.

Might is also strength (#2262, Patrick, 16 Oct 2026). A weapon weighing
30 to 44 needs Might 3, and one weighing 45 or more, the Giant's Club
among them, needs Might 5. Every other weapon needs none. It goes by the
weapon's own weight, not a list of records. Equipping one without the
Might is refused by the server before it is saved: the weapon stays in your
pack and you are told "You are not strong enough to wield this." and
"Needs Might N". The K panel's Might row shows both thresholds.

Critical chance is promised by Precision. The point is recorded and put
on your character, and the game ignores it. The server works out what
every blow deals, and there is no critical hit in that sum. Spending a
point in Precision says so, and so does the K panel. No hit is ever called
a critical one.

## Where the points come from

Choosing places points. They cannot be moved.

| Pick | Points placed |
| --- | --- |
| Hunter | Precision 1 |
| Fisher | Vigor 1 |
| Gatherer | Burden 1 |
| Miner | Might 1 |
| Farmer | Endurance 1 |
| Warrior | Vitality 1, Might 1 |
| Mage | Capacity 1, Clarity 1 |
| Alchemist | Toughness 1, Clarity 1 |
| Cook | Fortitude 1, Endurance 1 |
| Smith | Might 1, Burden 1 |
| Enchanter | Capacity 1, Ward 1 |
| Tailor | Agility 1, Efficiency 1 |
| Woodworker | Endurance 1, Burden 1 |
| Bulwark | Resilience 1 |
| Berserker | Might 1 |
| Blightbrewer | Potency 1 |
| Physicker | Clarity 1 |
| Hearthcook | Vitality 1 |
| Confectioner | Fortitude 1 |
| Platewright | Resilience 1 |
| Edgewright | Precision 1 |
| Bladebinder | Potency 1 |
| Wardweaver | Ward 1 |
| Liverywright | Efficiency 1 |
| Haberdasher | Agility 1 |
| Charburner | Toughness 1 |
| Woodwright | Precision 1 |
| Each mage school | 1 in that school's placed sub-skill: Destruction potency, Restoration clarity, Alteration ward, Conjuration capacity, Illusion efficiency |

A class places 1, a profession 2, a half 1. A mage also places 1 per
school they took. Nobody starts with more than a handful, and no
sub-skill starts near the cap of 5.

Every rank after that gives 1 free point. It goes in any sub-skill that
is not full. Rank comes from work, not from gold and not from being here
a long time. See [Professions](professions.md) for how a rank is earned.

## Where this is

The fifteen sub-skills, the cap of 5, the per-point numbers, the placed
points and the free point per rank are in the server and on the K panel.

A perk is ticked here when it fires. Each time the server fires one, it
writes `perks: <name> fired` to its log, so a tester can see it happen. Troll's Blood and Leyline Attunement write one line a fight
and one a cast, not one a second.

Four happen on your own machine, because the game works them out there
and the server cannot reach them: Unshakeable, Tireless, Windwalker's fall
and Pack Mule. The front plugin does them, from the list of perks the K
panel's view carries, and writes them in `thornswood-front.log`:
`unshakeable: refused a stagger while blocking` for each stagger refused,
`unshakeable: a stagger played with the block down` for each one let
through, a `perks:` line naming each game setting it changes, and
`perks: Pack Mule held` or `not held` when Pack Mule comes or goes. Tireless
and the fall are the game's own sums, from game settings read out of
Skyrim.esm that nothing in the load order changes:

| Perk | Game setting | The game's own | Held at |
| --- | --- | --- | --- |
| Windwalker, the fall | `fJumpFallHeightMult` | 0.1 | 0, so a fall comes to nothing |
| Tireless, a sprint | `fSprintStaminaDrainMult` | 7 | half |
| Tireless, a power attack | `fStaminaAttackWeaponBase` and `fStaminaAttackWeaponMult` | 20 and 1 | half of each |
| Tireless, a shield bash | `fStaminaBashBase` and `fStaminaPowerBashBase` | 35 and 55 | half of each |

The fall's settings are your own character's: everybody else's are the same
names ending in NPC, so nobody else's fall changes. Tireless's have no
second set, so an NPC your machine runs pays half for a sprint, a power
attack and a bash too, which Patrick kept (12 Oct). Running costs nothing
in this game and neither does a plain swing; a sprint, a power attack and
a shield bash are what cost stamina. A bash counts as a swing for Tireless
(Patrick, 12 Oct: one rule for every attack).

Nothing here is a command. Font of Magic, the one perk a person starts,
is the Use button beside it on the K panel. The K panel also says, beside
Archmage's Vessel, Font of Magic and Second Wind, whether each is ready or
how long until it is back.

A day, for the three once-a-day perks, is 24 real hours from when it
fired. The clock is kept on the character and written before the perk
fires, so a restart or a relog cannot fire it twice.

Font of Magic's 15 seconds are kept in memory, so a restart ends them
and the day stays spent. When you come back into the world the server
sends your K panel as it stands at that moment, so the free spells are
not left on you (issue #1642).

| Perk | Fires | What is not in the game yet |
| --- | --- | --- |
| Cheat Death | Yes. The engine asks the server before a blow that takes your health to nothing kills you, before anything is sent, and the server keeps you at 1 health of the most your bar shows (issue #1626). Health from gear or a potion the server cannot see is not counted in that most, so with one running you are left a little over 1 | |
| Troll's Blood | Yes. A fight is a hit landed or taken, or health falling, in the last 15 seconds | |
| Devastating Blow | Yes. With a warrior's Heavy on the same blow, each adds its share to what the blow took before it | |
| Unshakeable | Yes, on your own machine. A stagger is played there, so the front plugin refuses it while your block is up, by the game's own IsBlocking. The server refuses its own Break and Wreck on you the same way | |
| Purified Blood | Yes. The tree's disease resistance comes to 100 and its poison resistance to 75. What your race resists comes on top, as far as the game allows | |
| Archmage's Vessel | Yes | |
| Leyline Attunement | Yes. The server sees a cast as magicka falling. The usual rate is your race's own, raised by your Clarity | |
| Overcharge | Yes, both halves, each counted on its own. Every fifth spell of yours that takes health takes double, counted on the server. Every fifth spell of yours that holds (one you cast and let go, with an effect that lasts a time and none that takes health, like Oakflesh, Candlelight or Fear) holds twice as long. Its effects run on the machine of whoever they land on, so the engine fork counts the cast on your own machine and the server, counting the same casts, tells everybody else's machine to hold it twice as long too | |
| Spellbreaker | Yes. A spell you hold up, like Flames, counts once a second | |
| Font of Magic | Yes, from the Use button on the K panel. For 15 seconds each school's cost is taken off in full, the way the game's own Fortify enchantments take it off, so the game takes no magicka at all | |
| Tireless | Yes, on your own machine: a sprint, a power attack and a shield bash cost half | |
| Second Wind | Yes | |
| Windwalker | Yes. The speed from the server, the fall on your own machine | |
| Pack Mule | Yes, on your own machine. Being overloaded makes the game walk you there, and no game setting changes that, so the engine fork's client keeps a list of characters the game does not hold to their carry weight, and the front plugin puts yours on it while Pack Mule is held. You run and sprint whatever you carry, and everybody else sees you run. The inventory still shows your real carry weight | |
| Lethal Aim | Yes. An arrow or a bolt is worked out again against half the armour, by the same sum the server uses for every blow | |
