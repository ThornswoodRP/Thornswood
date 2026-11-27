"""Remove authored lock and parent-only activation restrictions on ordinary doors."""
import re
import struct


DELETED = 0x20
COMPRESSED = 0x40000
DESC = re.compile(r'[1-9a-f][0-9a-f]{0,5}:[^:\\/]+\.(?:esm|esp|esl)', re.I)
# xEdit's wbActionFlag defines XACT as uint32 action bits, never a form ID.
PLAIN = {b'EDID': None, b'DATA': (24,), b'XSCL': (4,), b'XAPD': (1,), b'XACT': (4,),
         b'ONAM': (0,)}  # REFR Open by Default is an empty marker, retained in place.
WITH_FORM = {
    b'NAME': ((4,), (0,)),
    b'XOWN': ((4,), (0,)),
    b'XTEL': ((32, 36), (0,)),
    b'XNDP': ((8,), (0,)),
    b'XLRL': ((4,), (0,)),
    b'XESP': ((8,), (0,)),
    b'XAPR': ((8,), (0,)),
    b'XLKR': ((4, 8), (0, 4)),
    b'XTNM': ((4,), (0,)),
}


def stop(reason):
    raise SystemExit('STOP. Authored door defaults: %s. Nothing was written.' % reason)


def references(rules):
    def keys(name):
        table = rules.get(name)
        if not isinstance(table, dict):
            stop('missing %s map' % name)
        result = set()
        for desc, why in table.items():
            if not DESC.fullmatch(desc) or not isinstance(why, str) or not why.strip():
                stop('invalid entry in %s' % name)
            number, plugin = desc.split(':', 1)
            result.add((plugin.lower(), int(number, 16)))
        if len(result) != len(table):
            stop('the same reference appears twice in %s' % name)
        return result

    return keys('protectedCells'), keys('protectedDoors')


def parent_only(fields):
    values = [data for tag, data in fields if tag == b'XAPD']
    if len(values) > 1 or any(data not in (b'\0', b'\1') for data in values):
        stop('unknown XAPD activation layout or value')
    return values == [b'\1']


def entries(plugins, winners, rules, subrecords, *, handled=(), protected=None):
    cells, doors = references(rules)
    bases = {gid for (tag, gid), row in winners.items() if tag == b'DOOR' and not row.flags & DELETED}
    if any((b'CELL', cell) not in winners for cell in cells) or any((b'REFR', door) not in winners for door in doors):
        stop('a protected cell or door is missing from the recorded load order')
    out = []
    for (tag, gid), row in sorted(winners.items()):
        if tag != b'REFR' or row.flags & DELETED:
            continue
        plugin = plugins[row.pi]
        fields = subrecords(plugin.data(row))
        locks = [data for name, data in fields if name == b'XLOC']
        if not locks and not any(name == b'XAPD' for name, _ in fields):
            continue
        raw_base = next((data for name, data in fields if name == b'NAME'), b'')
        if len(raw_base) != 4 or plugin.gid(struct.unpack('<I', raw_base)[0]) not in bases:
            continue
        cell = plugin.gid(row.ctx[1]) if row.ctx and row.ctx[1] else None
        if gid in doors or cell in cells:
            if gid in handled:
                stop('an existing override targets a protected door')
            if protected is not None:
                protected.append(gid)
            continue
        restricted = parent_only(fields)
        if gid in handled:
            # The independently checked gate/Riftweald copies do not accept
            # XAPD today. Never let a future changed source evade this pass.
            if restricted:
                stop('an existing override targets a parent-only activation door')
            continue
        if not locks and not restricted:
            continue
        if cell is None or len(locks) > 1 or any(len(lock) not in (12, 16, 20) for lock in locks):
            stop('unknown placement or lock layout at %s 0x%08X' % (plugin.name, row.fid))
        out.append(row)
    return out


def copy_pairs(plugin, fields, numbers):
    """Drop XLOC, clear XAPD in place and remap retained form IDs."""
    parent_only(fields)  # Validate even when called independently of entries.
    cooked = []
    for tag, data in fields:
        if tag == b'XLOC':
            continue
        if tag == b'XAPD':
            data = b'\0'
        what = '%s %s on authored door' % (plugin.name, tag.decode())
        if tag in WITH_FORM or tag == b'XLRT':
            if tag == b'XLRT':
                if len(data) % 4:
                    stop('unknown field size for %s (%d)' % (what, len(data)))
                offsets = range(0, len(data), 4)
            else:
                sizes, offsets = WITH_FORM[tag]
                if len(data) not in sizes:
                    stop('unknown field size for %s (%d)' % (what, len(data)))
            data = bytearray(data)
            for at in offsets:
                if at >= len(data):
                    continue
                original = struct.unpack_from('<I', data, at)[0]
                struct.pack_into('<I', data, at, numbers.one(plugin, original, what))
            data = bytes(data)
        elif tag == b'VMAD':
            data = numbers.vmad(plugin, data, False, what)
        elif tag not in PLAIN or PLAIN[tag] is not None and len(data) not in PLAIN[tag]:
            stop('unknown field or size for %s (%d)' % (what, len(data)))
        cooked.append((tag, data))
    return cooked


def summary(plugins, rows, subrecords, describe):
    unlocked, direct = [], []
    for row in rows:
        src = plugins[row.pi]
        fields = subrecords(src.data(row))
        desc = describe(src.gid(row.fid))
        if any(tag == b'XLOC' for tag, _ in fields):
            unlocked.append(desc)
        if parent_only(fields):
            direct.append(desc)
    return {'authoredDoorsUnlocked': unlocked, 'authoredDoorsDirectActivation': direct}


def verify(plugins, source_winners, final_winners, last, rules, subrecords, numbers, *, handled=()):
    failures = []
    protected = []
    ordinary = entries(plugins, source_winners, rules, subrecords, handled=handled, protected=protected)
    for key in protected:
        original = source_winners[b'REFR', key]
        actual = final_winners.get((b'REFR', key))
        if actual is None or (actual.pi, actual.fid, actual.off) != (original.pi, original.fid, original.off):
            failures.append('protected door %s 0x%06X was overridden' % key)
    for row in ordinary:
        src = plugins[row.pi]
        actual = final_winners.get((b'REFR', src.gid(row.fid)))
        expected = copy_pairs(src, subrecords(src.data(row)), numbers)
        if (actual is None or actual.pi != last.index or actual.flags != row.flags & ~COMPRESSED or
                actual.ctx is None or actual.ctx[1] is None or last.gid(actual.ctx[1]) != src.gid(row.ctx[1]) or
                actual.ctx[2] != row.ctx[2] or (last.gid(actual.ctx[0]) if actual.ctx[0] else None) !=
                (src.gid(row.ctx[0]) if row.ctx[0] else None) or subrecords(last.data(actual)) != expected):
            failures.append('%s 0x%08X has no exact door-default override' % (src.name, row.fid))
    for row in entries(plugins, final_winners, rules, subrecords):
        failures.append('door %s 0x%08X retains an authored lock or parent-only activation outside the exceptions'
                        % (plugins[row.pi].name, row.fid))
    return failures
