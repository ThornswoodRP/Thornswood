"""
Build-CastTable.py

Walks every placed actor in the load order and sorts the people into four:
traders, transport, guards and everyone else, hold by hold. It writes that down
as game\\data\\cast.json, which is the surviving cast written as a list before
anything is deleted.

WHY

Settled by Patrick on 17 September, entry 320 on the To Do List: "What
survives: traders you can buy from and sell to through the custom economy in
entry 214, and the carriage and ferry workers in entry 215. Everything else is
either rebuilt as a custom character or removed." And the order it has to
happen in: "Write the surviving cast down as a list before anything is deleted,
because the deletion is the part that cannot be undone".

This is that list, as a candidate. It removes nothing, changes no plugin and
touches nothing the server runs. A name on it is a question for Patrick, not an
instruction to anything. Guards get their own column because entry 321 wants
their numbers and they are neither a trader nor a stranger.

WHAT EACH COLUMN MEANS, and these are the judgements in here. Each was measured
against this load order on 24 September rather than assumed.

  trader     A member, at rank 0 or above, of a faction whose DATA flags carry
             the vendor bit (0x4000) and which has a buy and sell list (VEND).
             That is a vendor in the game's own terms, so it is the honest
             reading of "traders you can buy from and sell to". Rank -1 is not
             membership: Faendal sits in CurrentFollowerFaction, which has the
             vendor bit, at rank -1, and does not trade. The Job factions
             (JobMerchantFaction and the rest) are NOT the test: Belethor is in
             JobMerchantFaction at rank -1, so a job faction says what Bethesda
             meant someone to be and nothing about whether they sell. Of 1,620
             factions, 1,532 carry a VENV subrecord, so its presence means
             nothing either. 383 have the vendor bit, and the one of those with
             no buy and sell list is WhiterunBanneredMareFaction, which is who
             owns the inn rather than a shop. Hulda sells through
             ServicesWhiterunBanneredMare.

  transport  A member of a carriage or ferry faction, or one of the two
             records of Gjalund Salt-Sage, the Solstheim ferry, who belongs to
             no faction at all. The factions are the vanilla carriage system,
             the Hearthfire and Dawnguard drivers and ferrymen, and the ones
             CFTO.esp adds. CFTO also switches the vanilla drivers off, by
             their own flag or an enable parent, and places its own copies,
             which is why a driver can show up twice, once standing and once
             switched off.

  guard      A member of any GuardFaction<town>, or of IsGuardFaction together
             with GuardDialogueFaction, or of Raven Rock's guard faction.
             IsGuardFaction on its own is not the test: 50 people standing in
             the world are in it with neither of the others, and they are the
             Companions, the orc strongholds and a few soldiers, told to
             answer a crime rather than hired to keep the peace. Civil War
             soldiers in a camp carry CWSoldierNoGuardDialogueFaction and are
             not the watch of a hold.

  everyone   Every other person. A person is an actor whose race carries the
  else       ActorTypeNPC keyword. Wolves, horses, draugr and dragons are
             placed actors too and are counted, not listed. Mannequins are
             ManakinRace, which carries ActorTypeNPC, and are counted with the
             creatures because nobody would call one a person.

A TEMPLATE IS FOLLOWED, because a placed bandit or guard is usually a thin
record whose race, factions and name come from a template, and the thin
record's own RNAM is a leftover: 6,521 placements say FoxRace on their own
record. Each trait is read through the template the ACBS flags say to use, and
a leveled list is read through its first entry.

SWITCHED OFF AT THE START. A placement flagged initially disabled, or whose
enable parent is, stands nowhere until a script switches it on. 2,548 of the
6,931 people are, and most of them through a parent: the Civil War's other
garrison, a Hearthfire house not built yet, the vanilla carriage drivers CFTO
replaced. They are counted apart and, for traders and transport, named apart,
so the cast is the people actually standing there.

WHICH HOLD. The first of these that answers: the location the placement itself
carries (XLCN on the ACHR), the location of the cell it stands in, the
location of the ground under it when it stands in a worldspace's persistent
cell (by its position, 4096 units to a cell), the nearest ground within
NEAREST cells that names a place, and last the hold its crime faction belongs
to. A location answers when walking up its parents reaches one carrying
LocTypeHold, which in this load order is the nine holds and Solstheim. Anybody
none of these place is under "no hold", which is mostly holding cells, test
cells, Sovngarde and the arenas mods build in worlds of their own.

WHAT IT READS. Nothing but the plugins, the five masters then plugins.txt,
last one wins, the same reader Build-DoorTable.py uses. A plugin that names
its master as Hearthfires.esm and one that names it HearthFires.esm mean the
same file, so masters are matched to the load order without case: without
that, CFTO's override of a Hearthfire carriage driver reads as a second
driver.

WHAT IT WRITES. game\\data\\cast.json, and nothing else.

Usage:
    python scripts/dev/Build-CastTable.py --check
    python scripts/dev/Build-CastTable.py
"""

import argparse
import importlib.util
import io
import json
import os
import struct
import sys

import bsa
import own_plugins

HERE = os.path.dirname(os.path.abspath(__file__))

# The plugin reader lives in Build-DoorTable.py. It is loaded rather than copied
# so there is one reader of placed references in this repo, not two drifting
# apart. Its name has a hyphen in it, so it cannot be imported by name.
_spec = importlib.util.spec_from_file_location(
    'door_table', os.path.join(HERE, 'Build-DoorTable.py'))
door_table = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(door_table)
Plugin = door_table.Plugin
subrecords = door_table.subrecords
MASTERS = door_table.MASTERS

# Record header flags.
DELETED = 0x20
DISABLED = 0x800
# XESP flags: this reference is on when its enable parent is off.
ESP_OPPOSITE = 0x01

# FACT DATA flag: this faction is a vendor.
VENDOR = 0x4000

# ACBS flags: a person with a name of their own, as against one of a crowd.
UNIQUE = 0x20

# ACBS template flags, the uint16 at offset 18: which traits come from TPLT.
USE_TRAITS = 0x0001      # race
USE_FACTIONS = 0x0004
USE_BASE_DATA = 0x0080   # the name

CELL_INTERIOR = 0x01
CELL_UNITS = 4096.0
# How many cells out the nearest named place is looked for. Measured on 24
# September, the named squares of one hold spread from 18 cells across
# (Solstheim) to 47 (the Reach), so six keeps a guess near where it was made.
NEAREST = 6

TRANSPORT_FACTIONS = set([
    'CarriageSystemFaction', 'JobCarriageFaction', 'BYOHCarriageDriverFaction',
    'DLC1FerrySystemFaction',
    # CFTO.esp, which replaces the carriage drivers and adds the ferries.
    'KmodFastTravelDialogueFaction', 'KmodCarriageFreeFaction',
    'KmodFerryRoute1Faction', 'KmodFerryRoute2Faction',
    'KmodFerryRoute3Faction', 'KmodFerryRoute4Faction',
])
# The Solstheim ferry is in no faction. These are his two records, one at the
# Windhelm docks and one at Raven Rock.
TRANSPORT_BASES = set(['DLC2RRGjalundSaltSageWindhelm', 'DLC2RRGjalundSaltSageSolstheim'])

# IsGuardFaction alone is not enough: the Companions and the people of the orc
# strongholds are in it so that they answer a crime, and have no guard
# dialogue. A town's GuardFaction, or IsGuardFaction WITH GuardDialogueFaction,
# is the watch. Raven Rock's Redoran guards have a faction of their own.
GUARD_FACTIONS = set(['DLC2RavenRockGuardFaction'])
GUARD_PREFIX = 'GuardFaction'

NOT_PEOPLE_RACES = set(['ManakinRace'])

# The last fallback for a hold: whose law the person answers to.
CRIME_HOLD = {
    'CrimeFactionWhiterun': 'WhiterunHoldLocation',
    'CrimeFactionHaafingar': 'HaafingarHoldLocation',
    'CrimeFactionFalkreath': 'FalkreathHoldLocation',
    'CrimeFactionHjaalmarch': 'HjaalmarchHoldLocation',
    'CrimeFactionPale': 'PaleHoldLocation',
    'CrimeFactionRift': 'RiftHoldLocation',
    'CrimeFactionWinterhold': 'WinterholdHoldLocation',
    'CrimeFactionEastmarch': 'EastmarchHoldLocation',
    'CrimeFactionReach': 'ReachHoldLocation',
    'CrimeFactionCidhnaMine': 'ReachHoldLocation',
    'DLC2CrimeRavenRockFaction': 'DLC2SolstheimLocation',
}

NO_HOLD = 'no hold'
# Built from what this and Build-NpcPopulation.py read: it switches off every
# placed actor the catalogue cuts (#2468), so its actors are never read here.
LAST_PLUGIN = 'Thornswood-Last.esp'
WANTED = (b'FACT', b'NPC_', b'LVLN', b'RACE', b'KYWD', b'LCTN', b'CELL', b'WRLD')


def u32(body, off=0):
    return struct.unpack_from('<I', body, off)[0]


def edid_of(body):
    return body.rstrip(bytes([0])).decode('ascii', 'replace')


def read(pl, t):
    """Every record this pass wants out of one plugin, into t, last one wins."""
    buf = pl.buf

    def ref(body, off=0):
        return pl.desc(u32(body, off)) if len(body) >= off + 4 else None

    def eat(start, end, cell, world, gtype_here):
        p = start
        while p + 24 <= end:
            tag = buf[p:p + 4]
            size = u32(buf, p + 4)
            if tag == b'GRUP':
                gtype = u32(buf, p + 12)
                kc, kw = cell, world
                # Type 1 is a worldspace's children and its label is the world;
                # type 6 is a cell's children and its label is the cell.
                if gtype == 1:
                    kw = pl.desc(u32(buf, p + 8))
                elif gtype == 6:
                    kc = pl.desc(u32(buf, p + 8))
                eat(p + 24, p + size, kc, kw, gtype)
                p += size
                continue
            flags, fid = struct.unpack_from('<II', buf, p + 8)
            d = pl.desc(fid)
            if d and tag == b'REFR' and cell:
                # Only what decides whether a placed thing starts switched on:
                # its own flag, and the enable parent it follows. A marker is
                # usually the parent, which is why every REFR is looked at.
                body = pl.data(p, size, flags)
                row = {'disabled': bool(flags & DISABLED)}
                if b'XESP' in body:
                    for st, b in subrecords(body):
                        if st == b'XESP' and len(b) >= 5:
                            row['enableParent'] = ref(b)
                            row['opposite'] = bool(b[4] & ESP_OPPOSITE)
                if row['disabled'] or row.get('enableParent'):
                    t[b'REFR'][d] = row
                elif d in t[b'REFR']:
                    del t[b'REFR'][d]
            elif d and (tag in WANTED or (tag == b'ACHR' and cell)):
                row = {}
                for st, body in subrecords(pl.data(p, size, flags)):
                    if st == b'EDID':
                        row['edid'] = edid_of(body)
                    elif st == b'FULL':
                        row['name'] = pl.text(body)
                    elif st == b'KWDA':
                        row['keywords'] = [ref(body, i) for i in range(0, len(body) - 3, 4)]
                    elif tag == b'FACT' and st == b'DATA' and len(body) >= 4:
                        row['flags'] = u32(body)
                    elif tag == b'FACT' and st == b'VEND':
                        row['sells'] = True
                    elif tag == b'NPC_' and st == b'SNAM' and len(body) >= 5:
                        row.setdefault('factions', []).append(
                            (ref(body), struct.unpack_from('<b', body, 4)[0]))
                    elif tag == b'NPC_' and st == b'RNAM':
                        row['race'] = ref(body)
                    elif tag == b'NPC_' and st == b'TPLT':
                        row['template'] = ref(body)
                    elif tag == b'NPC_' and st == b'CRIF':
                        row['crime'] = ref(body)
                    elif tag == b'NPC_' and st == b'ACBS' and len(body) >= 20:
                        row['acbs'] = u32(body)
                        row['uses'] = struct.unpack_from('<H', body, 18)[0]
                    elif tag == b'LVLN' and st == b'LVLO' and len(body) >= 8:
                        row.setdefault('entries', []).append(ref(body, 4))
                    elif tag == b'LCTN' and st == b'PNAM':
                        row['parent'] = ref(body)
                    elif tag in (b'CELL', b'ACHR') and st == b'XLCN':
                        row['location'] = ref(body)
                    elif tag == b'CELL' and st == b'DATA' and len(body) >= 1:
                        row['interior'] = bool(body[0] & CELL_INTERIOR)
                    elif tag == b'CELL' and st == b'XCLC' and len(body) >= 8:
                        row['grid'] = struct.unpack_from('<ii', body, 0)
                    elif tag == b'ACHR' and st == b'NAME':
                        row['base'] = ref(body)
                    elif tag == b'ACHR' and st == b'DATA' and len(body) >= 8:
                        row['pos'] = struct.unpack_from('<ff', body, 0)
                    elif tag == b'ACHR' and st == b'XESP' and len(body) >= 5:
                        row['enableParent'] = ref(body)
                        row['opposite'] = bool(body[4] & ESP_OPPOSITE)
                if tag == b'CELL':
                    row['world'] = world
                    # A worldspace's persistent cell sits straight in the
                    # world's children, not in a block, and says it is at 0,0.
                    # It is not the ground at 0,0 and must not be taken for it.
                    row['persistent'] = gtype_here == 1
                elif tag == b'ACHR':
                    row['cell'] = cell
                    row['world'] = world
                    row['deleted'] = bool(flags & DELETED)
                    row['disabled'] = bool(flags & DISABLED)
                t[tag][d] = row
            p += 24 + size

    p = 24 + pl.header
    while p + 24 <= len(buf):
        size = u32(buf, p + 4)
        if buf[p:p + 4] != b'GRUP':
            break
        if buf[p + 8:p + 12] in WANTED:
            eat(p + 24, p + size, None, None, 0)
        p += size


class Cast(object):
    """The tables read out of the load order, and the questions asked of them."""

    def __init__(self, t):
        self.t = t
        self.fact = t[b'FACT']
        self.npc = t[b'NPC_']
        self.lvln = t[b'LVLN']
        self.loc = t[b'LCTN']
        self.cells = t[b'CELL']
        kw = dict((d, r.get('edid', '')) for d, r in t[b'KYWD'].items())
        self.kw = kw
        self.person_race = dict(
            (d, 'ActorTypeNPC' in [kw.get(k) for k in r.get('keywords', [])]
             and r.get('edid') not in NOT_PEOPLE_RACES)
            for d, r in t[b'RACE'].items())
        self.race_edid = dict((d, r.get('edid', '')) for d, r in t[b'RACE'].items())
        self.fact_edid = dict((d, r.get('edid', '')) for d, r in self.fact.items())
        self.vendors = set(d for d, r in self.fact.items()
                           if r.get('flags', 0) & VENDOR and r.get('sells'))
        self.loc_by_edid = dict((r.get('edid'), d) for d, r in self.loc.items())
        self._hold = {}
        # (world, x, y) -> the exterior cell at that grid square, and -> the
        # hold of that square when its cell names a place inside one.
        self.ground, self.named = {}, {}
        for d, r in self.cells.items():
            if r.get('grid') is not None and not r.get('interior') and not r.get('persistent'):
                square = (r.get('world'), r['grid'][0], r['grid'][1])
                self.ground[square] = d
                h = self.hold_of_location(r.get('location'))
                if h:
                    self.named[square] = h

    def through(self, base, bit, depth=0):
        """The NPC_ record that really supplies a trait, following templates."""
        n = self.npc.get(base)
        if n is None or depth > 16:
            return None
        tpl = n.get('template')
        if not tpl or not (n.get('uses', 0) & bit):
            return base
        if tpl in self.npc:
            return self.through(tpl, bit, depth + 1)
        return self.first_of(tpl, bit, depth + 1)

    def first_of(self, lvl, bit, depth):
        """A leveled list read through its first entry that resolves."""
        if depth > 16 or lvl not in self.lvln:
            return None
        for e in self.lvln[lvl].get('entries', []):
            if e in self.npc:
                got = self.through(e, bit, depth + 1)
            else:
                got = self.first_of(e, bit, depth + 1)
            if got:
                return got
        return None

    def name_of(self, base):
        n = self.npc.get(self.through(base, USE_BASE_DATA)) or {}
        return n.get('name') or n.get('edid') or self.npc.get(base, {}).get('edid') or base

    def unique(self, base):
        n = self.npc.get(self.through(base, USE_BASE_DATA)) or {}
        return bool(n.get('acbs', 0) & UNIQUE)

    def factions_of(self, base):
        """Faction editor id -> rank, for the factions this actor is really in."""
        n = self.npc.get(self.through(base, USE_FACTIONS)) or {}
        out = {}
        for f, rank in n.get('factions', []):
            if f:
                out[f] = rank
        return out

    def is_person(self, base):
        n = self.npc.get(self.through(base, USE_TRAITS)) or {}
        return bool(self.person_race.get(n.get('race')))

    def hold_of_location(self, loc):
        if loc in self._hold:
            return self._hold[loc]
        seen, at, found = set(), loc, None
        while at and at not in seen and at in self.loc:
            seen.add(at)
            r = self.loc[at]
            if 'LocTypeHold' in [self.kw.get(k) for k in r.get('keywords', [])]:
                found = at
                break
            at = r.get('parent')
        self._hold[loc] = found
        return found

    def nearest(self, world, gx, gy):
        """The hold of the closest square within NEAREST that names a place.

        Out in the wild most ground names nothing: 1,190 of 73,125 exterior
        cells in this load order carry a location. So a person on open ground
        is given the hold of the nearest square that does, ring by ring, and
        the closest by straight line when a ring holds more than one.
        """
        for r in range(1, NEAREST + 1):
            best = None
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    h = self.named.get((world, gx + dx, gy + dy))
                    if h:
                        key = (dx * dx + dy * dy, self.hold_name(h))
                        if best is None or key < best[0]:
                            best = (key, h)
            if best:
                return best[1]
        return None

    def hold_name(self, loc):
        r = self.loc.get(loc, {})
        return r.get('name') or r.get('edid') or loc

    def place(self, a, base):
        """(hold location or None, how it was worked out)."""
        h = self.hold_of_location(a.get('location'))
        if h:
            return h, 'its own location'
        cell = self.cells.get(a.get('cell'), {})
        h = self.hold_of_location(cell.get('location'))
        if h:
            return h, 'the cell it stands in'
        if not cell.get('interior') and a.get('pos'):
            x, y = a['pos']
            world, gx, gy = a.get('world'), int(x // CELL_UNITS), int(y // CELL_UNITS)
            if cell.get('persistent'):
                under = self.cells.get(self.ground.get((world, gx, gy)), {})
                h = self.hold_of_location(under.get('location'))
                if h:
                    return h, 'the ground it stands on'
            h = self.nearest(world, gx, gy)
            if h:
                return h, 'the nearest named place'
        crime = (self.npc.get(self.through(base, USE_FACTIONS)) or {}).get('crime')
        h = self.loc_by_edid.get(CRIME_HOLD.get(self.fact_edid.get(crime)))
        if h:
            return h, 'whose law it answers to'
        return None, 'nothing placed it'

    def role(self, base):
        """(column, the faction or record that put it there)."""
        facts = self.factions_of(base)
        member = dict((self.fact_edid.get(f, f), f) for f, rank in facts.items() if rank >= 0)
        sells = sorted(e for e, f in member.items() if f in self.vendors)
        if sells:
            return 'traders', sells
        ride = sorted(e for e in member if e in TRANSPORT_FACTIONS)
        edid = self.npc.get(base, {}).get('edid', '')
        if ride or edid in TRANSPORT_BASES:
            return 'transport', ride or [edid]
        watch = sorted(e for e in member if e in GUARD_FACTIONS or e.startswith(GUARD_PREFIX))
        if 'IsGuardFaction' in member and 'GuardDialogueFaction' in member:
            watch = sorted(set(watch) | set(['IsGuardFaction', 'GuardDialogueFaction']))
        if watch:
            return 'guards', watch
        return 'everyoneElse', []

    def off(self, ref, depth=0):
        """Whether a placed thing starts switched off.

        Its own flag says so, or its enable parent does: a child follows its
        parent, or does the opposite when XESP says to. A parent this pass
        never saw is taken as on, since nothing says otherwise.
        """
        r = self.t[b'ACHR'].get(ref) or self.t[b'REFR'].get(ref)
        if r is None:
            return False
        if r.get('disabled'):
            return True
        parent = r.get('enableParent')
        if not parent or depth > 32:
            return False
        above = self.off(parent, depth + 1)
        return (not above) if r.get('opposite') else above

    def cell_label(self, a):
        c = self.cells.get(a.get('cell'), {})
        return c.get('name') or c.get('edid') or (
            'open ground in %s' % (self.t[b'WRLD'].get(a.get('world'), {}).get('edid') or 'a worldspace'))


def build(data, plugins_txt, say):
    order = own_plugins.load_order(plugins_txt)
    missing = [n for n in order if not os.path.isfile(own_plugins.plugin_path(data, n))]
    if missing:
        say('STOP. %d plugin(s) are not in %s: %s' % (len(missing), data, ', '.join(missing[:6])))
        return None
    canon = dict((n.lower(), n) for n in order)

    t = dict((k, {}) for k in WANTED)
    t[b'ACHR'], t[b'REFR'] = {}, {}
    tables = 0
    for name in order:
        pl = Plugin(own_plugins.plugin_path(data, name), name)
        pl.masters = [canon.get(m.lower(), m) for m in pl.masters]
        if pl.localised:
            pl.strings = bsa.load_strings(data, name)
            if pl.strings:
                tables += 1
        if name == LAST_PLUGIN:
            # This is the cast as it stands before anything is deleted, and
            # Thornswood-Last.esp is the deleting: read as an input it would
            # list every cut actor as off at the start. Its places are read,
            # as Build-NpcPopulation.py reads them (#2551): its locations over
            # the ones before it, and of its cells only the location.
            places = dict((k, {}) for k in t)
            places[b'LCTN'] = t[b'LCTN']
            read(pl, places)
            for d, row in places[b'CELL'].items():
                if row.get('location') and d in t[b'CELL']:
                    t[b'CELL'][d]['location'] = row['location']
            continue
        read(pl, t)

    cast = Cast(t)
    holds = {}
    counts = {'placed': 0, 'deleted': 0, 'notPeople': 0, 'people': 0, 'offAtStart': 0,
              'traders': 0, 'transport': 0, 'guards': 0, 'everyoneElse': 0,
              'uniqueTraders': 0, 'uniqueTransport': 0,
              'noHold': 0, 'stringTables': tables}
    how, sellers = {}, {}
    for ref in sorted(t[b'ACHR']):
        a = t[b'ACHR'][ref]
        base = a.get('base')
        # A later plugin that deletes a placement often keeps nothing of it
        # but the flag, so this is counted before its base is asked for.
        if a['deleted']:
            counts['placed'] += 1
            counts['deleted'] += 1
            continue
        if base not in cast.npc:
            continue
        counts['placed'] += 1
        loc, why = cast.place(a, base)
        hold = cast.hold_name(loc) if loc else NO_HOLD
        h = holds.setdefault(hold, {
            'counts': {'people': 0, 'offAtStart': 0, 'traders': 0, 'transport': 0,
                       'guards': 0, 'everyoneElse': 0, 'notPeople': 0},
            'traders': [], 'transport': [], 'guards': {}, 'everyoneElse': {},
            'offAtStart': [],
            'offAtStartBy': {'traders': 0, 'transport': 0, 'guards': 0, 'everyoneElse': 0}})
        if not cast.is_person(base):
            counts['notPeople'] += 1
            h['counts']['notPeople'] += 1
            continue
        counts['people'] += 1
        h['counts']['people'] += 1
        how[why] = how.get(why, 0) + 1
        if not loc:
            counts['noHold'] += 1
        column, because = cast.role(base)
        name = cast.name_of(base)
        if cast.off(ref):
            # Switched off at the start, by its own flag or its enable parent's.
            # Nobody is standing there until a script switches it on, and
            # nothing on this server relies on a vanilla quest doing that, so
            # these are listed apart rather than counted as the cast.
            counts['offAtStart'] += 1
            h['counts']['offAtStart'] += 1
            h['offAtStartBy'][column] += 1
            if column in ('traders', 'transport'):
                h['offAtStart'].append({'name': name, 'column': column, 'ref': ref,
                                        'base': base, 'because': because,
                                        'offBy': 'its own flag' if a['disabled']
                                        else 'its enable parent'})
            continue
        counts[column] += 1
        h['counts'][column] += 1
        if column in ('traders', 'transport'):
            row = {'name': name, 'ref': ref, 'base': base,
                   'edid': cast.npc[base].get('edid', ''), 'unique': cast.unique(base),
                   'where': cast.cell_label(a), 'holdFrom': why, 'because': because}
            if a.get('enableParent'):
                row['enableParent'] = a['enableParent']
            h[column].append(row)
            if row['unique']:
                counts[{'traders': 'uniqueTraders', 'transport': 'uniqueTransport'}[column]] += 1
            if column == 'traders':
                for e in because:
                    sellers[e] = sellers.get(e, 0) + 1
        else:
            h[column][name] = h[column].get(name, 0) + 1

    for h in holds.values():
        for column in ('traders', 'transport', 'offAtStart'):
            h[column].sort(key=lambda r: (r['name'], r['ref']))
    return {'order': order, 'counts': counts, 'holds': holds, 'how': how, 'sellers': sellers}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default=r'C:\Thornswood\Profile\Default\plugins.txt')
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'game', 'data', 'cast.json'))
    ap.add_argument('--check', action='store_true', help='say what it found, write nothing')
    args = ap.parse_args()

    def say(s):
        print(s)

    got = build(args.data, args.plugins, say)
    if got is None:
        return 1
    c, holds = got['counts'], got['holds']
    f = lambda n: format(n, ',')

    say('The load order')
    say('  %d plugins, the five masters then %s' % (len(got['order']), args.plugins))
    say('')
    say('Placed actors')
    say('  %s placed actor(s), %s of them deleted by a later plugin' % (f(c['placed']), f(c['deleted'])))
    say('  %s are not people: animals, monsters, draugr and mannequins' % f(c['notPeople']))
    say('  %s are people, and %s of those start switched off, by their own flag or an enable parent'
        % (f(c['people']), f(c['offAtStart'])))
    say('')
    say('The people standing in the world')
    say('  %s trader(s), who survive, %s of them with a name of their own'
        % (f(c['traders']), f(c['uniqueTraders'])))
    say('  %s carriage and ferry worker(s), who survive, %s of them with a name of their own'
        % (f(c['transport']), f(c['uniqueTransport'])))
    say('  %s guard(s), for entry 321' % f(c['guards']))
    say('  %s everyone else, rebuilt as a custom character or removed' % f(c['everyoneElse']))
    say('')
    say('The vendor factions with the most traders standing, to check by eye')
    for e, n in sorted(got['sellers'].items(), key=lambda x: (-x[1], x[0]))[:8]:
        say('  %5s  %s' % (f(n), e))
    say('')
    say('How each person was given a hold')
    for why, n in sorted(got['how'].items(), key=lambda x: -x[1]):
        say('  %s by %s' % (f(n), why))
    say('')
    say('By hold: traders, transport, guards, everyone else')
    for hold in sorted(holds, key=lambda k: (k == NO_HOLD, k.lower())):
        hc = holds[hold]['counts']
        say('  %-12s %5s %5s %5s %6s' % (hold, f(hc['traders']), f(hc['transport']),
                                         f(hc['guards']), f(hc['everyoneElse'])))

    if args.check:
        say('')
        say('  --check, so nothing was written.')
        return 0

    payload = {
        'builtBy': 'scripts/dev/Build-CastTable.py',
        'readFrom': own_plugins.load_order_name(got['order']),
        'whatThisIs': 'A candidate for the surviving cast, entry 320: traders and the carriage '
                      'and ferry workers survive, everyone else is rebuilt as a custom character '
                      'or removed. Nothing reads this file and nothing is removed because of it. '
                      'Patrick approves the names first.',
        'columns': {
            'traders': 'a member at rank 0 or above of a faction with the vendor flag and a buy '
                       'and sell list, which is a vendor in the game\'s own terms. "because" '
                       'names that faction.',
            'transport': 'a member of a carriage or ferry faction, or Gjalund Salt-Sage, the '
                         'Solstheim ferry, who is in none.',
            'guards': 'a town\'s GuardFaction, IsGuardFaction together with GuardDialogueFaction, '
                      'or Raven Rock\'s guard. A count by name, for entry 321.',
            'everyoneElse': 'every other person, a count by name.',
            'offAtStart': 'traders and transport that start switched off, by their own flag or '
                          'by an enable parent, so nobody is standing there. Listed so a name '
                          'is never lost without a trace. offAtStartBy counts every column.',
            'unique': 'the record carries the unique flag: a person with a name of their own '
                      'rather than one of a crowd.',
            'holdFrom': 'how the hold was worked out: its own location, the cell it stands in, '
                        'the ground it stands on, the nearest named place within six cells, or '
                        'whose law it answers to. "nothing placed it" is the no hold column.',
            'sellers': 'every vendor faction behind a trader standing in the world, and how many '
                       'traders it makes. A mod that set the vendor flag on a crowd shows here.',
        },
        'counts': c,
        'holdFrom': got['how'],
        'sellers': got['sellers'],
        'holds': holds,
    }
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(payload, indent=1, sort_keys=True, ensure_ascii=False) + '\n')
    say('')
    say('  wrote %s (%s bytes)' % (args.out, f(os.path.getsize(args.out))))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except own_plugins.Unreadable as exc:
        # Every plugin is read before anything is written.
        print('STOP. %s. Nothing was written.' % exc)
        sys.exit(1)
