#!/usr/bin/env python3
"""
Audit-PapyrusEvents.py

Which scripts in the load order can still do anything under Thornswood, and
which mods are only their records.

WHY IT EXISTS

On 20 September Patrick reported that "a lot of the mods in our list are just
straight up not present in the game". It is not the load order: every plugin
loads, and the ones that look missing are light plugins the load order file
cannot see (entry 168). They are loaded and doing nothing, because the client
blocks Papyrus events, and from a chair that is indistinguishable from not
being installed. Entry 323 asks for a decision per event, which ones the server
could allow, and for the mods that only work through blocked events to come
out of the collection. Neither can be decided without knowing which events the
collection's scripts wait on, and nothing in this repo had ever read a .pex.
This does.

THE RULE is the fork's, and it is records\\papyrus-events.json, which
scripts\\dev\\PapyrusEventList.js reads out of the fork and
game\\tests\\test-papyrus-event-list.js holds to the fork at its pin (issue #503).
This keeps no copy of it. A script fires only where both halves let it:

  On each person's machine. skymp5-client turns the blocker on, and
  skyrim-platform's FridaHooks.cpp (OnSendEventEnter) blanks every event name
  but the ones the record lets through (OnUpdate at 1afaf2ef), unless a script
  on the same object carries one of the exempt names (SKI_ something, compared
  with case, and defaultDisableHavokOnLoad, without). A script that runs there
  runs on that one machine.

  On the server. Its own Papyrus machine attaches a script only to a placed
  reference (the reference's record and its base record), only when its
  storage holds the script (the built in scripts, data\\scripts and any
  archive the "archives" setting names) and nothing drops it by name, and
  sends it only the event names the record lists. Quests, aliases, dialogue,
  packages, perks, scenes and magic effects get nothing there. One rule this
  does not apply, and the report says so: with disableVanillaScriptsInExterior
  on, a reference below 05000000 in an exterior keeps only Sweet* scripts.

Each plugin gets a verdict on each half ("status" for the machine, "server"
for the server), and "firesNowhere" when it has scripts and neither half runs
any of them.

WHAT COUNTS AS AN EVENT. A .pex does not mark an event as different from a
function, so this takes the game's own word for it. A native script declares
the events native code will send it as empty functions: Form.pex declares
OnUpdate and OnMenuOpen, ObjectReference.pex OnActivate, PO3_Events_Form.pex
OnQuestStageChange. So every empty, non-native, non-global function in a
script that has native functions is an event name. Add OnInit, which the VM
sends to every script and no script declares, and every callback a script
names in RegisterForModEvent. Leave out onBeginState and onEndState: every
compiled script carries them and GotoState calls them, so they start nothing.
Anything else a script calls OnSomething, SkyUI's OnPageReset for one, is an
ordinary function called by another script, and this hook does not touch it.

A script handles an event when it, or a script it extends, has a body for it
in any state. The nearest definition wins, so a child that declares an event
empty has switched its parent's off.

A TIMER HAS TO BE STARTED. OnUpdate only arrives after RegisterForUpdate or
RegisterForSingleUpdate. For every script that handles OnUpdate this follows
the script's calls to itself from each event and lists the events that reach a
registration. The timer is counted as never starting, rather than as working,
only when all three hold: every event that reaches a registration is blocked;
no script anywhere calls in, by name, to a function on the way to one; and
nothing else the plugin attaches registers a timer on another object, the way
QuickLootIE's load alias starts its maintenance quest. Anything less certain
than that is counted as able to run.

WHAT IT READS. The five masters and plugins.txt, masters first as the engine
sorts them. The VMAD of every record in every plugin: the scripts on each
record and on each quest alias, and the fragment script on quests, dialogue,
scenes, packages and perks. The last plugin to define a record decides its
scripts, and a script is credited to the plugin that first put it there, so a
patch carrying a vanilla script forward does not make it the patch's. Scripts
come from Data\\Scripts first, then from the archives, a later one winning, as
the game reads them. A folder with no script archive of its own (the run's
data folder on the box) may hold the script pack instead,
papyrus-scripts.zip, which scripts\\mods\\New-ScriptPack.py makes on a PC
with the game: each archive's scripts under its own name and the loose ones,
read here as if those archives and Data\\Scripts were there (#3105).

WHAT IT DOES NOT KNOW, and says so rather than guess.
  Fragments. Quest stage, dialogue, scene, package and perk fragments are
  functions the engine calls by name, Fragment_0 and on, not events. Whether
  that call passes through the hook has not been checked, so they are counted
  and not judged.
  Whether a given event reaches SendEvent at all. The rule above blanks what
  passes through it. Nothing here was measured in the game.
  A placed reference and its base object are one object in the game, so a
  defaultDisableHavokOnLoad on a reference unblocks its base's scripts there.
  This judges each record and alias on its own.
  A timer another script starts, by calling into this one or registering it.
  An archive named after no plugin is counted as loaded, which is right for
  the Skyrim - ones the ini lists and may be wrong for a stray one.

Read only. It writes nothing unless --json names a file.

  python scripts/dev/Audit-PapyrusEvents.py
  python scripts/dev/Audit-PapyrusEvents.py --json papyrus-events.json
  python scripts/dev/Audit-PapyrusEvents.py --data D:\\Game\\Data --plugins D:\\plugins.txt
"""

import argparse
import io
import json
import os
import struct
import sys
import textwrap
import zipfile
import zlib
from collections import defaultdict

import bsa
import own_plugins

MASTERS = own_plugins.MASTERS

# The fork's event list, both halves, is records\papyrus-events.json, which
# scripts\dev\PapyrusEventList.js reads out of the fork and
# game\tests\test-papyrus-event-list.js holds to the fork at the pin (#503). This
# keeps no copy of it.
RECORD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'records', 'papyrus-events.json')

# The game's own timer event, which only arrives after a registration. This is
# how Papyrus works, not part of the fork's list.
TIMER_EVENT = 'onupdate'

# Records the server never attaches a script to: it attaches only to a placed
# reference, from the reference's record and its base record (the record's
# attachesTo, "references"). Quests and their aliases, dialogue, packages,
# perks, scenes and magic effects are not references or the base of one.
NOT_ON_A_REFERENCE = {'QUST', 'INFO', 'PACK', 'PERK', 'SCEN', 'MGEF'}

IMPLICIT_EVENTS = {'oninit': 'OnInit'}
NOT_EVENTS = {'onbeginstate', 'onendstate'}
TIMER_CALLS = {'registerforupdate', 'registerforsingleupdate'}
MOD_EVENT_CALL = 'registerformodevent'

FLAG_MASTER = 0x00000001
COMPRESSED = 0x00040000
# Never scripted, and the bulk of the compressed records in the masters.
UNSCRIPTED = {b'LAND', b'NAVM', b'NAVI'}
FRAGMENT_TYPES = {b'INFO', b'PACK', b'PERK', b'QUST', b'SCEN'}

# How many operands each Skyrim Papyrus opcode takes, by opcode. The three calls
# (callmethod, callparent, callstatic) take a counted list of arguments after.
OPERANDS = [0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3,
            1, 2, 2, 3, 2, 3, 1, 3, 3, 3, 2, 2, 3, 3, 4, 4]
CALLMETHOD, CALLPARENT, CALLSTATIC = 0x17, 0x18, 0x19
PEX_MAGIC = 0xFA57C0DE

STATUS_ORDER = ['works', 'partial', 'timer never starts', 'dead',
                'fragments only', 'no events', 'records only']
SERVER_ORDER = ['fires', 'loaded, never sent', 'not loaded', 'not on a reference', 'records only']


class Rule(object):
    """The fork's list out of the record, in the shape the audit asks it."""

    def __init__(self, record):
        c, s = record['client'], record['server']
        loads = s['loads']
        if s.get('attachesTo') != 'references':
            raise ValueError('the record says the server attaches scripts to %r, and this only knows references'
                             % s.get('attachesTo'))
        self.read_at = record.get('readAt', '')
        self.blocker_on = bool(c['blockerOn'])
        self.lets_through = {n.lower() for n in c['letsThrough']}
        self.exempt_prefixes = list(c['exemptPrefixes'])
        self.prefix_keeps_case = c['exemptPrefixCase'] == 'kept'
        self.exempt_names = list(c['exemptNames'])
        self.names_ignore_case = c['exemptNameCase'] == 'ignored'
        self.sends = {n.lower(): n for n in s['sends']}
        self.server_scripts = {n.lower() for n in loads['builtIn'] + loads['dataScripts']}
        self.archives = list(loads.get('archives') or [])
        self.drops = {n.lower() for n in s.get('dropsByName') or []}
        self.exterior = s.get('exterior') or {}
        self.record = record

    def passes(self, event_key):
        """Whether the client lets this event (lower case) through."""
        return not self.blocker_on or event_key in self.lets_through

    def frees(self, real_name):
        """Whether a script of this name on an object frees every event there."""
        for p in self.exempt_prefixes:
            if real_name.startswith(p) if self.prefix_keeps_case else real_name.lower().startswith(p.lower()):
                return True
        for n in self.exempt_names:
            if (real_name.lower() == n.lower()) if self.names_ignore_case else real_name == n:
                return True
        return False


def load_rule(path):
    with io.open(path, encoding='utf-8') as fh:
        return Rule(json.load(fh))


# ---------------------------------------------------------------------------
# .pex

class Pex(object):
    """A reader over one big endian .pex."""

    def __init__(self, data):
        self.b, self.p = data, 0

    def u8(self):
        v = self.b[self.p]
        self.p += 1
        return v

    def u16(self):
        v = struct.unpack_from('>H', self.b, self.p)[0]
        self.p += 2
        return v

    def u32(self):
        v = struct.unpack_from('>I', self.b, self.p)[0]
        self.p += 4
        return v

    def wstr(self):
        n = self.u16()
        s = self.b[self.p:self.p + n]
        self.p += n
        return s.decode('latin-1')

    def value(self):
        """One operand: (type, payload). Identifiers and strings are indexes
        into the string table, 1 and 2; the rest are skipped."""
        t = self.u8()
        if t == 0:
            return 0, None
        if t in (1, 2):
            return t, self.u16()
        if t == 3:
            v = struct.unpack_from('>i', self.b, self.p)[0]
            self.p += 4
            return 3, v
        if t == 4:
            self.p += 4
            return 4, None
        if t == 5:
            self.p += 1
            return 5, None
        raise ValueError('operand type %d at %d' % (t, self.p - 1))


def _function(r, names):
    """One function: its flags, whether it has a body, the functions of its own
    script it calls, the methods it calls on anything else, whether it starts a
    timer on itself, and the mod event callbacks it registers."""
    r.u16()
    r.u16()
    r.u32()
    flags = r.u8()
    for _ in range(r.u16()):
        r.u16()
        r.u16()
    for _ in range(r.u16()):
        r.u16()
        r.u16()
    count = r.u16()
    calls, outside, timer, callbacks = set(), set(), False, set()
    for _ in range(count):
        op = r.u8()
        if op >= len(OPERANDS):
            raise ValueError('opcode %d' % op)
        args = [r.value() for _ in range(OPERANDS[op])]
        if op in (CALLMETHOD, CALLPARENT, CALLSTATIC):
            t, n = r.value()
            if t != 3:
                raise ValueError('call without an argument count')
            args += [r.value() for _ in range(n)]
        if op == CALLMETHOD:
            method = names[args[0][1]].lower()
            on_self = args[1][0] == 1 and names[args[1][1]].lower() == 'self'
            if on_self:
                calls.add(method)
                if method in TIMER_CALLS:
                    timer = True
            else:
                outside.add(method)
            if method == MOD_EVENT_CALL and len(args) >= 5 and args[4][0] == 2:
                callbacks.add(names[args[4][1]])
        elif op == CALLPARENT:
            calls.add(names[args[0][1]].lower())
    return {'flags': flags, 'body': count > 0, 'calls': calls, 'outside': outside,
            'timer': timer, 'callbacks': callbacks}


def parse_pex(data):
    """The first object in a .pex: its name, the script it extends, whether it
    has native functions, and its functions merged across states."""
    r = Pex(data)
    if r.u32() != PEX_MAGIC:
        raise ValueError('not a .pex')
    r.u8()
    r.u8()
    r.u16()
    r.p += 8
    r.wstr()
    r.wstr()
    r.wstr()
    names = [r.wstr() for _ in range(r.u16())]
    if r.u8():
        r.p += 8
        for _ in range(r.u16()):
            r.p += 7
            lines = r.u16()
            r.p += 2 * lines
    for _ in range(r.u16()):
        r.u16()
        r.u8()
    objects = r.u16()
    if objects < 1:
        raise ValueError('no object')
    name = names[r.u16()]
    # The object's size field is not trusted. Measured 24 September, the four
    # QuickLootIE scripts, built by Caprica, carry sizes in the billions and the
    # game loads them anyway. Reading to the end of the file exactly is the
    # check instead.
    r.u32()
    parent = names[r.u16()]
    r.u16()
    r.u32()
    r.u16()
    for _ in range(r.u16()):
        r.u16()
        r.u16()
        r.u32()
        r.value()
    for _ in range(r.u16()):
        r.u16()
        r.u16()
        r.u16()
        r.u32()
        f = r.u8()
        if f & 4:
            r.u16()
        else:
            if f & 5 == 1:
                _function(r, names)
            if f & 6 == 2:
                _function(r, names)
    functions = {}
    for _ in range(r.u16()):
        state = names[r.u16()]
        for _ in range(r.u16()):
            fname = names[r.u16()]
            fn = _function(r, names)
            key = fname.lower()
            had = functions.get(key)
            if had is None:
                functions[key] = dict(fn, name=fname, declared=(state == '' and not fn['body']))
            else:
                had['body'] = had['body'] or fn['body']
                had['calls'] |= fn['calls']
                had['outside'] |= fn['outside']
                had['timer'] = had['timer'] or fn['timer']
                had['callbacks'] |= fn['callbacks']
                if state == '':
                    had['declared'] = not fn['body']
                    had['flags'] = fn['flags']
    if objects == 1 and r.p != len(data):
        raise ValueError('read to %d of %d bytes' % (r.p, len(data)))
    native = any(f['flags'] & 2 for f in functions.values())
    return {'name': name, 'parent': parent, 'native': native, 'functions': functions}


# ---------------------------------------------------------------------------
# Plugins

def _wstr(data, p):
    n = struct.unpack_from('<H', data, p)[0]
    return data[p + 2:p + 2 + n].decode('latin-1'), p + 2 + n


def _scripts(data, p, version, count):
    """The script list of a VMAD, or of one quest alias: names in order."""
    out = []
    for _ in range(count):
        name, p = _wstr(data, p)
        if version >= 4:
            p += 1
        props = struct.unpack_from('<H', data, p)[0]
        p += 2
        for _ in range(props):
            _pname, p = _wstr(data, p)
            kind = data[p]
            p += 1
            if version >= 4:
                p += 1
            if kind == 1:
                p += 8
            elif kind == 2:
                _s, p = _wstr(data, p)
            elif kind in (3, 4):
                p += 4
            elif kind == 5:
                p += 1
            elif kind in (11, 12, 13, 14, 15):
                n = struct.unpack_from('<I', data, p)[0]
                p += 4
                if kind == 11:
                    p += 8 * n
                elif kind == 12:
                    for _ in range(n):
                        _s, p = _wstr(data, p)
                elif kind in (13, 14):
                    p += 4 * n
                else:
                    p += n
            else:
                raise ValueError('property type %d' % kind)
        out.append(name)
    return out, p


def read_vmad(sig, data):
    """(scripts, {alias id: scripts}, fragment script or None) out of one VMAD.

    Only a quest has anything after its fragments, its aliases, so only a
    quest's fragments are read in full. The others stop at the fragment file
    name, which is all this needs from them.
    """
    version, fmt, count = struct.unpack_from('<hhH', data, 0)
    scripts, p = _scripts(data, 6, version, count)
    aliases, fragment = {}, None
    if sig not in FRAGMENT_TYPES or p >= len(data):
        return scripts, aliases, fragment
    if sig == b'QUST':
        p += 1
        frags = struct.unpack_from('<H', data, p)[0]
        p += 2
        fragment, p = _wstr(data, p)
        for _ in range(frags):
            p += 9
            _s, p = _wstr(data, p)
            _s, p = _wstr(data, p)
        n = struct.unpack_from('<H', data, p)[0]
        p += 2
        for _ in range(n):
            if fmt == 1:
                alias = struct.unpack_from('<h', data, p + 4)[0]
            else:
                alias = struct.unpack_from('<h', data, p + 2)[0]
            p += 8
            aversion, _afmt, acount = struct.unpack_from('<hhH', data, p)
            p += 6
            names, p = _scripts(data, p, aversion, acount)
            aliases[alias] = names
        if p != len(data):
            raise ValueError('quest VMAD read to %d of %d bytes' % (p, len(data)))
    elif sig == b'PERK':
        fragment, p = _wstr(data, p + 1)
    else:
        fragment, p = _wstr(data, p + 2)
    return scripts, aliases, (fragment or None)


def plugin_header(buf):
    """(flags, masters in lower case, where the records start)."""
    if buf[:4] != b'TES4':
        raise ValueError('not a plugin')
    size, flags = struct.unpack_from('<II', buf, 4)
    masters, p, end = [], 24, 24 + size
    while p + 6 <= end:
        sig = buf[p:p + 4]
        n = struct.unpack_from('<H', buf, p + 4)[0]
        if sig == b'MAST':
            masters.append(buf[p + 6:p + 6 + n].split(b'\0')[0].decode('latin-1').lower())
        p += 6 + n
    return flags, masters, end


def records(buf, start, masters, own, stats):
    """(record type, key, VMAD bytes or None) for every record in a plugin.

    Groups are walked into rather than over, since what is inside a group is
    just more records. The key is (plugin that made the form, form id), which is
    the same record however many plugins override it. VMAD always comes first
    or straight after EDID, so only those two are looked at. Measured 24
    September against a scan of every subrecord of every record in the 99
    plugins: 26,937 VMADs either way, none later than that, none on the types
    skipped here.
    """
    p, end, count = start, len(buf), len(masters)
    while p + 24 <= end:
        sig = buf[p:p + 4]
        size = struct.unpack_from('<I', buf, p + 4)[0]
        if sig == b'GRUP':
            p += 24
            continue
        flags, fid = struct.unpack_from('<II', buf, p + 8)
        body_at, p = p + 24, p + 24 + size
        if sig in UNSCRIPTED:
            continue
        idx = fid >> 24
        key = (masters[idx] if idx < count else own, fid & 0xFFFFFF)
        if flags & COMPRESSED:
            try:
                body = zlib.decompress(buf[body_at + 4:p])
            except zlib.error:
                stats['unreadable records'] += 1
                continue
            q, stop = 0, len(body)
        else:
            body, q, stop = buf, body_at, p
        vmad = None
        for _ in range(2):
            if q + 6 > stop:
                break
            tag = body[q:q + 4]
            n = struct.unpack_from('<H', body, q + 4)[0]
            if tag == b'VMAD':
                vmad = body[q + 6:q + 6 + n]
                break
            if tag != b'EDID':
                break
            q += 6 + n
        yield sig, key, vmad


def load_order(data_dir, plugins_txt):
    """The masters, then plugins.txt, with master flagged plugins first the way
    the engine sorts them. Returns (order, missing)."""
    listed = own_plugins.load_order(plugins_txt)
    first, rest, missing = [], [], []
    for name in listed:
        path = own_plugins.plugin_path(data_dir, name)
        if not os.path.isfile(path):
            missing.append(name)
            continue
        with open(path, 'rb') as fh:
            head = fh.read(12)
        flags = struct.unpack_from('<I', head, 8)[0] if len(head) == 12 else 0
        if flags & FLAG_MASTER or name.lower().endswith(('.esm', '.esl')):
            first.append(name)
        else:
            rest.append(name)
    return first + rest, missing


# ---------------------------------------------------------------------------
# Scripts

class NoScripts(Exception):
    """The data folder holds no script at all."""


# The script pack's name in a data folder, and its layout: archives/<archive
# file name>/<the file's path in the archive>, and loose/<name>.pex for the
# files of Data\\Scripts. scripts/mods/New-ScriptPack.py writes it.
SCRIPT_PACK = 'papyrus-scripts.zip'


def read_script_pack(path):
    """({archive file name: {path in the archive: bytes}}, {loose file name:
    bytes}) out of a script pack."""
    archives, loose = defaultdict(dict), {}
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            parts = info.filename.split('/')
            if parts[0] == 'archives' and len(parts) >= 4 and parts[1].lower().endswith('.bsa'):
                archives[parts[1]]['/'.join(parts[2:]).lower()] = z.read(info)
            elif parts[0] == 'loose' and len(parts) == 2 and parts[1]:
                loose[parts[1]] = z.read(info)
    return archives, loose


def script_index(data_dir, order, stats):
    """{script name in lower case: (where it came from, bytes)}, as the game
    would find it: archives in load order, a later one winning, then loose
    files over all of them. An archive or loose file that is in the folder
    itself is read from there; the script pack stands in for the ones that
    are not."""
    stems = [os.path.splitext(n)[0].lower() for n in order]

    def rank_of(archive):
        stem = archive[:-4].lower()
        rank = -1
        for i, s in enumerate(stems):
            if stem == s or stem.startswith(s + ' - '):
                rank = i
        return rank

    names = os.listdir(data_dir)
    here = set(n.lower() for n in names)
    ranked = []
    for archive in names:
        if archive.lower().endswith('.bsa'):
            ranked.append((rank_of(archive), archive.lower(), archive, None))
    packed, packed_loose = {}, {}
    pack = os.path.join(data_dir, SCRIPT_PACK)
    if os.path.isfile(pack):
        try:
            packed, packed_loose = read_script_pack(pack)
        except (zipfile.BadZipFile, OSError) as exc:
            stats['unreadable archives'].append('%s: %s' % (SCRIPT_PACK, exc))
        for archive in packed:
            if archive.lower() not in here:
                ranked.append((rank_of(archive), archive.lower(), archive, packed[archive]))
                stats['packed archives'] += 1
    index = {}
    for _rank, _low, archive, files in sorted(ranked, key=lambda r: (r[0], r[1])):
        if files is None:
            try:
                files = bsa.read(os.path.join(data_dir, archive), 'scripts')
            except (ValueError, struct.error, zlib.error, IndexError) as exc:
                stats['unreadable archives'].append('%s: %s' % (archive, exc))
                continue
        for path, data in files.items():
            if path.endswith('.pex'):
                index[path.split('/')[-1][:-4]] = (archive, data)
                stats['archive scripts'] += 1
    loose_files = dict(packed_loose)
    loose = os.path.join(data_dir, 'Scripts')
    if os.path.isdir(loose):
        for f in os.listdir(loose):
            if f.lower().endswith('.pex'):
                with open(os.path.join(loose, f), 'rb') as fh:
                    loose_files[f] = fh.read()
    for f in sorted(loose_files):
        if f.lower().endswith('.pex'):
            index[f[:-4].lower()] = ('Data\\Scripts', loose_files[f])
            stats['loose scripts'] += 1
    if not index:
        # A Skyrim load order always carries scripts (Skyrim - Misc.bsa alone
        # holds thousands), so none found means the folder lacks the archives
        # that hold them, and every reading made from it would be empty, not
        # safe (#3105: a box with the masters but no Misc archive read 0).
        unread = stats['unreadable archives']
        raise NoScripts('no script in %s: none of its archives holds a .pex and it has no Scripts folder%s'
                        % (data_dir, ('; could not read ' + '; '.join(unread)) if unread else ''))
    return index


class Scripts(object):
    """Every script parsed once, the event names the game declares, and what
    each script handles once its parents are counted in."""

    def __init__(self, index):
        self.index = index
        self.parsed, self.bad = {}, {}
        for name, (_src, data) in index.items():
            try:
                self.parsed[name] = parse_pex(data)
            except (ValueError, struct.error, IndexError, UnicodeDecodeError) as exc:
                self.bad[name] = str(exc)
        self.events = dict(IMPLICIT_EVENTS)
        self.declared_in = {k: 'the VM, to every script' for k in IMPLICIT_EVENTS}
        # Every method name any script calls on something other than itself.
        # A timer whose registration sits behind one of these could be started
        # by another script, so it is not called stuck.
        self.called_from_outside = set()
        for pex in self.parsed.values():
            for fn in pex['functions'].values():
                self.called_from_outside |= fn['outside']
            if not pex['native']:
                continue
            for key, fn in pex['functions'].items():
                if fn['declared'] and not fn['flags'] & 3 and key not in NOT_EVENTS:
                    self.events.setdefault(key, fn['name'])
                    self.declared_in.setdefault(key, pex['name'])
        self.cache = {}

    def chain(self, name):
        """The script and every script it extends that is here to read."""
        out, seen = [], set()
        key = name.lower()
        while key and key in self.parsed and key not in seen:
            seen.add(key)
            out.append(self.parsed[key])
            key = self.parsed[key]['parent'].lower()
        return out

    def handles(self, name):
        """What one script does: the events it handles, and for a timer, which
        of its events reach a registration. None when the script is not there
        or could not be read."""
        key = name.lower()
        if key in self.cache:
            return self.cache[key]
        chain = self.chain(key)
        if not chain:
            self.cache[key] = None
            return None
        funcs = {}
        for pex in chain:
            for fkey, fn in pex['functions'].items():
                funcs.setdefault(fkey, fn)
        callbacks = {}
        for fn in funcs.values():
            for cb in fn['callbacks']:
                callbacks[cb.lower()] = cb
        events = {}
        for fkey, fn in funcs.items():
            if not fn['body'] or fn['flags'] & 3:
                continue
            if fkey in self.events:
                events[fkey] = self.events[fkey]
            elif fkey in callbacks:
                events[fkey] = callbacks[fkey]
        out = {'name': chain[0]['name'], 'events': events,
               'source': self.index[key][0], 'extends': chain[0]['parent'],
               'registersOthers': any(fn['outside'] & TIMER_CALLS for fn in funcs.values())}
        if TIMER_EVENT in events:
            # Every function from which a registration can be reached through
            # the script's calls to itself, found by growing the set until it
            # stops growing.
            reach = {f for f, fn in funcs.items() if fn['timer']}
            grew = True
            while grew:
                grew = False
                for f, fn in funcs.items():
                    if f not in reach and fn['calls'] & reach:
                        reach.add(f)
                        grew = True
            out['starters'] = sorted(events[f] for f in reach if f in events and f != TIMER_EVENT)
            out['calledIn'] = sorted(funcs[f]['name'] for f in reach
                                     if f not in events and f in self.called_from_outside)
        self.cache[key] = out
        return out


def exempt(name, scripts, rule):
    """The record's exemptions, on the name the .pex gives itself when it is
    there, since that is the name the VM carries."""
    got = scripts.parsed.get(name.lower())
    real = got['name'] if got else name
    return rule.frees(real)


def server_storage(rule, data_dir, stats):
    """Every script name, in lower case, the server's script storage holds by
    the record: the built in scripts, data\\scripts, and the scripts in each
    archive the "archives" setting names, read here from the same Data folder
    (the server's copy of an archive is the same file)."""
    names = set(rule.server_scripts)
    for archive in rule.archives:
        path = archive if os.path.isabs(archive) else os.path.join(data_dir, archive)
        try:
            files = bsa.read(path, 'scripts')
        except (OSError, ValueError, struct.error, zlib.error, IndexError) as exc:
            stats['unreadable server archives'].append('%s: %s' % (archive, exc))
            continue
        for p in files:
            if p.endswith('.pex'):
                names.add(p.split('/')[-1][:-4])
    return names


# ---------------------------------------------------------------------------
# The audit

def audit(data_dir, plugins_txt, rule):
    stats = defaultdict(int)
    stats['unreadable archives'] = []
    stats['unreadable server archives'] = []
    order, missing = load_order(data_dir, plugins_txt)

    # Every scripted record and alias, and every plugin that defined it after,
    # in load order. A plugin that overrides a scripted record without a VMAD
    # takes its scripts away, which is how the engine reads an override.
    chains, kinds, subkeys = {}, {}, defaultdict(set)
    bad_vmad = defaultdict(int)
    for idx, plugin in enumerate(order):
        with open(own_plugins.plugin_path(data_dir, plugin), 'rb') as fh:
            buf = fh.read()
        try:
            _flags, masters, start = plugin_header(buf)
        except (ValueError, struct.error):
            stats['unreadable plugins'] += 1
            continue
        for sig, rkey, vmad in records(buf, start, masters, plugin.lower(), stats):
            defined = {}
            if vmad is not None:
                try:
                    scripts, aliases, fragment = read_vmad(sig, vmad)
                except (ValueError, struct.error, IndexError):
                    bad_vmad[plugin] += 1
                    continue
                defined[rkey + ('record',)] = tuple(scripts)
                for alias, names in aliases.items():
                    defined[rkey + ('alias', alias)] = tuple(names)
                if fragment:
                    defined[rkey + ('fragment',)] = (fragment,)
            known = subkeys.get(rkey)
            if not defined and not known:
                continue
            for k in set(defined) | (known or set()):
                chains.setdefault(k, []).append((idx, defined.get(k, ())))
                kinds[k] = sig.decode('latin-1')
            subkeys[rkey].update(defined)

    index = script_index(data_dir, order, stats)
    scripts = Scripts(index)
    on_server = server_storage(rule, data_dir, stats)

    # Credit each script on each record to the plugin that first put it there,
    # following the run of overrides back from the one that wins.
    credited = defaultdict(list)
    for k, chain in chains.items():
        last_idx, last = chain[-1]
        if not last:
            continue
        free = any(exempt(n, scripts, rule) for n in last) if k[2] != 'fragment' else False
        for name in last:
            who = last_idx
            for j in range(len(chain) - 2, -1, -1):
                if name.lower() in [n.lower() for n in chain[j][1]]:
                    who = chain[j][0]
                else:
                    break
            credited[who].append((k, name, free))

    plugins, events, if_loaded = [], {}, {}
    for idx, plugin in enumerate(order):
        rows = credited.get(idx, [])
        per_script, fragments, quiet, absent, unread = {}, 0, 0, set(), set()
        server = {'fires': {}, 'loadedNeverSent': set(), 'notLoaded': set(), 'notOnAReference': 0}
        # Whether anything this plugin attaches, fragments included, starts a
        # timer on something other than itself. QuickLootIE's load alias does,
        # GetOwningQuest().RegisterForSingleUpdate(), and that is the only way
        # its maintenance quest's timer starts.
        starts_others = False
        for k, name, free in rows:
            got = scripts.handles(name)
            if got is not None and got['registersOthers']:
                starts_others = True
            # The server half: a script runs there only on a reference, only
            # when the server's storage has it and nothing drops it by name,
            # and only on an event the server sends.
            if k[2] != 'record' or kinds[k] in NOT_ON_A_REFERENCE:
                server['notOnAReference'] += 1
            else:
                sent = sorted(rule.sends[e] for e in (got['events'] if got else {}) if e in rule.sends)
                for e in sent:
                    slot = if_loaded.setdefault(e, {'plugins': set(), 'scripts': set()})
                    slot['plugins'].add(plugin)
                    slot['scripts'].add((plugin, got['name'].lower()))
                if name.lower() not in on_server or name.lower() in rule.drops:
                    server['notLoaded'].add(name)
                elif sent:
                    server['fires'].setdefault(got['name'], set()).update(sent)
                else:
                    server['loadedNeverSent'].add(name)
            if k[2] == 'fragment':
                fragments += 1
                continue
            if got is None:
                (unread if name.lower() in scripts.bad else absent).add(name)
                continue
            if not got['events']:
                # Holds properties, or is a fragment script listed on its own
                # record as well. Nothing in it waits on anything.
                quiet += 1
                continue
            row = per_script.get(got['name'])
            if row is None:
                row = per_script[got['name']] = {
                    'attached': 0, 'exempt': 0, 'on': set(),
                    'events': sorted(got['events'].values()),
                    'alive': set(), 'blocked': set(),
                    'source': got['source'], 'extends': got['extends'],
                }
                if 'starters' in got:
                    row['timerStartsFrom'] = got['starters']
                    row['timerCalledInBy'] = got['calledIn']
            row['attached'] += 1
            if free:
                row['exempt'] += 1
            row['on'].add(kinds[k] + (' alias' if k[2] == 'alias' else ''))
            for key, ev in got['events'].items():
                if free or rule.passes(key):
                    row['alive'].add(ev)
                else:
                    row['blocked'].add(ev)

        # A timer counts as running unless every way this script has of
        # starting it is a blocked event, nothing anywhere calls in to the
        # functions that register it, and nothing else in the plugin registers
        # a timer on another object.
        live, blocked, stuck = False, False, False
        for row in per_script.values():
            if ('timerStartsFrom' in row and row['exempt'] == 0 and not starts_others
                    and rule.passes(TIMER_EVENT) and row['timerStartsFrom']
                    and not any(rule.passes(s.lower()) for s in row['timerStartsFrom'])
                    and not row['timerCalledInBy']):
                row['timerNeverStarts'] = True
                stuck = True
            elif row['alive']:
                live = True
            blocked = blocked or bool(row['blocked'])
            for e in row['blocked']:
                slot = events.setdefault(e, {'plugins': set(), 'scripts': 0})
                slot['plugins'].add(plugin)
                slot['scripts'] += 1
            row['alive'] = sorted(row['alive'])
            row['blocked'] = sorted(row['blocked'])
            row['on'] = sorted(row['on'])

        if not rows:
            status = 'records only'
        elif not per_script:
            status = 'fragments only' if fragments else 'no events'
        elif live and not blocked:
            status = 'works'
        elif live:
            status = 'partial'
        elif stuck:
            status = 'timer never starts'
        else:
            status = 'dead'
        if not rows:
            server_status = 'records only'
        elif server['fires']:
            server_status = 'fires'
        elif server['loadedNeverSent']:
            server_status = 'loaded, never sent'
        elif server['notLoaded']:
            server_status = 'not loaded'
        else:
            server_status = 'not on a reference'
        plugins.append({
            'plugin': plugin, 'master': plugin in MASTERS, 'status': status,
            'server': {
                'status': server_status,
                'fires': {n: sorted(v) for n, v in sorted(server['fires'].items())},
                'loadedNeverSent': sorted(server['loadedNeverSent']),
                'notLoaded': sorted(server['notLoaded']),
                'notOnAReference': server['notOnAReference'],
            },
            'firesNowhere': bool(rows) and status not in ('works', 'partial') and server_status != 'fires',
            'scripts': per_script, 'fragments': fragments,
            'attachedWithoutEvents': quiet,
            'missingScripts': sorted(absent),
            'unreadableScripts': sorted(unread),
            'unreadableVmads': bad_vmad.get(plugin, 0),
        })

    return {
        'rule': {
            'record': 'records/papyrus-events.json',
            'readAt': rule.read_at,
            'client': rule.record['client'],
            'server': rule.record['server'],
        },
        'loadOrder': order,
        'missingPlugins': missing,
        'counts': {
            'plugins': len(order),
            'looseScripts': stats['loose scripts'],
            'archiveScripts': stats['archive scripts'],
            'scriptsRead': len(scripts.parsed),
            'scriptsUnreadable': len(scripts.bad),
            'eventNames': len(scripts.events),
            'unreadableRecords': stats['unreadable records'],
            'unreadableVmads': sum(bad_vmad.values()),
            'unreadablePlugins': stats['unreadable plugins'],
        },
        'unreadableArchives': stats['unreadable archives'],
        'unreadableServerArchives': stats['unreadable server archives'],
        'unreadableScripts': scripts.bad,
        'eventNames': {scripts.events[k]: scripts.declared_in[k] for k in scripts.events},
        'plugins': plugins,
        'blockedEvents': {
            e: {'plugins': sorted(v['plugins']), 'scripts': v['scripts']}
            for e, v in sorted(events.items(), key=lambda kv: (-len(kv[1]['plugins']), kv[0]))
        },
        'serverSentEventsIfLoaded': {
            e: {'plugins': sorted(v['plugins']), 'scripts': len(v['scripts'])}
            for e, v in sorted(if_loaded.items(), key=lambda kv: (-len(kv[1]['plugins']), kv[0]))
        },
    }


def report(result, out=sys.stdout):
    c = result['counts']
    w = out.write
    rc, rs = result['rule']['client'], result['rule']['server']
    w('Papyrus events under Thornswood, by %s (the fork at %s)\n'
      % (result['rule']['record'], (result['rule']['readAt'] or '?')[:8]))
    if rc['blockerOn']:
        w('  Each person\'s machine: every event but %s is blanked, unless a script\n'
          '  named %s shares the object.\n'
          '  What runs there runs on that one machine only.\n'
          % (', '.join(rc['letsThrough']),
             ' or '.join([p + '*' for p in rc['exemptPrefixes']] + rc['exemptNames'])))
    else:
        w('  Each person\'s machine: the blocker is off, every event reaches its script.\n')
    loads = rs['loads']
    w('  The server: attaches scripts only to placed references, and only the ones\n'
      '  its storage holds (%d built in; data\\scripts: %s; archives: %s).\n'
      '%s\n'
      % (len(loads['builtIn']), ', '.join(loads['dataScripts']) or 'none',
         ', '.join(loads['archives']) or 'none set',
         textwrap.fill('It sends ' + ', '.join(rs['sends']) + '.', 76, initial_indent='  ', subsequent_indent='  ')))
    w('  %d plugins. %d scripts read, %d unreadable. %d loose and %d in archives,\n'
      '  a loose one winning over an archived one of the same name.\n'
      % (c['plugins'], c['scriptsRead'], c['scriptsUnreadable'], c['looseScripts'],
         c['archiveScripts']))
    w('  %d event names, from the game\'s own native scripts.\n' % c['eventNames'])
    if result['missingPlugins']:
        w('  NOT IN DATA, skipped: %s\n' % ', '.join(result['missingPlugins']))
    for a in result['unreadableArchives']:
        w('  COULD NOT READ %s\n' % a)
    for a in result['unreadableServerArchives']:
        w('  COULD NOT READ the server archive %s\n' % a)
    if c['unreadableVmads'] or c['unreadableRecords']:
        w('  %d VMADs and %d compressed records could not be read.\n'
          % (c['unreadableVmads'], c['unreadableRecords']))

    groups = defaultdict(list)
    for p in result['plugins']:
        groups[p['status']].append(p)
    w('\nBy plugin, on each person\'s machine\n')
    for s in STATUS_ORDER:
        w('  %-20s %3d\n' % (s, len(groups[s])))
    by_server = defaultdict(list)
    for p in result['plugins']:
        by_server[p['server']['status']].append(p)
    w('\nBy plugin, on the server\n')
    for s in SERVER_ORDER:
        w('  %-20s %3d\n' % (s, len(by_server[s])))
    if rs['exterior'].get('on'):
        w('  (and on a reference below %s in an exterior, only %s* scripts)\n'
          % (rs['exterior']['formIdBelow'], rs['exterior']['keepsPrefix']))
    for p in by_server['fires']:
        w('  fires: %s  %s\n' % (p['plugin'], _short('%s (%s)' % (n, ', '.join(e))
                                                    for n, e in p['server']['fires'].items())))
    nowhere = [p['plugin'] for p in result['plugins'] if p['firesNowhere']]
    w('\nScripted, and nothing fires on either half: %d\n' % len(nowhere))
    if nowhere:
        w(_lines(nowhere))

    for s in ('dead', 'timer never starts', 'partial'):
        if not groups[s]:
            continue
        w('\n%s\n' % s.upper())
        for p in groups[s]:
            blocked = sorted({e for row in p['scripts'].values() for e in row['blocked']})
            stuck = sorted(n for n, row in p['scripts'].items() if row.get('timerNeverStarts'))
            runs = sorted(n for n, row in p['scripts'].items()
                          if row['alive'] and n not in stuck)
            w('  %s%s\n' % (p['plugin'], '  (master)' if p['master'] else ''))
            w('      waits on  %s\n' % _short(blocked))
            if runs:
                w('      can run   %s\n' % _short(runs))
            if stuck:
                w('      a timer only a blocked event starts  %s\n' % _short(stuck))

    if groups['works']:
        w('\nWORKS\n')
        for p in groups['works']:
            how = []
            for row in p['scripts'].values():
                if row['exempt']:
                    how.append('exempt')
                elif row['alive'] and not row.get('timerNeverStarts'):
                    how.append('timer')
            w('  %s  (%s)\n' % (p['plugin'], ', '.join(sorted(set(how)))))

    w('\nBlocked events the load order waits on, by how many plugins\n')
    for e, v in list(result['blockedEvents'].items())[:40]:
        w('  %-32s %3d plugins  %4d scripts\n' % (e, len(v['plugins']), v['scripts']))
    more = len(result['blockedEvents']) - 40
    if more > 0:
        w('  and %d more, in the JSON\n' % more)

    w('\nScripts on references that wait on an event the server sends, were they loaded there\n')
    for e, v in result['serverSentEventsIfLoaded'].items():
        w('  %-32s %3d plugins  %4d scripts\n' % (e, len(v['plugins']), v['scripts']))


def _lines(names, width=76):
    """Names joined by commas, two spaces in, a line break between names
    and never inside one."""
    out, line = [], ''
    for i, n in enumerate(names):
        piece = n + (',' if i < len(names) - 1 else '')
        if line and len(line) + 1 + len(piece) > width:
            out.append(line)
            line = ''
        line = (line + ' ' + piece) if line else '  ' + piece
    if line:
        out.append(line)
    return ''.join(x + '\n' for x in out)


def _short(names, n=8):
    names = list(names)
    if len(names) <= n:
        return ', '.join(names)
    return '%s and %d more' % (', '.join(names[:n]), len(names) - n)


def main():
    ap = argparse.ArgumentParser(description='Which scripts can still do anything under the event blocker.')
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default=r'C:\Thornswood\Profile\Default\plugins.txt')
    ap.add_argument('--json', help='also write the full result here')
    ap.add_argument('--record', default=RECORD, help='the fork\'s event list, records/papyrus-events.json')
    args = ap.parse_args()

    if not os.path.isdir(args.data):
        print('STOP. %s is not a folder.' % args.data)
        return 1
    if not os.path.isfile(args.plugins):
        print('STOP. %s is not there.' % args.plugins)
        return 1
    try:
        rule = load_rule(args.record)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print('STOP. %s is not a readable event list: %s' % (args.record, exc))
        return 1
    try:
        result = audit(args.data, args.plugins, rule)
    except NoScripts as exc:
        print('STOP. %s' % exc)
        return 1
    report(result)
    if args.json:
        with io.open(args.json, 'w', encoding='utf-8') as fh:
            json.dump(result, fh, indent=1, sort_keys=True)
            fh.write(u'\n')
        print('\nWrote %s' % args.json)
    return 0


if __name__ == '__main__':
    sys.exit(main())
