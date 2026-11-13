"""
own_plugins.py

Where a builder reads a plugin of the load order from (#2923).

Thornswood's own plugins (Thornswood-Content.esp and any other file in
game/content) are made and shipped from this repository's game/content.
A game folder holds whichever release last reached it, so a table read from
there describes a plugin nobody ships. Every plugin whose name is a file in
game/content is read from there, and every other plugin from the game's Data
folder. The same rule is OwnPlugins.js and OwnPlugins.ps1;
tests/test-2923-own-plugins.js holds the three to it.

Thornswood-Last.esp is ours too, built here by Build-LastPlugin.py, but since
#2791 no repository holds it: it copies other authors' records, so it is made
in the Data folder from its recipe, game/data/last-plugin.recipe
(Make-LastPlugin.py), and read from there (MADE_IN_DATA). is_own still names
it, so what pins a load order by the collection's bytes leaves its bytes out
the way it leaves the content plugin's out (MerchantLoadOrderPin.js, #613).

Which plugins are in the load order is read here too (#2976). The game loads
Skyrim's five masters, then every line of plugins.txt that starts with '*'. A
line without one is a plugin Vortex or the launcher knows about and has
switched off: the game does not load it, and its file may be gone. Eight
builders parsed plugins.txt on their own and four of those took the switched
off lines as loaded, so on 20 Oct Build-DoorTable.py stopped on
ElysiumEstateSSE.esp, a switched off line whose file the launcher had removed
on 1 Oct. Every builder takes its load order from load_order.

    import own_plugins
    order = own_plugins.load_order(args.plugins)
    path = own_plugins.plugin_path(data, 'Thornswood-Content.esp')
"""

import hashlib
import io
import os
import struct
import zlib

OWN_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'game', 'content'))


# A PLUGIN THAT DOES NOT READ STOPS THE BUILD (#4553). A builder that passed
# over a file that is not a plugin, or read a compressed record that would
# not inflate as an empty one, built a table of a load order nobody runs and
# wrote it: with the masters swapped for blank files the bench, cast and door
# builders wrote empty tables and exited 0. So the reader refuses both, and
# no builder has a count of its own to remember to look at. It is a
# ValueError, so a builder that already stopped on ValueError still does.
class Unreadable(ValueError):
    pass


def read_plugin(path, name):
    """A plugin's bytes, or Unreadable when they are not a plugin."""
    with open(str(path), 'rb') as fh:
        buf = fh.read()
    if len(buf) < 24 or buf[:4] != b'TES4':
        raise Unreadable('%s is not a plugin: it does not start with a TES4 header' % name)
    return buf


def inflate(raw, name, tag, fid):
    """A compressed record's data: four bytes saying how long it inflates to,
    then a zlib stream. Unreadable when it does not inflate to that length."""
    what = '%s %s 0x%08X' % (name, tag.decode('ascii', 'replace'), fid)
    if len(raw) < 4:
        raise Unreadable('%s is compressed and will not inflate: it is %d bytes' % (what, len(raw)))
    want = struct.unpack_from('<I', raw, 0)[0]
    try:
        out = zlib.decompress(raw[4:])
    except zlib.error as exc:
        raise Unreadable('%s is compressed and will not inflate (%s)' % (what, exc))
    if len(out) != want:
        raise Unreadable('%s is compressed and will not inflate to its length: %d bytes, not %d'
                         % (what, len(out), want))
    return out


# Ours, and made in the Data folder from a recipe rather than held here (#2791).
MADE_IN_DATA = ['Thornswood-Last.esp']


def in_repo(name):
    return os.path.isfile(os.path.join(OWN_DIR, name))


def is_own(name):
    return in_repo(name) or name.lower() in [m.lower() for m in MADE_IN_DATA]


def plugin_path(data, name):
    return os.path.join(OWN_DIR, name) if in_repo(name) else os.path.join(str(data), name)


# The five masters load before the game reads plugins.txt, and are never
# written to it.
MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']


def read_plugins_txt(plugins_txt):
    """plugins.txt as the game reads it, as (on, off): on is the load order (the
    masters, then each '*' line, once, names matched without case the way
    Windows matches files), off is each line the game skips because it has no
    '*'."""
    on, off = list(MASTERS), []
    seen = set(n.lower() for n in on)
    with io.open(str(plugins_txt), encoding='utf-8-sig', errors='replace') as fh:
        lines = fh.read().splitlines()
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if not line.startswith('*'):
            off.append(line)
            continue
        name = line[1:].strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            on.append(name)
    skipped = []
    for name in off:
        if name.lower() not in seen:
            seen.add(name.lower())
            skipped.append(name)
    return on, skipped


def load_order(plugins_txt):
    return read_plugins_txt(plugins_txt)[0]


def switched_off(plugins_txt):
    return read_plugins_txt(plugins_txt)[1]


def load_order_name(order):
    """What a table says it was read from: how many plugins and the first
    twelve hex of the sha256 of their names in order, one per line. Never the
    plugin list's path, which names one machine (#3105: every box run wrote
    its own temp folder into ten tables)."""
    digest = hashlib.sha256('\n'.join(order).encode('utf-8')).hexdigest()[:12]
    return '%d plugins in load order (names sha256 %s)' % (len(order), digest)
