"""
Build-Recost.py

Writes game/data/recost.json: the smith recipes that ask far more or far less
than the other recipes for the same kind of piece, at the same rank, in the
same metal, and what each one asks for instead. scripts/mods/Build-LastPlugin.py
reads it and carries each one, as the winning record with only its input
counts changed, in Thornswood-Last.esp.

WHY (issue #613)

The forge report of 25 September: "Several items are too cheap or too
expensive". An item has no gold price here (docs/systems/professions.md: what
it sells for is the price a person posts), so a recipe is too cheap or too
dear only next to the recipes for the same thing. Patrick, 21 October 2026, on
the report page (q-613-recost-basis), A: measure a forge recipe against the
same kind of piece at the same rank and metal; a steel cuirass should cost
about what other steel cuirasses cost. Gold worth is read nowhere here.

Measured 21 October from game/data/recipes.json: 1,146 smith recipes at the
forge and the Skyforge, 1,112 of them a piece the game tempers and made from
materials, 882 of those with at least two peers. Sixteen Riekling leather
body armours asked 2 Leather Strips where leather body armour asks 5, and
Thieves Guild Gloves 7 where leather gauntlets ask 3. 39 rows are outside
half to twice what their peers ask.
The recipes are the mods' own; nothing in Thornswood set them.

THE RULE, every number of it a knob below

  A row is a smith's (owner Smith) at the forge or the Skyforge and is asked
  of the server (fires).

  Its kind is its family in recipes.json (Body armour, Helmets, Swords: read
  off the output's own keywords), its rank is the rank in recipes.json, and
  its metal is what the game tempers the piece with: the inputs of the
  recipe at the sharpening wheel or the armour table that makes the same
  item. A steel cuirass is tempered with a Steel Ingot. A piece nothing
  tempers has no metal and is left alone.

  Rows of the same kind, rank and metal are peers. Its cost is how many
  materials it asks for, every input counted but gold coins (Gold001): 21
  forge recipes of Immersive Weapons and the Hothtrooper compilation ask up
  to 50 coins as well as their materials, and coins are money, not a
  material. Patrick, 21 October, q-3115-forge-coins, B: a forge recipe that
  charges coins costs only its materials, so every forge recipe that asks
  coins, whoever's work it is (bows and an eyepatch are at the forge too),
  has them taken out: its row in the table takes them to 0, and
  Build-LastPlugin.py leaves that input out of the record. A
  recipe that takes a finished piece (an Old Captain Helmet into an Old
  Helmet, a Nord Hero blade into another) is a conversion, not a piece made
  from materials, and is left alone: 18 rows. A group of fewer than PEERS rows
  is too small to say what is usual, and is left alone.

  A row asking under half the group's median, or over twice it, is re-costed:
  every material count is multiplied by the one factor that brings its cost
  to the median, then rounded, and never under one. Only the counts change: the
  same inputs, in the same order, the same output and bench. A row whose
  counts come out the same after rounding is listed under unreachable, with
  why, and gets no override.

  A recipe of a plugin Thornswood-Last.esp never copies a record of
  (last-plugin-policy.json notCopiedFrom: Immersive Armors, the Hothtrooper
  compilation, Patrick 17 Oct, #2454, used as-is and nothing built from it
  handed on) is listed under notCopied with whyNot and gets no override,
  coins or not, because an override is a copy of its record; it still
  counts as a peer, because the game still asks it. Measured 22 October:
  17 of them, 10 of those charging coins. One the policy carries by
  'COBJ <id>' is re-costed like any other.

  THOSE ARE CHANGED IN EACH PERSON'S GAME INSTEAD (Patrick, 22 October,
  report page q-613-ia-recipes, C). The RECIPES_SET_IN_GAME table this
  writes, game/gamemode-tables/RECIPES_SET_IN_GAME.json, which the gamemode
  reads when it loads (#5191), holds each one's output, bench and inputs
  with the counts it had and the counts it asks now. The gamemode hands
  the new counts to every person, whose game sets them on its own copy of
  the record (ConstructibleObject.SetNthIngredientQuantity, coins to 0),
  and accepts a craft of that output at that bench with exactly the new
  counts. No record of the plugin is copied anywhere.

WHY IT IS STABLE

  Once Thornswood-Last.esp carries the new counts, a recipes.json built from
  that load order reads them, and those rows would read as usual. So a row
  already in recost.json keeps the ORIGINAL inputs it was first measured
  with, for its own cost and for its group's median, every run. A row that
  leaves the load order leaves the file. A row that newly falls outside the
  band joins it.

Usage:
    python scripts/dev/Build-Recost.py           writes game/data/recost.json and the block
    python scripts/dev/Build-Recost.py --check   exit 1 when either is not what the rule gives
"""

import argparse
import collections
import io
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import gamemode_tables  # noqa: E402
RECIPES = os.path.join(ROOT, 'game', 'data', 'recipes.json')
OUT = os.path.join(ROOT, 'game', 'data', 'recost.json')
POLICY = os.path.join(ROOT, 'game', 'data', 'last-plugin-policy.json')

OWNER = 'Smith'
BENCHES = ('CraftingSmithingForge', 'CraftingSmithingSkyforge')
TEMPER = ('CraftingSmithingSharpeningWheel', 'CraftingSmithingArmorTable')
PIECES = ('ARMO', 'WEAP')  # an input that is itself a finished piece makes the row a conversion
COIN = 'f:Skyrim.esm'  # Gold001: money, not a material (#3115)
PEERS = 3    # fewer rows than this of one kind, rank and metal say nothing about what is usual
LOW = 0.5    # under half the group's median
HIGH = 2.0   # over twice it


def metals(recipes):
    """The item each tempering recipe improves, to what it is tempered with."""
    out = {}
    for section in ('recipes', 'unowned', 'refused'):
        for desc in sorted(recipes.get(section, {})):
            row = recipes[section][desc]
            if row.get('benchName') in TEMPER and row.get('out') and row.get('inputItems'):
                out.setdefault(row['out'], sorted(i['name'] for i in row['inputItems']))
    return out


def put_at(row):
    """The bench the recipe's mod put it at. A row recipes.json moved to its
    trade's bench (movedFromName, #3120) is measured, and its coins taken out,
    where its mod put it, so a move changes no count; RECIPES_SET_IN_GAME
    still names the bench it is made at now."""
    return row.get('movedFromName') or row.get('benchName')


def candidates(recipes, metal, kept):
    """(desc, row, inputs, group) for every row the rule may ask, with the
    original inputs: the ones recost.json first measured, or the record's own."""
    out = []
    for desc in sorted(recipes['recipes']):
        row = recipes['recipes'][desc]
        if row.get('owner') != OWNER or put_at(row) not in BENCHES or row.get('fires') is False:
            continue
        if not metal.get(row.get('out')):
            continue
        source = kept[desc]['inputs'] if desc in kept else row.get('inputItems', [])
        inputs = [{'item': i['item'], 'name': i['name'], 'count': i['count']} for i in source]
        if not inputs or any(i.get('type') in PIECES for i in row.get('inputItems', [])):
            continue
        group = (row.get('family', ''), row.get('rank', ''), ' + '.join(metal[row['out']]))
        out.append((desc, row, inputs, group))
    return out


def cost(inputs):
    return sum(i['count'] for i in inputs if i['item'] != COIN)


def entry_for(desc, row, inputs, to):
    return {
        'recipe': desc,
        'editorId': row.get('editorId', ''),
        'name': row.get('name', ''),
        'plugin': row.get('plugin', desc.split(':', 1)[1]),
        'kind': row.get('family', ''), 'rank': row.get('rank', ''),
        'costWas': cost(inputs),
        'inputs': [dict(i, to=t) for i, t in zip(inputs, to)],
        'costNow': sum(t for i, t in zip(inputs, to) if i['item'] != COIN),
    }


def never_copied(policy):
    """The plugins game/data/last-plugin-policy.json says Thornswood-Last.esp
    never copies a record of (notCopiedFrom), and the records it carries from
    them anyway, both lower case."""
    rows = (policy or {}).get('notCopiedFrom', [])
    return ({r['plugin'].lower() for r in rows},
            {c.lower() for r in rows for c in r.get('carried', [])})


def build(recipes, previous, policy=None):
    metal = metals(recipes)
    kept = {r['recipe']: r for r in (previous or {}).get('recipes', [])}
    for section in ('unreachable', 'notCopied'):
        kept.update({r['recipe']: r for r in (previous or {}).get(section, [])})
    rows = candidates(recipes, metal, kept)
    groups = collections.defaultdict(list)
    for desc, row, inputs, group in rows:
        groups[group].append(cost(inputs))
    usual = {g: statistics.median(c) for g, c in groups.items() if len(c) >= PEERS}
    recost, unreachable, done = [], [], set()
    for desc, row, inputs, group in rows:
        if group not in usual:
            continue
        median, was = usual[group], cost(inputs)
        if LOW * median <= was <= HIGH * median:
            continue
        factor = median / was
        to = [0 if i['item'] == COIN else max(1, int(round(i['count'] * factor))) for i in inputs]
        entry = entry_for(desc, row, inputs, to)
        entry.update({'metal': group[2], 'peers': len(groups[group]), 'usual': median})
        entry['why'] = ['peers'] + (['coins'] if COIN in [i['item'] for i in inputs] else [])
        if [t for i, t in zip(inputs, to) if i['item'] != COIN] == [i['count'] for i in inputs if i['item'] != COIN] \
                and 'coins' not in entry['why']:
            entry['why'] = ('every input is already at one, the least a recipe can ask, so no count '
                            'brings it nearer what its peers ask')
            unreachable.append(entry)
        else:
            recost.append(entry)
        done.add(desc)
    # Every other forge recipe that charges coins, whoever's work it is
    # (Patrick, q-3115 B): the coins come out and the materials stay.
    for desc in sorted(recipes['recipes']):
        row = recipes['recipes'][desc]
        if desc in done or put_at(row) not in BENCHES:
            continue
        source = kept[desc]['inputs'] if desc in kept else row.get('inputItems', [])
        inputs = [{'item': i['item'], 'name': i['name'], 'count': i['count']} for i in source]
        if COIN not in [i['item'] for i in inputs]:
            continue
        entry = entry_for(desc, row, inputs, [0 if i['item'] == COIN else i['count'] for i in inputs])
        entry['why'] = ['coins']
        recost.append(entry)
    recost.sort(key=lambda r: r['recipe'])
    # A recipe of a plugin Thornswood-Last.esp never copies from stays as
    # its mod has it: an override is a copy of its record (Patrick, 17 Oct
    # 2026, #2454: Immersive Armors is used as-is and nothing built from it
    # is handed on). It is still a peer, because the game still asks it.
    blocked, carried = never_copied(policy)
    held = [r for r in recost if r['recipe'].split(':', 1)[1].lower() in blocked
            and ('COBJ ' + r['recipe']).lower() not in carried]
    for r in held:
        r['whyNot'] = ('%s is a plugin last-plugin-policy.json never copies from (notCopiedFrom), so its '
                       'recipe is not overridden' % r['recipe'].split(':', 1)[1])
    recost = [r for r in recost if r not in held]
    coins = sum(1 for r in recost if 'coins' in r['why'])
    return {
        'version': 2,
        'builtBy': 'scripts/dev/Build-Recost.py',
        'issue': 613,
        'decision': 'Patrick, 21 October 2026, report page q-613-recost-basis, A: measure a forge recipe against '
                    'the same kind of piece at the same rank and metal; a steel cuirass should cost about what '
                    'other steel cuirasses cost. No gold worth. And q-3115-forge-coins, B: a forge recipe that '
                    'charges gold coins costs only its materials. A recipe of a plugin the last plugin never copies from '
                    '(Immersive Armors, #2454) is listed under notCopied and left as its mod has it.',
        'readFrom': 'game/data/recipes.json: the smith rows at the forge and the Skyforge that the server is asked '
                    'about, their family and rank, and the inputs of the tempering recipe for the same item',
        'rule': {
            'owner': OWNER, 'benches': list(BENCHES), 'temper': list(TEMPER),
            'peers': PEERS, 'low': LOW, 'high': HIGH, 'notMaterial': [COIN],
            'how': 'peers are the rows of the same family, rank and tempering material; cost is how many materials '
                   'a row asks, every input counted but gold coins. A row under low or over high times its peers\' median cost has '
                   'every material count multiplied by the one factor that brings it to the median, rounded, never '
                   'under one. Every forge recipe that charges gold coins has them taken out (to 0). A row already '
                   'listed keeps the original inputs it was first measured with.',
        },
        'counts': {'measured': len(rows), 'inGroups': sum(len(groups[g]) for g in usual),
                   'groups': len(usual), 'recosted': len(recost), 'coinsTakenOut': coins,
                   'unreachable': len(unreachable), 'notCopied': len(held)},
        'recipes': recost,
        'unreachable': unreachable,
        'notCopied': held,
    }


def dump(data):
    return json.dumps(data, indent=1, ensure_ascii=False) + '\n'


def in_game_table(data, recipes):
    """The RECIPES_SET_IN_GAME table as JSON text: every notCopied row, by
    recipe, with its output, its bench keyword and its inputs as [item, had,
    asks]. What it means is written over its table() line in the gamemode."""
    rows = {}
    for r in data['notCopied']:
        row = recipes['recipes'][r['recipe']]
        rows[r['recipe']] = {'name': r['name'], 'out': row['out'], 'bench': row['bench'],
                             'inputs': [[i['item'], i['count'], i['to']] for i in r['inputs']]}
    return json.dumps(rows, sort_keys=True, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    recipes = json.load(io.open(RECIPES, encoding='utf-8'))
    previous = json.load(io.open(OUT, encoding='utf-8')) if os.path.isfile(OUT) else None
    data = build(recipes, previous, json.load(io.open(POLICY, encoding='utf-8')))
    text = dump(data)
    table = in_game_table(data, recipes)
    table_file = gamemode_tables.table_file('RECIPES_SET_IN_GAME')
    have_table = io.open(table_file, encoding='utf-8', newline='').read() if os.path.isfile(table_file) else ''
    c = data['counts']
    print('%d smith recipes measured, %d in %d groups of %d or more peers; %d re-costed (%d with gold coins taken out), '
          '%d no count can fix, %d left as a never-copied plugin has them'
          % (c['measured'], c['inGroups'], c['groups'], PEERS, c['recosted'], c['coinsTakenOut'],
             c['unreachable'], c['notCopied']))
    if args.check:
        have = io.open(OUT, encoding='utf-8').read() if os.path.isfile(OUT) else ''
        if have != text or have_table != gamemode_tables.layout(table):
            print('recost.json or the RECIPES_SET_IN_GAME table is not what the rule gives: '
                  'run scripts/dev/Build-Recost.py')
            return 1
        print('recost.json and the RECIPES_SET_IN_GAME table are what the rule gives')
        return 0
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    gamemode_tables.write('RECIPES_SET_IN_GAME', table)
    print('wrote ' + os.path.relpath(OUT, ROOT) + ' and ' + os.path.relpath(table_file, ROOT) + ', %d recipe(s)'
          % len(data['notCopied']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
