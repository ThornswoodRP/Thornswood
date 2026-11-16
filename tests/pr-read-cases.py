"""
pr-read-cases.py

    python tests/pr-read-cases.py

The cases tests/test-5900-pr-read.js runs, which say why. Each prints a PASS
or FAIL line, and it exits 1 when any fails.

The bot's post rules are bot/tests/test-5199-pr-tasks.py's to hold, with the
real bot. Here a stand-in for them refuses a block with no Server line and
passes the rest, so this needs nothing but Python. Never connects to
anything.
"""
import contextlib
import io
import os
import sys
import types
import urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'bot'))
import pr_tasks  # noqa: E402

FAIL = []


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


# ---- a stand-in for the bot's rules: no Server line is refused
def all_marked(issue, comments, mark, room=None):
    text = comments[0]['body'].split('\n', 1)[1] if '\n' in comments[0]['body'] else ''
    first = text.split('\n', 1)[0].strip().lower()
    server = first.split(':', 1)[1].strip() if first.startswith('server:') else ''
    return [(issue['title'], text, server, None, None)]


def post_problems(channel, title, text, server=None, fix_in_main=None):
    return [] if server else ['Format: no Server line.']


STAND_IN = types.SimpleNamespace(TASK_MARK='Test task:', _all_marked=all_marked,
                                 post_problems=post_problems, TASK_BODY_ROOM=4000)
pr_tasks._bot = lambda: STAND_IN

MAIN = ('Test task for #101: Forge makes a dagger\n'
        'Server: Main\n'
        '1. Go to the forge outside Whiterun.\n'
        'What should happen: you get one dagger.\n')
OTHER = MAIN.replace('Forge makes a dagger', 'Forge makes a sword')

calls = []
state = {'down': True}


def fake_get(token, path):
    calls.append(path)
    if path.startswith('repos/o/r/pulls'):
        if state['down']:
            raise urllib.error.HTTPError('https://api.github.com/' + path, 503,
                                         'Service Unavailable', {}, None)
        if path == 'repos/o/r/pulls/7':
            return {'number': 7, 'body': OTHER}
        return [{'number': 8, 'body': OTHER}]
    if path.startswith('repos/o/r/issues/'):
        return {'number': int(path.rsplit('/', 1)[1]), 'state': 'open'}
    return None


pr_tasks._get = fake_get
KEYS = ('GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'PR_NUMBER', 'HEAD_REF', 'PR_BODY',
        'PR_EVENT_BODY', 'GITHUB_EVENT_NAME', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTIONS')
for k in KEYS:
    os.environ.pop(k, None)


def run(**env):
    for k in KEYS:
        os.environ.pop(k, None)
    os.environ.update({'GITHUB_TOKEN': 't', 'GITHUB_REPOSITORY': 'o/r', 'PR_NUMBER': '7'})
    os.environ.update(env)
    del calls[:]
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = pr_tasks.main([])
    return code, out.getvalue()


def asked_pr():
    return any(p.startswith('repos/o/r/pulls') for p in calls)


# ---- 1. a pull_request run checks the body its event carries
state['down'] = True
code, out = run(GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='1', PR_EVENT_BODY=MAIN)
yes('1. with GitHub answering 503 to the pull request, a pull_request run still checks it and passes a good body (exit %d)'
    % code, code == 0 and 'PASS  Main test task for issue 101, "Forge makes a dagger"' in out)
yes('   it never asks GitHub for the pull request', not asked_pr())
yes('   and says where the body came from', 'the body the pull_request event carries' in out)
yes('   it still reads the issue the block names', 'repos/o/r/issues/101' in calls)
code, out = run(GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='1',
                PR_EVENT_BODY=MAIN.replace('Server: Main\n', ''))
yes('   a bad body in the event still fails it (exit %d)' % code,
    code == 1 and 'FAIL  Main test task for issue 101' in out)
code, out = run(GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='1', PR_EVENT_BODY='')
yes('   an event whose body is empty is an empty body, not a read (exit %d)' % code,
    code == 0 and 'nothing to check' in out and not asked_pr())
state['down'] = False
code, out = run(GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='1', PR_EVENT_BODY=MAIN)
yes('   with GitHub up, it is still the event\'s body that is checked',
    'Forge makes a dagger' in out and 'Forge makes a sword' not in out and not asked_pr())

# ---- 2. a re-run reads the body as it is now
state['down'] = False
code, out = run(GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='2', PR_EVENT_BODY=MAIN)
yes('2. a re-run reads the pull request from GitHub, not its first attempt\'s event',
    'repos/o/r/pulls/7' in calls and 'Forge makes a sword' in out and 'Forge makes a dagger' not in out)
state['down'] = True
code, out = run(GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='2', PR_EVENT_BODY=MAIN)
yes('   and when GitHub cannot answer, it fails closed, saying nothing was checked (exit %d)' % code,
    code == 1 and 'could not be read from GitHub, so nothing was checked' in out)

# ---- 3. the merge queue and a run by hand read it
state['down'] = True
code, out = run(GITHUB_EVENT_NAME='merge_group', GITHUB_RUN_ATTEMPT='1', PR_EVENT_BODY=MAIN)
yes('3. the merge queue reads the pull request from GitHub, and fails closed when it cannot (exit %d)' % code,
    'repos/o/r/pulls/7' in calls and code == 1 and 'nothing was checked' in out)
code, out = run(GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_RUN_ATTEMPT='1', PR_NUMBER='',
                HEAD_REF='engine-pin/next')
yes('   and so does a run by hand on a branch (exit %d)' % code,
    any(p.startswith('repos/o/r/pulls?state=open') for p in calls) and code == 1)
state['down'] = False
code, out = run(GITHUB_EVENT_NAME='merge_group', GITHUB_RUN_ATTEMPT='1')
yes('   with GitHub up, the merge queue checks the body as it is now', code == 0 and 'Forge makes a sword' in out)

for k in KEYS:
    os.environ.pop(k, None)

# ---- 4. the workflow hands the body over in env
with open(os.path.join(REPO, '.github', 'workflows', 'test-tasks.yml'), encoding='utf-8') as f:
    wf = f.read()
at = wf.find('- name: Check the test tasks in the body')
step = wf[at:] if at >= 0 else ''
head, _, script = step.partition('run: |')
yes('4. test-tasks.yml passes the event\'s body to the step as PR_EVENT_BODY, in env',
    'PR_EVENT_BODY: ${{ github.event.pull_request.body }}' in head)
yes('   and never pastes it into the step\'s script', bool(script) and 'github.event.pull_request.body' not in script)

print()
if FAIL:
    print('%d case(s) failed' % len(FAIL))
    sys.exit(1)
print('all passed')
