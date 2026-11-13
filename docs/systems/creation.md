# Creation

A new character is made in the game, not in the launcher.

The game loads to its main menu. An empty slot starts a character. They
arrive in a quiet stone hall and the race menu opens. That menu is the
face, the race, and nothing else about the life they will lead. The ten
peoples and the rieklings are in [Races](races.md).

When the face is done they are dressed in a plain tunic and boots. A
riekling is dressed in the riekling cut of the same tunic and in
footwraps instead, because the tunic and boots are cut for the other peoples and
do not fit a riekling (Patrick, 12 October 2026). The
panel behind K opens on its own. On it:

- **Home.** The town they wake in. This one is required before they leave
  the hall. Confirming it sends them to that town's start spot, not its inn
  (#2622).
- **Class.** Hunter, Fisher, Gatherer, Miner or Farmer. Can be left for
  later and picked in the world from the same panel. Until it is picked,
  every seam, carcass, plant, fishing spot and crop turns them away.
- **Profession and half.** One profession, then one half of it. Can wait
  the same way. Until it is picked, they cannot make anything that is
  somebody's work, smelting and tanning included. See
  [Professions](professions.md).

They are handed 40 gold once, and nothing else, except a tool at the
moment a pick that needs one is made: a pickaxe for a Miner, a
woodcutter's axe for a Woodworker, a shovel and seed for a Farmer, a
crude fishing pole for a Fisher, and for the bench trades (#3162) a
hammer for a Smith, a pair of shears for a Tailor, a wooden ladle for a
Cook, an alembic for an Alchemist and a rune knife for an Enchanter. The
tool has 50 uses.

The towns are Whiterun, Riften, Solitude, Windhelm, Markarth, Falkreath,
Morthal, Dawnstar and Winterhold (`game\data\chargen.json`). The arrival
is that town's start spot (#2622): the stables or the carriage stop at
Whiterun, Solitude, Windhelm and Riften, Understone Keep in Markarth, and
a quiet spot of each of the other four. The inn spot is kept for staff, as
`/tp <town> inn`. A death wakes them at the nearest temple or Hall of the
Dead instead. See [Death](death.md).

Nothing about a character is chosen in the launcher. Skyrim's own
levelling is off, so the face menu does not start a perk tree.

## The first steps

Patrick, 22 October 2026 (#3166): a new character is guided by a short
guide on the K panel and a short errand in the start town, and gets the
basic tool for the profession they pick. The tool is the one above, handed
at the pick. The guide and the errand are one thing.

On arriving, one line in the chat says the first steps are on the panel
behind K. There, **First steps** is the first page while they last, and K
opens on it once. It has five steps, and each one ticks itself when the
server sees it done, in any order:

1. Choose your class and your profession, on the panel.
2. Speak to the Cook at the building they stand in. Look at them and press
   E, as at any guild trader.
3. Find the notice board in the town and press E on it. Its drop box is not
   the board.
4. Do one piece of your own work: a seam, a log, a fish, a crop, a plant, a
   hunt, or something made at a bench.
5. Go back to the Cook.

The Cook is the start town's guild Cook, from the trader list
(`game\data\merchant-traders.json`, [Merchant trader counts](merchant-traders.md)):

| Town | The Cook stands in |
| --- | --- |
| Whiterun | The Bannered Mare |
| Riften | Marise Aravel's House |
| Solitude | The Winking Skeever |
| Windhelm | Candlehearth Hall |
| Markarth | Understone Keep |
| Falkreath | Dead Man's Drink |
| Morthal | Moorside Inn |
| Dawnstar | Northern Star Goods |
| Winterhold | The Frozen Hearth |

The first time, the Cook gives the errand: find the notice board, do a piece
of your own work, and come back. Before both are done the Cook says which
are left. After them the errand is finished, and the Cook names where the
guild's trader of your own profession stands in that hold, for a Smith,
Woodworker, Tailor, Enchanter, Cook or Alchemist. Nothing is handed over:
the 40 gold and the tool are the whole start. The page goes when the errand
is finished, and **Put this away** on it takes it off at any time.

Only a character who arrives from the hall has first steps. A character
made before them is shown nothing.

## Changing character in the game

Change character, at the foot of the K panel, goes back to the same
choice without closing the game (#3128). Patrick settled it on 22 October
2026: any time out of combat, after ten seconds in place. A line a second
counts down; moving, a fight, getting hurt or dying stops it, and so does
pressing it again. At the end the world closes as it does when somebody
quits, the game goes to its main menu and the slots come back with the
character just left lit. A slot plays that character, an empty one makes a
new one in the hall, and the bin forgets one, as at the start of a game.
The button is not there while a character is being made.

A pick there moves the chat, voice and the join pass to the character
picked, and the launcher writes the list again after each pick and each
forget, checks in the id New character uses next, and counts the time
played against each character in turn.

## Where this is

The hall, the face, the K panel, the town, the waiting class and
profession, the 40 gold, the first steps and the nine tools are in the server: the
pickaxe, the woodcutter's axe, the shovel, the crude fishing pole
a new fisher is handed, without which the water turns them away, and
the bench trades' hammer, pair of shears, wooden ladle, alembic and rune
knife, without which their bench turns them away. The farmer's seed is
handed with the shovel. The public
steps are on the site's help page.

The first steps are kept on the character (`thornswoodFirstSteps`), so a
relog, a reload and a restart find them where they were. The Cook is
answered from the E press the game already sends for anybody under the
crosshair, within 400 of the Cook in the same cell, whether or not trading
is open; the board from the board's own press; the work from the count every
piece of work goes through. `game\tests\test-3166-first-steps.js` walks a new
character through all of it on the whole gamemode.

Somebody still choosing who puts the panel down gets it back on its
own: ten minutes after Escape or K, and within thirty seconds when it
went any other way. It comes back whether or not anything on it has
changed.
