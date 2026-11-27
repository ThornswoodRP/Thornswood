"""Admit placed doors without turning public exterior cells into properties.

Existing interior titles and their locks stay intact. New exterior gateways
share a stable placed-reference identity; a standalone gate owns only itself.
Until the catalogue proves an inside/outside boundary these new leaves remain
passable, using the existing WAY_OUT contract rather than inventing a side.
"""

# Compatibility with the already released runtime town-gate overlay. These are
# property identities and proved inside leaves, not default-lock exclusions.
TOWNS = {
    'gate:whiterun-main': ('Whiterun Main Gate', ('1b1f1:Skyrim.esm', '1b1f3:Skyrim.esm'),
                           ('1b1f3:Skyrim.esm',)),
    'gate:riften-main': ('Riften Main Gate', ('42283:Skyrim.esm', '42284:Skyrim.esm',
                                             '42285:Skyrim.esm', '42286:Skyrim.esm'),
                         ('42283:Skyrim.esm', '42285:Skyrim.esm')),
}


def expand(cells, placed, buildings, by_door, names, way_out, policy, markers=()):
    """Return complete tables and explicit site metadata; never touch claims."""
    rules = policy.get('authoredDoorDefaults') or {}
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
        if kind == 'interior':
            c = cells[site]
            names.setdefault(site, c.get('name') or c.get('edid') or 'A room')
        else:
            names.setdefault(site, 'A gate')
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
    for site in served:
        sites.setdefault(site, {'kind': 'interior', 'name': names[site]})
    return by_door, names, way_out, scopes, sites, added
