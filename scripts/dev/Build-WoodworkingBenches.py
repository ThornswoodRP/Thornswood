"""
Build-WoodworkingBenches.py

Works out where the server stands a woodworking bench beside each town's
public forge, from the plugins, and writes it down: game\\data\\
woodworking-benches.json and the gamemode's WOODWORKING_BENCH_BASE and
WOODWORKING_BENCHES tables (game\\gamemode-tables, #5191).

WHY (#516)

Since #2529 Thornswood-Content.esp carries a woodworking bench,
ThornswoodCraftingWoodworkingWorkbench (154e2, keyword 154e1), and 26
recipes moved onto it from the forge: the bows, arrows and bolts of Skyrim,
Dawnguard and Dragonborn, our three fishing poles and the fish trap. No
plugin places that bench anywhere. Patrick, 12 October: our own bench, at
least one in every major hold and in some minor towns. The placement brief
(docs\\systems\\station-placement.md, "Woodworking benches") asks for one
beside the public forge in each hold's capital and in towns with an
open-air forge, never at the charcoal kiln.

NO COORDINATE IN HERE IS TYPED FROM THE GAME. Each site in SITES names a
forge reference and an offset in that forge's own frame: so many units to
its right and in front of where its smith stands, and a turn from the
forge's own angle. The point, the height and the angle are worked out of
the forge's winning record over the whole load order, the way the notice
boards' anchors were (#2516, #2555).

WHAT HOLDS A SPOT CLEAR, measured rather than assumed, and the build stops
on any site that fails it:

  The forge. Its winning record over the load order in
  game\\data\\last-plugin.json, the repository's own Thornswood-Content.esp
  in its place, and the repository's Thornswood-Last.esp after it. It has to be placed furniture
  carrying CraftingSmithingForge, enabled, not deleted, with no enable
  parent, in the worldspace SITES says. The server loads furniture
  (WorldState::AttachEspmRecord) and skips disabled and deleted references.

  The ground. The bench's outline and the place its user stands are sampled
  every 16 units. Every sample has to lie on the winning navmesh of that
  worldspace (NAVM, NVNM), which the game's authors cut around walls,
  buildings, rocks and everything solid, within 16 units of every other
  sample and within 60 of the forge's own height. The bench stands on the
  lowest of them, so its far side sinks a few units into the ground rather
  than any of it floating.

  Nothing in the way. No furniture, container, door, activator, plant, item
  or static smaller than 250 by 250 units may overlap the bench or its
  user's place (each one's object bounds, turned and scaled as it is
  placed), unless it lies wholly below the floor or more than 140 units
  above it, and the nearest of them stands at least 30 units from the
  table. Nor may the place somebody stands at any other bench, or the way
  through any door. A larger static (a building, a wall, a rock), and
  anything over 600 units on a side (a dragon's perch, a pond's water), is
  the navmesh's to answer for: its bounds are a box round all of it and
  would cover the street in front of it.

The bench's shape, from its record and its mesh (_BYOH\\Furniture\\
CraftingWorkbench01.nif): its object bounds run x -72 to 81 and y -10 to 75
in its own frame, and the mesh's one furniture marker sits at its origin
facing +y, so the woodworker stands at the origin and the table is in
front of them. TABLE and USER below are those two areas with a margin.

WHAT IT WRITES

  game\\data\\woodworking-benches.json: each site's forge, its winning
  record and every plugin that touches it, the point and angle, the height
  of the ground under it, the nearest solid thing and how far, and every
  plugin read with its size and sha256 (builtAgainst).
  The WOODWORKING_BENCH_BASE table, the bench's base, and the
  WOODWORKING_BENCHES table, each site's forge, worldspace, point and angle.

Read only apart from those three files. --check writes nothing and fails when
either file is not what the plugins give now. --search <site> prints the
clear spots round that site's forge, nearest first, to choose an offset.

Usage:
    python scripts/dev/Build-WoodworkingBenches.py --check
    python scripts/dev/Build-WoodworkingBenches.py
    python scripts/dev/Build-WoodworkingBenches.py --search whiterun
"""

import argparse
import hashlib
import io
import json
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import own_plugins  # noqa: E402
import gamemode_tables  # noqa: E402  (where a table the gamemode reads is written, #5191)
COMPRESSED = 0x00040000
DELETED, DISABLED = 0x20, 0x800

BENCH = ('thornswood-content.esp', 0x154e2)
BENCH_KEYWORD = ('thornswood-content.esp', 0x154e1)
FORGE_KEYWORD_EDID = 'CraftingSmithingForge'
# The repository's own plugins, read from game\content rather than the game folder
# (own_plugins.py reads every file there that way, #2923), and the one made in
# the Data folder from its recipe since #2791, read from there.
OURS = ['Thornswood-Content.esp']
AFTER = ['Thornswood-Last.esp']

# Where the woodworker and the bench are, in the bench's own frame (x right, y the way the woodworker faces).
TABLE = (-75.0, 8.0, 85.0, 88.0)
USER = (-35.0, -55.0, 35.0, 8.0)
# Where somebody stands at any other bench, and the way through a door, in their frames.
FURN_USER = (-35.0, -60.0, 35.0, 10.0)
DOOR_WAY = (-80.0, -160.0, 80.0, 160.0)
SAMPLE = 16.0
# A navmesh height further than this from the forge's is another storey, not this ground.
LAYER = 250.0
# The bench stands on the forge's own floor, not up a stair or down a bank from it.
STOREY = 60.0
FLAT = 16.0
# Room left round the table to the nearest solid thing, so a woodworker walks round it.
MARGIN = 30.0
CLEAR_BELOW, CLEAR_ABOVE = 6.0, 140.0
BIG_STATIC = 250.0 * 250.0
VOLUME = 600.0
NOT_SOLID = {'XMarker', 'XMarkerHeading', 'CollisionMarker', 'NorthMarker', 'MapMarker', 'COCMarkerHeading',
             'DivineMarker', 'TempleMarker', 'HeadingMarker', 'RoomMarker', 'PortalMarker', 'PlaneMarker'}
SOLID = {'STAT', 'SCOL', 'MSTT', 'FURN', 'CONT', 'DOOR', 'ACTI', 'TREE', 'FLOR', 'MISC', 'WEAP', 'ARMO', 'LIGH',
         'TACT', 'BOOK', 'ALCH', 'INGR', 'AMMO', 'KEYM', 'SLGM', 'MOVS', 'ADDN'}
LARGE = {'STAT', 'SCOL', 'MSTT', 'TREE'}

# THE SITES. forge: the forge reference, as the server names it. offset: the
# bench's point in the forge's frame, x to the smith's right and y the way
# the smith faces. turn: the bench's angle less the forge's, in degrees. Why
# each was chosen is in game\data\woodworking-benches.json under "why".
SITES = {
    'whiterun': {
        'where': 'Whiterun', 'forge': 'c430a:Skyrim.esm', 'cell': '1a26f:Skyrim.esm', 'offset': (-668, -23), 'turn': 315,
        'why': 'Warmaiden\'s forge, not the Skyforge. The smithing yard round it is cut up by the tanning rack, the '
               'armour bench, the grindstone, the smelter and JK\'s Skyrim\'s railings, and searched every 20 units '
               'in four turns no clear spot within 640 units is on the forge\'s own floor. This one is north of '
               'Warmaiden\'s shop, by its wall, on the forge\'s floor, facing north. It is the same spot as before '
               '#2553, measured now from where Skyrim stands the forge: until then the forge stood where the other '
               'server\'s plugin had moved and turned it.'},
    'solitude': {
        'where': 'Solitude', 'forge': '4e3e9:Skyrim.esm', 'cell': '37edf:Skyrim.esm', 'offset': (20, -200), 'turn': 0,
        'why': 'Beirand\'s forge. Behind the smith, in the open yard between the smelter, '
               'the armour bench and the forge, on the forge\'s floor, facing the way the forge does.'},
    'windhelm': {
        'where': 'Windhelm', 'forge': 'f7798:Skyrim.esm', 'cell': '1691d:Skyrim.esm', 'offset': (-100, -240), 'turn': 180,
        'why': 'The blacksmith yard\'s forge, Skyrim\'s own and untouched by any plugin. Behind the smith, '
               'facing away from the forge, the grindstone nearest at 53 units. Until #2553 it stood to the '
               'smith\'s left; Skyrim\'s tanning rack there is back at its own size and place, 15 units from that '
               'table, since the other server\'s plugin no longer shrinks and moves it.'},
    'markarth': {
        'where': 'Markarth', 'forge': '514d8:Skyrim.esm', 'cell': '16d71:Skyrim.esm', 'offset': (680, -300), 'turn': 0,
        'why': 'Ghorza\'s forge. Markarth is built in tiers and JK\'s Skyrim fills the forge\'s '
               'own ledge; searched every 20 units in eight turns, the nearest clear spot on flat ground is this '
               'one, on the walk a step below the forge to the smith\'s right.'},
    'riften': {
        'where': 'Riften', 'forge': '53481:Skyrim.esm', 'cell': '16bb4:Skyrim.esm', 'offset': (240, 100), 'turn': 270,
        'why': 'The Scorched Hammer\'s forge, where Skyrim stands it since #2553 (the other server\'s plugin had '
               'moved it 101 units and turned it a quarter turn, onto the spot the bench had). To the smith\'s '
               'right on the same boards, a signpost nearest at 70 units.'},
    'falkreath': {
        'where': 'Falkreath', 'forge': '99b8a:Skyrim.esm', 'cell': '3c:Skyrim.esm', 'offset': (-380, 80), 'turn': 0,
        'why': 'Lod\'s forge. To the smith\'s left, on the flat yard in front of the smithy, facing the way the '
               'forge does.'},
    'dawnstar': {
        'where': 'Dawnstar', 'forge': 'cadf6:Skyrim.esm', 'cell': '3c:Skyrim.esm', 'offset': (-240, -380), 'turn': 0,
        'why': 'Rustleif\'s forge. Behind the smith and to the left, on the flat yard, clear of the barrels.'},
    'morthal': {
        'where': 'Morthal', 'forge': '24588:JKs Skyrim.esp', 'cell': '3c:Skyrim.esm', 'offset': (-400, 120), 'turn': 0,
        'why': 'Morthal has no forge of Skyrim\'s own. JK\'s Skyrim gives it a smithing anvil, which opens the same '
               'menu as a forge and is where Morthal\'s smiths work, so the bench stands beside that: to the '
               'smith\'s left, on the flat ground, clear of the fire pit.'},
    'riverwood': {
        'where': 'Riverwood', 'forge': 'd6987:Skyrim.esm', 'cell': '3c:Skyrim.esm', 'offset': (-320, 240), 'turn': 0,
        'why': 'Alvor\'s forge in the open. To the smith\'s left, on the flat yard, nowhere near the charcoal kiln '
               'up the road (#2337).'},
}

# Towns in the placement brief with no bench, and why. Measured 15 October over
# the same load order: every placed reference carrying CraftingSmithingForge.
SKIPPED = {
    'winterhold': 'no forge: JK\'s Skyrim\'s smithing anvil (89c2:JKs Skyrim.esp) stands inside a shack of its own, '
                  'and no clear flat ground of the bench\'s size lies within 640 units of it on its floor.',
    'rorikstead': 'no forge of Skyrim\'s own. JK\'s Skyrim\'s anvil yard (62b1:JKs Skyrim.esp) sits on a raised '
                  'ledge, and no clear flat ground of the bench\'s size lies within 640 units of it on that ledge.',
    'ivarstead': 'no forge and no anvil: no placed reference carrying CraftingSmithingForge stands in Ivarstead.',
    'dragonbridge': 'its forge (531b:JKs Skyrim.esp) stands on sloping ground; the nearest clear flat spot is '
                    '725 units away out in the field, which is not beside a forge. The second forge, aa57 in '
                    'Thornswood-Content.esp, was the other server\'s and left with its placements (#2553).',
}


# ------------------------------------------------------------------ plugins --

def subs(d):
    out, i, big = [], 0, None
    while i + 6 <= len(d):
        t = d[i:i + 4]
        n = struct.unpack_from('<H', d, i + 4)[0]
        if t == b'XXXX':
            big = struct.unpack_from('<I', d, i + 6)[0]
            i += 6 + n
            continue
        if big is not None:
            n, big = big, None
        out.append((t, d[i + 6:i + 6 + n]))
        i += 6 + n
    return out


class Plugin:
    def __init__(self, path, name):
        self.name = name
        self.buf = open(path, 'rb').read()
        hs = struct.unpack_from('<I', self.buf, 4)[0]
        self.masters = [b.rstrip(b'\0').decode('latin1') for t, b in subs(self.buf[24:24 + hs]) if t == b'MAST']
        self.files = [m.lower() for m in self.masters] + [name.lower()]
        self.start = 24 + hs
        self.size = len(self.buf)
        self.sha256 = hashlib.sha256(self.buf).hexdigest()

    def key(self, fid):
        idx = fid >> 24
        return (self.files[idx] if idx < len(self.files) else self.name.lower(), fid & 0xFFFFFF)

    def body(self, p, size, flags):
        d = self.buf[p + 24:p + 24 + size]
        return zlib.decompress(d[4:]) if flags & COMPRESSED else d

    def walk(self, visit, tops=None):
        buf = self.buf
        stack = [(self.start, len(buf), None, None)]
        while stack:
            p, end, world, cell = stack.pop()
            while p + 24 <= end:
                tag = buf[p:p + 4]
                size = struct.unpack_from('<I', buf, p + 4)[0]
                if tag == b'GRUP':
                    label = struct.unpack_from('<I', buf, p + 8)[0]
                    gt = struct.unpack_from('<i', buf, p + 12)[0]
                    w, c = world, cell
                    if gt == 0 and tops is not None and buf[p + 8:p + 12] not in tops:
                        p += size
                        continue
                    if gt == 1:
                        w, c = self.key(label), None
                    elif gt in (6, 8, 9, 10):
                        c = self.key(label)
                    stack.append((p + 24, p + size, w, c))
                    p += size
                    continue
                visit(tag, p, size, struct.unpack_from('<I', buf, p + 8)[0],
                      struct.unpack_from('<I', buf, p + 12)[0], world, cell)
                p += 24 + size


class World:
    """What the load order says, last plugin wins."""

    def __init__(self, plugins):
        self.plugins = plugins
        self.names = {pl.name.lower(): pl.name for pl in plugins}
        self.bases, self.kywd, self.worlds, self.cells = {}, {}, {}, {}
        tops = {b'KYWD', b'WRLD', b'CELL'} | {t.encode() for t in SOLID} | {b'NPC_', b'SOUN', b'IDLM'}
        for pl in plugins:
            def visit(tag, p, size, flags, fid, world, cell, pl=pl):
                if tag not in tops:
                    return
                k = pl.key(fid)
                ss = subs(pl.body(p, size, flags))
                edid = next((b.rstrip(b'\0').decode('latin1') for t, b in ss if t == b'EDID'), '')
                if tag == b'KYWD':
                    self.kywd[k] = edid
                elif tag == b'WRLD':
                    self.worlds[k] = edid
                elif tag == b'CELL':
                    grid, cflags = None, 0
                    for t, b in ss:
                        if t == b'XCLC' and len(b) >= 8:
                            grid = struct.unpack_from('<ii', b)
                        elif t == b'DATA' and len(b) >= 1:
                            cflags = b[0]
                    self.cells[k] = (world, grid, bool(cflags & 1))
                else:
                    ob, kws, model = None, [], ''
                    for t, b in ss:
                        if t == b'OBND' and len(b) == 12:
                            ob = struct.unpack_from('<6h', b)
                        elif t == b'KWDA':
                            kws = [pl.key(x) for x in struct.unpack_from('<%dI' % (len(b) // 4), b)]
                        elif t == b'MODL':
                            model = b.rstrip(b'\0').decode('latin1')
                    self.bases[k] = (tag.decode(), edid, ob, kws, pl.name, model)
            pl.walk(visit)

    def desc(self, k):
        return '%x:%s' % (k[1], self.names.get(k[0], k[0]))

    def refs(self, want_key=None, region=None):
        """Placed references, winning record each, with every plugin that carries one.
        want_key(k) picks by id; region is a set of (world, gx, gy) and also brings the navmeshes."""
        refs, navms = {}, {}
        for pl in self.plugins:
            def visit(tag, p, size, flags, fid, world, cell, pl=pl):
                if tag == b'NAVM':
                    if region is None or not cell:
                        return
                    ci = self.cells.get(cell)
                    if not ci or not ci[1] or (ci[0], ci[1][0], ci[1][1]) not in region:
                        return
                    k = pl.key(fid)
                    if flags & DELETED:
                        navms[k] = None
                        return
                    for t, b in subs(pl.body(p, size, flags)):
                        if t == b'NVNM':
                            nv = struct.unpack_from('<I', b, 16)[0]
                            verts = struct.unpack_from('<%df' % (nv * 3), b, 20)
                            q = 20 + nv * 12
                            nt = struct.unpack_from('<I', b, q)[0]
                            tris = [struct.unpack_from('<3H', b, q + 4 + i * 16) for i in range(nt)]
                            navms[k] = (ci[0], verts, tris)
                    return
                if tag not in (b'REFR', b'ACHR'):
                    return
                k = pl.key(fid)
                ci = self.cells.get(cell) if cell else None
                interior = bool(ci and ci[2])
                w = None if interior else (world or (ci[0] if ci else None))
                if region is None and not want_key(k):
                    return
                d = pl.body(p, size, flags)
                base, pos, scale, xesp = None, None, 1.0, None
                for t, b in subs(d):
                    if t == b'NAME':
                        base = pl.key(struct.unpack_from('<I', b)[0])
                    elif t == b'DATA' and len(b) >= 24:
                        pos = struct.unpack_from('<6f', b)
                    elif t == b'XSCL':
                        scale = struct.unpack_from('<f', b)[0]
                    elif t == b'XESP':
                        xesp = pl.key(struct.unpack_from('<I', b)[0])
                if pos is None:
                    return
                picked = want_key is not None and want_key(k)
                if not picked:
                    if interior or (w, int(pos[0] // 4096), int(pos[1] // 4096)) not in region:
                        return
                prev = refs.get(k)
                refs[k] = dict(base=base, pos=list(pos[:3]), rot=list(pos[3:]), scale=scale, flags=flags,
                               xesp=xesp, world=w, interior=interior, by=pl.name,
                               touched=(prev['touched'] if prev else []) + [pl.name])
            pl.walk(visit, tops={b'WRLD', b'CELL'})
        return refs, navms


# --------------------------------------------------------------- geometry ----

def turn_xy(lx, ly, a):
    """A point in a frame turned by a (radians, Skyrim's clockwise heading) to world offsets."""
    c, s = math.cos(a), math.sin(a)
    return lx * c + ly * s, -lx * s + ly * c


def rot3(rx, ry, rz):
    def mul(A, B):
        return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    cx, sx = math.cos(-rx), math.sin(-rx)
    cy, sy = math.cos(-ry), math.sin(-ry)
    cz, sz = math.cos(-rz), math.sin(-rz)
    Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return mul(Rz, mul(Ry, Rx))


def corners(r, ob):
    R = rot3(*r['rot'])
    out = []
    for x in (ob[0], ob[3]):
        for y in (ob[1], ob[4]):
            for z in (ob[2], ob[5]):
                v = (x * r['scale'], y * r['scale'], z * r['scale'])
                out.append(tuple(r['pos'][i] + sum(R[i][j] * v[j] for j in range(3)) for i in range(3)))
    return out


def rect(x, y, a, box):
    x0, y0, x1, y1 = box
    out = []
    for lx, ly in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        dx, dy = turn_xy(lx, ly, a)
        out.append((x + dx, y + dy))
    return out


def hull(pts):
    pts = sorted(set((round(p[0], 3), round(p[1], 3)) for p in pts))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def overlap(A, B):
    """Separating axis test for two convex outlines."""
    if len(A) < 3 or len(B) < 3:
        return False
    for P in (A, B):
        for i in range(len(P)):
            ex, ey = P[(i + 1) % len(P)][0] - P[i][0], P[(i + 1) % len(P)][1] - P[i][1]
            ax, ay = -ey, ex
            pa = [p[0] * ax + p[1] * ay for p in A]
            pb = [p[0] * ax + p[1] * ay for p in B]
            if max(pa) <= min(pb) or max(pb) <= min(pa):
                return False
    return True


class Site:
    """Everything round one forge: what is solid, and the navmesh."""

    def __init__(self, world, forge, refs, navms):
        self.w = world
        self.f = forge
        fx, fy = forge['pos'][0], forge['pos'][1]
        self.things = []
        for k, r in refs.items():
            if r['interior'] or r['world'] != forge['world'] or (r['flags'] & (DELETED | DISABLED)):
                continue
            if math.hypot(r['pos'][0] - fx, r['pos'][1] - fy) > 1200:
                continue
            b = world.bases.get(r['base'])
            if not b or b[0] not in SOLID or b[1] in NOT_SOLID or not b[2]:
                continue
            # Nothing drawn, or an editor marker (Markers\...): nothing to walk into.
            if b[0] != 'FURN' and (not b[5] or b[5].lower().startswith('markers' + chr(92))):
                continue
            ob = b[2]
            area = (ob[3] - ob[0]) * (ob[4] - ob[1]) * r['scale'] ** 2
            if area == 0:
                continue
            if b[0] in LARGE and area > BIG_STATIC:
                continue
            # A dragon's perch, a pond's water, a tower: a volume, not a thing on the floor.
            if max(ob[3] - ob[0], ob[4] - ob[1]) * r['scale'] > VOLUME:
                continue
            cs = corners(r, ob)
            zs = [c[2] for c in cs]
            name = world.desc(k)
            self.things.append(dict(ref=name, edid=b[1], outline=hull([(c[0], c[1]) for c in cs]),
                                    lo=min(zs), hi=max(zs), solid=True))
            if b[0] == 'FURN':
                self.things.append(dict(ref=name, edid=b[1] + ', where its user stands',
                                        outline=rect(r['pos'][0], r['pos'][1], r['rot'][2], FURN_USER),
                                        lo=r['pos'][2] - 20, hi=r['pos'][2] + 150, solid=False))
            elif b[0] == 'DOOR':
                self.things.append(dict(ref=name, edid=b[1] + ', its way through',
                                        outline=rect(r['pos'][0], r['pos'][1], r['rot'][2], DOOR_WAY),
                                        lo=r['pos'][2] - 20, hi=r['pos'][2] + 150, solid=False))
        self.tris = []
        for k, v in navms.items():
            if not v or v[0] != forge['world']:
                continue
            _, vs, ts = v
            for t in ts:
                P = [(vs[i * 3], vs[i * 3 + 1], vs[i * 3 + 2]) for i in t]
                cx = (P[0][0] + P[1][0] + P[2][0]) / 3
                cy = (P[0][1] + P[1][1] + P[2][1]) / 3
                if math.hypot(cx - fx, cy - fy) < 1500:
                    self.tris.append((P, min(p[0] for p in P), max(p[0] for p in P),
                                      min(p[1] for p in P), max(p[1] for p in P)))

    def ground(self, x, y, zref):
        best = None
        for P, x0, x1, y0, y1 in self.tris:
            if x < x0 or x > x1 or y < y0 or y > y1:
                continue
            a, b, c = P
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
            l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
            l3 = 1 - l1 - l2
            if min(l1, l2, l3) < -1e-6:
                continue
            z = l1 * a[2] + l2 * b[2] + l3 * c[2]
            if abs(z - zref) < LAYER and (best is None or abs(z - zref) < abs(best - zref)):
                best = z
        return best

    def check(self, x, y, a):
        """(clear, height, low, high, why) for a bench at x, y turned a radians."""
        zs = []
        for box in (TABLE, USER):
            x0, y0, x1, y1 = box
            nx, ny = max(2, int((x1 - x0) / SAMPLE) + 1), max(2, int((y1 - y0) / SAMPLE) + 1)
            for i in range(nx):
                for j in range(ny):
                    lx, ly = x0 + (x1 - x0) * i / (nx - 1), y0 + (y1 - y0) * j / (ny - 1)
                    dx, dy = turn_xy(lx, ly, a)
                    z = self.ground(x + dx, y + dy, self.f['pos'][2])
                    if z is None:
                        return False, None, None, None, 'off the navmesh at %d, %d in the bench\'s frame' % (lx, ly)
                    zs.append(z)
        lo, hi = min(zs), max(zs)
        if hi - lo > FLAT:
            return False, None, lo, hi, 'the ground under it runs %.0f to %.0f' % (lo, hi)
        # Its feet on the lowest sample: the far side sinks a few units into the ground, nothing floats.
        z = lo
        if abs(z - self.f['pos'][2]) > STOREY:
            return False, z, lo, hi, 'its ground is %.0f units from the forge\'s height' % (z - self.f['pos'][2])
        mine = [rect(x, y, a, TABLE), rect(x, y, a, USER)]
        for t in self.things:
            if t['hi'] < z + CLEAR_BELOW or t['lo'] > z + CLEAR_ABOVE:
                continue
            for m in mine:
                if overlap(m, t['outline']):
                    return False, z, lo, hi, 'touches %s (%s)' % (t['edid'], t['ref'])
        return True, z, lo, hi, 'clear'

    def nearest(self, x, y, a, z):
        best = (1e9, None)
        for t in self.things:
            if not t['solid'] or t['hi'] < z + CLEAR_BELOW or t['lo'] > z + CLEAR_ABOVE:
                continue
            for p in t['outline']:
                dx, dy = p[0] - x, p[1] - y
                c, s = math.cos(a), math.sin(a)
                lx, ly = dx * c - dy * s, dx * s + dy * c
                ex = max(TABLE[0] - lx, 0, lx - TABLE[2])
                ey = max(TABLE[1] - ly, 0, ly - TABLE[3])
                d = math.hypot(ex, ey)
                if d < best[0]:
                    best = (d, t)
        return best


# ------------------------------------------------------------------- main ----

def load_order(data):
    lo = json.load(io.open(os.path.join(ROOT, 'game', 'data', 'last-plugin.json'), encoding='utf-8'))['loadOrder']
    out = []
    for name in lo + AFTER:
        out.append((own_plugins.plugin_path(data, name), name))
    return out


def norm_deg(a):
    return round(((a % 360) + 360) % 360, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.environ.get('THORNSWOOD_DATA') or r'C:\Thornswood\Game\Data')
    ap.add_argument('--out', default=os.path.join(ROOT, 'game', 'data', 'woodworking-benches.json'))
    ap.add_argument('--tables', default=None,
                    help='the folder of gamemode tables (#5191); game/gamemode-tables when not given')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--search', default='')
    args = ap.parse_args()

    order = load_order(args.data)
    missing = [n for p, n in order if not os.path.isfile(p)]
    if missing:
        print('STOP. %d plugin(s) of the load order are not there: %s' % (len(missing), ', '.join(missing[:6])))
        return 1
    plugins = [Plugin(p, n) for p, n in order]
    # The game folder has to hold the collection's own bytes, or this measures another world.
    record = json.load(io.open(os.path.join(ROOT, 'records', 'collection-plugins.json'), encoding='utf-8'))
    rec = {r['name'].lower(): r for r in record['plugins']}
    other = [pl.name for pl in plugins if pl.name not in OURS + AFTER and
             (pl.name.lower() not in rec or rec[pl.name.lower()]['sha256'].lower() != pl.sha256)]
    if other:
        print('STOP. %d plugin(s) in %s are not the collection\'s bytes (revision %s): %s'
              % (len(other), args.data, record.get('revision'), ', '.join(other[:6])))
        return 2
    print('The load order: %d plugins, game\\data\\last-plugin.json\'s then %s; %s read from game\\content'
          % (len(plugins), ' and '.join(AFTER), ', '.join(OURS + AFTER)))
    world = World(plugins)
    fails = []

    bench = world.bases.get(BENCH)
    if not bench or bench[0] != 'FURN' or BENCH_KEYWORD not in bench[3] or \
            world.kywd.get(BENCH_KEYWORD) != 'ThornswoodCraftingWoodworking':
        print('STOP. %s is not furniture carrying ThornswoodCraftingWoodworking in this load order' % world.desc(BENCH))
        return 1
    forge_kw = [k for k, v in world.kywd.items() if v == FORGE_KEYWORD_EDID]
    print('The bench: %s %s, keyword %s' % (world.desc(BENCH), bench[1], world.desc(BENCH_KEYWORD)))

    sites = dict(SITES)
    if args.search and args.search not in sites:
        print('STOP. no site %s in SITES' % args.search)
        return 1
    want = {}
    for site, s in sites.items():
        f, h = s['forge'].split(':', 1)
        want[(h.lower(), int(f, 16))] = site
    picked, _ = world.refs(want_key=lambda k: k in want)
    region = set()
    for k, site in want.items():
        r = picked.get(k)
        if not r or r['interior'] or not r['world']:
            continue
        gx, gy = int(r['pos'][0] // 4096), int(r['pos'][1] // 4096)
        for x in range(gx - 1, gx + 2):
            for y in range(gy - 1, gy + 2):
                region.add((r['world'], x, y))
    refs, navms = world.refs(region=region)
    refs.update(picked)

    rows = {}
    for site in sorted(sites):
        s = sites[site]
        k = [kk for kk, v in want.items() if v == site][0]
        r = refs.get(k)
        say = '  %-12s ' % site
        if not r:
            fails.append('%s: the forge %s is in no plugin' % (site, s['forge']))
            print(say + 'STOP. the forge %s is in no plugin' % s['forge'])
            continue
        b = world.bases.get(r['base'])
        why = []
        if not b or b[0] != 'FURN' or not any(kw in b[3] for kw in forge_kw):
            why.append('is not furniture carrying %s' % FORGE_KEYWORD_EDID)
        if r['flags'] & DELETED:
            why.append('is deleted by %s' % r['by'])
        if r['flags'] & DISABLED:
            why.append('is disabled by %s' % r['by'])
        if r['xesp']:
            why.append('has an enable parent in %s' % r['by'])
        if r['interior'] or world.desc(r['world']) != s['cell']:
            why.append('is in %s, not %s' % (world.desc(r['world']) if r['world'] else 'an interior', s['cell']))
        if why:
            fails.append('%s: the forge %s %s' % (site, s['forge'], '; '.join(why)))
            print(say + 'STOP. the forge %s %s' % (s['forge'], '; '.join(why)))
            continue
        here = Site(world, r, refs, navms)
        fa = r['rot'][2]
        if args.search == site:
            print('Clear spots round %s\'s forge %s, nearest first' % (site, s['forge']))
            found = []
            for t in (0, 90, 180, 270):
                for dx in range(-640, 641, 20):
                    for dy in range(-640, 641, 20):
                        d = math.hypot(dx, dy)
                        if d < 120 or d > 640:
                            continue
                        ox, oy = turn_xy(dx, dy, fa)
                        ok, z, lo, hi, w = here.check(r['pos'][0] + ox, r['pos'][1] + oy, fa + math.radians(t))
                        if ok:
                            found.append((d + (0 if t == 0 else 60), dx, dy, t, z))
            shown = 0
            for f2 in sorted(found):
                ox, oy = turn_xy(f2[1], f2[2], fa)
                dist, near = here.nearest(r['pos'][0] + ox, r['pos'][1] + oy, fa + math.radians(f2[3]), f2[4])
                if dist < MARGIN:
                    continue
                print('    offset %d, %d turn %d, ground %.1f, nearest %s %d units' % (f2[1:] + (near['edid'] if near else 'nothing', dist if near else 0)))
                shown += 1
                if shown >= 20:
                    break
            return 0
        ox, oy = turn_xy(s['offset'][0], s['offset'][1], fa)
        x, y = r['pos'][0] + ox, r['pos'][1] + oy
        a = fa + math.radians(s['turn'])
        ok, z, lo, hi, w = here.check(x, y, a)
        if not ok:
            fails.append('%s: the spot is not clear, %s' % (site, w))
            print(say + 'STOP. the spot is not clear: %s' % w)
            continue
        dist, near = here.nearest(x, y, a, z)
        if near and dist < MARGIN:
            fails.append('%s: %s is %d units from the table' % (site, near['edid'], dist))
            print(say + 'STOP. %s (%s) is %d units from the table, under %d' % (near['edid'], near['ref'], dist, MARGIN))
            continue
        rows[site] = {
            'where': s['where'],
            'forge': s['forge'],
            'forgeEdid': b[1],
            'forgeRecordFrom': r['by'],
            'forgeTouchedBy': r['touched'],
            'forgeAt': [round(v, 1) for v in r['pos']],
            'forgeAngle': norm_deg(math.degrees(fa)),
            'cell': s['cell'],
            'worldEdid': world.worlds.get(r['world'], ''),
            'offset': list(s['offset']),
            'turn': s['turn'],
            'pos': [round(x, 1), round(y, 1), round(z, 1)],
            'angle': norm_deg(math.degrees(a)),
            'groundUnder': [round(lo, 1), round(hi, 1)],
            'fromForge': round(math.hypot(s['offset'][0], s['offset'][1])),
            'nearest': {'edid': near['edid'], 'ref': near['ref'], 'units': round(dist)} if near else None,
            'why': s['why'],
        }
        print(say + '%-28s %-22s at %s turned %s, ground %.0f to %.0f, nearest %s %d units'
              % (s['forge'] + ' ' + b[1], rows[site]['worldEdid'], rows[site]['pos'], rows[site]['angle'],
                 lo, hi, near['edid'] if near else 'nothing', dist if near else 0))

    if fails:
        print('')
        print('%d site(s) failed; nothing was written.' % len(fails))
        return 1

    payload = {
        'builtBy': 'scripts/dev/Build-WoodworkingBenches.py',
        'issue': 516,
        'bench': world.desc(BENCH),
        'benchEdid': bench[1],
        'keyword': world.desc(BENCH_KEYWORD),
        'readFrom': 'game/data/last-plugin.json loadOrder, then %s; %s from game/content, %s made in the Data folder from its recipe'
                    % (', '.join(AFTER), ', '.join(OURS), ', '.join(AFTER)),
        'rule': ('Each bench stands beside a forge, at offset (x to the smith\'s right, y the way the smith faces) '
                 'and turn from the forge\'s winning record. Its outline (x %g to %g, y %g to %g) and its user\'s '
                 'place (x %g to %g, y %g to %g) lie on the navmesh, on ground flat to %g units and within %g of the '
                 'forge\'s height, and touch no furniture, container, door, item or static under %d by %d (larger '
                 'statics, and anything over %d units on a side, are the navmesh\'s), nor where anybody stands at '
                 'another bench or the way through a door, from %g to %g units above the floor, with %g units round '
                 'the table. It stands on the lowest of those samples.'
                 % (TABLE[0], TABLE[2], TABLE[1], TABLE[3], USER[0], USER[2], USER[1], USER[3], FLAT, STOREY,
                    int(math.sqrt(BIG_STATIC)), int(math.sqrt(BIG_STATIC)), int(VOLUME), CLEAR_BELOW, CLEAR_ABOVE,
                    MARGIN)),
        'benches': rows,
        'skipped': SKIPPED,
        'builtAgainst': [{'name': pl.name, 'size': pl.size, 'sha256': pl.sha256} for pl in plugins],
    }
    text = json.dumps(payload, indent=1, sort_keys=True) + '\n'

    # The gamemode says above its table() lines what these hold;
    # game\\data\\woodworking-benches.json says what was measured at each spot.
    tables = {
        'WOODWORKING_BENCH_BASE': json.dumps(world.desc(BENCH)),
        'WOODWORKING_BENCHES': json.dumps(
            {site: {'where': v['where'], 'forge': v['forge'], 'cell': v['cell'], 'pos': v['pos'],
                    'angle': v['angle']} for site, v in sorted(rows.items())}, sort_keys=True),
    }

    if args.check:
        old = io.open(args.out, encoding='utf-8').read() if os.path.isfile(args.out) else ''
        bad = []
        if old != text:
            bad.append('game/data/woodworking-benches.json')
        bad += ['the %s table' % name for name, t in tables.items()
                if not gamemode_tables.is_current(name, t, args.tables)]
        print('')
        if bad:
            print('--check: %s differ from what the plugins give now. Run this without --check.' % ' and '.join(bad))
            return 1
        print('--check: woodworking-benches.json and both tables are what the plugins give. Nothing was written.')
        return 0
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(text)
    for name, t in tables.items():
        gamemode_tables.write(name, t, args.tables)
    print('')
    print('wrote %s and the WOODWORKING_BENCH_BASE and WOODWORKING_BENCHES tables, %d bench(es)' % (args.out, len(rows)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
