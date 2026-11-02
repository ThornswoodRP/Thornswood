"""Catalogue the winning cast and ecological population policy, without game writes.

Uses the same record, string and template reader as Build-CastTable.py.
The optional installed settings input is used only for its loadOrder paths.
"""
import argparse
import collections
import copy
import csv
import hashlib
import importlib.util
import json
import math
import os
import pathlib
import re
import struct
from MerchantRoster import apply_roster, BOOK_HOLDS, ROLES
import gamemode_source
import own_plugins

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('npc_cast', HERE / 'Build-CastTable.py')
cast_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cast_module)
C = cast_module

LAST_PLUGIN = 'Thornswood-Last.esp'
CITY_WORLDS = {'WhiterunWorld', 'RiftenWorld', 'SolitudeWorld', 'WindhelmWorld', 'MarkarthWorld'}
DOMESTIC = {'chicken', 'cow', 'goat', 'dog', 'horse'}
CITY_ANIMALS = {'chicken', 'dog', 'goat'}
PREDATORS = {'wolf', 'bear', 'sabre-cat'}
ENEMY_FACTIONS = re.compile(r'bandit|forsworn|warlock|necromancer|vampire|draugr|skeleton|'
                            r'falmer|hagraven|werewolf|dwarven|dragon|giant|riekling|'
                            r'hostile|daedra|thalmor', re.I)
# The game's test worldspaces and interiors, and the interiors it keeps actors
# in until a script moves them (CWTestHold, WerewolfPreload, DLC2HoldingCellBard;
# #2067). Only worldspaces and interiors: Tamriel, Blackreach, the Soul Cairn and
# Solstheim have real exterior cells named Test..., and a bank is a Holdings.
TEST_WORLDS = re.compile(r'test', re.I)
TEST_INTERIORS = re.compile(r'test|preload|holdingcell', re.I)
HABITATS = [('sewer', 'LocTypeSewer'), ('bandit-camp', 'LocTypeBanditCamp'),
            ('giant-camp', 'LocTypeGiantCamp'), ('farm', 'LocTypeFarm'),
            ('cave', 'LocTypeCave'), ('dungeon', 'LocTypeDungeon'),
            ('city', 'LocTypeCity'), ('city', 'LocTypeTown')]
TIERS = {1: {'cap': 8, 'returnMinutes': 30}, 2: {'cap': 12, 'returnMinutes': 45},
         3: {'cap': 16, 'returnMinutes': 60}, 4: {'cap': 20, 'returnMinutes': 90}}
# A name is not evidence of the Unique flag. Named quest bosses and pets often
# omit it. Keep species and encounter titles, never personal names or aliases.
GENERIC_NAMES = set('''Albino Spider|Ash Hopper|Ash Spawn|Bandit|Bandit Chief|Bandit Outlaw|
Bear|Betty Netch|Blackblood Marauder|Blood Horker|Bloodstarved Fledgling|Boneman|
Bristleback|Bull Netch|Burnt Spriggan|Cave Bear|Cave Troll|Chaurus|Chaurus Hunter Fledgling|
Chaurus Reaper|Chicken|Corrupted Shade|Corsair|Cow|Cultist|Dark Brotherhood Assassin|
Death Hound|Deer|Dog|Dragon|Dragon Cultist|Dragon Priest|Draugr|Draugr Overlord|
Draugr Thrall|Draugr Wight|Dwarven Centurion|Dwarven Centurion Master|Dwarven Sphere|
Dwarven Sphere Guardian|Dwarven Spider|Dwarven Spider Worker|Elk|Falmer|Falmer Skulker|
Falmer Warmonger|Feral Vampire|Flame Atronach|Flame Cloaked Spider|Forsworn|
Forsworn Briarheart|Forsworn Shaman|Fox|Frost Cloaked Spider|Frost Giant|Frost Troll|
Frostbite Spider|Gargoyle|Ghost|Giant|Giant Frostbite Spider|Goat|Hagraven|Horker|
Horse|Husky|Ice Wolf|Ice Wraith|Jumping Flame Spider|Jumping Frost Spider|
Jumping Poisonous Spider|Jumping Shock Spider|Kamal Snow Demon|Keeper|Lurker|Mammoth|
Master Vampire|Mistman|Mounted Riekling|Mudcrab|Netch Calf|Orc Hunter|Pirate|
Pirate Captain|Pirate Mage|Pit Wolf|Poacher|Poisonous Cloaked Spider|Rabbit|Reaver|
Reaver Lord|Reaver Outlaw|Reaver Plunderer|Restless Draugr|Riekling|Riekling Hunter|
Riekling Rider|Sabre Cat|Seeker|Shock Cloaked Spider|Skeever|Skeleton|Slaughterfish|
Smuggler|Snow Bear|Snow Fox|Snowy Sabre Cat|Soul|Spectral Warhound|Spellsword|
Spriggan|Spriggan Earth Mother|Spriggan Matron|Storm Thrall|Stray Dog|Thief|Troll|Vaermina Devotee|Vale Deer|Vale Sabre Cat|
Vampire Fledgling|Vampire's Thrall|Volkihar Countess|Volkihar Exile|Werewolf|
Whispering Spirit|Wisp|Wispmother|Witch|Wolf|Wrathman'''.replace('\n', '').split('|'))


def generic_name(context, base):
    name = context.name_of(base)
    if name in GENERIC_NAMES:
        return True
    if re.fullmatch(r'(Novice|Apprentice|Adept|Expert|Master) (Conjurer|Necromancer|Fire Mage|Ice Mage|Storm Mage)', name):
        return True
    record = context.npc.get(context.through(base, C.USE_BASE_DATA), {})
    # Unnamed source encounters use their editor ID instead of a display name.
    return name == record.get('edid') and bool(re.match(r'Enc|LChar|Bandit|Chicken|Cow|Giant', name))


def location_chain(context, location):
    seen = set()
    while location and location not in seen and location in context.loc:
        seen.add(location)
        row = context.loc[location]
        yield location, row
        location = row.get('parent')


def habitat_at(context, actor):
    cell = context.cells.get(actor.get('cell'), {})
    cell_name = (cell.get('edid', '') + ' ' + cell.get('name', '')).lower()
    # An underground interior can point straight to the city's parent location.
    # Its authored identity must win over that surface ancestor.
    if cell.get('interior'):
        inferred = 'sewer' if 'sewer' in cell_name or 'ratway' in cell_name else (
            ('cave' if 'cave' in cell_name else 'dungeon')
            if re.search(r'catacomb|cave|barrow|crypt|ruin|dungeon|mine|lair|den\b', cell_name) else None)
        if inferred:
            # Room names identify underground habitat, but a typed location
            # groups all its rooms under one shared cap and difficulty tier.
            for identity, row in location_chain(context, actor.get('location') or cell.get('location')):
                keys = {context.kw.get(k) for k in row.get('keywords', [])}
                if keys & {'LocTypeSewer', 'LocTypeCave', 'LocTypeDungeon', 'LocTypeNordicRuin',
                           'LocTypeDwarvenRuin', 'LocTypeAnimalDen', 'LocTypeDragonLair'}:
                    return inferred, identity
            return inferred, actor.get('cell')
    location = actor.get('location') or cell.get('location')
    if cell.get('persistent') and actor.get('pos'):
        p = actor['pos']
        ground = context.ground.get((actor.get('world'), int(p[0] // 4096), int(p[1] // 4096)))
        location = actor.get('location') or context.cells.get(ground, {}).get('location') or location
    for identity, row in location_chain(context, location):
        keys = {context.kw.get(k) for k in row.get('keywords', [])}
        name = (row.get('edid', '') + ' ' + row.get('name', '')).lower()
        if cell.get('interior') and ('sewer' in name or 'ratway' in name):
            return 'sewer', identity
        for habitat, keyword in HABITATS:
            if keyword in keys:
                return habitat, identity
        if cell.get('interior') and {'LocTypeNordicRuin', 'LocTypeDwarvenRuin',
                                     'LocTypeAnimalDen', 'LocTypeDragonLair'} & keys:
            return 'dungeon', identity
    # Some plugins omit location links, but separate city worlds are unambiguous.
    world = context.t[b'WRLD'].get(actor.get('world'), {}).get('edid')
    if world in CITY_WORLDS and not cell.get('interior'):
        return 'city', actor.get('world')
    name = (cell.get('edid', '') + ' ' + cell.get('name', '')).lower()
    if cell.get('interior'):
        if 'sewer' in name or 'ratway' in name:
            return 'sewer', actor.get('cell')
        if re.search(r'cave|barrow|crypt|ruin|dungeon|mine|lair|den\b', name):
            return 'cave' if 'cave' in name else 'dungeon', actor.get('cell')
        return 'interior', location or actor.get('cell')
    return 'wilderness', location or actor.get('cell')


def species_of(race):
    lower = race.lower()
    for word, species in [('chicken', 'chicken'), ('cow', 'cow'), ('goat', 'goat'),
                          ('husky', 'dog'), ('dog', 'dog'), ('horse', 'horse'),
                          ('mammoth', 'mammoth'), ('giant', 'giant'),
                          ('wolf', 'wolf'), ('bear', 'bear'), ('sabre', 'sabre-cat'),
                          ('deer', 'deer'), ('elk', 'deer'), ('rabbit', 'rabbit'),
                          ('fox', 'fox'), ('horker', 'horker'), ('slaughterfish', 'slaughterfish'),
                          ('mudcrab', 'mudcrab'), ('skeever', 'skeever'), ('netch', 'netch'),
                          ('spider', 'spider'), ('troll', 'troll'), ('chaurus', 'chaurus')]:
        if word in lower:
            return species
    return lower.removesuffix('race') or 'unknown'


def transport_title(edid, factions):
    captain = edid in C.TRANSPORT_BASES
    identities = [edid.lower()] + [value.lower() for value in factions]
    ferry = any('ferry' in value for value in identities)
    carriage = any('carriage' in value for value in identities)
    if sum([captain, ferry, carriage]) != 1:
        raise ValueError('Transport role is missing or ambiguous: ' + edid)
    if captain:
        return 'Ship Captain'
    return 'Ferry Operator' if ferry else 'Coach Driver'


def classify(context, ref, actor):
    base = actor.get('base')
    habitat, location = habitat_at(context, actor)
    trait = context.npc.get(context.through(base, C.USE_TRAITS), {})
    race = context.race_edid.get(trait.get('race'), '')
    species = species_of(race)
    # Swims and not Walks (RACE DATA flags 0x40 and 0x100, libespm's kSwims and
    # kWalks): the race moves only in water, so the runtime keeps it there (#2067).
    race_flags = context.t[b'RACE'].get(trait.get('race'), {}).get('raceFlags', 0)
    swims = bool(race_flags & 0x40) and not race_flags & 0x100
    # Bethesda names the actors that wait in a sarcophagus, an alcove or a pipe
    # until somebody comes near ...Ambush... (LvlDraugrAmbushMelee1HMale).
    base_edid = (context.npc.get(base) or context.lvln.get(base) or {}).get('edid', '')
    result = {'role': 'cut', 'reason': 'Ambient filler', 'habitat': habitat,
              'location': location, 'species': species, 'keep': False,
              'swims': swims, 'ambush': 'ambush' in base_edid.lower()}
    def decide(role, keep, reason):
        result.update(role=role, keep=keep, reason=reason)
        return result
    if ref == '14:Skyrim.esm':
        return decide('human', False, 'The human reference is never an NPC')
    if actor.get('deleted') or context.off(ref):
        return decide('cut', False, 'Deleted or initially switched off')
    if actor.get('startsDead'):
        return decide('cut', False, 'Authored corpse, not a living encounter')
    cell = context.cells.get(actor.get('cell'), {})
    world = context.t[b'WRLD'].get(actor.get('world'), {}).get('edid', '')
    if TEST_WORLDS.search(world) or (cell.get('interior') and TEST_INTERIORS.search(cell.get('edid', ''))):
        return decide('cut', False, 'Test or holding cell, never in the world as placed')
    if base not in context.npc:
        return decide('cut', False, 'No valid NPC base')
    facts = context.factions_of(base)
    members = {context.fact_edid.get(f, f): f for f, rank in facts.items() if rank >= 0}
    hostile_identity = any(ENEMY_FACTIONS.search(e) for e in members)
    role, because = context.role(base)
    # Arena spectators and generic hunting encounters are not guild shops.
    vendors = [e for e in because if e not in {'LSDspectateurs', 'WEServicesHunterFaction',
                                              'CurrentFollowerFaction'}]
    if role == 'traders' and vendors and not hostile_identity:
        return decide('trader', True, 'Vendor faction with a buy and sell list: ' + ', '.join(vendors))
    if role == 'transport':
        world_name = context.t[b'WRLD'].get(actor.get('world'), {}).get('edid')
        interior = context.cells.get(actor.get('cell'), {}).get('interior')
        keep = not interior and world_name not in CITY_WORLDS
        if keep:
            result['displayName'] = transport_title(base_edid, members)
        return decide('transport', keep,
                      'Authored exterior carriage or ferry stop; city ancestry is not a wall')
    if role == 'guards':
        return decide('cut', False, 'Bethesda town guard; law belongs to people')
    if context.name_of(base) in {'Thalmor Justiciar', 'Thalmor Soldier', 'Thalmor Wizard'}:
        return decide('cut', False, 'Old Thalmor actor; remnant patrols are not placed here')
    if race == 'ManakinRace' or not race:
        return decide('cut', False, 'Display actor or unresolved race')
    if context.unique(base) or not generic_name(context, base):
        return decide('cut', False, 'Specially named animal or enemy is cut')
    animal = species in DOMESTIC | PREDATORS | {'deer', 'rabbit', 'fox', 'horker', 'mammoth',
                'slaughterfish', 'mudcrab', 'skeever', 'netch', 'spider', 'troll', 'chaurus'}
    if animal:
        if habitat == 'city':
            return decide('animal', species in CITY_ANIMALS, 'Only limited domestic animals on city streets')
        if habitat == 'farm':
            return decide('animal', species in DOMESTIC, 'Farm livestock; predators belong outside the farm')
        if habitat == 'interior' and species not in {'dog', 'skeever', 'spider'}:
            return decide('animal', False, 'Wildlife does not belong inside an ordinary building')
        return decide('animal', True, 'Existing species in its authored natural habitat')
    enemy = not context.is_person(base) or hostile_identity
    if enemy:
        return decide('enemy', habitat not in {'city', 'farm', 'interior'},
                      'Hostile encounter habitat' if habitat not in {'city', 'farm', 'interior'}
                      else 'Enemies do not populate town streets or ordinary buildings')
    return result


def assign_caps(rows):
    counts = collections.Counter()
    # Source identity order makes selection reproducible across connections/reloads.
    for row in sorted(rows, key=lambda r: r['ref']):
        if not row['keep']:
            continue
        habitat, role, species = row['habitat'], row['role'], row.get('species')
        place = row.get('location') or row.get('cell')
        cap = None
        if role == 'animal' and habitat == 'city':
            key, cap = (place, 'city-animals'), 6
        elif role == 'animal' and habitat == 'farm':
            key, cap = (place, 'farm-animals'), 8
        elif habitat == 'giant-camp' and species in {'giant', 'mammoth'}:
            key, cap = (place, species), 2 if species == 'giant' else 4
        elif habitat == 'bandit-camp' and role == 'enemy':
            key, cap = (place, 'bandits'), 7
        elif habitat in {'dungeon', 'cave', 'sewer'} and role in {'enemy', 'animal'}:
            key, cap = (place, 'encounter'), TIERS[row.get('tier', 1)]['cap']
        elif habitat == 'wilderness' and role == 'animal':
            pos = row['pos']
            tile = (row.get('world'), int(pos[0] // 4096), int(pos[1] // 4096))
            key, cap = (tile, species), 3 if species == 'wolf' else 2 if species in PREDATORS else 6
        elif habitat == 'wilderness' and role == 'enemy':
            pos = row['pos']
            tile = (row.get('world'), int(pos[0] // 4096), int(pos[1] // 4096))
            key, cap = (tile, 'road-encounter'), 4
        if cap is not None:
            row['populationBucket'] = json.dumps(key, separators=(',', ':'))
            counts[key] += 1
            row['cap'] = cap
            if counts[key] > cap:
                row.update(keep=False, reason='Shared habitat population cap: ' + str(cap))
    return rows


def read_details(plugin, tables):
    """Fields beyond the cast reader: complete transforms and encounter levels.

    Layout agrees with xEdit TES5 definitions: ECZN DATA minimum at byte9,
    maximum at byte11; NPC ACBS level at byte8, minimum at byte10.
    """
    buf = plugin.buf
    def walk(start, end, cell=None, world=None):
        at = start
        while at + 24 <= end:
            tag = buf[at:at+4]
            size = struct.unpack_from('<I', buf, at+4)[0]
            if tag == b'GRUP':
                kind = struct.unpack_from('<I', buf, at+12)[0]
                label = plugin.desc(struct.unpack_from('<I', buf, at+8)[0])
                walk(at+24, at+size, label if kind == 6 else cell, label if kind == 1 else world)
                at += size
                continue
            flags, fid = struct.unpack_from('<II', buf, at+8)
            identity = plugin.desc(fid)
            if identity and tag in {b'NPC_', b'ACHR', b'CELL', b'ECZN', b'REFR', b'RACE'}:
                if tag == b'ECZN':
                    # ECZN is not read by the cast pass: replace a losing row
                    # even when the winner is an empty deletion.
                    row = {'deleted': bool(flags & C.DELETED)}
                    tables[tag][identity] = row
                else:
                    row = tables.setdefault(tag, {}).setdefault(identity, {})
                if tag == b'ACHR':
                    row['startsDead'] = bool(flags & 0x200)
                if tag == b'REFR':
                    row.update(cell=cell, world=world, deleted=bool(flags & C.DELETED))
                for st, body in C.subrecords(plugin.data(at, size, flags)):
                    if st == b'EDID':
                        row['edid'] = C.edid_of(body)
                    elif tag == b'NPC_' and st == b'ACBS' and len(body) >= 12:
                        row['level'] = struct.unpack_from('<H', body, 10 if C.u32(body) & 0x80 else 8)[0]
                    elif tag in {b'ACHR', b'REFR'} and st == b'DATA' and len(body) >= 24:
                        row['pos'] = list(struct.unpack_from('<fff', body))
                        row['rot'] = [v * 180 / math.pi for v in struct.unpack_from('<fff', body, 12)]
                    elif tag == b'REFR' and st == b'NAME' and len(body) >= 4:
                        row['base'] = plugin.desc(C.u32(body))
                    elif tag == b'CELL' and st == b'XEZN' and len(body) >= 4:
                        row['encounter'] = plugin.desc(C.u32(body))
                    elif tag == b'RACE' and st == b'DATA' and len(body) >= 36:
                        # Flags follow 14 bytes of skill boosts, 2 unknown and
                        # four heights and weights (xEdit TES5 RACE DATA).
                        row['raceFlags'] = C.u32(body, 32)
                    elif tag == b'ECZN' and st == b'DATA' and len(body) >= 12:
                        row['location'] = plugin.desc(C.u32(body, 4))
                        row['minimum'], row['maximum'] = body[9], body[11]
            at += size + 24
    walk(24+plugin.header, len(buf))


def build(paths, strings_dir=None):
    order = [os.path.basename(p) for p in paths]
    if len({p.lower() for p in order}) != len(order):
        raise ValueError('Duplicate plugins in the load order')
    canon = {n.lower(): n for n in order}
    tables = {tag: {} for tag in C.WANTED}
    tables.update({b'ACHR': {}, b'REFR': {}, b'ECZN': {}})
    sources = []
    for path, name in zip(paths, order):
        plugin = C.Plugin(path, name)
        if not plugin.ok:
            raise ValueError('Invalid plugin: ' + name)
        # Thornswood-Last.esp is built FROM this catalogue: it switches off
        # every placed actor the catalogue cuts (#2468). Read as an input it
        # would make every cut actor "Deleted or initially switched off", and
        # a rule changed later (keep the guards again, say) could never bring
        # one back. So it is in the load order the gamemode checks, by name
        # and sha256, and its actors are not read.
        #
        # Its places are (#2551): the location records it gives a hold and
        # the rooms it gives a location come from its policy, never from this
        # catalogue, and without them a kept animal in Dayspring Canyon would
        # be in no hold here while the game puts it in the Rift. So its
        # locations are read over the ones before it, and of its cells only
        # the location: every other field of a cell there is the winner's own
        # copy, which read_details has already read with more than C.read
        # gives. Its actors go into a table nobody reads.
        if name == LAST_PLUGIN:
            sources.append({'name': name, 'sha256': hashlib.sha256(plugin.buf).hexdigest()})
            plugin.masters = [canon.get(m.lower(), m) for m in plugin.masters]
            places = {tag: {} for tag in tables}
            places[b'LCTN'] = tables[b'LCTN']
            C.read(plugin, places)
            if plugin.failed:
                raise ValueError('Failed compressed records: ' + name)
            for desc, row in places[b'CELL'].items():
                if row.get('location') and desc in tables[b'CELL']:
                    tables[b'CELL'][desc]['location'] = row['location']
            continue
        plugin.masters = [canon.get(m.lower(), m) for m in plugin.masters]
        if plugin.localised:
            plugin.strings = C.bsa.load_strings(strings_dir or os.path.dirname(path), name)
        C.read(plugin, tables)
        read_details(plugin, tables)
        if plugin.failed:
            raise ValueError('Failed compressed records: ' + name)
        sources.append({'name': name, 'sha256': hashlib.sha256(plugin.buf).hexdigest()})
    context = C.Cast(tables)
    rows = []
    for ref, actor in sorted(tables[b'ACHR'].items()):
        policy = classify(context, ref, actor)
        # Cast's hold resolver expects the XY pair; retain full source XYZ here.
        hold, via = context.place(dict(actor, pos=actor.get('pos', [])[:2]), actor.get('base'))
        cell = context.cells.get(actor.get('cell'), {})
        zone = tables[b'ECZN'].get(cell.get('encounter'), {})
        level = (zone.get('minimum') if not zone.get('deleted') else None) or (
            context.npc.get(context.through(actor.get('base'), 2)) or {}).get('level', 1)
        tier = 4 if level >= 30 else 3 if level >= 20 else 2 if level >= 10 else 1
        row = dict(policy, ref=ref, base=actor.get('base'), name=context.name_of(actor.get('base')),
                   cell=actor.get('cell'), world=actor.get('world'), pos=actor.get('pos'), rot=actor.get('rot'),
                   hold=context.hold_name(hold) if hold else 'no hold', holdFrom=via,
                   locationName=context.loc.get(policy['location'], {}).get('name') or context.cell_label(actor),
                   tier=tier if policy['habitat'] in {'dungeon', 'cave', 'sewer'} else None)
        if row['pos'] is None or len(row['pos']) != 3 or not all(math.isfinite(v) for v in row['pos']):
            row.update(keep=False, reason='Invalid authored position')
        rows.append(row)
    # One location has one tier, even if its individual inhabitants differ.
    levels = collections.defaultdict(list)
    for r in rows:
        if r['tier']:
            levels[r['location']].append(r['tier'])
    location_tiers = {key: sorted(values)[len(values)//2] for key, values in levels.items()}
    for r in rows:
        if r['tier']:
            r['tier'] = location_tiers[r['location']]
        if r['role'] == 'trader':
            minutes = 360
        elif r['habitat'] == 'giant-camp' or r['species'] == 'mammoth':
            minutes = 240
        elif r['habitat'] == 'bandit-camp':
            minutes = 45
        elif r['tier']:
            minutes = TIERS[r['tier']]['returnMinutes']
        elif r['species'] in PREDATORS:
            minutes = 30 if r['species'] == 'wolf' else 60
        elif r['role'] == 'animal':
            minutes = 20
        else:
            minutes = 45
        r['returnMinutes'] = minutes
        r['leash'] = 512 if r['habitat'] in {'city', 'farm'} else 2048 if 'camp' in r['habitat'] else 1536
    assign_caps(rows)
    grouped = collections.defaultdict(list)
    for row in rows:
        if row['keep']:
            grouped[row['location']].append(row)
    locations = []
    for identity, residents in sorted(grouped.items()):
        first = residents[0]
        locations.append({'id': identity, 'name': first['locationName'], 'hold': first['hold'],
            'habitat': first['habitat'], 'tier': first['tier'], 'count': len(residents),
            'species': dict(collections.Counter(r['species'] for r in residents)),
            'roles': dict(collections.Counter(r['role'] for r in residents)),
            'returnMinutes': sorted({r['returnMinutes'] for r in residents}),
            'refs': [r['ref'] for r in residents]})
    counts = collections.Counter(r['role'] for r in rows if r['keep'])
    return {'version': 1, 'builtBy': 'scripts/dev/Build-NpcPopulation.py', 'loadOrder': sources,
            'summary': {'catalogued': len(rows), 'retained': sum(counts.values()),
                        'excluded': sum(not r['keep'] for r in rows), 'retainedByRole': dict(counts)},
            'tierRules': TIERS, 'npcs': rows, 'locations': locations}


def activate_guild(payload):
    result = copy.deepcopy(payload)
    policy = json.loads((HERE.parent.parent / 'game/data/merchant-roster.json').read_text(encoding='utf-8'))
    result['merchantHistory'] = apply_roster(result['npcs'], policy)
    result['merchantRoster'] = {'version': 1, 'worldMode': 'alpha'}
    kept = [row for row in result['npcs'] if row['keep']]
    counts = collections.Counter(row['role'] for row in kept)
    result['summary'].update(retained=len(kept), excluded=len(result['npcs'])-len(kept), retainedByRole=dict(counts))
    grouped = collections.defaultdict(list)
    for row in kept:
        grouped[row['location']].append(row)
    result['locations'] = []
    for identity, residents in sorted(grouped.items()):
        first = residents[0]
        result['locations'].append({'id': identity, 'name': first['locationName'], 'hold': first['hold'],
            'habitat': first['habitat'], 'tier': first['tier'], 'count': len(residents),
            'species': dict(collections.Counter(row['species'] for row in residents)),
            'roles': dict(collections.Counter(row['role'] for row in residents)),
            'returnMinutes': sorted({row['returnMinutes'] for row in residents}),
            'refs': [row['ref'] for row in residents]})
    return result


def main():
    parser = argparse.ArgumentParser()
    where = parser.add_mutually_exclusive_group()
    where.add_argument('--settings', help='A server-settings file; its loadOrder paths are read')
    # The catalogue's own load order, every plugin read out of one folder:
    # how it is rebuilt after Build-LastPlugin.py has rebuilt the plugin it
    # lists last (#3077), by scripts/mods/Run-OnBox.ps1 with --data '{data}'
    # and, since #3120, as the step after it in scripts/mods/content-tables.json,
    # on One out of the game's Data folder when neither is named. The order
    # itself moves only with the collection, and then from a server-settings
    # file.
    where.add_argument('--data', help='A folder holding every plugin of the catalogue\'s own load order '
                       '(default: THORNSWOOD_DATA, else C:\\Thornswood\\Game\\Data)')
    parser.add_argument('--out', default=str(HERE.parent.parent / 'game/data/npc-population.json'))
    parser.add_argument('--write-runtime', action='store_true')
    parser.add_argument('--strings-dir', help='Installed archive directory for localized record names')
    args = parser.parse_args()
    if not args.settings and not args.data:
        args.data = os.environ.get('THORNSWOOD_DATA') or r'C:\Thornswood\Game\Data'
    if args.settings:
        with open(args.settings, encoding='utf-8-sig') as source:
            paths = json.load(source)['loadOrder']
    else:
        with open(args.out, encoding='utf-8') as source:
            paths = [own_plugins.plugin_path(args.data, row['name']) for row in json.load(source)['loadOrder']]
    payload = activate_guild(build(paths, args.strings_dir))
    with open(args.out, 'w', encoding='utf-8', newline='\n') as output:
        json.dump(payload, output, ensure_ascii=False, separators=(',', ':'))
        output.write('\n')
    print(json.dumps(payload['summary']))
    if args.write_runtime:
        write_runtime(payload)
        write_catalogues(payload)


def write_runtime(payload):
    payload = activate_guild(payload)
    # No cut list: Thornswood-Last.esp switches every cut actor off at the
    # record, and the gamemode no longer hands the server one (#2468, #2486).
    compact = {'version': 1, 'plugins': [s['name'] for s in payload['loadOrder']],
        'merchantHistory': payload['merchantHistory'], 'merchantRoster': payload['merchantRoster'],
        'merchantRoles': {r['ref']: r['guildRole'] for r in payload['npcs'] if r['keep'] and r['role'] == 'trader'},
        'keep': [[r['ref'], r['base'], r['world'] or r['cell'], r['pos'], r['leash'],
                  r['returnMinutes'], r['role'], r['habitat'], r['tier'], r.get('cap'),
                  r.get('populationBucket'),
                  # 1: swims and cannot walk; 2: an ambush placement (#2067).
                  (1 if r.get('swims') else 0) | (2 if r.get('ambush') else 0), r['species']] +
                 ([r['displayName']] if 'displayName' in r else [])
                 for r in payload['npcs'] if r['keep']]}
    target = str(HERE.parent.parent / 'game/gamemode')
    source = gamemode_source.read(target)
    begin = source.index('// NPC POPULATION DATA BEGIN')
    end = source.index('// NPC POPULATION DATA END')
    block = '// NPC POPULATION DATA BEGIN\nconst NPC_POPULATION_DATA = ' + json.dumps(
        compact, ensure_ascii=False, separators=(',', ':')) + ';\n'
    gamemode_source.write(target, source[:begin] + block + source[end:])


# docs/HUNTING-SPOTS.csv is every retained animal with what its body gives.
# One writer, so a population rebuild and a hunt table rebuild both leave the
# same columns (#1874): it reads only npc-population.json and hunts.json, and
# Build-ResourceLocations.py --hunting-only runs it without any plugin.
HUNTING_COLUMNS = ['ref', 'name', 'base', 'hold', 'locationName', 'location', 'habitat', 'role',
                   'species', 'tier', 'cap', 'returnMinutes', 'leash', 'cell', 'world', 'x', 'y', 'z',
                   'rank', 'access', 'products', 'productIds', 'yieldByRank', 'sharedStock', 'rewardRule']


def hunting_rows(npcs, hunts):
    rows = []
    for row in npcs:
        if not row['keep'] or row['role'] != 'animal':
            continue
        hunt = hunts.get(row['base'])
        products = hunt['gives'] if hunt else []
        rows.append(dict(row, x=row['pos'][0], y=row['pos'][1], z=row['pos'][2],
            rank=hunt['rank'] if hunt else '', access='Hunter' if hunt else 'No dressing yield',
            products='; '.join(item['name'] for item in products),
            productIds='; '.join(item['item'] for item in products),
            yieldByRank=json.dumps(hunt['yield'], separators=(',', ':')) if hunt else '',
            sharedStock=1, rewardRule='One dressing per life' if hunt else 'None'))
    return rows


def write_hunting_spots(npcs):
    root = HERE.parent.parent
    hunts = json.loads((root / 'game/data/hunts.json').read_text(encoding='utf-8'))['hunts']
    rows = hunting_rows(npcs, hunts)
    target = root / 'docs' / 'HUNTING-SPOTS.csv'
    # LF on every machine, as git stores it (#3029): since #3120 this builder
    # is a step of scripts/mods/content-tables.json.
    with target.open('w', encoding='utf-8', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=HUNTING_COLUMNS, lineterminator='\n')
        writer.writeheader()
        writer.writerows({key: row.get(key, '') for key in HUNTING_COLUMNS} for row in rows)
    return rows


def write_catalogues(payload):
    payload = activate_guild(payload)
    root = HERE.parent.parent / 'docs'
    columns = ['ref', 'name', 'base', 'hold', 'locationName', 'location', 'habitat', 'role',
               'species', 'tier', 'cap', 'returnMinutes', 'leash', 'cell', 'world', 'x', 'y', 'z']
    kept = [r for r in payload['npcs'] if r['keep']]
    with (root / 'NPC-SPAWNS.csv').open('w', encoding='utf-8', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=columns, lineterminator='\n')
        writer.writeheader()
        for r in kept:
            writer.writerow(dict({k: r.get('displayName', r.get(k)) if k == 'name' else r.get(k)
                                  for k in columns if k not in {'x', 'y', 'z'}},
                                 x=r['pos'][0], y=r['pos'][1], z=r['pos'][2]))
    write_hunting_spots(payload['npcs'])
    summary = payload['summary']
    lines = ['# NPC population catalogue', '',
        f"Generated from the winning records in the {len(payload['loadOrder'])}-plugin load order.",
        'These are source policies and counts. Release proof is recorded separately.', '',
        f"{summary['catalogued']:,} placements inspected; {summary['retained']:,} retained; {summary['excluded']:,} excluded.", '',
        'Named pets and named enemies are excluded even when their source record lacks the Unique flag.',
        'Merchant traders and exterior transport services remain available.', '',
        '[All retained spawn coordinates](NPC-SPAWNS.csv) and [animal habitat coordinates](HUNTING-SPOTS.csv)',
        'list source identities, species, location, tier, cap, return interval and home radius.',
        'Each row is one authored identity, not a per-person spawn. A dead identity returns once after its',
        'listed interval; the deadline persists through restart. A corpse yields one shared dressing per life.', '',
        '| Hold | Retained NPCs |', '|---|---:|']
    for hold, count in sorted(collections.Counter(r['hold'] for r in kept).items()):
        lines.append(f'| {hold} | {count:,} |')
    lines += ['', 'City animals: at most six per location. Farm livestock: at most eight per location.',
        'Bandit camps: at most seven enemies, 45-minute returns. Giant camps: at most two giants',
        'and four mammoths, four-hour returns. Camps have separate type baselines, without location tiers.',
        'Wilderness tiles are 4,096 units: at most four enemies, three wolves, two other large predators',
        'and six of each other animal species per tile. Cave and dungeon caps are shared across their rooms.', '',
        '| Tier | Cave/dungeon cap | Return minutes |', '|---|---:|---:|']
    lines += [f'| {tier} | {rule["cap"]} | {rule["returnMinutes"]} |' for tier, rule in TIERS.items()]
    lines += ['', '## Locations', '', '| Location | Hold | Habitat | Tier | NPC count | Return minutes |', '|---|---|---|---:|---:|---|']
    for row in payload['locations']:
        name = str(row['name']).replace('|', '/')
        lines.append(f"| {name} | {row['hold']} | {row['habitat']} | {row['tier'] or ''} | {row['count']} | " +
                     ', '.join(map(str, row['returnMinutes'])) + ' |')
    page = '\n'.join(lines) + '\n'
    (root / 'NPC-POPULATION.md').write_text(page, encoding='utf-8', newline='\n')
    write_merchants(payload)


def write_merchants(payload):
    root = HERE.parent.parent
    reverse_holds = {value: key for key, value in BOOK_HOLDS.items()}
    merchants = [row for row in payload['npcs'] if row['keep'] and row['role'] == 'trader']
    by_ref = {row['ref']: {'name': row['guildRole'], 'role': row['guildRole'], 'hold': row['hold'],
        'bookHold': reverse_holds[row['hold']], 'locationName': row['locationName'],
        'cell': row['cell'], 'world': row['world'], 'pos': row['pos']} for row in merchants}
    with (root / 'game/data/merchant-traders.json').open('w', encoding='utf-8', newline='\n') as output:
        output.write(json.dumps({'version': 1, 'count': len(by_ref), 'byRef': by_ref}, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Merchant trader counts', '',
        '60 authored guild traders: one Smith, Woodworker, Tailor, Enchanter, Cook and Alchemist in each hold.',
        'People cannot join. Exact guild relocation remains separate. These are source counts, not release proof.', '',
        '| Hold | Role | Place | Reference | Book hold |', '| --- | --- | --- | --- | --- |']
    for ref, row in sorted(by_ref.items(), key=lambda item: (item[1]['hold'], item[1]['role'])):
        lines.append('| ' + ' | '.join([row['hold'], row['role'], row['locationName'], ref, row['bookHold']]) + ' |')
    lines += ['', 'Total: 60', '',
        'Each authored identity returns after 360 minutes and keeps its existing 512-unit home radius.',
        'Exact coordinates and the shared population rules are in [NPC spawns](../NPC-SPAWNS.csv).']
    with (root / 'docs/systems/merchant-traders.md').open('w', encoding='utf-8', newline='\n') as output:
        output.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
