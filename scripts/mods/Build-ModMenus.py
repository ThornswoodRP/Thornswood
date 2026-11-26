"""
Build-ModMenus.py

Writes launcher\\app\\FromGameModMenus.cs: Thornswood's edits to the menus of
three of the collection's mods, as the bytes that change, so the launcher can
make the edited menus on each machine from that machine's own copy of those
mods (#3113, #3127), the way it makes the main menu from the game's (#2827).

    Data\\Interface\\skyui\\config.txt         SkyUI's item lists
    Data\\Interface\\skyui\\itemcard.swf       SkyUI's item card
    Data\\Interface\\hudmenu.swf               SkyHUD's HUD
    Data\\Interface\\AHZHudInfo.swf            moreHUD's HUD widget, and its
    Data\\Interface\\exported\\AHZHudInfo.swf  copy under exported
    Data\\Interface\\quest_journal.swf         SkyUI's journal (#3127)
    Data\\Interface\\inventorymenu.swf         SkyUI's mapped inventory close (#6721)

WHY

An item on Thornswood has no gold price: "What it sells for is the price a
person posts" (docs\\systems\\professions.md, docs\\GAME-SYSTEMS.md). Patrick, 21 Oct
2026, on the report page: "this is an RP server and the gold prices listed dont
even matter also one of the things was supposed to remove the listed prices
entirly". Measured 21 Oct from the collection's own archives (revision 4: SkyUI
file 749043, SkyHUD 61422, moreHUD 803483), every place an item's built-in gold
value is drawn, and what draws it:

  1. The Value and V/W columns of every item list: inventory, container,
     barter, gift, and the crafting menus (Crafting Categories' smithing menu
     reads the same file). SkyUI's interface\\skyui\\config.txt names them in
     each view's columns line.
  2. VALUE and its number on the item card under every one of those lists.
     SkyUI's interface\\skyui\\itemcard.swf places a "$VALUE" label and the
     ItemValueText field on each kind of card (weapons, apparel, potions,
     ingredients, books, misc and the rest).
  3. VALUE and its number under the name when somebody looks at an item lying
     in the world. The engine hands the HUD the item's value (aCost) and
     SkyHUD's interface\\hudmenu.swf, which wins over SkyUI's because SkyHUD.esp
     loads later, writes it into RolloverInfoText in SetCrosshairTarget.
  4. moreHUD's V/W, appended to that same line. Its plugin reads the last two
     numbers of the line as weight and value, so with the value gone it would
     divide the damage or armour by the weight. Its widget,
     interface\\AHZHudInfo.swf, turns it on from the AHZShowVW setting in
     updateSettings.

QuickLoot's Val and V/W columns are the fifth; they are a setting, not a menu
edit (game\\ours\\Data\\SKSE\\Plugins\\QuickLootIE.json).

THE JOURNAL'S SYSTEM PAGE (#3127). Patrick: "remove all of the vanilla Skyrim
GUI menus and pieces we don't use, such as the vanilla help". Escape opens the
Journal Menu at its System page, and the movie the game draws for it is
SkyUI's interface\\quest_journal.swf (SkyUI_SE.bsa): no other archive or loose
file of the collection has one, so it wins over Skyrim - Interface.bsa's.
Measured 26 Oct from SkyUI file 749043: SystemPage.onLoad pushes Quick Save,
Save, Load, Settings, Mod Configuration, Controls, Help and Quit, and two more
are put in at the fourth place, Creations (SetShowMod, when the game says so)
and Installed Content (startPage, on a game at 1.1.26 or later). Four of them
do nothing on Thornswood and two are worse than nothing: a character lives on
the server, not in a save, so Quick Save and Save write a file nothing reads
and Load leaves the world for a save the server never heard of; Help is
Skyrim's own help, which the help panel (F7) replaced (#1633); Creations and
Installed Content are the Creation Club, and Thornswood is Special Edition
only. Settings, Mod Configuration, Controls and Quit stay. The page finds each
entry by its text (UpdateIndices), so an entry that is never put in has no
index, and no press can reach its action. The game itself still asks for
those entries: each time the journal opens, UpdateSystemButtons hands it
every entry by its index, and the game writes "disabled" into each one, so
each entry taken off is handed over as an empty object of its own.

WHAT EACH EDIT IS

  config.txt      valueColumn, valueWeightColumn, alchValueColumn and
                  alchValueWeightColumn come out of every views.*.columns line.
                  The columns' own definitions stay; no view names them.
  itemcard.swf    every PlaceObject of a "$VALUE" label and of ItemValueText is
                  taken out, in every frame. ItemCard's own script already asks
                  whether ItemValueText is there before it writes to it.
  hudmenu.swf     the test before the value is written, "if (aCost !=
                  undefined)", is made to fail always: the push of aCost
                  becomes a push of true, and the second Not a ToNumber, so the
                  If always jumps past the block. Same length, nothing moves.
  AHZHudInfo.swf  "showValueToWeight = showValueToWeightValue >= 1" reads false
                  in place of the setting, so it is always false. Same length.
  quest_journal   onLoad jumps over the three pushes of Quick Save, Save and
                  Load, and over the push of Help, where each block's first
                  push was; SetShowMod stores false in place of what the game
                  says, so Creations is never put in; startPage jumps over the
                  block that puts in Installed Content. Same length, and every
                  jump lands on the action after the block, so nothing moves.
                  UpdateSystemButtons hands the game, in SetSaveDisabled, a
                  new empty object in the places of Quick Save, Save, Load and
                  Help, where it handed entryList[IDX_...]: the game sets
                  "disabled" on every object in that array without checking
                  it is one, and crashed on the undefined an entry that is not
                  there gives (31 Oct 2026). Any entry taken off the page has
                  to be handed over this way too.

Each edit is checked for what it must find (how many places, which bytes) and
stops when the mod's file is not the one it was written for. The recipe pins
each source by sha256, so a new release of one of these mods makes nothing
until this is run again against it, and the launcher says which file differs.

Then each file is made the way the launcher makes it (the edits applied, a
movie packed again with zlib level 6, which FromGameDeflate.cs does to the
bit), and its sha256 goes in the recipe.

Usage, with the collection's archives in a Data folder (read, never written):
    python scripts/mods/Build-ModMenus.py --data <Data>           write the recipe
    python scripts/mods/Build-ModMenus.py --data <Data> --check   say whether it is what this writes
    --recipe <file>   where the recipe goes (default launcher\\app\\FromGameModMenus.cs)
Exit 1 when a check fails or a file cannot be read. Plain Python: none of the
three archives is compressed; a compressed one needs the lz4 module.
"""

import argparse
import hashlib
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
RECIPE = os.path.join(REPO, 'launcher', 'app', 'FromGameModMenus.cs')
DATA = 'C:\\Thornswood\\Game\\Data'


# ------------------------------------------------------------------ archives

def read_archive(path, want):
    """The file at want (folder\\leaf, any case) in a version 105 archive, unpacked."""
    with open(path, 'rb') as f:
        h = f.read(36)
        if h[:4] != b'BSA\x00' or struct.unpack_from('<I', h, 4)[0] != 105:
            raise SystemExit('STOP. %s is not a Skyrim Special Edition archive.' % path)
        foff, flags, nfold, nfile, lfold, lfile = struct.unpack_from('<IIIIII', h, 8)
        if flags & 3 != 3:
            raise SystemExit('STOP. %s does not carry its folder and file names.' % path)
        f.seek(foff)
        counts = [struct.unpack('<QIIQ', f.read(24))[1] for _ in range(nfold)]
        recs = []
        for c in counts:
            n = f.read(1)[0]
            folder = f.read(n)[:-1].decode('latin-1')
            for _ in range(c):
                _, size, off = struct.unpack('<QII', f.read(16))
                recs.append((folder, size, off))
        names = f.read(lfile).split(b'\x00')
        for (folder, size, off), leaf in zip(recs, names):
            if (folder + '\\' + leaf.decode('latin-1')).lower() != want.lower():
                continue
            packed = bool(flags & 4) ^ bool(size & 0x40000000)
            size &= 0x3FFFFFFF
            f.seek(off)
            if flags & 0x100:
                n = f.read(1)[0]
                f.read(n)
                size -= n + 1
            raw = f.read(size)
            if not packed:
                return raw
            try:
                import lz4.frame
            except ImportError:
                raise SystemExit('STOP. %s in %s is LZ4 packed and this Python has no lz4 module.' % (want, path))
            return lz4.frame.decompress(raw[4:])
    raise SystemExit('STOP. %s has no %s.' % (path, want))


# ---------------------------------------------------------------------- movies

def unpack(swf, what):
    """The whole movie uncompressed, its 8 byte header included."""
    if swf[:3] != b'CWS':
        raise SystemExit('STOP. %s is not a compressed SWF (it starts %r).' % (what, swf[:3]))
    d = zlib.decompressobj()
    body = d.decompress(swf[8:]) + d.flush()
    if d.unused_data or len(body) + 8 != struct.unpack_from('<I', swf, 4)[0]:
        raise SystemExit('STOP. %s does not unpack to the length its header says.' % what)
    return swf[:8] + body


def pack(plain):
    """zlib level 6, window 15, memory level 8, the default strategy: what
    FromGameDeflate.cs does, so the launcher makes these bytes."""
    c = zlib.compressobj(6, zlib.DEFLATED, 15, 8, zlib.Z_DEFAULT_STRATEGY)
    return b'CWS' + plain[3:8] + c.compress(plain[8:]) + c.flush()


def tags(b, o, end, what):
    """Each tag from o to end: (code, start, body start, end)."""
    out = []
    while o < end:
        cl = struct.unpack_from('<H', b, o)[0]
        code, n, h = cl >> 6, cl & 0x3F, 2
        if n == 0x3F:
            n, h = struct.unpack_from('<I', b, o + 2)[0], 6
        if o + h + n > end:
            raise SystemExit('STOP. %s has a tag that runs past its end.' % what)
        out.append((code, o, o + h, o + h + n))
        o += h + n
        if code == 0:
            break
    if o != end:
        raise SystemExit('STOP. %s goes on after its end tag.' % what)
    return out


def header_end(plain):
    nbits = plain[8] >> 3
    return 8 + (5 + 4 * nbits + 7) // 8 + 4


def place_character(b, s, body):
    """The character a PlaceObject2 (26) or PlaceObject3 (70) places, or None."""
    code = struct.unpack_from('<H', b, s)[0] >> 6
    f1 = b[body]
    o = body + (2 if code == 70 else 1) + 2
    if code == 70:
        f2 = b[body + 1]
        if f2 & 0x08 or (f2 & 0x10 and f1 & 0x02):
            o = b.index(0, o) + 1
    if not f1 & 0x02:
        return None
    return struct.unpack_from('<H', b, o)[0]


def edit_itemcard(plain):
    """Takes out every placement of a "$VALUE" label and of ItemValueText.
    Each sprite that loses one gets its length again, and so does the movie."""
    top = tags(plain, header_end(plain), len(plain), 'the item card')
    labels = set()
    for code, s, b0, e in top:
        if code == 37 and b'>$VALUE</font>' in plain[b0:e]:
            labels.add(struct.unpack_from('<H', plain, b0)[0])
    if not labels:
        raise SystemExit('STOP. The item card has no "$VALUE" label, so it is not the card this edit was written for.')
    edits, cut = [], 0
    gone = {'label': 0, 'field': 0}
    for code, s, b0, e in top:
        if code != 39:
            continue
        drop = []
        for c, ss, sb, se in tags(plain, b0 + 4, e, 'a sprite of the item card'):
            if c not in (26, 70):
                continue
            if place_character(plain, ss, sb) in labels:
                gone['label'] += 1
                drop.append((ss, se))
            elif b'ItemValueText\x00' in plain[sb:se]:
                gone['field'] += 1
                drop.append((ss, se))
        if not drop:
            continue
        n = e - b0 - sum(se - ss for ss, se in drop)
        edits.append((s, b0 - s, struct.pack('<HI', (39 << 6) | 0x3F, n).hex()))
        edits += [(ss, se - ss, '') for ss, se in drop]
        cut += sum(se - ss for ss, se in drop) - (6 - (b0 - s))
    if gone['field'] < 10 or gone['label'] < 10:
        raise SystemExit('STOP. The item card had %d value labels and %d value fields to take out; the card this '
                         'edit was written for has at least ten of each.' % (gone['label'], gone['field']))
    edits.insert(0, (4, 4, struct.pack('<I', len(plain) - cut).hex()))
    return edits, '%d "$VALUE" labels and %d ItemValueText fields taken out' % (gone['label'], gone['field'])


def edit_once(plain, before, after, what):
    """The one place before is, changed to after, as the bytes that differ."""
    if len(before) != len(after):
        raise SystemExit('STOP. %s: an edit must keep the length.' % what)
    n = plain.count(before)
    if n != 1:
        raise SystemExit('STOP. %s: the bytes this edit changes are there %d times, not once, so it is not the file '
                         'it was written for.' % (what, n))
    at = plain.index(before)
    return [(at + i, 1, '%02x' % after[i]) for i in range(len(before)) if before[i] != after[i]]


# SetCrosshairTarget, at "if (aCost != undefined)": Push register14 (aCost),
# undefined; Equals2; Not; Not; If past the block that writes VALUE. Then the
# block's first push, register1 and "ValueTranslated", is matched too, so the
# bytes are the ones in front of the value and nowhere else. After: Push true,
# undefined; Equals2 (false); Not (true); ToNumber (1); If, which always jumps.
HUD_BEFORE = bytes.fromhex('960300040e03' '491212' '9d02003f00' '9605000401096201')
HUD_AFTER = bytes.fromhex('960300050103' '49124a' '9d02003f00' '9605000401096201')

# updateSettings: Push register1, "showValueToWeight", register11, 1; Less2;
# Not; SetMember. register11 (the setting) becomes false, and false < 1, so
# the Not stores false whatever the setting says.
VW_BEFORE = bytes.fromhex('960b000401083a040b0701000000' '48124f')
VW_AFTER = bytes.fromhex('960b000401083a05000701000000' '48124f')


def edit_hud(plain):
    return edit_once(plain, HUD_BEFORE, HUD_AFTER, 'SkyHUD\'s HUD'), 'the value test in SetCrosshairTarget never passes'


def edit_morehud(plain):
    return edit_once(plain, VW_BEFORE, VW_AFTER, 'moreHUD\'s widget'), 'showValueToWeight is always false'


# The System page's entries, in SystemPage.onLoad. Each is Push "text", the
# entry's name; Push 1; InitObject; Push 1, register1, "CategoryList";
# GetMember; Push "entryList"; GetMember; Push "push"; CallMethod; Pop: 51
# bytes, the name the only byte that differs. The first push, five bytes,
# becomes a Jump to the action after the block (Jump's offset counts from its
# own end), so the block is never run.
ENTRY = '9602000840' '960200%s' '9605000701000000' '43' '9605000701000000' '9602000401' '96020008024e' \
        '96020008424e' '9602000843' '52' '17'


def jump(n):
    """A Jump over the n bytes that follow it."""
    return bytes.fromhex('990200') + struct.pack('<h', n)


QUICKSAVE, SAVE, LOAD, HELP = '0841', '0844', '0845', '0849'
# Quick Save, Save and Load are three blocks in a row; the fourth push after
# them is Settings ("$SETTINGS", constant 0x46).
SAVES_BEFORE = bytes.fromhex(ENTRY % QUICKSAVE + ENTRY % SAVE + ENTRY % LOAD + '9602000840' '9602000846')
SAVES_AFTER = jump(3 * 51 - 5) + SAVES_BEFORE[5:]
# Help, then Quit ("$QUIT", constant 0x4a).
HELP_BEFORE = bytes.fromhex(ENTRY % HELP + '9602000840' '960200084a')
HELP_AFTER = jump(51 - 5) + HELP_BEFORE[5:]

# SetShowMod(bshow): Push register1, "_ShowModMenu", register2 (bshow);
# SetMember. register2 becomes false, so _ShowModMenu is false whatever the
# game asks and the If after it never puts "$MOD MANAGER" (Creations) in.
MOD_BEFORE = bytes.fromhex('9602000401' '960200082f' '9602000402' '4f')
MOD_AFTER = bytes.fromhex('9602000401' '960200082f' '9602000500' '4f')

# startPage: "IsVersionAtLeast1126" (constant 0x90); CallMethod; Not; If past
# the block (113 bytes on) that splices "$INSTALLED CONTENT" (constant 0x91)
# in. The block's first push becomes a Jump to where the If goes.
CONTENT_BEFORE = bytes.fromhex('9602000890' '52' '12' '9d02007100' '9602000840' '9602000891')
CONTENT_AFTER = CONTENT_BEFORE[:12] + jump(113 - 5) + CONTENT_BEFORE[17:]


# UpdateSystemButtons hands the game every entry of the page, by its index,
# in GameDelegate.call("SetSaveDisabled", [...]): Quick Save, Save and Load,
# Installed Content and Creations when they are there, then Settings, Mod
# Configuration, Controls, Help and Quit, then abRefreshMode. The game's
# handler sets "disabled" on each object in that array without asking whether
# it is one, so an entry that is never put in (its index undefined, so
# entryList[undefined] is undefined) is a null object to it, and the game
# crashes reading through it the moment the journal opens (31 Oct 2026, dev,
# EXCEPTION_ACCESS_VIOLATION reading 0 at SkyrimSE.exe+0FAE262, with
# Journal_SystemTab and "disabled" in the crash log). Installed Content and
# Creations are already pushed only when their index is defined; the four
# entries this takes off the page are handed over in a fixed place, so each
# of their slots, Push register3 (entryList), register1, "IDX_..."; GetMember;
# GetMember (18 bytes), hands an object of its own instead: Push 0;
# InitObject (a new, empty object, on no list, so its "disabled" draws
# nothing), then Push 0; Pop, which leaves the stack as it was. Same length,
# and every slot still hands one value, so the game's array keeps its places.
def slot(index):
    """The 18 bytes that push entryList[this[IDX_...]], the constant's index given."""
    return bytes.fromhex('9602000403' '9602000401' '96030009') + struct.pack('<H', index) + bytes.fromhex('4e4e')


OWN_OBJECT = bytes.fromhex('960500070000000043' '960500070000000017')
IDX_QUICKSAVE, IDX_SAVE, IDX_LOAD, IDX_HELP, IDX_QUIT = 0x104, 0x105, 0x106, 0x10c, 0x10d
# [Quick Save, Save, Load]: their three slots, then Push 3; InitArray.
GIVE_SAVES_BEFORE = slot(IDX_LOAD) + slot(IDX_SAVE) + slot(IDX_QUICKSAVE) + bytes.fromhex('9605000703000000' '42')
GIVE_SAVES_AFTER = OWN_OBJECT * 3 + GIVE_SAVES_BEFORE[54:]
# The push of the rest: Quit's slot, then Help's, which is the one that goes.
GIVE_HELP_BEFORE = slot(IDX_QUIT) + slot(IDX_HELP)
GIVE_HELP_AFTER = GIVE_HELP_BEFORE[:18] + OWN_OBJECT


def edit_journal(plain):
    edits = []
    for before, after, what in ((SAVES_BEFORE, SAVES_AFTER, 'Quick Save, Save and Load'),
                                (HELP_BEFORE, HELP_AFTER, 'Help'),
                                (MOD_BEFORE, MOD_AFTER, 'Creations'),
                                (CONTENT_BEFORE, CONTENT_AFTER, 'Installed Content'),
                                (GIVE_SAVES_BEFORE, GIVE_SAVES_AFTER, 'what SetSaveDisabled gets for Quick Save, Save and Load'),
                                (GIVE_HELP_BEFORE, GIVE_HELP_AFTER, 'what SetSaveDisabled gets for Help')):
        edits += edit_once(plain, before, after, 'SkyUI\'s journal, ' + what)
    return edits, 'Quick Save, Save, Load, Help, Creations and Installed Content never put on the System page'


# ---------------------------------------------------------------- the config

VALUE_COLUMNS = ('valueColumn', 'valueWeightColumn', 'alchValueColumn', 'alchValueWeightColumn')


def _avm1_actions(body):
    """Flat action records in the supported handler, including branch targets."""
    records, at = [], 0
    while at < len(body):
        op = body[at]
        if op >= 0x80 and at + 3 > len(body):
            raise SystemExit('STOP. Inventory input has a truncated action header.')
        size = struct.unpack_from('<H', body, at + 1)[0] if op >= 0x80 else 0
        data = at + (3 if op >= 0x80 else 1)
        end = data + size
        if end > len(body) or op in (0x8e, 0x9b, 0x94):
            raise SystemExit('STOP. Inventory input has an unsupported action extent.')
        if op in (0x99, 0x9d) and size != 2:
            raise SystemExit('STOP. Inventory input has an invalid branch.')
        records.append((at, op, data, end))
        at = end
    boundaries = {r[0] for r in records} | {len(body)}
    for at, op, data, end in records:
        if op in (0x99, 0x9d) and end + struct.unpack_from('<h', body, data)[0] not in boundaries:
            raise SystemExit('STOP. Inventory branch is not at an action boundary.')
    return records


def insert_inventory_actions(body, offset, extra):
    """Insert a predicate and rebase every existing Jump/If crossing it."""
    records = _avm1_actions(body)
    _avm1_actions(extra)
    boundaries = {r[0] for r in records} | {len(body)}
    if offset not in boundaries:
        raise SystemExit('STOP. Inventory edit is not at an action boundary.')
    edits = [(offset, 0, extra.hex())]
    for at, op, data, end in records:
        if op not in (0x99, 0x9d):
            continue
        old = struct.unpack_from('<h', body, data)[0]
        target = end + old
        # A branch to the old predicate must also evaluate its added OR arm.
        target += len(extra) if target > offset else 0
        end += len(extra) if at >= offset else 0
        distance = target - end
        if not -32768 <= distance <= 32767:
            raise SystemExit('STOP. Inventory branch exceeds its signed width.')
        if distance != old:
            edits.append((data, 2, struct.pack('<h', distance).hex()))
    edits.sort()
    _avm1_actions(apply(body, edits))
    return edits


def inventory_close_predicate():
    """OR the existing Tab predicate with a fresh, unblocked mapped control."""
    def push(value):
        return b'\x96' + struct.pack('<H', len(value)) + value
    def string(value):
        return push(b'\0' + value.encode('utf8') + b'\0')
    def member(register, *names):
        value = push(bytes((4, register)))
        for name in names:
            value += string(name) + b'\x4e'  # GetMember
        return value
    checks = [member(2, 'control') + string('Quick Inventory') + b'\x49']
    # Shared.GlobalFunc.IsKeyPressed also accepts keyHold. The new shortcut
    # must not close from a repeat of the key that just opened the menu.
    checks.append(member(2, 'value') + string('keyDown') + b'\x49')
    for name in ('itemList', 'categoryList'):
        checks.append(member(1, 'inventoryLists', name, 'disableInput') + b'\x12')
    value, branches = bytearray(checks[0]), []
    for check in checks[1:]:
        # Keep the current boolean, but skip later properties when false.
        value += b'\x4c\x12\x9d\x02\x00\x00\x00'  # Duplicate, Not, If
        branches.append(len(value) - 2)
        value += check + b'\x10'  # And
    finish = len(value)
    value += b'\x11'  # Or, retaining the existing Tab/Shift-Tab result
    for data in branches:
        struct.pack_into('<h', value, data, finish - (data + 2))
    # Native Tab/Shift-Tab must not read any new input or movie properties.
    return b'\x4c\x9d\x02\x00' + struct.pack('<h', len(value)) + value


def edit_inventory(plain):
    # SkyUI Community 6.11 SE, Nexus file749043. The launcher also checks the
    # compressed source hash; this builder refuses a different original movie.
    if hashlib.sha256(plain).hexdigest() != '2f1b1a41b675d726dfd7a3f3eb8de9335b0ae5bf8c78757198ca1e2cabd309ab':
        raise SystemExit('STOP. Inventory menu is not the supported SkyUI 6.11 SE original.')
    start, size, predicate = 168586, 393, 203
    body = plain[start:start + size]
    if body[predicate:predicate + 2] != b'\x12\x9d':
        raise SystemExit('STOP. Inventory close predicate is missing.')
    extra = inventory_close_predicate()
    edits = [(start + at, remove, insert) for at, remove, insert in insert_inventory_actions(body, predicate, extra)]
    container = [t for t in tags(plain, header_end(plain), len(plain), 'inventory menu') if t[1] == 165451]
    if len(container) != 1 or container[0][0] != 59 or container[0][2] - container[0][1] != 6:
        raise SystemExit('STOP. Inventory input tag is not the supported long DoInitAction.')
    tag_size = container[0][3] - container[0][2]
    edits += [(4, 4, struct.pack('<I', len(plain) + len(extra)).hex()),
              (165453, 4, struct.pack('<I', tag_size + len(extra)).hex()),
              (start - 2, 2, struct.pack('<H', size + len(extra)).hex())]
    return sorted(edits), 'mapped inventory key uses its normal fade and close, after child input and without held repeats'


def edit_config(text):
    """Each views line that names a value column, without it."""
    edits, at = [], 0
    for line in text.split(b'\n'):
        s = line.decode('latin-1')
        if s.startswith('views.') and '.columns' in s.split('=')[0] and '<' in s:
            head, rest = s.split('<', 1)
            inner, tail = rest.split('>', 1)
            cols = [c.strip() for c in inner.split(',')]
            keep = [c for c in cols if c not in VALUE_COLUMNS]
            if keep != cols:
                new = (head + '<' + ', '.join(keep) + '>' + tail).encode('latin-1')
                p = 0
                while line[p] == new[p]:
                    p += 1
                q = 0
                while line[-1 - q] == new[-1 - q] and len(new) - q > p:
                    q += 1
                edits.append((at + p, len(line) - p - q, new[p:len(new) - q].hex()))
        at += len(line) + 1
    if len(edits) < 10:
        raise SystemExit('STOP. SkyUI\'s config had %d views with a value column; the one this edit was written for '
                         'has twelve.' % len(edits))
    return edits, 'the value columns taken out of %d views' % len(edits)


# --------------------------------------------------------------------- recipes

# (C# name, mod, archive, path in it, path in the game folder, edit, kind)
MENUS = [
    ('SkyUIConfig', 'SkyUI', 'SkyUI_SE.bsa', 'interface\\skyui\\config.txt', 'Data\\Interface\\skyui\\config.txt', edit_config, 'text'),
    ('SkyUIItemCard', 'SkyUI', 'SkyUI_SE.bsa', 'interface\\skyui\\itemcard.swf', 'Data\\Interface\\skyui\\itemcard.swf', edit_itemcard, 'movie'),
    ('SkyHUDMenu', 'SkyHUD', 'SkyHUD.bsa', 'interface\\hudmenu.swf', 'Data\\Interface\\hudmenu.swf', edit_hud, 'movie'),
    ('MoreHUDInfo', 'moreHUD', 'AHZmoreHUD.bsa', 'interface\\ahzhudinfo.swf', 'Data\\Interface\\AHZHudInfo.swf', edit_morehud, 'movie'),
    ('MoreHUDInfoExported', 'moreHUD', 'AHZmoreHUD.bsa', 'interface\\exported\\ahzhudinfo.swf', 'Data\\Interface\\exported\\AHZHudInfo.swf', edit_morehud, 'movie'),
    ('SkyUIJournal', 'SkyUI', 'SkyUI_SE.bsa', 'interface\\quest_journal.swf', 'Data\\Interface\\quest_journal.swf', edit_journal, 'movie'),
    ('SkyUIInventory', 'SkyUI', 'SkyUI_SE.bsa', 'interface\\inventorymenu.swf', 'Data\\Interface\\inventorymenu.swf', edit_inventory, 'movie'),
]


def apply(a, edits):
    out, at = bytearray(), 0
    for e_at, remove, insert in edits:
        out += a[at:e_at] + bytes.fromhex(insert)
        at = e_at + remove
    return bytes(out + a[at:])


def make(data, menu):
    name, mod, archive, source, path, edit, kind = menu
    where = os.path.join(data, archive)
    if not os.path.isfile(where):
        raise SystemExit('STOP. %s is not in %s. Give --data the Data folder the collection is in.' % (archive, data))
    src = read_archive(where, source)
    plain = unpack(src, source) if kind == 'movie' else src
    edits, said = edit(plain)
    edits.sort()
    edited = apply(plain, edits)
    if kind == 'movie':
        tags(edited, header_end(edited), len(edited), 'the edited ' + path)
        if struct.unpack_from('<I', edited, 4)[0] != len(edited):
            raise SystemExit('STOP. %s: the edited movie\'s header does not say its length.' % path)
    made = pack(edited) if kind == 'movie' else edited
    return {'name': name, 'mod': mod, 'archive': archive, 'source': source, 'path': path, 'src': src,
            'made': made, 'edits': edits, 'said': said}


def cs(s):
    return s.replace('\\', '\\\\')


def recipe(made):
    i2, i3, i4 = ' ' * 8, ' ' * 12, ' ' * 16
    L = ['// Written by scripts\\mods\\Build-ModMenus.py from the collection\'s SkyUI, SkyHUD and',
         '// moreHUD archives. Run it again rather than editing this; an edit here fails the',
         '// launcher\'s byte for byte check (#3113).',
         'namespace Thornswood',
         '{',
         '    public sealed partial class MenuRecipe',
         '    {']
    for m in made:
        L += [i2 + 'public static readonly MenuRecipe %s = new MenuRecipe' % m['name'],
              i2 + '{',
              i3 + 'Mod = "%s",' % m['mod'],
              i3 + 'Archive = "%s",' % m['archive'],
              i3 + 'Source = "%s",' % cs(m['source']),
              i3 + 'SourceSize = %d,' % len(m['src']),
              i3 + 'SourceSha256 = "%s",' % hashlib.sha256(m['src']).hexdigest(),
              i3 + 'Path = "%s",' % cs(m['path']),
              i3 + 'Size = %d,' % len(m['made']),
              i3 + 'Sha256 = "%s",' % hashlib.sha256(m['made']).hexdigest(),
              i3 + 'Edits = new[]',
              i3 + '{']
        L += [i4 + 'new MenuEdit(%d, %d, "%s"),' % e for e in m['edits']]
        L += [i3 + '},',
              i2 + '};',
              '']
    L += [i2 + '/// <summary>Every mod menu FromGame makes, in this order.</summary>',
          i2 + 'public static readonly MenuRecipe[] Mods = { %s };' % ', '.join(m['name'] for m in made),
          '    }', '}', '']
    return '\n'.join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=DATA)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--recipe', default=RECIPE)
    args = ap.parse_args()
    made = [make(args.data, m) for m in MENUS]
    for m in made:
        print('%-42s %s: %s bytes from %s bytes (sha256 %s), %d edits' % (
            m['path'], m['said'], format(len(m['made']), ','), format(len(m['src']), ','),
            hashlib.sha256(m['made']).hexdigest()[:16], len(m['edits'])))
    text = recipe(made)
    if args.check:
        have = open(args.recipe, 'rb').read().decode('utf-8') if os.path.isfile(args.recipe) else None
        same = have is not None and have.replace('\r\n', '\n') == text.replace('\r\n', '\n')
        print('  ok    %s is what this writes' % args.recipe if same else
              '  DIFFERS  %s is not what this writes' % args.recipe)
        return 0 if same else 1
    open(args.recipe, 'wb').write(text.encode('utf-8'))
    print('wrote ' + args.recipe)
    return 0


if __name__ == '__main__':
    sys.exit(main())
