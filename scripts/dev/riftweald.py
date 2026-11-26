"""The exact retired TG07 locks, shared by the table and final-record builder.

This is not a general unlock list. A changed identity, script, parent or link
requires a new review before the build can copy anything.
"""
import struct

DOOR = '27eed:Skyrim.esm'
PARTNER = '270cf:Skyrim.esm'
BARS = ('9401e:Skyrim.esm', '94020:Skyrim.esm', '94023:Skyrim.esm')
BASE = '94025:Skyrim.esm'
BAR_BASE = '9401f:Skyrim.esm'
CELL = '37cc6:Skyrim.esm'
KEY = '72b05:Skyrim.esm'
VANILLA = {'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'}


def stop(why):
    raise SystemExit('STOP. Riftweald unlock: %s. Nothing was written.' % why)


def policy_refs(policy):
    rule = policy.get('riftwealdUnlocked')
    if rule is None:
        return ()
    if rule.get('door') != DOOR or rule.get('bars') != list(BARS):
        stop('the policy does not name exactly the reviewed TG07 door and three bars')
    return (DOOR,) + BARS


def table_check(placed):
    door, partner = placed.get(DOOR), placed.get(PARTNER)
    if door != {'base': BASE, 'cell': '16be0:Skyrim.esm', 'to': PARTNER,
                'lock': {'level': 75, 'key': KEY}}:
        stop('the back door no longer has its reviewed base, cell, partner and vanilla key lock')
    if partner != {'base': '4d6ed:Skyrim.esm', 'cell': CELL, 'to': DOOR}:
        stop('the unlocked way out no longer has its reviewed base, cell and partner')


def check_pairs(pairs, kind):
    expected = ([b'EDID', b'NAME', b'XTEL', b'XLOC', b'XNDP', b'DATA'] if kind == 'door' else
                [b'EDID', b'NAME', b'XTEL', b'XNDP', b'DATA'] if kind == 'partner' else
                [b'NAME', b'XSCL', b'DATA'])
    if [t for t, _ in pairs] != expected:
        stop('%s carries changed fields, scripts or links' % kind)
    lengths = {b'NAME': 4, b'XTEL': 32, b'XLOC': 20, b'XNDP': 8, b'DATA': 24, b'XSCL': 4}
    for tag, body in pairs:
        if tag in lengths and len(body) != lengths[tag]:
            stop('%s has malformed %s' % (kind, tag.decode()))


def copy_pairs(src, pairs, numbers, kind):
    check_pairs(pairs, kind)
    out = []
    for tag, body in pairs:
        if tag == b'XLOC':
            continue
        if tag in (b'NAME', b'XTEL', b'XNDP'):
            body = struct.pack('<I', numbers.one(src, struct.unpack_from('<I', body)[0], kind)) + body[4:]
        out.append((tag, body))
    return out


def entries(plugins, win, policy, subrecords, vmad_parse):
    if not policy_refs(policy):
        return []
    def key(desc):
        fid, plug = desc.split(':', 1)
        return plug.lower(), int(fid, 16)
    def get(tag, desc):
        entry = win.get((tag, key(desc)))
        if entry is None or entry.flags & 0x20:
            stop('missing %s %s' % (tag.decode(), desc))
        return entry, plugins[entry.pi]
    table, selected = {}, []
    for desc, kind, cell, base, edid in (
            (DOOR, 'door', '16be0:Skyrim.esm', BASE, b'TG07BackDoorRef\0'),
            (PARTNER, 'partner', CELL, '4d6ed:Skyrim.esm', b'RiftwealdToBackBalconyLoad\0')):
        entry, src = get(b'REFR', desc)
        pairs = subrecords(src.data(entry))
        check_pairs(pairs, kind)
        values = dict(pairs)
        if entry.flags & (0x20 | 0x800) or entry.ctx[1] is None or src.gid(entry.ctx[1]) != key(cell) or \
                src.gid(struct.unpack('<I', values[b'NAME'])[0]) != key(base) or values[b'EDID'] != edid:
            stop('%s has changed identity, cell, base or visibility' % desc)
        row = {'base': base, 'cell': cell, 'to': PARTNER if kind == 'door' else DOOR}
        target = src.gid(struct.unpack_from('<I', values[b'XTEL'])[0])
        if target != key(row['to']):
            stop('%s has a changed teleport destination' % desc)
        if kind == 'door':
            lock = values[b'XLOC']
            if lock[0] != 75 or src.gid(struct.unpack_from('<I', lock, 4)[0]) != key(KEY):
                stop('the door has a changed lock or key')
            row['lock'] = {'level': 75, 'key': KEY}
            selected.append((entry, kind))
        table[desc] = row
    table_check(table)
    # The door base's type matters: a replacement activator is not a door.
    for desc in (BASE, '4d6ed:Skyrim.esm'):
        get(b'DOOR', desc)
    base, src = get(b'ACTI', BAR_BASE)
    values = dict(subrecords(src.data(base)))
    if values.get(b'EDID') != b'TG07DoorBoltSecured\0' or b'VMAD' not in values:
        stop('the bar base no longer identifies the obsolete TG07 mechanism')
    scripts = vmad_parse(values[b'VMAD'], False)['scripts']
    if len(scripts) != 1 or scripts[0]['name'] != b'TG07BarScript' or len(scripts[0]['props']) != 1:
        stop('the bar base has a changed script contract')
    prop = scripts[0]['props'][0]
    if prop['name'] != b'pMessage' or prop['type'] != 1 or src.gid(prop['value']['fid']) != key('94021:Skyrim.esm'):
        stop('the bar base has a changed refusal message')
    for desc in BARS:
        entry, src = get(b'REFR', desc)
        pairs = subrecords(src.data(entry))
        check_pairs(pairs, 'bar')
        if entry.flags & (0x20 | 0x800) or entry.ctx[1] is None or src.gid(entry.ctx[1]) != key(CELL) or \
                src.gid(struct.unpack('<I', dict(pairs)[b'NAME'])[0]) != key(BAR_BASE):
            stop('%s has changed base, cell or visibility' % desc)
        selected.append((entry, 'bar'))
    protected_dependencies(plugins, win, subrecords, vmad_parse)
    return selected


def protected_dependencies(plugins, win, subrecords, vmad_parse):
    bars = {('skyrim.esm', int(desc.split(':')[0], 16)) for desc in BARS}
    targets = bars | {('skyrim.esm', 0x27eed), ('skyrim.esm', 0x270cf)}
    def objects(value):
        if isinstance(value, dict):
            if isinstance(value.get('fid'), int):
                yield value['fid']
            for child in value.values():
                yield from objects(child)
        elif isinstance(value, list):
            for child in value:
                yield from objects(child)
    for (tag, gid), entry in win.items():
        if tag not in (b'REFR', b'ACHR', b'QUST') or gid in bars:
            continue
        src = plugins[entry.pi]
        for field, body in subrecords(src.data(entry)):
            if tag in (b'REFR', b'ACHR') and field in (b'XESP', b'XLKR'):
                offsets = [0] if field == b'XESP' else range(4, len(body), 8)
                for offset in offsets:
                    if offset + 4 <= len(body) and src.gid(struct.unpack_from('<I', body, offset)[0]) in bars:
                        stop('%x:%s depends on a reviewed bolt through %s' % (gid[1], gid[0], field.decode()))
            elif tag == b'QUST' and gid[0] not in VANILLA:
                if field in (b'ALFR', b'ALRT') and len(body) == 4 and src.gid(struct.unpack('<I', body)[0]) in targets:
                    stop('a non-vanilla quest aliases a reviewed door or bolt')
                if field == b'VMAD':
                    # Decode only a script that can name one of the exact targets.
                    owner = next((i for i, name in enumerate(src.masters + [src.name])
                                  if name.lower() == 'skyrim.esm'), None)
                    if owner is not None and any(struct.pack('<I', owner << 24 | fid) in body for _, fid in targets):
                        if any(src.gid(fid) in targets for fid in objects(vmad_parse(body, True)) if fid):
                            stop('a non-vanilla quest script names a reviewed door or bolt')


def verify(plugins, source_win, win, last, manifest, policy, subrecords, vmad_parse, numbers):
    expected_refs = policy_refs(policy)
    if manifest.get('riftwealdUnlocked', []) != list(expected_refs):
        return ['Riftweald manifest differs from the exact policy']
    failures = []
    for source, kind in entries(plugins, source_win, policy, subrecords, vmad_parse):
        src = plugins[source.pi]
        gid = src.gid(source.fid)
        actual = win.get((b'REFR', gid))
        expected = copy_pairs(src, subrecords(src.data(source)), numbers, kind)
        flags = (source.flags & ~0x40000) | (0x800 if kind == 'bar' else 0)
        if actual is None or actual.pi != last.index or actual.flags != flags or \
                subrecords(last.data(actual)) != expected or \
                actual.ctx is None or actual.ctx[1] is None or \
                last.gid(actual.ctx[1]) != src.gid(source.ctx[1]) or actual.ctx[2] != source.ctx[2]:
            failures.append('Riftweald %x has no exact final %s override' % (gid[1], kind))
    if expected_refs:
        key = (b'REFR', ('skyrim.esm', 0x270cf))
        actual, source = win.get(key), source_win.get(key)
        if actual is None or actual.pi != source.pi or actual.fid != source.fid:
            failures.append('Riftweald safe way out was changed by the final plugin')
    return failures
