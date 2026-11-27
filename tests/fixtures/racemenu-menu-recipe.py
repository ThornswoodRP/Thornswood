"""insert_actions and the RaceMenu edit (#7087), run on a movie built here.

No copyrighted movie, game folder, Flash tool or extra package: a small SWF
is put together byte by byte, with two DoInitAction tags, a class guard that
jumps over the functions after it, a function with a loop, and a branch that
crosses where new code goes. New actions are put in with Build-ModMenus.py's
own insert_actions, and the result is read again independently: every action
that was there is still there with its bytes, each branch still lands on the
action it landed on, each function still ends after the action it ended
after, the inserted branches land where they were asked to, and the tag's and
the movie's lengths are right. Then the cases it must refuse, and the RaceMenu
edit's own constants, each Jump's length against the If or block it stands
for."""
import importlib.util
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('menus', ROOT / 'scripts/mods/Build-ModMenus.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

passed = failed = 0


def yes(name, value):
    global passed, failed
    print(('PASS  ' if value else 'FAIL  ') + name)
    if value:
        passed += 1
    else:
        failed += 1


def refuses(name, fn):
    try:
        fn()
    except SystemExit as e:
        yes(name, str(e).startswith('STOP.'))
        return
    yes(name, False)


def push_int(n):
    return b'\x96\x05\x00\x07' + struct.pack('<i', n)


POP, NOT = b'\x17', b'\x12'


def branch(op, to_label):
    return ('br', op, to_label)


def assemble(items):
    """items: bytes, ('label', name), ('br', 0x99|0x9d, name), ('fn', [items]).
    Returns the code and where each label is."""
    def size(it):
        if isinstance(it, bytes):
            return len(it)
        if it[0] == 'label':
            return 0
        if it[0] == 'br':
            return 5
        return 8 + sum(size(x) for x in it[1])   # DefineFunction: no name, no parameters, its size

    labels, at = {}, 0

    def place(seq, base):
        p = base
        for it in seq:
            if isinstance(it, tuple) and it[0] == 'label':
                labels[it[1]] = p
            elif isinstance(it, tuple) and it[0] == 'fn':
                place(it[1], p + 8)
            p += size(it)
        return p
    place(items, 0)

    def emit(seq, base):
        out = bytearray()
        for it in seq:
            here = base + len(out)
            if isinstance(it, bytes):
                out += it
            elif it[0] == 'label':
                pass
            elif it[0] == 'br':
                out += bytes((it[1], 2, 0)) + struct.pack('<h', labels[it[2]] - (here + 5))
            else:
                body = emit(it[1], here + 8)
                out += b'\x9b\x05\x00' + b'\x00' + struct.pack('<HH', 0, len(body)) + body
        return bytes(out)
    return emit(items, 0), labels


def movie(tag_codes):
    rect = bytes((0x08, 0))               # nbits 1: 5 + 4 * 1 bits, two bytes
    head = rect + b'\x00\x18' + b'\x01\x00'
    tags = b''
    for sprite, code in tag_codes:
        body = struct.pack('<H', sprite) + code
        tags += struct.pack('<HI', (59 << 6) | 0x3F, len(body)) + body
    tags += b'\x00\x00'
    plain = b'FWS\x0a' + struct.pack('<I', 8 + len(head) + len(tags)) + head + tags
    return plain


A = [push_int(1), branch(0x9d, 'end'),                    # class guard over everything after
     ('fn', [push_int(0), ('label', 'top'), push_int(2), NOT, branch(0x9d, 'out'),
             push_int(3), POP, ('label', 'here'), push_int(4), POP,
             push_int(5), POP, branch(0x99, 'top'), ('label', 'out')]),
     POP, ('fn', [push_int(6), POP]), ('label', 'end'), push_int(7), POP]
codeA, LA = assemble(A)
codeB, LB = assemble([push_int(8), POP, ('fn', [push_int(9), POP])])
plain = movie([(1, codeA), (2, codeB)])
starts = M.header_end(plain)
tg = M.tags(plain, starts, len(plain), 'test')
a0 = tg[0][2] + 2            # code of tag 1 starts after its sprite id
yes('the test movie reads as two DoInitAction tags and an end', [t[0] for t in tg] == [59, 59, 0])
M.check_actions(plain, a0, tg[0][3], 'test')

at = a0 + LA['here']
new = b'\x96\x05\x00\x07' + struct.pack('<i', 42) + POP + b'\x9d\x02\x00\x00\x00' + push_int(43) + POP
k = 8 + 1 + 3      # the If after the push and the Pop: its offset
edits = M.insert_actions(plain, [(at, new, [(k, at)])], 'test')
out = M.apply(plain, sorted(edits))
tg2 = M.tags(out, M.header_end(out), len(out), 'edited test')
yes('the movie says its new length', struct.unpack_from('<I', out, 4)[0] == len(out) == len(plain) + len(new))
yes('the tag with the insert says its new length, the other is as it was',
    tg2[0][3] - tg2[0][2] == tg[0][3] - tg[0][2] + len(new) and out[tg2[1][2]:tg2[1][3]] == plain[tg[1][2]:tg[1][3]])
r0 = M.check_actions(plain, a0, tg[0][3], 'test')
r1 = M.check_actions(out, tg2[0][2] + 2, tg2[0][3], 'edited test')
n = len(new)


def moved(x):
    return x + (n if x >= at else 0)


old_by_new = {moved(r[0]): r for r in r0}
kept = [r for r in r1 if r[0] in old_by_new]
yes('every action that was there is still there, in order', len(kept) == len(r0))
same, lands, ends = True, True, True
for r in kept:
    o = old_by_new[r[0]]
    if r[1] != o[1]:
        same = False
    if r[1] in (0x99, 0x9d):
        ot = o[3] + struct.unpack_from('<h', plain, o[2])[0]
        nt = r[3] + struct.unpack_from('<h', out, r[2])[0]
        lands = lands and nt == moved(ot)
    elif r[1] in (0x8e, 0x9b):
        oe = o[3] + struct.unpack_from('<H', plain, o[3] - 2)[0]
        ne = r[3] + struct.unpack_from('<H', out, r[3] - 2)[0]
        ends = ends and ne == moved(oe)
    elif out[r[0]:r[3]] != plain[o[0]:o[3]]:
        same = False
yes('  with the same bytes, branches and functions aside', same)
yes('  each branch lands on the action it landed on (the class guard and the loop cross the insert)', lands)
yes('  each function ends after the action it ended after', ends)
yes('the new code is where it was asked, in front of the action that was there',
    out[at:at + k] == new[:k] and out[at + k + 2:at + n] == new[k + 2:] and out[at + n:at + n + 8] == push_int(4))
ib = at + k - 3
yes('its branch to its own place lands just after it', ib + 5 + struct.unpack_from('<h', out, ib + 3)[0] == at + n)

refuses('it refuses an insert where a branch already lands', lambda: M.insert_actions(plain, [(a0 + LA['top'], POP, [])], 't'))
refuses('it refuses an insert where a function ends', lambda: M.insert_actions(plain, [(a0 + LA['out'], POP, [])], 't'))
refuses('it refuses an insert inside an action', lambda: M.insert_actions(plain, [(at + 1, POP, [])], 't'))
refuses('it refuses an insert outside every tag', lambda: M.insert_actions(plain, [(len(plain) - 1, POP, [])], 't'))


def jump_len(b, i):
    return struct.unpack_from('<h', b, i + 3)[0]


yes('the tabs Jump goes 208 bytes on from the Sliders push, the length of the three tabs\' blocks and '
    'their buttons and listeners', M.TABS_AFTER[0] == 0x99 and jump_len(M.TABS_AFTER, 0) + 5 == 208)
yes('the Sculpt Jump goes where the If before it goes',
    M.SCULPT_AFTER[12] == 0x99 and 12 + 5 + jump_len(M.SCULPT_AFTER, 12) ==
    7 + 5 + struct.unpack_from('<h', M.SCULPT_BEFORE, 10)[0])
yes('the ALL Jump goes past the push, InvalidateData and the press (167 bytes)',
    jump_len(M.ALL_AFTER, 0) + 5 == 167)
yes('the splice keeps nothing: both of its 1s are 0s and nothing else changes',
    [i for i in range(len(M.SPLICE_BEFORE)) if M.SPLICE_BEFORE[i] != M.SPLICE_AFTER[i]] == [10, 19])
yes('the categories Jump of the Papyrus categories goes where the loop\'s If leaves it',
    5 + 5 + jump_len(M.ADD_CATEGORIES_AFTER, 5) == 5 + struct.unpack_from('<h', M.ADD_CATEGORIES_BEFORE, 3)[0])
press, kp = M._press_first()
yes('the first category is pressed only when none is chosen, and its If skips the press',
    b'_selectedIndex' in press and press[kp - 3] == 0x9d and b'\x96\x02\x00\x08\x5f' in press)
yes('of the Papyrus sliders only ChangeHeight is kept, put in BODY (4) with no priority (length 8)',
    b'ChangeHeight' in M.KEEP_HEIGHT_HEAD and M.KEEP_HEIGHT_TAIL ==
    bytes.fromhex('960c00040307010000000704000000' '4f' '96090004030818' '0708000000' '4f'))
yes('the RaceMenu menu is in the list the recipe is written from',
    any(m[0] == 'RaceMenuMenu' and m[5] is M.edit_racemenu and m[4] == 'Data\\Interface\\racesex_menu.swf'
        for m in M.MENUS))
recipe = (ROOT / 'launcher/app/FromGameModMenus.cs').read_text()
yes('and the recipe the launcher builds with has it, with an insert naming ChangeHeight',
    'public static readonly MenuRecipe RaceMenuMenu' in recipe and b'ChangeHeight'.hex() in recipe)

print('')
print('%d passed, %d failed' % (passed, failed))
raise SystemExit(1 if failed else 0)
