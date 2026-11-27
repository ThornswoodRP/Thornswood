"""Execute the real added AVM1 predicate and branch relocation on own bytes."""
import importlib.util, pathlib, struct
ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('menus', ROOT / 'scripts/mods/Build-ModMenus.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
passed = failed = 0
def yes(name, value):
    global passed, failed
    print(('PASS ' if value else 'FAIL ') + name)
    if value: passed += 1
    else: failed += 1

def push(value): return b'\x96'+struct.pack('<H', len(value))+value
def boolean(value): return push(bytes((5, int(value))))
# Own tiny program: an existing true predicate returns true; false returns
# false. Inserting immediately before its Not must retain both old branches.
BODY = b'\x12\x9d\x02\x00\x06\x00'+boolean(True)+b'\x3e'+boolean(False)+b'\x3e'
EXTRA = M.inventory_close_predicate()
EDITS = M.insert_inventory_actions(BODY, 0, EXTRA)
PATCHED = M.apply(BODY, EDITS)

class Watched(dict):
    def __init__(self, *args, forbidden=(), **kwargs):
        super().__init__(*args, **kwargs); self.forbidden = forbidden
    def get(self, key):
        if key in self.forbidden: raise AssertionError('unexpected member read: '+key)
        return super().get(key)

def value_type(value):
    return 'boolean' if isinstance(value, bool) else 'number' if isinstance(value, (int, float)) else \
        'string' if isinstance(value, str) else 'function' if callable(value) else 'object' if value is not None else 'undefined'

def run(code, *, original=False, control='Quick Inventory', value='keyDown', item=False, category=False,
        trap=(), skse_key=23, mapping=23, native=True, trap_mapping=False, trap_value=False):
    this = Watched({'inventoryLists': Watched({'itemList': {'disableInput': item},
        'categoryList': {'disableInput': category}}, forbidden=('categoryList',) if item else ())}, forbidden=trap)
    details = Watched({'control': control, 'value': value, 'skseKeycode': skse_key}, forbidden=('value',) if trap_value else ())
    def mapped(*args):
        if trap_mapping: raise AssertionError('unexpected mapped-key lookup')
        if args != ('Quick Inventory', 0, 0): raise AssertionError('not the keyboard gameplay mapping')
        return mapping
    globals = Watched({'skse': None if native is None else {'GetMappedKey': mapped} if native else {}},
        forbidden=('skse',) if trap_mapping else ())
    registers = {1: this, 2: details}; stack = [original]
    actions = {at: (op, data, end) for at, op, data, end in M._avm1_actions(code)}
    pc = 0
    for _ in range(200):
        op, data, end = actions[pc]; pc = end
        if op == 0x96:
            while data < end:
                kind = code[data]; data += 1
                if kind == 0:
                    stop = code.index(0, data); stack.append(code[data:stop].decode()); data = stop+1
                elif kind == 4: stack.append(registers[code[data]]); data += 1
                elif kind == 5: stack.append(bool(code[data])); data += 1
                elif kind == 7: stack.append(struct.unpack_from('<i', code, data)[0]); data += 4
                else: raise AssertionError('unexpected Push type')
        elif op == 0x4e:
            name = stack.pop(); obj = stack.pop(); stack.append(obj.get(name))
        elif op == 0x1c: stack.append(globals.get(stack.pop()))
        elif op == 0x44:
            value = stack.pop()
            stack.append(value_type(value))
        elif op in (0x48, 0x67):
            right = stack.pop(); left = stack.pop(); stack.append(left < right if op == 0x48 else left > right)
        elif op == 0x52:
            name = stack.pop(); obj = stack.pop(); count = stack.pop(); args = [stack.pop() for _ in range(count)]
            stack.append(obj[name](*args))
        elif op == 0x49:
            right = stack.pop(); stack.append(stack.pop() == right)
        elif op == 0x66:
            right = stack.pop(); left = stack.pop()
            stack.append(value_type(left) == value_type(right) and left == right)
        elif op == 0x4c: stack.append(stack[-1])
        elif op == 0x17: stack.pop()
        elif op == 0x12: stack.append(not stack.pop())
        elif op in (0x10, 0x11):
            right = bool(stack.pop()); left = bool(stack.pop()); stack.append(left and right if op == 0x10 else left or right)
        elif op == 0x9d:
            if stack.pop(): pc = end + struct.unpack_from('<h', code, data)[0]
        elif op == 0x99: pc = end + struct.unpack_from('<h', code, data)[0]
        elif op == 0x3e: return stack.pop()
        else: raise AssertionError('unexpected opcode')
    raise AssertionError('instruction budget exceeded')

yes('original false predicate cannot close on the mapped inventory control', run(BODY) is False)
yes('real emitted predicate accepts a fresh mapped inventory press', run(PATCHED) is True)
yes('ordinary native close makes no additional movie/list or mapping reads', run(PATCHED, original=True, trap=('inventoryLists',), trap_mapping=True) is True)
yes('named inventory branch does not require a new lookup', run(PATCHED, trap_mapping=True) is True)
yes('unrelated physical control skips both later input and movie properties', run(PATCHED, control='Quick Magic', skse_key=25, trap=('inventoryLists',), trap_value=True) is False)
yes('default physical inventory key closes without a named control', run(PATCHED, control='', skse_key=23) is True)
yes('remapped physical inventory key closes with a different menu-context name', run(PATCHED, control='Other', skse_key=44, mapping=44) is True)
yes('a known different key does not close', run(PATCHED, control='', skse_key=44, mapping=23, trap=('inventoryLists',), trap_value=True) is False)
for bad in (-1, 0, 256, 280, None, '23', True, float('nan'), float('inf')):
    yes('invalid keyboard mapping refuses: '+str(bad), run(PATCHED, control='', skse_key=bad, mapping=bad, trap=('inventoryLists',), trap_value=True) is False)
yes('missing native mapping function refuses', run(PATCHED, control='', native=False, trap=('inventoryLists',), trap_value=True) is False)
yes('missing native SKSE object refuses', run(PATCHED, control='', native=None, trap=('inventoryLists',), trap_value=True) is False)
for key, mapping in [(None, 23), ('23', 23), (True, 1), (256, 23), (280, 23)]:
    yes('unmatched or nonnumeric physical key refuses: '+str(key), run(PATCHED, control='', skse_key=key, mapping=mapping,
        trap=('inventoryLists',), trap_value=True) is False)
for value in ('keyUp', 'keyHold'):
    yes('physical branch refuses '+value, run(PATCHED, control='', value=value, trap=('inventoryLists',)) is False)
yes('physical branch respects the item-card quantity guard', run(PATCHED, control='', item=True) is False)
yes('physical branch respects disabled categories', run(PATCHED, control='', category=True) is False)
for value in ('keyUp', 'keyHold', '', None):
    yes('only a fresh keyDown closes: '+str(value), run(PATCHED, value=value, trap=('inventoryLists',)) is False)
yes('disabled item list refuses and never reads the category list', run(PATCHED, item=True) is False)
yes('disabled category list refuses', run(PATCHED, category=True) is False)
yes('existing true predicate remains true with disabled lists', run(PATCHED, original=True, item=True, category=True) is True)
yes('source edits preserve the original action stream outside the insertion',
    PATCHED[len(EXTRA):] == BODY)

def refused(name, fn):
    try: fn(); no = False
    except SystemExit as e: no = str(e).startswith('STOP.')
    yes(name, no)
refused('different source movie refuses before any edit', lambda: M.edit_inventory(b'not the collection movie'))
refused('truncated action header refuses', lambda: M.insert_inventory_actions(b'\x96', 0, EXTRA))
refused('truncated action data refuses', lambda: M.insert_inventory_actions(b'\x96\x20\x00x', 0, EXTRA))
refused('wrong branch width refuses', lambda: M.insert_inventory_actions(b'\x99\x01\x00\0', 0, EXTRA))
refused('branch into instruction data refuses', lambda: M.insert_inventory_actions(b'\x99\x02\x00\xfd\xff', 0, EXTRA))
refused('insertion into instruction data refuses', lambda: M.insert_inventory_actions(BODY, 2, EXTRA))
refused('invalid inserted branch refuses', lambda: M.insert_inventory_actions(BODY, 0, b'\x99\x02\x00\x01\0'))
# A backward branch crosses an insertion at an instruction boundary.
back = b'\x06\x99\x02\x00\xfa\xff'
grown = M.apply(back, M.insert_inventory_actions(back, 1, b'\x06'))
yes('backward branch still targets the original first action', struct.unpack_from('<h', grown, 5)[0] + 7 == 0)
forward = b'\x99\x02\x00\x01\0\x06'
grown = M.apply(forward, M.insert_inventory_actions(forward, 5, b'\x06'))
yes('forward branch crosses the insertion to the original end', struct.unpack_from('<h', grown, 3)[0] + 5 == len(grown))
entry = b'\x99\x02\x00\0\0\x06'
grown = M.apply(entry, M.insert_inventory_actions(entry, 5, b'\x06'))
yes('a branch to the insertion evaluates its new first action', struct.unpack_from('<h', grown, 3)[0] + 5 == 5)
refused('a relocated branch exceeding int16 refuses', lambda: M.insert_inventory_actions(b'\x99\x02\x00\x01\0\x06', 5, b'\x06' * 32768))
print(str(passed)+' passed, '+str(failed)+' failed')
raise SystemExit(1 if failed else 0)
