"""Admit placed doors without turning public exterior cells into properties.

Existing interior titles and their locks stay intact. New exterior gateways
share a stable placed-reference identity; a standalone gate owns only itself.
Until the catalogue proves an inside/outside boundary these new leaves remain
passable, using the existing WAY_OUT contract rather than inventing a side.
"""
import hashlib
import re

# Compatibility with the already released runtime town-gate overlay. These are
# property identities and proved inside leaves, not default-lock exclusions.
TOWNS = {
    'gate:whiterun-main': ('Whiterun Main Gate', ('1b1f1:Skyrim.esm', '1b1f3:Skyrim.esm'),
                           ('1b1f3:Skyrim.esm',)),
    'gate:riften-main': ('Riften Main Gate', ('42283:Skyrim.esm', '42284:Skyrim.esm',
                                             '42285:Skyrim.esm', '42286:Skyrim.esm'),
                         ('42283:Skyrim.esm', '42285:Skyrim.esm')),
}


def site_name(name, site):
    # A key or mold uses the name as its identity. The code must not change
    # if another gate with the same name is added to the collection.
    code = hashlib.sha256(site.casefold().encode('utf-8')).hexdigest()[:10].upper()
    suffix = ', site ' + code
    return name if name.endswith(suffix) else name + suffix


def expand(cells, placed, buildings, by_door, names, way_out, policy, markers=()):
    """Return complete tables and explicit site metadata; never touch claims."""
    rules = policy.get('authoredDoorDefaults') or {}
    historic = rules.get('historicPropertySites', [])
    if not isinstance(historic, list):
        raise ValueError('historicPropertySites must be a list of issued site identities')
    issued = set()
    for site in historic:
        if not isinstance(site, str) or (site not in TOWNS and not re.fullmatch(
                r'[0-9a-fA-F]{1,8}:[^:\r\n]+\.(?:esm|esp|esl)', site, re.IGNORECASE)):
            raise ValueError('invalid historic property site: %r' % site)
        identity = site.casefold()
        if identity in issued:
            raise ValueError('duplicate historic property site: %s' % site)
        issued.add(identity)
    protected_refs = set(rules.get('protectedDoors', {}))
    protected_cells = set(rules.get('protectedCells', {}))
    markers = set(markers)
    markers.update({ref for ref, row in placed.items() if row.get('to') in markers})
    excluded = {ref for ref, row in placed.items()
                if ref in protected_refs or row['cell'] in protected_cells}
    excluded.update({ref for ref, row in placed.items() if row.get('to') in excluded})
    ignored = excluded | markers
    by_door = {ref: site for ref, site in by_door.items() if ref not in ignored}
    names, way_out = dict(names), {ref: 1 for ref in way_out if ref not in ignored}
    sites = {}

    for site, (label, refs, outs) in TOWNS.items():
        actual = [ref for ref in refs if ref in placed and ref not in ignored]
        if actual:
            by_door.update({ref: site for ref in actual})
            names[site] = label
            way_out.update({ref: 1 for ref in outs if ref in actual})
            sites[site] = {'kind': 'established-gateway', 'name': label}

    added = {}
    for ref, row in sorted(placed.items()):
        if ref in ignored or ref in by_door:
            continue
        cell = cells.get(row['cell'])
        if cell is None:
            raise ValueError('claim site %s has no actual parent CELL' % ref)
        far = placed.get(row.get('to'))
        far_cell = cells.get(far['cell']) if far else None
        if far and far_cell is None:
            raise ValueError('claim site %s has no actual partner CELL' % ref)
        if far_cell and far_cell.get('interior'):
            site, kind = far['cell'], 'interior'
        elif cell.get('interior'):
            site, kind = row['cell'], 'interior'
        elif far and far.get('to') == ref:
            # A native form identity is unique across record types. Using the
            # smaller endpoint preserves one shared site independent of order.
            site, kind = min(ref, row['to']), 'exterior-gateway'
        else:
            site, kind = ref, 'standalone'
        if site in sites and sites[site]['kind'] == 'established-gateway':
            raise ValueError('new claim site collides with an established gateway')
        by_door[ref] = site
        added[ref] = kind
        if site not in names:
            if kind == 'interior':
                c = cells[site]
                label = c.get('name') or c.get('edid') or 'A room'
            else:
                labels = sorted({c['name'] for c in (cell, far_cell) if c and c.get('name')})
                label = 'Gate at ' + ' / '.join(labels) if labels else 'A gate'
            names[site] = label
        sites.setdefault(site, {'kind': kind, 'name': names[site], 'passageOnly': True})
        # All existing meaningful ingress locks retain their old WAY_OUT value.
        # Newly admitted leaves must not acquire a trapping lock by accident.
        way_out[ref] = 1

    # Keep the generation-chain contract: every served name has a real scope
    # with exact reference inputs for hold inference. Native cell sites retain
    # their old ingress list; new door sites use their actual placed leaves.
    served = set(by_door.values())
    names = {site: names[site] for site in served}
    scopes = {site: [ref for ref in refs if ref not in ignored]
              for site, refs in buildings.items() if site in served}
    for ref, site in by_door.items():
        if site not in scopes:
            scopes[site] = []
        if site not in buildings and ref not in scopes[site]:
            scopes[site].append(ref)
    new_names = set()
    for site in served:
        # Pairing can promote a newly admitted CELL into the builder's initial
        # name table. Its issued identity, not that incidental route, decides
        # whether the site code is needed.
        if site.casefold() not in issued and site not in TOWNS:
            names[site] = site_name(names[site], site)
            if names[site] in new_names:
                raise ValueError('new claim site label is not unique: %s' % names[site])
            new_names.add(names[site])
        sites.setdefault(site, {'kind': 'interior', 'name': names[site]})
        sites[site]['name'] = names[site]
    return by_door, names, way_out, scopes, sites, added
