"""
Build-CrimeTable.py

Reads every faction in the load order and writes down each one that tracks
crime, so the front plugin can tell all of them that no crime adds a bounty.
Reads every script in the load order as well, and writes down each one that
adds a bounty itself or reports a crime, with whether it can run here.

WHY

Patrick, 11 October, on #502: "there should be no bounties at all added when
killing NPCs". Then on 12 October, the same issue: no bounty for anything,
killing, attacking, theft, pickpocketing or trespass, "the whole bounty system
should be removed in its entirety".

Nothing Thornswood wrote adds a bounty: no line of the gamemode, the plugins or
the fork's server calls ModCrimeGold or SetCrimeGold. The bounty is Skyrim's
own crime system, running in each person's game. When somebody commits a crime
against a member of a faction that tracks crime (or against something that
faction owns), the game adds that faction's gold for the crime to that
faction's bounty: murder, assault, trespass, pickpocketing, theft (the item's
value times the faction's multiplier), escaping jail, and being seen to turn
into a werewolf. A faction on "Use Defaults" takes its amounts from the
engine's settings; the rest carry their own, CrimeFactionReach among them, so
zeroing settings would leave some in place. The answer is on each faction: the
ignore flags, which tell the game that a crime of that kind against a member
is not a crime against that faction at all. There are six (murder, assault,
stealing, trespass, pickpocket, werewolf). game/plugins/thornswood-front.js
sets all six on every faction this lists, when a game is loaded.

ESCAPE has no ignore flag. The game adds it only when somebody it has jailed
leaves before serving the time, and the game jails nobody here: no NPC guard is
placed (game/data/npc-population.json cuts every one, "law belongs to people"),
and the scripts that send somebody to jail are read below.

THE SCRIPTS. A script can add a bounty without any crime being seen
(ModCrimeGold, SetCrimeGold), send somebody to jail (SendPlayerToJail), or
report a crime (SendAssaultAlarm, SendStealAlarm). This reads every .pex the
load order carries, the archives too, finds each that calls one of those, and
asks scripts\\dev\\Audit-PapyrusEvents.py which of them has an event that can
fire under Thornswood. A report only reaches a faction that now ignores it. A
direct add or a jailing would not care about the flags, so the json says, for
each, why it cannot run: no event of it fires on anybody's machine, or it is a
quest, scene or dialogue fragment, and no Papyrus quest runs under SkyMP
(docs/systems/quests.md).

WHAT IT READS. Nothing but the plugins and their scripts: the five masters,
then the plugins plugins.txt marks active (a line starting with *), in load
order, last one wins. A line without * is a plugin that is installed and
switched off, which the game does not load, so it is not read either. A
folder with no script in it at all stops it (#3105): the scripts are in the
archives, and a folder without them would say none of them can run. So
does a folder that lacks a script the load order attaches, unless
records\\papyrus-missing.json lists it as missing on a game PC too.

WHAT IT WRITES. game\\data\\crime-factions.json, every faction that tracks
crime with its flags, its amounts and the plugin whose record won, and the
scripts that touch a bounty; and the NO_BOUNTY_FACTIONS block in
game\\plugins\\thornswood-front.js, the form ids the plugin flags.

Read only apart from those two files. --check writes nothing, and with --json
writes the same reading to another file, which is how
game\\tests\\test-502-no-bounty.js reads the load order on a machine that has one.

Usage:
    python scripts/dev/Build-CrimeTable.py --check
    python scripts/dev/Build-CrimeTable.py
"""

import argparse
import importlib.util
import io
import json
import os
import struct
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import own_plugins  # noqa: E402


def _load(name, file):
    # Both have a hyphen in their names, so they are loaded by path.
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Build-DoorTable.py already reads a plugin: the header, the master list, a
# form id as <hex>:<plugin>, compressed records.
dt = _load('door_table', 'Build-DoorTable.py')
# Audit-PapyrusEvents.py reads the scripts and says which can run.
ape = _load('papyrus_audit', 'Audit-PapyrusEvents.py')

# FACT DATA flags, as the record and SKSE's SetFactionFlag both number them.
TRACK_CRIME = 0x40
USE_DEFAULTS = 0x1000
IGNORE = [
    ('murder', 0x80),
    ('assault', 0x100),
    ('stealing', 0x200),
    ('trespass', 0x400),
    ('pickpocket', 0x2000),
    ('werewolf', 0x10000),
]
IGNORE_ALL = 0
for _n, _f in IGNORE:
    IGNORE_ALL |= _f

# What a faction on Use Defaults is charged, from the game settings. The ones
# Skyrim.esm does not carry are the engine's own values, and they are the same
# numbers every hold's crime faction carries in its own record (measured
# 12 October: 1000, 40, 5, 25, 0.5, 100, 1000), so a load order that sets
# none of them charges these.
SETTINGS = [
    ('murder', 'iCrimeGoldMurder', 1000),
    ('assault', 'iCrimeGoldAttack', 40),
    ('trespass', 'iCrimeGoldTrespass', 5),
    ('pickpocket', 'iCrimeGoldPickpocket', 25),
    ('steal', 'fCrimeGoldSteal', 0.5),
    ('escape', 'iCrimeGoldEscape', 100),
    ('werewolf', 'iCrimeGoldWerewolf', 1000),
]

# Script natives that touch a bounty. ADDS puts gold on a faction or jails
# somebody whatever the faction's flags say; REPORTS raises an alarm, which is
# a crime against the faction the flags then ignore; PAYS takes gold off.
ADDS = {'modcrimegold', 'setcrimegold', 'setcrimegoldviolent', 'sendplayertojail'}
REPORTS = {'sendassaultalarm', 'sendstealalarm', 'sendtrespassalarm'}
PAYS = {'playerpaycrimegold', 'paycrimegold'}
FRAGMENT_PREFIXES = (('qf_', 'quest'), ('tif_', 'dialogue line'), ('sf_', 'scene'),
                     ('pf_', 'package'), ('prkf_', 'perk'))


def top_groups(pl, want):
    """Each record in the top groups named in want, as (tag, flags, fid, offset, size)."""
    buf = pl.buf
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]
    p = 24 + pl.header
    while p + 24 <= len(buf):
        size = u32(p + 4)
        if buf[p:p + 4] != b'GRUP':
            break
        if buf[p + 8:p + 12] in want:
            q = p + 24
            while q + 24 <= p + size:
                tag = buf[q:q + 4]
                rs = u32(q + 4)
                if tag == b'GRUP':
                    q += rs
                    continue
                flags, fid = struct.unpack_from('<II', buf, q + 8)
                yield tag, flags, fid, q, rs
                q += 24 + rs
        p += size


def crva(body):
    """CRVA: arrest and attack on sight as bytes, then murder, assault,
    trespass and pickpocket as 16 bit amounts, two unused bytes, the steal
    multiplier as a float, then escape and werewolf. Older records stop
    early, and what they do not carry is 0."""
    out = {'murder': 0, 'assault': 0, 'trespass': 0, 'pickpocket': 0,
           'steal': 0.0, 'escape': 0, 'werewolf': 0}
    if len(body) >= 10:
        out['murder'], out['assault'], out['trespass'], out['pickpocket'] = \
            struct.unpack_from('<HHHH', body, 2)
    if len(body) >= 16:
        out['steal'] = round(struct.unpack_from('<f', body, 12)[0], 4)
    if len(body) >= 20:
        out['escape'], out['werewolf'] = struct.unpack_from('<HH', body, 16)
    return out


def read(data, order):
    factions, settings = {}, {}
    names = set(s[1] for s in SETTINGS)
    for name in order:
        pl = dt.Plugin(own_plugins.plugin_path(data, name), name)
        for tag, flags, fid, q, rs in top_groups(pl, (b'FACT', b'GMST')):
            pairs = dt.subrecords(pl.data(q, rs, flags))
            if tag == b'GMST':
                edid, body = '', None
                for st, b in pairs:
                    if st == b'EDID':
                        edid = b.rstrip(bytes([0])).decode('ascii', 'replace')
                    elif st == b'DATA' and len(b) >= 4:
                        body = b
                if edid in names and body is not None:
                    v = struct.unpack_from('<f' if edid[0] == 'f' else '<i', body, 0)[0]
                    settings[edid] = {'value': round(v, 4) if edid[0] == 'f' else v, 'from': name}
                continue
            d = pl.desc(fid)
            if not d:
                continue
            row = {'from': name, 'edid': '', 'flags': 0, 'own': crva(b'')}
            for st, body in pairs:
                if st == b'EDID':
                    row['edid'] = body.rstrip(bytes([0])).decode('ascii', 'replace')
                elif st == b'DATA' and len(body) >= 4:
                    row['flags'] = struct.unpack_from('<I', body, 0)[0]
                elif st == b'CRVA':
                    row['own'] = crva(body)
            factions[d] = row
    return factions, settings


def charges(row, defaults):
    """What each crime costs in this faction, and which crimes it does not
    already ignore."""
    f = row['flags']
    amounts = dict(defaults) if f & USE_DEFAULTS else dict(row['own'])
    lacks = [n for n, flag in IGNORE if not (f & flag)]
    return amounts, lacks


def read_scripts(data, plugins_txt):
    """Every script that calls a native touching a bounty, and whether it can
    run under Thornswood, by Audit-PapyrusEvents.py's own reading."""
    rule = ape.load_rule(ape.RECORD)
    stats = defaultdict(int)
    stats['unreadable archives'] = []
    order, _missing = ape.load_order(data, plugins_txt)
    index = ape.script_index(data, order, stats)
    parsed = ape.Scripts(index)
    callers = {}
    for key, pex in parsed.parsed.items():
        hit = set()
        for fn in pex['functions'].values():
            hit |= (fn['outside'] | fn['calls']) & (ADDS | REPORTS | PAYS)
        if hit:
            callers[key] = {'name': pex['name'], 'natives': sorted(hit), 'source': index[key][0]}
    result = ape.audit(data, plugins_txt, rule)
    attached, alive, stuck = defaultdict(set), defaultdict(set), set()
    for p in result['plugins']:
        for sname, sc in p.get('scripts', {}).items():
            k = sname.lower()
            if k not in callers:
                continue
            attached[k].add(p['plugin'])
            if sc.get('timerNeverStarts'):
                stuck.add(k)
            elif sc.get('alive'):
                alive[k].update(sc['alive'])
    rows = {}
    for k, c in callers.items():
        kind = ''
        for prefix, what in FRAGMENT_PREFIXES:
            if k.startswith(prefix) or ('_' + prefix) in k[:12]:
                kind = what
                break
        row = {'natives': c['natives'], 'source': c['source'],
               'attachedBy': sorted(attached.get(k, [])),
               'canFire': sorted(alive.get(k, []))}
        if kind:
            row['fragmentOf'] = kind
        if row['canFire']:
            row['why'] = 'runs on ' + ', '.join(row['canFire']) + ' on the machine of whoever it is on'
        elif kind:
            row['why'] = "a fragment of a quest's %s, and no Papyrus quest runs under SkyMP" % (
                'stages' if kind == 'quest' else kind)
        elif k in stuck:
            row['why'] = 'it waits on a timer, and every event that would start the timer is blocked'
        elif row['attachedBy']:
            row['why'] = 'every event it waits on is blocked'
        else:
            row['why'] = 'no record in the load order carries it'
        rows[c['name']] = row
    missing = set((p['plugin'], n) for p in result['plugins'] for n in p.get('missingScripts', []))
    return {'read': len(parsed.parsed), 'unreadable': len(parsed.bad),
            'rule': 'records/papyrus-events.json at ' + str(rule.read_at), 'scripts': rows}, missing


def known_missing(path):
    """(plugin, script) pairs, in lower case, that records/papyrus-missing.json
    says the load order attaches and no archive or loose file carries."""
    with io.open(path, encoding='utf-8') as fh:
        rec = json.load(fh)
    return set((p.lower(), n.lower()) for p, names in rec['missing'].items() for n in names)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default=r'C:\Thornswood\Profile\Default\plugins.txt')
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'game', 'data', 'crime-factions.json'))
    ap.add_argument('--front', default=os.path.join(HERE, '..', '..', 'game', 'plugins', 'thornswood-front.js'))
    ap.add_argument('--check', action='store_true', help='say what it found, write nothing')
    ap.add_argument('--json', help='with --check: write the reading here instead')
    ap.add_argument('--no-scripts', action='store_true', help='read the factions only')
    ap.add_argument('--known-missing', default=os.path.join(HERE, '..', '..', 'records', 'papyrus-missing.json'),
                    help='the scripts the load order attaches and does not carry, as measured on a game PC')
    args = ap.parse_args()

    if not os.path.isfile(args.plugins) or not os.path.isdir(args.data):
        print('STOP. no load order here: %s, %s' % (args.plugins, args.data))
        return 1
    order = own_plugins.load_order(args.plugins)
    missing = [n for n in order if not os.path.isfile(own_plugins.plugin_path(args.data, n))]
    if missing:
        print('STOP. %d active plugin(s) are not in %s: %s'
              % (len(missing), args.data, ', '.join(missing[:6])))
        return 1
    print('The load order')
    print('  %d active plugins, the five masters then %s' % (len(order), args.plugins))

    factions, settings = read(args.data, order)
    defaults = {}
    for key, gmst, value in SETTINGS:
        defaults[key] = settings.get(gmst, {}).get('value', value)
    print('')
    print('What a faction on Use Defaults is charged')
    print('  ' + ', '.join('%s %s' % (k, defaults[k]) for k, _g, _v in SETTINGS))

    listed = {}
    for d, r in factions.items():
        if not (r['flags'] & TRACK_CRIME):
            continue
        amounts, lacks = charges(r, defaults)
        listed[d] = {'edid': r['edid'], 'from': r['from'], 'flags': '0x%x' % r['flags'],
                     'useDefaults': bool(r['flags'] & USE_DEFAULTS),
                     'charges': amounts, 'lacks': lacks}

    print('')
    print('Factions')
    print('  %d faction record(s), %d of them track crime, and all of those are listed' % (len(factions), len(listed)))
    flag_of = {'steal': 'stealing'}
    costly = [d for d in listed if any(v > 0 and flag_of.get(k, k) in listed[d]['lacks']
                                       for k, v in listed[d]['charges'].items())]
    print('  %d of them would put a bounty on some crime today:' % len(costly))
    for d in sorted(costly, key=lambda k: listed[k]['edid'].lower()):
        r = listed[d]
        print('    %-34s %-26s does not yet ignore: %s' % (r['edid'], d, ', '.join(r['lacks'])))

    scripts = None
    if not args.no_scripts:
        print('')
        print('Scripts (Audit-PapyrusEvents.py reads every script; this takes a minute)')
        try:
            scripts, missing = read_scripts(args.data, args.plugins)
        except ape.NoScripts as exc:
            print('STOP. %s' % exc)
            return 1
        known = known_missing(args.known_missing)
        lacks = sorted((p, n) for p, n in missing if (p.lower(), n.lower()) not in known)
        if lacks:
            # A folder that carries some scripts and not others (the box with
            # Skyrim - Misc.bsa and none of the mods' archives, #3105) would
            # call every script it lacks one that cannot run.
            print('STOP. %d script(s) the load order attaches are not in %s, and %s does not list them: %s'
                  % (len(lacks), args.data, os.path.basename(args.known_missing),
                     ', '.join('%s %s' % pn for pn in lacks[:12]) + (' and %d more' % (len(lacks) - 12) if len(lacks) > 12 else '')))
            return 1
        found = len(known) - len(set((p.lower(), n.lower()) for p, n in missing) & known)
        if found:
            print('  %d script(s) %s lists as missing are here now; take them out of it'
                  % (found, os.path.basename(args.known_missing)))
        rows = scripts['scripts']
        adds = [n for n in rows if set(rows[n]['natives']) & ADDS]
        live_adds = [n for n in adds if rows[n]['canFire']]
        live = [n for n in rows if rows[n]['canFire']]
        print('  %d scripts read, %d call a native that touches a bounty' % (scripts['read'], len(rows)))
        print('  %d of them add gold or jail somebody; %d of those can run here' % (len(adds), len(live_adds)))
        for n in sorted(live):
            print('    can run: %-34s %s (%s)' % (n, ', '.join(rows[n]['natives']), rows[n]['why']))

    payload = {
        'builtBy': 'scripts/dev/Build-CrimeTable.py',
        'readFrom': own_plugins.load_order_name(order),
        'whatIsListed': 'every faction that tracks crime. The front plugin sets all six ignore flags on '
                        'each (murder, assault, stealing, trespass, pickpocket, werewolf), so no crime '
                        'adds a bounty. charges is what each crime costs there by the record (the game '
                        'settings for a faction on Use Defaults); lacks is the ignore flags the record '
                        'does not already set.',
        'ignoreFlags': dict((n, '0x%x' % f) for n, f in IGNORE),
        'escape': 'no ignore flag. The game adds it only when somebody it jailed leaves early, and it '
                  'jails nobody here: no NPC guard is placed, and the scripts that send somebody to '
                  'jail are under scripts, none of which can run.',
        'settings': defaults,
        'factions': listed,
    }
    if scripts is not None:
        payload['scripts'] = scripts

    if args.check:
        if args.json:
            io.open(args.json, 'w', encoding='utf-8', newline='\n').write(
                json.dumps(payload, indent=1, sort_keys=True) + '\n')
            print('')
            print('  --check, so only %s was written.' % args.json)
        else:
            print('')
            print('  --check, so nothing was written.')
        return 0

    if scripts is None:
        print('STOP. the json carries the scripts too, so write it without --no-scripts.')
        return 1
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(payload, indent=1, sort_keys=True) + '\n')
    print('')
    print('  wrote %s' % args.out)

    rows = []
    for d in sorted(listed, key=lambda k: (listed[k]['edid'].lower(), k)):
        local, plugin = d.split(':', 1)
        rows.append('    [0x%s, %s, %s],' % (local, json.dumps(plugin), json.dumps(listed[d]['edid'])))
    text = io.open(args.front, encoding='utf-8', newline='').read()
    mark = 'NO_BOUNTY_FACTIONS'
    a = text.find('// ==== %s, generated ====' % mark)
    b = text.find('// ==== end %s ====' % mark)
    if a < 0 or b < 0 or b < a:
        print('  no %s block in the front plugin, so it was not written' % mark)
        return 1
    lines = ['// ==== %s, generated ====' % mark,
             '  // One row a faction: its form id in its plugin, the plugin, its editor id.',
             '  // Generated by scripts\\dev\\Build-CrimeTable.py; do not hand edit.',
             '  const NO_BOUNTY_FACTIONS = ['] + rows + ['  ];']
    text = text[:a] + '\n'.join(lines) + '\n' + '  ' + text[b:]
    io.open(args.front, 'w', encoding='utf-8', newline='').write(text)
    print('  wrote %s into the front plugin' % mark)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except own_plugins.Unreadable as exc:
        # Every plugin is read before anything is written.
        print('STOP. %s. Nothing was written.' % exc)
        sys.exit(1)
