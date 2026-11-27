"""Retire only the reviewed TG01 surface passage's vanilla physical sequence.

Normal After leaves retain their own names and arrival transforms. The casket
cover is disabled, not animated or deleted; no shared ACTI or script is edited.
"""
import struct

VANILLA = {'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'}
DISABLED, DELETED, COMPRESSED = 0x800, 0x20, 0x40000
# ref, base, partner, cell, editor id, base editor id, desired visibility
DOORS = (
    (0x16c1d, 0x4d233, 0x16d1e, 0x16be0, 'CrypttoGuildDoorBefore', 'RiftenRWPortholeDoor01MinUse', 'disable'),
    (0x16d1e, 0x2d2ff, 0x16c1d, 0x16bd0, 'RiftenTGHQDirecttoSurfaceDoorBefore', 'RiftenRWHallLadderDoor01MinUse', 'disable'),
    (0x2d2dd, 0x49b02, 0x2d2fa, 0x16be0, 'CrypttoGuildDoorAfter', 'RiftenRWPortholeDoor01', 'enable'),
    (0x2d2fa, 0x48b39, 0x2d2dd, 0x16bd0, 'RiftenTGHQDirecttoSurfaceDoorAfter', 'RiftenRWHallLadderDoor01', 'enable'),
)
COVER = 0xc730a
TARGETS = {('skyrim.esm', row[0]) for row in DOORS} | {('skyrim.esm', COVER)}
QUESTS = {'1f326:Skyrim.esm', '21553:Skyrim.esm'}


def stop(why):
    raise SystemExit('STOP. Cistern passage: %s. Nothing was written.' % why)


def enabled(policy):
    rule = policy.get('cisternPassage')
    if rule is None:
        return False
    if rule != {'enabled': True}:
        stop('the exact passage policy changed')
    return True


def receipt(policy):
    return ({'enabled': ['2d2dd:Skyrim.esm', '2d2fa:Skyrim.esm'],
             'disabled': ['16c1d:Skyrim.esm', '16d1e:Skyrim.esm', 'c730a:Skyrim.esm']}
            if enabled(policy) else None)


def require_stopped(manifest, policy):
    if enabled(policy) and not QUESTS <= {row['quest'] for row in manifest.get('quests', {}).get('stopped', [])}:
        stop('both vanilla TG01 and TG07 must remain stopped')


def shape(pairs, mode):
    expected = ([b'VMAD', b'NAME', b'XAPD', b'XAPR', b'XAPR', b'XLKR', b'DATA'] if mode == 'cover' else
                [b'EDID', b'NAME', b'XTEL', b'XNDP', b'DATA'])
    if [tag for tag, _ in pairs] != expected:
        stop('a reviewed placement has changed fields, ownership, scripts or links')
    lengths = {b'NAME': 4, b'XAPD': 1, b'XAPR': 8, b'XLKR': 8, b'XTEL': 32, b'XNDP': 8, b'DATA': 24}
    for tag, body in pairs:
        if tag in lengths and len(body) != lengths[tag]:
            stop('malformed %s on reviewed placement' % tag.decode())


def entries(plugins, win, policy, subrecords, vmad_parse):
    if not enabled(policy):
        return []

    def get(tag, fid):
        row = win.get((tag, ('skyrim.esm', fid)))
        if row is None or row.flags & DELETED or plugins[row.pi].name.lower() not in VANILLA:
            stop('missing, deleted or non-vanilla winning %s %x' % (tag.decode(), fid))
        src = plugins[row.pi]
        return row, src, subrecords(src.data(row))

    def identity(row, src, values, base, cell, was_disabled):
        if (not row.ctx or row.ctx[1] is None or src.gid(row.ctx[1]) != ('skyrim.esm', cell) or
                src.gid(struct.unpack('<I', values[b'NAME'])[0]) != ('skyrim.esm', base) or
                bool(row.flags & DISABLED) != was_disabled):
            stop('a reviewed placement changed its cell, base or initial visibility')

    selected, fields = [], {}
    for fid, base, partner, cell, edid, base_edid, mode in DOORS:
        row, src, pairs = get(b'REFR', fid)
        shape(pairs, 'door'); values = dict(pairs)
        identity(row, src, values, base, cell, mode == 'enable')
        if values[b'EDID'] != edid.encode() + b'\0' or src.gid(struct.unpack_from('<I', values[b'XTEL'])[0]) != ('skyrim.esm', partner):
            stop('a leaf changed its name or reciprocal travel target')
        _, _, base_pairs = get(b'DOOR', base)
        base_values = dict(base_pairs)
        if (base_values.get(b'EDID') != base_edid.encode() + b'\0' or b'VMAD' in base_values or
                base_values.get(b'FNAM') != bytes([0 if mode == 'enable' else 12])):
            stop('a leaf no longer has its reviewed normal or hidden/minimal-use base')
        selected.append((row, mode)); fields[fid] = values
    for before, after in ((0x16c1d, 0x2d2dd), (0x16d1e, 0x2d2fa)):
        if fields[before][b'DATA'] != fields[after][b'DATA']:
            stop('Before and After leaves are no longer colocated')

    row, src, pairs = get(b'REFR', COVER)
    shape(pairs, 'cover'); values = dict(pairs)
    identity(row, src, values, 0xe9350, 0x16be0, False)
    scripts = vmad_parse(values[b'VMAD'], False)['scripts']
    if (len(scripts) != 1 or scripts[0]['name'] != b'RiftenCasketDoorScript' or scripts[0]['props'] or
            values[b'XAPD'] != b'\0' or
            [(src.gid(struct.unpack_from('<I', b)[0]), struct.unpack_from('<f', b, 4)[0])
             for t, b in pairs if t == b'XAPR'] != [(('skyrim.esm', 0xc7312), 0.0), (('skyrim.esm', 0xebec3), 0.0)] or
            values[b'XLKR'][:4] != bytes(4) or src.gid(struct.unpack_from('<I', values[b'XLKR'], 4)[0]) != ('skyrim.esm', 0xebec3)):
        stop('the casket cover changed its own script, activation parents or linked trigger')
    _, _, base_pairs = get(b'ACTI', 0xe9350)
    if dict(base_pairs).get(b'EDID') != b'RTMausoleumDoor\0' or any(t == b'VMAD' for t, _ in base_pairs):
        stop('the casket cover changed its native ACTI base')
    selected.append((row, 'disable'))

    # The exact quest binding establishes the Before/After physical roles.
    _, quest_src, quest_pairs = get(b'QUST', 0x1f326)
    q = dict(quest_pairs)
    if q.get(b'EDID') != b'TG01\0' or b'VMAD' not in q:
        stop('the vanilla sequence changed identity')
    scripts = vmad_parse(q[b'VMAD'], True)['scripts']
    role_scripts = [s for s in scripts if s['name'] == b'TG01QuestScript']
    props = {p['name']: p for s in role_scripts for p in s['props']}
    for fid, base, partner, cell, edid, base_edid, mode in DOORS:
        name = ('pTG01Door' + ('After' if mode == 'enable' else 'Before') +
                ('Outside' if cell == 0x16be0 else 'Inside')).encode()
        prop = props.get(name)
        if len(role_scripts) != 1 or prop is None or prop['type'] != 1 or quest_src.gid(prop['value']['fid']) != ('skyrim.esm', fid):
            stop('the sequence no longer binds exactly the reviewed four leaf roles')
    protected_dependencies(plugins, win, subrecords)
    return selected


def protected_dependencies(plugins, win, subrecords):
    for (tag, gid), row in win.items():
        if row.flags & DELETED or gid in TARGETS:
            continue
        src = plugins[row.pi]
        for field, body in subrecords(src.data(row)):
            if tag in (b'REFR', b'ACHR') and field in (b'XESP', b'XAPR'):
                if len(body) >= 4 and src.gid(struct.unpack_from('<I', body)[0]) in TARGETS:
                    if len(body) != 8:
                        stop('unrecognized incoming parent layout for this passage')
                    stop('an external placement depends on a retired passage reference')
            if src.name.lower() in VANILLA:
                continue
            # Refuse a custom alias or script dependency, even if its unknown
            # VMAD version cannot be decoded. Never silently skip that binding.
            if field in (b'VMAD', b'ALFR', b'ALRT', b'XLKR', b'XTEL', b'NAME'):
                owners = src.masters + [src.name]
                for owner, fid in TARGETS | {('skyrim.esm', 0x16be0), ('skyrim.esm', 0x16bd0)}:
                    for index, name in enumerate(owners):
                        if name.lower() == owner and struct.pack('<I', index << 24 | fid) in body:
                            stop('a non-vanilla winning record names this passage or its cells')


def flags(row, mode):
    clean = row.flags & ~COMPRESSED
    return clean & ~DISABLED if mode == 'enable' else clean | DISABLED


def copy_pairs(src, pairs, numbers, mode):
    shape(pairs, 'cover' if any(tag == b'VMAD' for tag, _ in pairs) else 'door')
    result = []
    for tag, body in pairs:
        if tag in (b'NAME', b'XTEL', b'XNDP', b'XAPR', b'XLKR'):
            offset = 4 if tag == b'XLKR' else 0
            original = struct.unpack_from('<I', body, offset)[0]
            body = body[:offset] + struct.pack('<I', numbers.one(src, original, 'Cistern passage')) + body[offset + 4:]
        elif tag == b'VMAD':
            body = numbers.vmad(src, body, False, 'Cistern passage')
        result.append((tag, body))
    return result


def verify(plugins, source_win, win, last, manifest, policy, subrecords, vmad_parse, numbers):
    require_stopped(manifest, policy)
    if manifest.get('cisternPassage') != receipt(policy):
        return ['Cistern passage receipt differs from the exact policy']
    failures = []
    for source, mode in entries(plugins, source_win, policy, subrecords, vmad_parse):
        src = plugins[source.pi]; gid = src.gid(source.fid)
        actual = win.get((b'REFR', gid))
        if (actual is None or actual.pi != last.index or actual.flags != flags(source, mode) or
                not actual.ctx or last.gid(actual.ctx[1]) != src.gid(source.ctx[1]) or
                actual.ctx[2] != source.ctx[2] or
                (last.gid(actual.ctx[0]) if actual.ctx[0] else None) != (src.gid(source.ctx[0]) if source.ctx[0] else None) or
                subrecords(last.data(actual)) != copy_pairs(src, subrecords(src.data(source)), numbers, mode)):
            failures.append('Cistern %x has no exact final %s override' % (gid[1], mode))
    return failures
