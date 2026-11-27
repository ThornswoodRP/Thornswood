"""Four individually reviewed authored locks; no general unlock selection."""
import hashlib
import re
import struct

# ref: outside base, inside partner/base, outside/inside cell, lock level
PLAN = {
    '5a7ea:Skyrim.esm': ('2834e:Skyrim.esm', '52a40:Skyrim.esm', '5ad3c:Skyrim.esm', 'd74:Skyrim.esm', '529dd:Skyrim.esm', 50),
    '501a7:Skyrim.esm': ('2834e:Skyrim.esm', '501a9:Skyrim.esm', '2834e:Skyrim.esm', 'd74:Skyrim.esm', '5015d:Skyrim.esm', 50),
    'cb8b9:Skyrim.esm': ('252c7:Skyrim.esm', 'cb8b8:Skyrim.esm', '252c7:Skyrim.esm', '1a270:Skyrim.esm', '165af:Skyrim.esm', 25),
    '24201:JKs Skyrim.esp': ('e9e08:Skyrim.esm', '241ef:JKs Skyrim.esp', 'e9e07:Skyrim.esm', 'd74:Skyrim.esm', '241f2:JKs Skyrim.esp', 50),
}
OWNERS = {'529dd:Skyrim.esm': None, '5015d:Skyrim.esm': '2c006:Skyrim.esm',
          '165af:Skyrim.esm': '93b1b:Skyrim.esm', '241f2:JKs Skyrim.esp': '135e9:Skyrim.esm',
          'd74:Skyrim.esm': None, '1a270:Skyrim.esm': None}
VANILLA = {'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'}

def stop(why):
    raise SystemExit('STOP. Claimable door unlock: %s. Nothing was written.' % why)

def key(desc):
    number, name = desc.split(':', 1)
    return name.lower(), int(number, 16)

def policy_refs(policy):
    rule = policy.get('claimableDoorsUnlocked')
    if rule is None:
        return ()
    types = {ref: 'REFR' for ref in PLAN}
    for base, partner, partner_base, _, _, _ in PLAN.values():
        types.update({base: 'DOOR', partner: 'REFR', partner_base: 'DOOR'})
    records = rule.get('records', {})
    if rule.get('doors') != list(PLAN) or set(records) != set(types):
        stop('policy differs from the exact four reviewed door pairs and bases')
    for desc, row in records.items():
        if row.get('type') != types[desc] or not row.get('winner') or \
                not isinstance(row.get('flags'), int) or \
                any(not re.fullmatch('[0-9a-f]{64}', str(row.get(field, '')))
                    for field in ('sourceSha256', 'dataSha256')):
            stop('invalid exact record guard for %s' % desc)
    return tuple(PLAN)

def table_apply(placed, policy):
    for ref in policy_refs(policy):
        base, pair, pair_base, cell, inside, level = PLAN[ref]
        if placed.get(ref) != {'base': base, 'cell': cell, 'to': pair, 'lock': {'level': level, 'key': None}} or \
                placed.get(pair) != {'base': pair_base, 'cell': inside, 'to': ref}:
            stop('changed door, owner, key, cell or teleport pair at %s' % ref)
    for ref in policy_refs(policy):
        del placed[ref]['lock']

def cell_owners(plugins, win, subrecords):
    for desc, owner in OWNERS.items():
        entry = win.get((b'CELL', key(desc)))
        if entry is None:
            stop('missing parent CELL %s' % desc)
        src = plugins[entry.pi]
        pairs = subrecords(src.data(entry))
        actual = [src.gid(struct.unpack('<I', body)[0]) for tag, body in pairs if tag == b'XOWN']
        if actual != ([key(owner)] if owner else []) or any(tag in (b'VMAD', b'XESP', b'XLKR') for tag, _ in pairs):
            stop('changed owner, script or parent on CELL %s' % desc)

def objects(value):
    if isinstance(value, dict):
        if isinstance(value.get('fid'), int):
            yield value['fid']
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)

def dependencies(plugins, win, policy, subrecords, vmad_parse):
    refs = {key(ref) for ref in PLAN} | {key(row[1]) for row in PLAN.values()}
    extra = {key(row[4]) for row in PLAN.values()} | {key(row[0]) for row in PLAN.values()} | {key(row[2]) for row in PLAN.values()}
    kept = {key(row['quest']) for row in policy.get('questsKept', [])}
    prefixes = tuple(policy.get('questEditorIdPrefixesKept', {}))
    encoded_by_source = {}
    for src in plugins:
        names = [name.lower() for name in src.masters + [src.name]]
        encoded_by_source[src.index] = {
            broad: {struct.pack('<I', names.index(owner) << 24 | number)
                    for owner, number in (refs | extra if broad else refs) if owner in names}
            for broad in (False, True)}
    for (tag, gid), entry in win.items():
        if tag not in (b'QUST', b'REFR', b'ACHR', b'ACTI', b'DOOR'):
            continue
        src = plugins[entry.pi]
        raw = src.data(entry)
        if tag != b'QUST' and not any(token in raw for token in encoded_by_source[src.index][False]):
            continue
        pairs = subrecords(raw)
        edid = dict(pairs).get(b'EDID', b'').rstrip(b'\0').decode('latin1')
        protect_extra = tag == b'QUST' and (gid[0] not in VANILLA or gid in kept or (prefixes and edid.startswith(prefixes)))
        targets = refs | extra if protect_extra else refs
        encoded = encoded_by_source[src.index][bool(protect_extra)]
        for field, body in pairs:
            if field == b'XESP' and len(body) >= 4 and src.gid(struct.unpack_from('<I', body)[0]) in refs:
                stop('an enable parent depends on a reviewed door')
            if field == b'XLKR':
                for offset in range(4, len(body) - 3, 8):
                    if src.gid(struct.unpack_from('<I', body, offset)[0]) in refs:
                        stop('a linked reference depends on a reviewed door')
            if tag == b'QUST' and field in (b'ALFR', b'ALRT', b'ALCO') and len(body) == 4 and src.gid(struct.unpack('<I', body)[0]) in targets:
                stop('a quest aliases a reviewed door, base or cell')
            if field == b'VMAD' and any(token in body for token in encoded):
                if any(src.gid(fid) in targets for fid in objects(vmad_parse(body, tag == b'QUST')) if fid):
                    stop('a script names a reviewed door, base or cell')

def entries(plugins, win, policy, subrecords, vmad_parse):
    if not policy_refs(policy):
        return []
    rule, hashes = policy['claimableDoorsUnlocked'], {}
    guarded_keys = {key(desc) for desc in rule['records']}
    types_by_key = {gid: [] for gid in guarded_keys}
    for (_, gid), entry in win.items():
        if gid in types_by_key:
            types_by_key[gid].append(entry)
    # Check all exact source records before selecting any copy.
    for desc, guard in rule['records'].items():
        gid = key(desc)
        entry = win.get((guard['type'].encode(), gid))
        if entry is None or any(other.pi >= entry.pi and other.tag != entry.tag for other in types_by_key[gid]):
            stop('missing or changed record type for %s' % desc)
        src = plugins[entry.pi]
        if entry.pi not in hashes:
            hashes[entry.pi] = hashlib.sha256(src.buf).hexdigest()
        if src.name != guard['winner'] or hashes[entry.pi] != guard['sourceSha256']:
            stop('changed source for %s' % desc)
        if entry.flags != guard['flags'] or entry.flags & (0x20 | 0x800) or \
                hashlib.sha256(src.data(entry)).hexdigest() != guard['dataSha256']:
            stop('changed record for %s' % desc)
    selected = []
    for ref, (base, pair, pair_base, cell, inside, level) in PLAN.items():
        for desc, expected_base, expected_cell, expected_pair, locked in (
                (ref, base, cell, pair, True), (pair, pair_base, inside, ref, False)):
            entry = win[(b'REFR', key(desc))]
            src = plugins[entry.pi]
            pairs = subrecords(src.data(entry))
            values = dict(pairs)
            world = key('1a26f:Skyrim.esm' if expected_cell == '1a270:Skyrim.esm' else '3c:Skyrim.esm') if locked else None
            if entry.ctx[1] is None or src.gid(entry.ctx[1]) != key(expected_cell) or entry.ctx[2] != 8 or \
                    (src.gid(entry.ctx[0]) if entry.ctx[0] else None) != world or \
                    src.gid(struct.unpack('<I', values[b'NAME'])[0]) != key(expected_base) or \
                    src.gid(struct.unpack_from('<I', values[b'XTEL'])[0]) != key(expected_pair) or \
                    any(tag in (b'XOWN', b'VMAD', b'XESP', b'XLKR') for tag, _ in pairs):
                stop('changed identity, owner, script, placement or pair at %s' % desc)
            locks = [body for tag, body in pairs if tag == b'XLOC']
            if (locked and (len(locks) != 1 or len(locks[0]) != 20 or locks[0][0] != level or
                            struct.unpack_from('<I', locks[0], 4)[0] != 0)) or (not locked and locks):
                stop('changed lock or key at %s' % desc)
            if locked:
                selected.append(entry)
    cell_owners(plugins, win, subrecords)
    dependencies(plugins, win, policy, subrecords, vmad_parse)
    return selected

def copy_pairs(src, pairs, numbers):
    out = []
    lengths = {b'NAME': 4, b'XTEL': 32, b'XNDP': 8, b'XSCL': 4, b'DATA': 24}
    for tag, body in pairs:
        if tag == b'XLOC':
            continue
        if tag != b'EDID' and (tag not in lengths or len(body) != lengths[tag]):
            stop('unexpected copied subrecord %s' % tag.decode())
        if tag in (b'NAME', b'XTEL', b'XNDP'):
            body = struct.pack('<I', numbers.one(src, struct.unpack_from('<I', body)[0], 'claimable door')) + body[4:]
        out.append((tag, body))
    return out

def verify(plugins, source_win, win, last, manifest, policy, subrecords, vmad_parse, numbers):
    expected = policy_refs(policy)
    if manifest.get('claimableDoorsUnlocked', []) != list(expected):
        return ['claimable door manifest differs from the exact four-ref policy']
    failures = []
    for source in entries(plugins, source_win, policy, subrecords, vmad_parse):
        src = plugins[source.pi]
        actual = win.get((b'REFR', src.gid(source.fid)))
        pairs = copy_pairs(src, subrecords(src.data(source)), numbers)
        if actual is None or actual.pi != last.index or actual.flags != source.flags & ~0x40000 or \
                subrecords(last.data(actual)) != pairs or actual.ctx is None or actual.ctx[1] is None or \
                last.gid(actual.ctx[1]) != src.gid(source.ctx[1]) or actual.ctx[2] != source.ctx[2] or \
                (last.gid(actual.ctx[0]) if actual.ctx[0] else None) != (src.gid(source.ctx[0]) if source.ctx[0] else None):
            failures.append('claimable door %x has no exact final XLOC-only override' % source.fid)
    if expected:
        cell_owners(plugins, win, subrecords)
        for desc, guard in policy['claimableDoorsUnlocked']['records'].items():
            if desc in PLAN:
                continue
            record = (guard['type'].encode(), key(desc))
            actual, source = win.get(record), source_win.get(record)
            if actual is None or actual.pi != source.pi or actual.fid != source.fid:
                failures.append('claimable door pair/base %s was changed by the final plugin' % desc)
    return failures
