"""
Check-PluginClean.py

Says whether Thornswood's own plugins are clean: no record left identical to
the master it overrides, no deleted reference, and no fault in the file
itself. It is the check SSEEdit's Check for Errors and its cleaning filter
were run for, done from the files, so it runs on any machine with Python.

WHY (issue #2790)

The weekly review of 19 October opened #2790: three plugins changed that week
(Thornswood-Content.esp, Thornswood-Last.esp, Thornswood-WoodworkerTrail.esp)
and each needed an SSEEdit check for stray identical records, deleted
references and errors before the next main release. SSEEdit only runs on
Windows, with a window and somebody clicking, so the issue said "this waits
on One". Every one of the three is written by a script in this repository and
changes most weeks (five merges changed the content plugin on 20 October
alone), so a check that needs a person at One's desk is a check that waits
every week. This one is the same questions asked of the bytes.

WHAT IT CHECKS

  The file      Every group and record lies inside the group around it and
                the file; every record's subrecords add up to its size; a
                compressed record inflates to the size it says; no record has
                form id 0 or a file index past the plugin's own; no form id is
                in the file twice; a light (ESL flagged) plugin adds records
                only in 0x800 to 0xFFF; HEDR's next object id is past every
                record the plugin adds.

  Deleted       Any record flagged deleted (0x20). A placed reference (REFR,
                ACHR and the other placed kinds) that overrides a master's is
                a deleted reference, which crashes anything that still names
                it; SSEEdit's clean undeletes and disables it. Our writers
                never delete: they take a record out of the file, or mark a
                master's reference initially disabled (Build-LastPlugin.py).

  Identical     With the masters: every record that overrides one, held to
  to master     the version it overrides, the last of the plugin's own
                masters that has it, the way SSEEdit's Quick Auto Clean loads
                a plugin with its masters. Identical means the same record
                flags (compression aside) and the same subrecords in the same
                order, where a form id counts as the same when it names the
                same record through each file's own master list (equal bytes
                can name different records, and different bytes the same
                one), and a localised string counts as the same text when
                the master's string table holds exactly the plugin's plain
                text. A cell or
                worldspace that is identical but holds records of the plugin
                is the parent those records need, and is not something to
                clean; SSEEdit skips those too.

  Masters       With the masters: each one is there, and each master's own
                masters come before it in the plugin's list.

  References    With the masters: the fields every one of these plugins uses
                to name another record (a placed reference's base, keywords,
                a recipe's result, bench and items, a cell's location, owner,
                water, climate, music and lighting, a location's parent, link
                and enable parents) name a record that exists in the plugin
                or one of its masters. A record one of the release's other
                plugins adds in a master's numbering (MoreCraftableEquipment
                adds its loom keyword as Update.esm's 0x6CE000) exists in the
                release's load order, as SSEEdit loaded with that order sees
                it; that is a note naming the plugin, not a fault. The load
                order is the NPC catalogue's (game/data/npc-population.json),
                read only when a reference needs it.

WHAT IT DOES NOT

  SSEEdit's Check for Errors reads every field through its definition of
  every record type, so it also catches a reference to a record of the wrong
  type, a reference in a field not listed above (conditions, scripts, quest
  aliases), and values out of range. This does not have those definitions.
  The fields it does read are the ones the three writers produce.

  Without the definitions it cannot say which bytes are form ids, so it
  reads the four byte words where every form id field the writers produce
  sits, and takes a word for a form id only when it names a record that
  exists. A script (VMAD) puts form ids at any byte, so a script that the
  master numbers differently counts as changed. Both of those lean towards
  calling a record changed: the one way a changed record could read as
  identical is a value that is not a form id, differs between the two files
  by exactly the move of a file index, and also reads as a record that
  exists. Read the record before taking it out of its writer.

  The header's record count is #2789 (two writers count records and leave
  the groups out); SSEEdit rewrites that number when it saves and never
  reports it, so this does not either.

WHERE IT RUNS

  Without the game (--no-masters) it reads only the plugins: the file and
  deleted checks. Every pull request runs that (.github/workflows/build-pr.yml)
  over game/content, so a writer that leaves a broken or deleted record goes
  red before it merges. The masters are Bethesda's and the collection's mods'
  plugins, which live in a game folder and, every one of them, in the dev
  server's own plugins folder on the box (C:\\Thornswood-Server-Dev\\plugins,
  103 plugins, and Python 3.12 is installed there, measured 21 October). The
  server's folder has no archives or string tables, so a record that matches
  its master but for localised text is listed as could not tell, and the run
  says it was not checked whole; on 21 October, taking every such text as
  the same turned no record of the three into one to clean. The full check:

    python scripts/mods/Check-PluginClean.py
    python scripts/mods/Check-PluginClean.py --data "C:\\Thornswood\\Game\\Data"
    python scripts/mods/Check-PluginClean.py --no-masters
    python scripts/mods/Check-PluginClean.py --data D:\\Data Thornswood-Last.esp
    python scripts/mods/Check-PluginClean.py --data C:\\Thornswood-Server-Dev\\plugins

  With no plugin named it checks every plugin in game/content. Thornswood's
  own plugins are always read from game/content (scripts/dev/own_plugins.py),
  the masters from --data. Read only. Exit 0 when every plugin is clean, 1 on
  any finding, 2 when it could not check (a master missing, a file it cannot
  read).

CLEANING

  When this finds something, the cure is in the writer that made the record,
  not in an editor: the plugins are rebuilt by their scripts and an edit by
  hand is lost at the next build. Content: Add-ContentRecords.py. Last:
  Build-LastPlugin.py.
"""

import argparse
import json
import os
import re
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'dev'))
import bsa  # noqa: E402  (the repository's archive reader)
import own_plugins  # noqa: E402  (where each plugin is read from, #2923)

DATA_DIR = 'C:\\Thornswood\\Game\\Data'
# The release's load order: the NPC catalogue's, which every builder of the
# last plugin and the tables reads, held there to each plugin's bytes.
CATALOGUE = os.path.join(ROOT, 'game', 'data', 'npc-population.json')

COMPRESSED = 0x00040000
DELETED = 0x20
LOCALISED = 0x80
LIGHT = 0x200

# The placed kinds. A deleted one that overrides a master's is a deleted
# reference.
PLACED = {b'REFR', b'ACHR', b'PGRE', b'PMIS', b'PARW', b'PBAR', b'PBEA', b'PCON',
          b'PFLA', b'PHZD', b'NAVM'}

# The fields that name another record, by record type: (subrecord, offsets of
# form ids inside it, or None for a list of form ids that fills it).
# '*' applies to every type.
REFERENCE_FIELDS = {
    b'*': {b'KWDA': None},
    b'REFR': {b'NAME': (0,), b'XLKR': (0, 4), b'XESP': (0,), b'XOWN': (0,), b'XEZN': (0,),
              b'XLCN': (0,), b'XLRT': None},
    b'ACHR': {b'NAME': (0,), b'XLKR': (0, 4), b'XESP': (0,), b'XOWN': (0,), b'XEZN': (0,),
              b'XLCN': (0,), b'XLRT': None},
    b'COBJ': {b'CNAM': (0,), b'BNAM': (0,), b'CNTO': (0,)},
    b'CELL': {b'XLCN': (0,), b'XOWN': (0,), b'XCWT': (0,), b'XCAS': (0,), b'XCIM': (0,),
              b'XCMO': (0,), b'LTMP': (0,), b'XEZN': (0,)},
    b'WRLD': {b'XLCN': (0,), b'WNAM': (0,), b'CNAM': (0,), b'NAM2': (0,), b'ZNAM': (0,)},
    b'LCTN': {b'PNAM': (0,)},
}

# What a record's or group's four letter type looks like.
TAG = re.compile(rb'^[A-Z0-9_]{4}$')

# The string tables a localised field may name.
STRING_KINDS = ('strings', 'dlstrings', 'ilstrings')


class Fault(Exception):
    pass


# --------------------------------------------------------------- reading

def subrecords(data):
    """(tag, bytes) pairs. A subrecord longer than 65,535 bytes is preceded by
    an XXXX that carries its real size; the pair comes back whole."""
    out, i, big = [], 0, None
    while i + 6 <= len(data):
        tag = data[i:i + 4]
        size = struct.unpack_from('<H', data, i + 4)[0]
        if tag == b'XXXX':
            if size != 4:
                raise Fault('an XXXX subrecord is %d bytes, not 4' % size)
            big = struct.unpack_from('<I', data, i + 6)[0]
            i += 6 + size
            continue
        if big is not None:
            size, big = big, None
        if i + 6 + size > len(data):
            raise Fault('subrecord %s runs past the end of its record' % tag.decode('latin1'))
        out.append((tag, data[i + 6:i + 6 + size]))
        i += 6 + size
    if i != len(data):
        raise Fault('the record ends inside a subrecord header')
    return out


class Record(object):
    __slots__ = ('tag', 'flags', 'fid', 'off', 'size', 'children')

    def __init__(self, tag, flags, fid, off, size):
        self.tag, self.flags, self.fid, self.off, self.size = tag, flags, fid, off, size
        # The records in this CELL's or WRLD's child group, in this file.
        self.children = 0


class Plugin(object):
    """One plugin, read whole. faults are what is wrong with the file itself;
    records are every record but the header, in file order."""

    def __init__(self, path, name, candidate=None):
        self.path, self.name = path, name
        if candidate is None:
            with open(path, 'rb') as fh:
                candidate = fh.read()
        self.buf = candidate
        self.faults = []
        self.records = []
        b = self.buf
        if len(b) < 24 or b[:4] != b'TES4':
            raise Fault('%s does not start with a TES4 header' % name)
        hs = struct.unpack_from('<I', b, 4)[0]
        self.hflags = struct.unpack_from('<I', b, 8)[0]
        if 24 + hs > len(b):
            raise Fault('%s: the header runs past the end of the file' % name)
        self.header_end = 24 + hs
        head = subrecords(b[24:24 + hs])
        self.masters = [x.rstrip(b'\x00').decode('latin1') for t, x in head if t == b'MAST']
        self.next_object = None
        for t, x in head:
            if t == b'HEDR' and len(x) >= 12:
                self.next_object = struct.unpack_from('<I', x, 8)[0]
        self.localised = bool(self.hflags & LOCALISED)
        self.light = bool(self.hflags & LIGHT) or name.lower().endswith('.esl')
        self._walk()

    def owner(self, fid):
        """The file that defines the form id, by this file's own numbering."""
        idx = fid >> 24
        return self.masters[idx] if idx < len(self.masters) else self.name

    def gid(self, fid):
        """A form id as (owning plugin, object id), the same in every file."""
        return (self.owner(fid).lower(), fid & 0xFFFFFF)

    def data(self, r):
        raw = self.buf[r.off + 24:r.off + 24 + r.size]
        if r.flags & COMPRESSED:
            if len(raw) < 4:
                raise Fault('%s %08X is flagged compressed and holds no data' % (r.tag.decode(), r.fid))
            want = struct.unpack_from('<I', raw, 0)[0]
            try:
                out = zlib.decompress(raw[4:])
            except zlib.error as e:
                raise Fault('%s %08X does not inflate: %s' % (r.tag.decode(), r.fid, e))
            if len(out) != want:
                raise Fault('%s %08X inflates to %d bytes, not the %d it says'
                            % (r.tag.decode(), r.fid, len(out), want))
            return out
        return raw

    def _walk(self):
        b, n = self.buf, len(self.buf)
        # (end, type, label, the CELL or WRLD record this group holds the children of)
        stack = []
        parents = {}
        p = self.header_end
        while p < n:
            while stack and p >= stack[-1][0]:
                if p > stack[-1][0]:
                    self.faults.append('a record or group at byte %d runs past the end of '
                                       'the group around it' % p)
                stack.pop()
            if p + 24 > n:
                self.faults.append('%d stray bytes at the end of the file' % (n - p))
                break
            tag = b[p:p + 4]
            size = struct.unpack_from('<I', b, p + 4)[0]
            if tag == b'GRUP':
                if size < 24:
                    self.faults.append('a group at byte %d is %d bytes, less than its own header'
                                       % (p, size))
                    break
                end = p + size
                if end > n or (stack and end > stack[-1][0]):
                    self.faults.append('the group at byte %d runs past the end of the %s'
                                       % (p, 'group around it' if stack and end <= n else 'file'))
                    break
                gtype = struct.unpack_from('<i', b, p + 12)[0]
                owner = None
                if gtype in (1, 6):
                    fid = struct.unpack_from('<I', b, p + 8)[0]
                    owner = parents.get(fid)
                    if owner is None:
                        self.faults.append('the child group at byte %d belongs to %08X, which '
                                           'is not the record before it' % (p, fid))
                stack.append((end, gtype, owner))
                p += 24
                continue
            if not TAG.match(tag):
                self.faults.append('byte %d starts neither a record nor a group' % p)
                break
            if p + 24 + size > n or (stack and p + 24 + size > stack[-1][0]):
                self.faults.append('%s at byte %d runs past the end of the %s'
                                   % (tag.decode('latin1'), p, 'group around it' if stack else 'file'))
                break
            flags, fid = struct.unpack_from('<II', b, p + 8)
            r = Record(tag, flags, fid, p, size)
            self.records.append(r)
            for (_, gt, owner) in stack:
                if owner is not None:
                    owner.children += 1
            if tag in (b'CELL', b'WRLD'):
                parents[fid] = r
            p += 24 + size


# ---------------------------------------------------------- string tables

class Strings(object):
    """The masters' string tables, read the first time a comparison needs
    one: loose files first, then the archives, the order the game reads
    them in."""

    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.tables = {}
        self.archives = None

    def _archive_files(self):
        if self.archives is None:
            self.archives = {}
            try:
                names = sorted(os.listdir(self.data_dir))
            except OSError:
                names = []
            for a in names:
                if not a.lower().endswith('.bsa'):
                    continue
                try:
                    files = bsa.read(os.path.join(self.data_dir, a), 'strings')
                except (ValueError, struct.error, zlib.error, IndexError, OSError):
                    continue
                for k, v in files.items():
                    self.archives.setdefault(k, v)
        return self.archives

    def table(self, plugin, kind):
        """{string id: text}, or None when the plugin has no such table in
        the Data folder or its archives."""
        key = (plugin.lower(), kind)
        if key in self.tables:
            return self.tables[key]
        name = '%s_english.%s' % (os.path.splitext(plugin)[0].lower(), kind)
        data = None
        loose = os.path.join(self.data_dir, 'Strings', name)
        if os.path.isfile(loose):
            with open(loose, 'rb') as fh:
                data = fh.read()
        else:
            data = self._archive_files().get('strings/' + name)
        if data is None:
            self.tables[key] = None
            return None
        out = {}
        if len(data) >= 8:
            count = struct.unpack_from('<I', data, 0)[0]
            base = 8 + count * 8
            for i in range(count):
                sid, off = struct.unpack_from('<II', data, 8 + i * 8)
                at = base + off
                if kind == 'strings':
                    e = data.find(b'\x00', at)
                    out[sid] = data[at:e if e >= 0 else len(data)]
                else:
                    ln = struct.unpack_from('<I', data, at)[0]
                    out[sid] = data[at + 4:at + 4 + ln].rstrip(b'\x00')
        self.tables[key] = out
        return out


# ------------------------------------------------------------- comparing

def index_map(src, dst):
    """{file index in src: file index in dst} for every file both know."""
    where = {m.lower(): i for i, m in enumerate(dst.masters)}
    where[dst.name.lower()] = len(dst.masters)
    out = {}
    for i, m in enumerate(src.masters + [src.name]):
        if m.lower() in where:
            out[i] = where[m.lower()]
    return out


def same_values(mine, theirs, imap, mine_names, theirs_names):
    """Whether two subrecords hold the same values, read four bytes at a time
    the way their form ids are laid out. A form id's top byte is a file index
    into its own file's master list, so the same record can be different
    bytes in the two files, and the same bytes can be different records.

    A word in theirs whose top byte is a file index there is read both ways:
      the same record    mine is theirs with the index moved to mine's
                         numbering, and theirs names a record that exists
                         (otherwise it was not a form id, and the bytes
                         differ);
      different records  the bytes are equal but the index moves, and both
                         name a record that exists (otherwise it was not a
                         form id, and equal bytes are equal values).
    mine_names and theirs_names say whether a form id names a record, each in
    its own file's numbering."""
    if len(mine) != len(theirs):
        return False
    whole = len(mine) - len(mine) % 4
    if mine[whole:] != theirs[whole:]:
        return False
    for o in range(0, whole, 4):
        x, y = struct.unpack_from('<I', mine, o)[0], struct.unpack_from('<I', theirs, o)[0]
        v = y >> 24
        if v not in imap or imap[v] == v or y == 0:
            if x != y:
                return False
            continue
        moved = (imap[v] << 24) | (y & 0xFFFFFF)
        if x == moved:
            if not theirs_names(y):
                return False
        elif x == y:
            if theirs_names(y) and mine_names(x):
                return False
        else:
            return False
    return True


def same_text(mine, theirs, master, strings):
    """Whether a plain string in mine is the text a localised master's field
    names by string id: True, False, or None when it may be and none of the
    master's string tables is there to say."""
    if not master.localised or len(theirs) != 4 or strings is None:
        return False
    if not (mine.endswith(b'\x00') and all(32 <= ch < 127 for ch in mine[:-1])):
        return False
    sid = struct.unpack('<I', theirs)[0]
    text = mine.rstrip(b'\x00')
    if sid == 0:
        return text == b''
    tables = [t for t in (strings.table(master.name, kind) for kind in STRING_KINDS) if t is not None]
    if not tables:
        return None
    return any(t.get(sid) == text for t in tables)


def identical(plugin, r, master, m, strings, names):
    """Whether record r of plugin is the same as record m of master: True,
    False, or None when it is unless some localised text differs that the
    master's string tables are not there to read. names holds every record
    of the plugin and its masters, as gids."""
    if (r.flags & ~COMPRESSED) != (m.flags & ~COMPRESSED):
        return False
    a = subrecords(plugin.data(r))
    b = subrecords(master.data(m))
    if len(a) != len(b):
        return False
    imap = index_map(master, plugin)
    moves = any(k != v for k, v in imap.items())

    def mine_names(fid):
        return plugin.gid(fid) in names

    def theirs_names(fid):
        return master.gid(fid) in names

    unknown = False
    for (ta, va), (tb, vb) in zip(a, b):
        if ta != tb:
            return False
        if ta == b'VMAD':
            # A script's object properties put form ids at any byte, so
            # equal bytes are the same values only when no index moves.
            if va == vb and not moves:
                continue
            return False
        if same_values(va, vb, imap, mine_names, theirs_names):
            continue
        said = same_text(va, vb, master, strings)
        if said:
            continue
        if said is None:
            unknown = True
            continue
        return False
    return None if unknown else True


def references(plugin, r):
    """(field, form id) for every reference REFERENCE_FIELDS knows in r."""
    fields = dict(REFERENCE_FIELDS[b'*'])
    fields.update(REFERENCE_FIELDS.get(r.tag, {}))
    out = []
    for t, v in subrecords(plugin.data(r)):
        if t not in fields:
            continue
        offs = fields[t]
        if offs is None:
            if len(v) % 4:
                raise Fault('%s %08X %s is %d bytes, not a list of form ids'
                            % (r.tag.decode(), r.fid, t.decode(), len(v)))
            offs = range(0, len(v), 4)
        for o in offs:
            if o + 4 <= len(v):
                out.append((t, struct.unpack_from('<I', v, o)[0]))
    return out


# ---------------------------------------------------------------- checks

def check_file(p):
    """What is wrong with the file itself, and its deleted records."""
    faults = list(p.faults)
    deleted = []
    seen = {}
    own = len(p.masters)
    for r in p.records:
        what = '%s %08X' % (r.tag.decode('latin1'), r.fid)
        if r.fid == 0:
            faults.append('%s at byte %d has form id 0' % (r.tag.decode('latin1'), r.off))
        idx = r.fid >> 24
        if idx > own:
            faults.append('%s has file index %02X; this plugin has %d masters, so the last '
                          'index it may use is %02X' % (what, idx, own, own))
        if r.fid in seen:
            faults.append('%s is in the file twice (bytes %d and %d)' % (what, seen[r.fid], r.off))
        seen[r.fid] = r.off
        if idx == own:
            obj = r.fid & 0xFFFFFF
            if p.light and not 0x800 <= obj <= 0xFFF:
                faults.append('%s is added by a light plugin outside 0x800 to 0xFFF' % what)
            if p.next_object is not None and obj >= p.next_object:
                faults.append('%s is at or past the header\'s next object id %06X' % (what, p.next_object))
        try:
            subrecords(p.data(r))
        except Fault as e:
            faults.append('%s: %s' % (what, e))
            continue
        if r.flags & DELETED:
            kind = 'deleted reference' if r.tag in PLACED and idx < own else 'deleted record'
            deleted.append('%s %s' % (kind, what))
    return faults, deleted


def load_masters(p, data_dir, read):
    """The plugin's masters, read, in its own order, and what stopped any of
    them being read. read holds the masters already read, by name, so a
    master of several plugins is read once."""
    out, missing = [], []
    for m in p.masters:
        if m.lower() in read:
            out.append(read[m.lower()])
            continue
        path = own_plugins.plugin_path(data_dir, m)
        if not os.path.isfile(path):
            missing.append('%s is not in %s' % (m, own_plugins.OWN_DIR if own_plugins.in_repo(m) else data_dir))
            continue
        try:
            read[m.lower()] = Plugin(path, m)
            out.append(read[m.lower()])
        except (Fault, OSError, struct.error) as e:
            missing.append('%s cannot be read: %s' % (m, e))
    return out, missing


def check_masters(p, masters):
    """Each master's own masters come before it in the plugin's list."""
    faults = []
    order = {m.lower(): i for i, m in enumerate(p.masters)}
    for i, m in enumerate(masters):
        for mm in m.masters:
            j = order.get(mm.lower())
            if j is None:
                faults.append('%s needs %s, which is not among this plugin\'s masters' % (m.name, mm))
            elif j > order[m.name.lower()]:
                faults.append('%s needs %s, which comes after it in this plugin\'s masters' % (m.name, mm))
    return faults


def check_against_masters(p, masters, strings):
    """(identical records to clean, identical parents kept, faults, the
    references that name a record no master has, as (record, field, form id)
    for the load order to answer, and the records that are identical unless
    text the missing string tables hold differs)."""
    want = set()
    for r in p.records:
        if (r.fid >> 24) < len(p.masters):
            want.add(p.gid(r.fid))
    refs = []
    for r in p.records:
        try:
            for t, v in references(p, r):
                if v:
                    refs.append((r, t, v))
        except Fault as e:
            refs.append((r, None, str(e)))
    # The version each override replaces: the last of the plugin's masters
    # that has it.
    base = {}
    exists = set(p.gid(r.fid) for r in p.records)
    for m in masters:
        for e in m.records:
            g = m.gid(e.fid)
            exists.add(g)
            if g in want:
                base[g] = (m, e)
    itm, kept, faults, untold = [], [], [], []
    for r in p.records:
        if (r.fid >> 24) >= len(p.masters):
            continue
        what = '%s %08X' % (r.tag.decode('latin1'), r.fid)
        g = p.gid(r.fid)
        if g not in base:
            faults.append('%s overrides a record %s does not have' % (what, p.owner(r.fid)))
            continue
        m, e = base[g]
        if e.tag != r.tag:
            faults.append('%s overrides %s, which is a %s there' % (what, m.name, e.tag.decode('latin1')))
            continue
        try:
            same = identical(p, r, m, e, strings, exists)
        except Fault as x:
            faults.append('%s: %s' % (what, x))
            continue
        if same is False:
            continue
        if r.tag in (b'CELL', b'WRLD') and r.children:
            kept.append('%s, the parent of %d of this plugin\'s records' % (what, r.children))
        elif same is None:
            untold.append('%s is %s\'s but for localised text whose string table is not in the Data '
                          'folder' % (what, m.name))
        else:
            itm.append('%s is identical to %s\'s' % (what, m.name))
    unresolved = []
    for r, t, v in refs:
        what = '%s %08X' % (r.tag.decode('latin1'), r.fid)
        if t is None:
            faults.append('%s: %s' % (what, v))
        elif (v >> 24) > len(p.masters):
            faults.append('%s %s names %08X, past this plugin\'s last file index' % (what, t.decode(), v))
        elif p.gid(v) not in exists:
            unresolved.append((r, t, v))
    return itm, kept, faults, unresolved, untold


def injected_by(p, unresolved, data_dir, read, order):
    """(notes, faults) for references no master holds. A plugin may add a
    record in another file's numbering (MoreCraftableEquipment.esp adds its
    loom keyword as Update.esm's 0x6CE000): in the release's load order that
    record exists, and SSEEdit, loaded with that order, resolves it. So the
    rest of the load order is read, and a reference one of its plugins
    injects is a note that names the plugin; one nothing holds is a fault."""
    want = set(p.gid(v) for _, _, v in unresolved)
    found = {}
    for n in order:
        if n.lower() == p.name.lower() or n in p.masters:
            continue
        if n.lower() not in read:
            path = own_plugins.plugin_path(data_dir, n)
            if not os.path.isfile(path):
                continue
            try:
                read[n.lower()] = Plugin(path, n)
            except (Fault, OSError, struct.error):
                continue
        q = read[n.lower()]
        for e in q.records:
            g = q.gid(e.fid)
            if g in want and g[0] != q.name.lower():
                found.setdefault(g, q.name)
    notes, faults = [], []
    for r, t, v in unresolved:
        what = '%s %08X %s names %08X' % (r.tag.decode('latin1'), r.fid, t.decode(), v)
        g = p.gid(v)
        if g in found:
            notes.append('%s, which no master has; %s adds it as %s\'s' % (what, found[g], p.owner(v)))
        else:
            faults.append('%s, which is in neither %s, its masters nor the load order'
                          % (what, p.name))
    return notes, faults


def release_order(catalogue):
    """The plugin names of the release's load order, or [] when the
    catalogue cannot be read."""
    try:
        with open(catalogue, encoding='utf-8') as fh:
            return [row['name'] for row in json.load(fh)['loadOrder']]
    except (OSError, ValueError, KeyError, TypeError):
        return []


def report(title, lines, empty='none'):
    print('  %s' % title)
    if not lines:
        print('    %s' % empty)
    for l in lines:
        print('    %s' % l)


def main(argv=None):
    ap = argparse.ArgumentParser(description='Whether Thornswood\'s own plugins are clean.')
    ap.add_argument('plugins', nargs='*', help='plugin file names; every plugin in game/content when none')
    ap.add_argument('--data', default=DATA_DIR, help="the game's Data folder, where the masters are read from")
    ap.add_argument('--catalogue', default=CATALOGUE,
                    help='the JSON whose loadOrder is the release load order (the NPC catalogue)')
    ap.add_argument('--no-masters', action='store_true',
                    help='read only the plugins: the file and deleted checks')
    args = ap.parse_args(argv)

    names = args.plugins or sorted(n for n in os.listdir(own_plugins.OWN_DIR)
                                   if n.lower().endswith(('.esp', '.esm', '.esl')))
    strings = None if args.no_masters else Strings(args.data)
    said = {'clean': 0, 'not clean': 0, 'could not be checked whole': 0}
    read = {}
    for name in names:
        said[check_one(name, args, strings, read)] += 1
    print('')
    print(', '.join('%d %s' % (n, k) for k, n in said.items()) + ', of %d.' % len(names))
    if said['not clean']:
        return 1
    if said['could not be checked whole']:
        return 2
    return 0


def check_build(name, candidate, data_dir, order):
    """Check the bytes the writer is about to keep, not the previous plugin."""
    args = argparse.Namespace(data=data_dir, no_masters=False)
    return check_one(name, args, Strings(data_dir), {}, candidate, order) == 'clean'


def check_one(name, args, strings, read, candidate=None, order=None):
    """Checks one plugin, says what it found, and answers clean, not clean or
    could not be checked whole."""
    path = own_plugins.plugin_path(args.data, name) if candidate is None else 'build candidate'
    print('')
    print(name)
    try:
        p = Plugin(path, name, candidate)
    except (Fault, OSError, struct.error) as e:
        print('  COULD NOT CHECK. %s' % e)
        return 'could not be checked whole'
    print('  %s, %d masters, %d records, %d of them its own%s'
          % (path, len(p.masters), len(p.records),
             sum(1 for r in p.records if (r.fid >> 24) == len(p.masters)),
             ', light' if p.light else ''))
    faults, deleted = check_file(p)
    itm = None
    notes, untold = [], []
    if not args.no_masters:
        masters, missing = load_masters(p, args.data, read)
        if missing:
            report('COULD NOT CHECK against the masters', missing)
        else:
            faults += check_masters(p, masters)
            itm, kept, more, unresolved, untold = check_against_masters(p, masters, strings)
            faults += more
            if unresolved:
                names = release_order(args.catalogue) if order is None else order
                notes, more = injected_by(p, unresolved, args.data, read, names)
                faults += more
    report('Errors', faults)
    report('Deleted records', deleted)
    if itm is not None:
        report('Identical to master, to clean', itm)
        report('Identical to master and kept, the parent of records', kept)
        report('Named through a plugin that is not a master', notes)
        if untold:
            report('Could not tell, the string tables are missing', untold)
    found = len(faults) + len(deleted) + len(itm or [])
    if found:
        print('  NOT CLEAN, %d to fix in the writer that made it' % found)
        return 'not clean'
    if itm is None and not args.no_masters:
        print('  not checked against its masters')
        return 'could not be checked whole'
    if untold:
        print('  not checked whole: give --data a Data folder with the masters\' string tables')
        return 'could not be checked whole'
    print('  clean%s' % (' (the file and deleted checks; no masters read)' if args.no_masters else ''))
    return 'clean'


if __name__ == '__main__':
    sys.exit(main())
