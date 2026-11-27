# Injury

A wound is on the character, the same way hunger is. It survives a
restart. There is no switch that turns this off for some people.

Going down, a crooked heal, and a loss someone agreed to are all this
system. Death of the character is [Death](death.md). This page is
everything short of that, and the step just before it.

## The track

1. Sound. No open wound.
2. Hurt. One or more wounds.
3. Down. Health would have hit zero. You cannot fight or cast. You can
   talk.
4. Up, still hurt, if someone stabilizes you.
5. The temple, if nobody does and the rules allow the wake. The temple
   cleans and closes your cuts, bites and burns. A break, a crooked heal
   and a disease come with you.

## Down

The clock is 3 real minutes.

If the world did it (a draugr, a fall, a fire with no killer), and
nobody stabilizes you, you wake in the temple with the breaks and
diseases you had.

If another person did it, the 3 minutes are when the question gets
asked, out of character. Death and a loss that rewrites you need a yes.
That rule is [Death](death.md). Silence is the temple, with the breaks
and diseases you already had, and no new loss.

Stabilize with a bandage, a healing spell, or a potion. Health returns
to 25% of its max, not to full. The potion is still the sip in
[Potions](potions.md).

## The wounds

**Cut.** Bleeds 2 health a second until stopped. Torn cloth slows it to
1. A tailor's bandage stops it. A healing spell can close it. Left
open 10 minutes, the chance of wound fever is 40%. A bandage makes
that 10%. A poultice makes it 5%. Torn cloth does not change the
chance. See [Disease](disease.md).

**Break.** An arm: -0.15 melee damage, a block costs twice the stamina,
and crafting that needs both hands is refused. A leg: -8 speed, and
sprint is refused. Sleep does not set it. A splint holds it. A
physicker or a temple sets it. An expert healing spell sets a break
that is already splinted, and the 3 day clock starts. It does not
clear a crooked heal. Looked after, it heals in 3 real days of not
stressing it. Ignored, it heals crooked in 3 days: a lasting -4 speed
or -0.05 melee damage until a master physicker or a temple rite clears
it.

**Burn.** The coals already deal about 7 health a second while you
stand in them. If that fire dealt 30 health or more before you stepped
out, it is a bad burn. Clothing on that part counts at half for warmth
until it heals. See [Temperature](temperature.md). It heals in a day
if it is kept clean, or the wound fever chance is 40%.

**Bite.** A cut, and bite sickness. 25% if the wound is closed inside
10 minutes. 60% if it stays open past that. It is not vampirism and
not lycanthropy.

## Lasting harm

**Ordinary.** The crooked heal. It comes from neglect. Medicine can
undo it. It does not need a separate agreement.

**Agreed.** A hand, an eye, a scar they will be known by. Asked first,
out of character, the same as a death. Once agreed, a potion does not
clear it. A missing hand is the arm break's refusal, permanent. A
missing eye is -20% damage with a bow or a spell. Melee is unchanged.
The scar is a line other people can be told when they look at you. It
is not a hidden stat.

## Who treats what

| Treatment | Who | What it does |
| --- | --- | --- |
| Torn cloth | Anyone | Bleed from 2 a second to 1 |
| Bandage | A tailor's work, used by anyone | Stops a bleed, lowers fever |
| Splint | A woodwright's work at the kiln, used by anyone | Holds a break |
| Healing potion | Anyone who has one | Health. Does not set a bone |
| Poultice | A physicker | Cuts the fever chance |
| Restoration, novice | Whoever has the spell | Stops a bleed |
| Restoration, advanced and up | As the school allows | Closes a cut. Expert helps a break |
| Temple | The place. Priest is not a class | Sets breaks, clears ordinary lasting harm, does not clear an agreed loss |

## Where this is

The wound record is in the server, on the character. It survives a
restart and a death. A cut and a bite bleed 2 a second, or 1 in torn
cloth, through the engine's own damage. At 10 minutes an open cut, an
open bite and an untreated bad burn roll wound fever at 40%, 10%
bandaged, 5% with a poultice. A bite rolls bite sickness at 25% closed
and 60% open. A break costs what this page says. Set, it heals in 3
days. Nobody sets it and it heals crooked in 3 days, a lasting -4
speed or -0.05 melee damage until a master physicker or a temple puts
it right. The fire is
timed from the client's own reports at 7 a second: one that dealt 30
or more is a bad burn, what you wear counts at half for warmth, and it
heals in a day.

What opens a wound, by Patrick's answer on #1383 (4 October). An
unblocked power or sneak attack with a blade or an axe is a cut, and
so is an arrow or a bolt that lands. An unblocked power attack with a
mace or a warhammer is a break, the arm or the leg at even odds. An
unblocked hit from a wolf, a dog, a bear, a sabre cat, a skeever, a
spider, a chaurus, a troll, a horker or a slaughterfish is a bite. A
blow opens a wound only when it took health and left you standing.

What treats a wound today: torn cloth, a bandage, a splint, a poultice
and a physicker's remedy, as Who treats what says; a physicker
setting a bone, and a master physicker clearing a crooked heal; a
healing spell by its own rank (novice stops a bleed, advanced and up
closes a cut, expert sets a splinted break); and a shrine pressed
inside one of the temples the wake uses, which sets breaks and clears
a crooked heal. A remedy closes a cut the way a bandage does,
clears one ordinary disease, wound fever first, and ends a hangover
(see [Drink](drink.md)). A hangover counts as something to tend, so
the H line and Tend their wounds are offered for it too.

Your own wounds are tended from the inventory: while you have one
somebody could tend, a line at the bottom names H, and H opens a panel
of your wounds with a button for each treatment you can give.
Somebody else's are tended from the look prompt: Tend their wounds, on
X, opens the same panel for them, within about 4 metres. Torn cloth and
setting a bone take no item. A bandage, a splint, a poultice or a
remedy comes out of your pack only when it helps a wound.

| Item | Asks for | Bench | Made by |
| --- | --- | --- | --- |
| Bandage | 1 Tundra Cotton | Loom | Tailor, Haberdasher, novice |
| Splint | 1 Firewood, 1 Leather Strips | Kiln | Woodworker, Woodwright, novice |
| Poultice | 1 Tundra Cotton, 1 Garlic | Alchemy lab | Alchemist, Physicker, novice |
| Physicker's Remedy | 1 Mudcrab Chitin, 1 Blue Mountain Flower | Alchemy lab | Alchemist, Physicker, advanced |

The four are records in Thornswood-Content.esp. The recipe table
names who may make each, at the rank above (#1622).
The alchemy lab is the one Thornswood-Content.esp places, which takes
recipes; Skyrim's own lab only brews.

A broken arm and a missing hand refuse the forges, the armour table,
the wheel, the smelter, the tanning rack, the loom and the kiln. That is
asked the same way at a bench's own menu, the kiln's included, and at a
key cut at a forge with the lock key, before anything is taken (#1733). A missing eye is -20% damage with a bow and with
destruction. A scar is a line on the look prompt.

An agreed loss is written onto the character by staff with /hurt,
because the yes is given out of character. Staff can also give a cut,
a bite or a break with it for a scene.

Going down is the server's. Health that would reach nothing leaves a
person down instead (#4607): the engine asks before the death, and the
server keeps them at a sliver of health with nothing of a death sent.
While down, fighting and casting are off on their own machine and they
lie in the bleedout pose; talking is theirs. Somebody else's bandage,
from Tend their wounds, a healing spell landing on them, or a healing
potion they drink stands them up at 25%, or what they have if that is
more. A blow on somebody down does not kill them, and nobody bleeds
while down. After 3 minutes the death goes through, and the wake is
the temple's with the breaks and diseases they had. A potion brewed at a lab does
not stand anybody up yet (#6407).

Not in yet:

- Staff seeing who is down, confirming the outcome, and changing the
  downed minutes from the staff panel (#6409). Until then the clock is
  3 minutes for everybody, and silence is the temple.

A broken arm makes a block cost twice the stamina and a broken leg
refuses sprint, for as long as the break lasts, splinted or not.
Neither one is an actor value. The server charges a blocked hit's
stamina itself (see the warrior's Set), so it doubles that charge for a
broken arm. For a leg it tells the client, and the client shuts the
sprint gate (#1383).
