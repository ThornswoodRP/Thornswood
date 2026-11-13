"""
Remove-DeadConditions.py

RETIRED. DO NOT RUN (#4811). It did its one job in September, before
Remove-DeadRecords.ps1 took the rank manuals out. On 12 November no record in
Thornswood-Content.esp matched its default prefixes (372 records read, none
compressed), nothing called it, and its --data default was its own folder,
where there is no plugin. It refuses to run, and the rest of the file is kept
for the history of how those conditions went.

Takes conditions out of Thornswood-Content.esp that test for a record which is
about to be deleted, so that Remove-DeadRecords.ps1 can then delete it.

WHY

Patrick, 21 September: "They shouldn't be reading the books it should just be
given to them", and "You level up from working your trade". The sixteen rank
manuals therefore come out of the plugin. Remove-DeadRecords.ps1 refused to
delete three of them, correctly, because three charcoal recipes still point at
them:

    COBJ 0x5015486 ThornswoodRecipeCharcoalTier2 -> 0x501548A WoodcutterAdvanced
    COBJ 0x5015487 ThornswoodRecipeCharcoalTier3 -> 0x501548B WoodcutterExpert
    COBJ 0x5015488 ThornswoodRecipeCharcoalTier4 -> 0x501548C WoodcutterMaster

Each is one CTDA: a condition saying the recipe only appears in the crafting
menu for somebody carrying that book. That is the manual tier gate, in the
plugin, doing in the client's crafting menu what the retired tier system used to
do on the server. It goes for the same reason the rest of it went.

Nothing is left ungated by that. The charcoal grade is the Charburner RANK now,
which burnCharcoal reads directly, and mp.onCraft refuses any recipe the half
and rank on the row do not allow. Build-RecipeTable.ps1 names these three in as
many words as "waiting on somebody putting those books in the world"; they are
not waiting on anything after this, and re-running that script is what puts a
rank on each rung.

WHAT IT PROVES BEFORE IT WRITES

The same discipline as Remove-DeadRecords.ps1, which this borrows its parser
shape from. It parses the file to a tree and
serialises it back byte for byte first, because a parser that cannot reproduce
what it was given has no business editing it. Afterwards it checks the result:
every record is still there, in the same order, with the same form id, type and
flags, and every record's bytes are unchanged except the ones it was asked to
edit, which differ by exactly the conditions removed.

It will not touch a compressed record. None of the records that carry these
conditions is compressed, and silently rewriting something it had to inflate
first is not a thing this should learn to do quietly.

THIS IS A SHIPPED FILE, so its size changing means a release and every client
downloading it again.

Usage:
    python scripts/oneoff/Remove-DeadConditions.py --check
    python scripts/oneoff/Remove-DeadConditions.py

Exit code 1 if the parse does not round trip, if the result does not verify, or
if a condition it was asked to remove sits in a compressed record.
"""

# The refusal comes before anything else, so no part of it can run by
# accident (#4811, as #1179 retired the others in scripts/oneoff).
raise SystemExit('STOP. Remove-DeadConditions.py is retired and changes nothing (#4811). '
                 'No record in Thornswood-Content.esp matches its prefixes any more.')

import argparse
import os
import struct
import sys

COMPRESSED = 0x00040000

# A CTDA is 32 bytes in Skyrim. The two form id parameters sit at 12 and 16.
CTDA_SIZE = 32
CTDA_PARAM1 = 12
CTDA_PARAM2 = 16

# A condition's own string parameters follow it and belong to it, so they go
# when it goes. Neither of the three here has one; this is so that a later
# condition with one is not left orphaned.
CTDA_TRAILERS = (b'CIS1', b'CIS2')


class Rec(object):
    """One record: header bytes, then data."""

    def __init__(self, tag, size, flags, fid, extra, data):
        self.tag, self.flags, self.fid = tag, flags, fid
        self.extra, self.data = extra, data

    def bytes(self):
        return (self.tag + struct.pack('<III', len(self.data), self.flags, self.fid)
                + self.extra + self.data)

    @property
    def compressed(self):
        return (self.flags & COMPRESSED) != 0

    def editor_id(self):
        if self.compressed:
            return ''
        for tag, body in subrecords(self.data):
            if tag == b'EDID':
                return body.rstrip(b'\x00').decode('ascii', 'replace')
        return ''


class Grup(object):
    """One group: header bytes, then children."""

    def __init__(self, label, kids):
        self.label, self.kids = label, kids

    def bytes(self):
        body = b''.join(k.bytes() for k in self.kids)
        return b'GRUP' + struct.pack('<I', len(body) + 24) + self.label + body


def subrecords(data):
    """Every (tag, body) in a record's data, in order."""
    out, i = [], 0
    while i + 6 <= len(data):
        tag = data[i:i + 4]
        size = struct.unpack_from('<H', data, i + 4)[0]
        if i + 6 + size > len(data):
            break
        out.append((tag, data[i + 6:i + 6 + size]))
        i += 6 + size
    return out


def pack_subrecords(pairs):
    return b''.join(t + struct.pack('<H', len(b)) + b for t, b in pairs)


def parse(buf, start, end):
    kids, p = [], start
    while p + 24 <= end:
        tag = buf[p:p + 4]
        size = struct.unpack_from('<I', buf, p + 4)[0]
        if tag == b'GRUP':
            kids.append(Grup(buf[p + 8:p + 24], parse(buf, p + 24, p + size)))
            p += size
        else:
            flags, fid = struct.unpack_from('<II', buf, p + 8)
            kids.append(Rec(tag, size, flags, fid, buf[p + 16:p + 24],
                            buf[p + 24:p + 24 + size]))
            p += 24 + size
    return kids


def every_record(kids):
    for k in kids:
        if isinstance(k, Grup):
            for r in every_record(k.kids):
                yield r
        else:
            yield k


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=here)
    ap.add_argument('--plugin', default='Thornswood-Content.esp')
    ap.add_argument('--prefixes', default='ThornswoodMining,ThornswoodSmithing,'
                                          'ThornswoodWoodcutter,ThornswoodAlchemy',
                    help='editor id prefixes whose records are about to be deleted')
    ap.add_argument('--check', action='store_true', help='say what would go, write nothing')
    args = ap.parse_args()

    path = os.path.join(args.data, args.plugin)
    raw = open(path, 'rb').read()
    print('The file')
    print('  %s' % path)
    print('  %s bytes' % format(len(raw), ','))

    header_size = struct.unpack_from('<I', raw, 4)[0]
    tree = parse(raw, 24 + header_size, len(raw))
    head = raw[:24 + header_size]

    print('')
    print('Can the parser reproduce the file it was given')
    again = head + b''.join(k.bytes() for k in tree)
    if again != raw:
        print('STOP. the parse does not round trip. Nothing was written.')
        return 1
    print('  ok    parsed and written back byte for byte, %s bytes' % format(len(again), ','))

    prefixes = tuple(p.strip() for p in args.prefixes.split(',') if p.strip())
    records = list(every_record(tree))
    doomed = {}
    for r in records:
        e = r.editor_id()
        if e and e.startswith(prefixes):
            doomed[r.fid] = e

    print('')
    print('Records about to be deleted, whose conditions have to go first')
    print('  %d of them' % len(doomed))
    if not doomed:
        print('  nothing matches those prefixes, so there is nothing to do')
        return 0

    print('')
    print('Conditions that test for one of them')
    edits, blocked = [], []
    for r in records:
        if r.compressed:
            # Prove it is not hiding one rather than assuming it is not.
            for fid in doomed:
                if struct.pack('<I', fid) in r.data:
                    blocked.append('%s 0x%07X is compressed and holds 0x%07X'
                                   % (r.tag.decode(), r.fid, fid))
            continue
        pairs = subrecords(r.data)
        keep, drop, i = [], [], 0
        while i < len(pairs):
            tag, body = pairs[i]
            hit = None
            if tag == b'CTDA' and len(body) >= CTDA_PARAM2 + 4:
                for off in (CTDA_PARAM1, CTDA_PARAM2):
                    p = struct.unpack_from('<I', body, off)[0]
                    if p in doomed:
                        hit = p
            if hit is None:
                keep.append((tag, body))
                i += 1
                continue
            drop.append((r, hit))
            i += 1
            while i < len(pairs) and pairs[i][0] in CTDA_TRAILERS:
                i += 1
        if drop:
            edits.append((r, keep, drop))

    if blocked:
        for b in blocked:
            print('  %s' % b)
        print('')
        print('STOP. a compressed record points at one of these and this script does')
        print('      not rewrite compressed records. Nothing was written.')
        return 1

    if not edits:
        print('  none')
        return 0

    for r, keep, drop in edits:
        for _, fid in drop:
            print('  %s 0x%07X %-32s tests for 0x%07X (%s)'
                  % (r.tag.decode(), r.fid, r.editor_id(), fid, doomed[fid]))

    if args.check:
        print('')
        print('  --check, so nothing was written.')
        return 0

    before = {r.fid: (r.tag, r.flags, r.data) for r in records}
    for r, keep, drop in edits:
        r.data = pack_subrecords(keep)

    out = head + b''.join(k.bytes() for k in tree)

    print('')
    print('Does the result verify')
    after = list(every_record(parse(out, 24 + header_size, len(out))))
    if len(after) != len(records):
        print('  STOP. %d records went in and %d came out. Nothing was written.'
              % (len(records), len(after)))
        return 1
    edited = set(r.fid for r, _, _ in edits)
    for was, now in zip(records, after):
        if was.fid != now.fid or was.tag != now.tag or was.flags != now.flags:
            print('  STOP. 0x%07X changed identity. Nothing was written.' % was.fid)
            return 1
        old_tag, old_flags, old_data = before[was.fid]
        if now.fid not in edited and now.data != old_data:
            print('  STOP. 0x%07X was not on the list and its bytes changed. '
                  'Nothing was written.' % now.fid)
            return 1
    print('  ok    %d records in, %d out, same order, same ids, same flags'
          % (len(records), len(after)))
    print('  ok    %d record(s) edited, every other byte untouched' % len(edited))

    # This script adds and removes no records, so the header's count cannot have
    # gone wrong here. It is still checked, because the count HAD been wrong in
    # this file since before any of these scripts existed and nothing ever looked
    # at it. Every script that touches the plugin says what the count is now.
    out = bytearray(out)
    hedr = out.find(b'HEDR')
    if hedr < 0:
        print('  STOP. no HEDR in the header. Nothing was written.')
        return 1
    at = hedr + 6 + 4
    claimed = struct.unpack_from('<i', out, at)[0]
    if claimed != len(after):
        struct.pack_into('<i', out, at, len(after))
        print('  ok    the header said %d records and the file holds %d. Set to %d.'
              % (claimed, len(after), len(after)))
    else:
        print('  ok    the header record count reads %d, which is what is in the file' % claimed)
    out = bytes(out)

    open(path, 'wb').write(out)
    print('')
    print('  %s bytes -> %s bytes' % (format(len(raw), ','), format(len(out), ',')))
    print('  THIS IS A SHIPPED FILE. Its size changed, so this needs a release and')
    print('  every client will download it again.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
