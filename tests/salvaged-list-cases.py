"""
salvaged-list-cases.py, run by tests\\test-4354-salvaged-list.js

Issue #4354. scripts\\mods\\content-salvaged.json says what became of every
record salvaged from another server's plugin (#2553). Since #2553 the only
thing that changes it is game\\data\\station-sites.json: a salvaged cell or
worldspace a station Thornswood places stands in stays as Bethesda's, and one
no station stands in is dropped. The study desk in the Hall of the Elements
(#1387) is the first station to stand in a cell the list had dropped.

List-SalvagedRecords.py used to rebuild the whole list from the plugin's git
history, so it could only run on a full clone, never on the box, which gets
a commit's files and no history. This runs it in a copy of the repository's
files with no .git at all and proves:

  A. with main's station table it finds the list already right and writes
     it as it is;
  B. its --check agrees;
  C. with the desk taken out of the table, the hall is dropped (no
     bethesdaSha256, the counts follow) and no other row moves;
  D. with the desk back and no masters to read, it stops, names the hall and
     --masters, and writes nothing, so a run with no game never leaves a
     dropped hall under a desk;
  E. with the desk back and the masters' copy of the hall, the hall is
     Bethesda's again with that copy's hash, and the list is main's but for
     the hash;
  F. --history, the full rebuild, says it needs a full clone when there is
     none.

Copies go to a temporary folder (TEST_TMP if set) and are removed.
"""

import hashlib
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
HALL = '1380e:Skyrim.esm'
HALL_SITE = 'study-elements'

passed = failed = 0


def yes(what, cond):
    global passed, failed
    if cond:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


def copy_tree(dest):
    # Files only, no modes or times: the copy is a checkout's files and
    # nothing else, as the box gets them.
    for d in ('scripts/mods', 'scripts/dev'):
        for here, _, files in os.walk(os.path.join(ROOT, d)):
            into = os.path.join(dest, os.path.relpath(here, ROOT))
            os.makedirs(into, exist_ok=True)
            for name in files:
                shutil.copyfile(os.path.join(here, name), os.path.join(into, name))
    for f in ('game/data/station-sites.json', 'game/content/Thornswood-Content.esp'):
        os.makedirs(os.path.dirname(os.path.join(dest, f)), exist_ok=True)
        shutil.copyfile(os.path.join(ROOT, f), os.path.join(dest, f))


def run(dest, *args):
    return subprocess.run([sys.executable, os.path.join(dest, 'scripts', 'mods', 'List-SalvagedRecords.py')]
                          + list(args), cwd=dest, capture_output=True, text=True)


def read(path):
    # The tool writes \n line ends; a Windows checkout may hold \r\n.
    with open(path, 'rb') as f:
        return f.read().replace(b'\r\n', b'\n')


def rows(text):
    return {r['formId']: r for r in json.loads(text)['records']}


main_list = read(os.path.join(ROOT, 'scripts', 'mods', 'content-salvaged.json'))
main_rows = rows(main_list)
yes('main\'s list keeps the Hall of the Elements as Bethesda\'s, with the master\'s hash (#1387)',
    main_rows.get(HALL, {}).get('disposition') == "Bethesda's" and len(main_rows[HALL].get('bethesdaSha256', '')) == 64)
with open(os.path.join(ROOT, 'game', 'data', 'station-sites.json'), encoding='utf-8', newline='') as f:
    sites_text = f.read()
yes('main\'s station table stands a study desk in the hall',
    json.loads(sites_text)['sites'].get(HALL_SITE, {}).get('cell') == HALL)

tmp_root = os.environ.get('TEST_TMP') or tempfile.gettempdir()
os.makedirs(tmp_root, exist_ok=True)
dest = tempfile.mkdtemp(prefix='ts-4354-', dir=tmp_root)
try:
    copy_tree(dest)
    out = os.path.join(dest, 'scripts', 'mods', 'content-salvaged.json')
    sites = os.path.join(dest, 'game', 'data', 'station-sites.json')
    no_game = os.path.join(dest, 'no-game')
    os.makedirs(no_game)
    yes('the copy has no git history to read', not os.path.exists(os.path.join(dest, '.git')))

    # A. Main's table: the list is already right, and stays as it is.
    a = run(dest, '--masters', no_game)
    yes('A the tool runs with no history and no game (exit %d)' % a.returncode, a.returncode == 0)
    if a.returncode != 0:
        print(a.stdout + a.stderr)
    yes('A and leaves main\'s list as it is', read(out) == main_list)

    # B. --check agrees.
    b = run(dest, '--check', '--masters', no_game)
    yes('B --check says the list is what the station table gives', b.returncode == 0)

    # C. No desk in the hall: the hall goes, and nothing else moves.
    table = json.loads(sites_text)
    del table['sites'][HALL_SITE]
    with open(sites, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(table, f, indent=1)
    c = run(dest, '--masters', no_game)
    got = json.loads(read(out).decode('utf-8'))
    now = rows(read(out).decode('utf-8'))
    hall = now.get(HALL, {})
    yes('C with no desk in the hall the tool runs (exit %d)' % c.returncode, c.returncode == 0)
    yes('C the hall is dropped, with no master\'s hash',
        hall.get('disposition') == 'dropped' and 'bethesdaSha256' not in hall and
        hall.get('why') == "nothing of Thornswood's is placed in it once the placements above go")
    want_counts = dict(json.loads(main_list)['counts'])
    want_counts["CELL Bethesda's"] -= 1
    want_counts['CELL dropped'] += 1
    yes('C the counts follow: CELL Bethesda\'s %d, dropped %d' % (want_counts["CELL Bethesda's"], want_counts['CELL dropped']),
        got['counts'] == want_counts)
    others = [k for k in main_rows if k != HALL and now.get(k) != main_rows[k]]
    yes('C no other row moved', not others and [r['formId'] for r in got['records']] == list(main_rows))
    dropped_list = read(out)

    # D. The desk back, no masters: stop, say why, write nothing.
    with open(sites, 'w', encoding='utf-8', newline='') as f:
        f.write(sites_text)
    d = run(dest, '--masters', no_game)
    said = d.stdout + d.stderr
    yes('D with the desk back and no masters to read it stops (exit %d)' % d.returncode, d.returncode != 0)
    yes('D and says the hall needs --masters', 'STOP.' in said and '1380e' in said and '--masters' in said)
    yes('D and writes nothing: the list is as it was', read(out) == dropped_list)

    # E. The desk back, the masters' copy of the hall: Bethesda's again.
    spec = importlib.util.spec_from_file_location('list_salvaged', os.path.join(dest, 'scripts', 'mods', 'List-SalvagedRecords.py'))
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    own = b'EDID' + struct.pack('<H', 35) + b'WinterholdCollegeHallofTheElements\x00' + b'DATA' + struct.pack('<H', 2) + b'\x01\x00'
    asked = []

    class Masters(object):
        @staticmethod
        def bethesdas_world_records(masters_dir, names, wanted):
            asked.append((masters_dir, list(wanted)))
            return {k: (None, own) for k in wanted}

    tool.content_tool = lambda: Masters
    written = tool.update('the-masters')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(written, indent=1, ensure_ascii=True) + '\n')
    hall = rows(read(out).decode('utf-8'))[HALL]
    rest = b'DATA' + struct.pack('<I', 2) + b'\x01\x00'
    yes('E only the hall is asked of the masters', len(asked) == 1 and asked[0][0] == 'the-masters' and
        [k[1] & 0xFFFFFF for k in asked[0][1]] == [0x1380e] and asked[0][1][0][0] == b'CELL')
    yes('E the hall is Bethesda\'s again, with the hash of the masters\' copy, editor id left out',
        hall['disposition'] == "Bethesda's" and hall['bethesdaSha256'] == hashlib.sha256(rest).hexdigest())
    back = json.loads(read(out).decode('utf-8'))
    for r in back['records']:
        if r['formId'] == HALL:
            r['bethesdaSha256'] = main_rows[HALL]['bethesdaSha256']
    yes('E and the list is main\'s, but for that hash',
        (json.dumps(back, indent=1, ensure_ascii=True) + '\n').encode('utf-8') == main_list)

    # F. The full rebuild is still there, and needs a full clone.
    f_run = run(dest, '--history', '--masters', no_game)
    yes('F --history needs the history, and says so', f_run.returncode != 0 and 'STOP.' in f_run.stdout + f_run.stderr and
        'history' in f_run.stdout + f_run.stderr)
finally:
    shutil.rmtree(dest, ignore_errors=True)

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
