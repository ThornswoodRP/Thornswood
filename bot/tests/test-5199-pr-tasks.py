"""
test-5199-pr-tasks.py

The pull request's check on its test tasks (#5199, bot/pr_tasks.py): it
reads the "Test task for #N" blocks the way .github/workflows/done-on-merge.yml
does, and holds each against the bot's own post rules before the merge.

It holds:
  - the grammar is done-on-merge.yml's: the same three patterns are in that
    workflow's text, a block ends where that workflow ends one (a heading, a
    "---" line, an emoji line, the next block), and Dev is decided the same way;
  - a good Main and a good Dev test task pass, and so does a body with none;
  - each post rule is refused before the merge: a long title, no Server line,
    a link, code, a footer, unnumbered steps, a Dev step a workflow could do,
    ordinary steps marked Dev, a staff command in a Main one;
  - a Main body longer than the bot's first post, two of one kind for one
    issue, and a body that also closes the issue are refused;
  - with an issue reader: a missing issue, a pull request and a closed issue
    are refused, and an open issue passes;
  - main() exits 1 on a bad body and 0 on a good one, and says when it could
    not read the issues;
  - with a token it reads the body from GitHub, by number or through the one
    open pull request a branch heads, and passes a branch with none.

The real bot module is imported. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import contextlib
import io

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''  # nor the box admin service's (#5184)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
import pr_tasks  # noqa: E402

FAIL = []


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def rules_of(body, reader=None):
    got, _skipped = pr_tasks.problems(body, reader, bot=bot)
    return [r for _b, rs in got for r in rs]


def has(rules, word):
    return any(r.startswith(word) for r in rules)


MAIN = ('Test task for #101: Forge makes a dagger\n'
        'Server: Main\n'
        '1. Go to the forge outside Whiterun.\n'
        '2. Make an iron dagger.\n'
        'What should happen: you get one dagger.\n')
DEV = ('Test task for #102: Spawned wolf answers\n'
       'Server: Dev\n'
       '1. Join dev with the dev launcher and type /spawn wolf in chat.\n'
       '2. Watch the wolf.\n'
       'What should happen: a wolf appears.\n')

# ---- the grammar is done-on-merge.yml's
wf = open(os.path.join(HERE, '..', '.github', 'workflows', 'done-on-merge.yml'),
          encoding='utf-8').read()
for ps in (r"'^\s*Test task for #(\d+)\s*:\s*(.+?)\s*$'", r"'^\s*#{1,6}\s'",
           r"'^\s*---\s*$'", r"'^\s*[\uD800-\uDBFF]'", r"'^\s*Server\s*:\s*Dev\s*(\n|$)'"):
    yes('done-on-merge.yml still reads with %s, the pattern pr_tasks.py copies' % ps, ps in wf)
yes('  and pr_tasks.py holds the same text',
    pr_tasks.START.pattern == r'^\s*Test task for #(\d+)\s*:\s*(.+?)\s*$'
    and pr_tasks.HEADING.pattern == r'^\s*#{1,6}\s'
    and pr_tasks.RULE.pattern == r'^\s*---\s*$'
    and pr_tasks.DEV_LINE.pattern == r'^\s*Server\s*:\s*Dev\s*(\n|$)')

body = ('## What changed\n\nRefs #101\n\n' + MAIN + '\n' + DEV
        + '\n### Which parts\n- [x] The gamemode\n\n'
        + '\U0001f916 Generated with [Claude Code](https://claude.com/claude-code)\n')
got = pr_tasks.blocks(body)
yes('two blocks read, in order', [b['issue'] for b in got] == [101, 102])
yes('  the first is Main and the second Dev', [b['kind'] for b in got] == ['Main', 'Dev'])
yes('  a block ends at the next block', 'Spawned' not in got[0]['steps'])
yes('  and at a heading', 'Which parts' not in got[1]['steps'])
yes('  its steps are trimmed and begin with the Server line',
    got[0]['steps'].startswith('Server: Main\n1. Go') and got[0]['steps'].endswith('one dagger.'))
got = pr_tasks.blocks(MAIN + '\n---\nmore text\n')
yes('a "---" line ends a block', 'more text' not in got[0]['steps'])
got = pr_tasks.blocks(MAIN + '\U0001f916 Generated with Claude Code\n')
yes('an emoji line ends a block', 'Generated' not in got[0]['steps'])
yes('a block with no Server: Dev line is Main, as done-on-merge.yml reads it',
    pr_tasks.blocks('Test task for #1: A thing\n1. Do it.\n')[0]['kind'] == 'Main')
yes("the template's own example, #N, is not a block", pr_tasks.blocks(
    'Test task for #N: <title, at most 45 characters>\nServer: Main\n') == [])
yes('the comment written for a block is "Test task: <title>" and the steps',
    pr_tasks.comment_of(pr_tasks.blocks(MAIN)[0]).startswith('Test task: Forge makes a dagger\nServer: Main\n1. '))

# ---- good bodies pass
yes('a good Main test task passes', rules_of(MAIN) == [])
yes('a good Dev test task passes', rules_of(DEV) == [])
yes('both in one body pass', rules_of(MAIN + DEV) == [])
yes('a body with no test task has nothing to refuse', pr_tasks.problems('Closes #9', None, bot=bot)[0] == [])

# ---- each post rule, before the merge
yes('a title over 45 characters is refused', has(rules_of(
    MAIN.replace('Forge makes a dagger', 'Forge makes a dagger and a sword and a shield too')), 'Format'))
yes('no Server line is refused (the bot would refuse the post)',
    has(rules_of(MAIN.replace('Server: Main\n', '')), 'Format'))
yes('a link is refused', has(rules_of(MAIN.replace('one dagger', 'one dagger, see https://x.y')), 'Format'))
yes('code is refused', has(rules_of(MAIN.replace('iron dagger', '`iron dagger`')), 'Format'))
yes('an issue number in the steps is refused', has(rules_of(MAIN.replace('Whiterun', 'Whiterun (#77)')), 'Format'))
yes('a footer line inside the block is refused', has(rules_of(
    MAIN + '_Generated by [Claude Code](https://claude.ai/code)_\n3. Look again.\n'), 'Footer'))
yes('  one at its very end is cut, as the bot cuts it, and passes', rules_of(
    MAIN + '_Generated by [Claude Code](https://claude.ai/code)_\n') == [])
yes('steps that are not numbered are refused', has(rules_of(
    'Test task for #3: Forge works\nServer: Main\nGo to the forge and make a dagger.\n'), 'Format'))
yes('a Dev step a workflow could do is refused', has(rules_of(
    DEV.replace('Watch the wolf.', 'Read the server log and count the wolves.')), 'Dev test tasks'))
yes('ordinary steps marked Dev are refused (that is Main)', has(rules_of(
    MAIN.replace('Server: Main', 'Server: Dev')), 'Dev test tasks'))
yes('a staff command in a Main test task is refused', has(rules_of(
    MAIN.replace('Make an iron dagger.', 'Type /give iron dagger.')), 'Main test tasks'))
yes('whether the fix is on the main release is never asked before the merge',
    not has(rules_of(MAIN), 'Main test tasks'))

# ---- what only the pull request can get wrong
long_steps = 'Test task for #4: Long one\nServer: Main\n' + '1. Walk.\n' * 300
yes('a Main body past the first post is refused', has(rules_of(long_steps), 'Format: the steps are'))
yes('two Main test tasks for one issue are refused', has(rules_of(MAIN + MAIN), 'Duplicates'))
yes('  one Main and one Dev for one issue pass',
    rules_of(MAIN + DEV.replace('#102', '#101')) == [])
yes('a body that also closes the issue is refused', has(rules_of('Closes #101\n\n' + MAIN), 'Closing'))
yes('  as does Fixes and Resolved', has(rules_of('Fixes #101\n' + MAIN), 'Closing')
    and has(rules_of('resolved #101\n' + MAIN), 'Closing'))
yes('  Refs passes', rules_of('Refs #101\n\n' + MAIN) == [])
yes('  closing another issue passes', rules_of('Closes #9\n\n' + MAIN) == [])

# ---- the issue it names
ISSUES = {101: {'number': 101, 'state': 'open'},
          102: {'number': 102, 'state': 'closed'},
          103: {'number': 103, 'state': 'open', 'pull_request': {'url': 'x'}}}
reader = ISSUES.get
yes('an open issue passes', rules_of(MAIN, reader) == [])
yes('a closed issue is refused', has(rules_of(MAIN.replace('#101', '#102'), reader), 'Issue'))
yes('a pull request is refused', has(rules_of(MAIN.replace('#101', '#103'), reader), 'Issue'))
yes('a missing issue is refused', has(rules_of(MAIN.replace('#101', '#104'), reader), 'Issue'))
yes('with no reader the issues are said to be skipped',
    pr_tasks.problems(MAIN, None, bot=bot)[1] == ['issues'])


# ---- main()
def run(body):
    os.environ['PR_BODY'] = body
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = pr_tasks.main([])
    return code, out.getvalue()


code, out = run(MAIN)
yes('main() passes a good body with exit 0', code == 0 and 'PASS  Main test task for issue 101' in out)
yes('  and says it could not read the issues', 'SKIP  whether each issue is open' in out)
code, out = run(MAIN.replace('Server: Main\n', ''))
yes('main() fails a bad body with exit 1 and names the rule', code == 1 and 'FAIL  Main test task for issue 101' in out
    and 'Server: Main' in out)
code, out = run('Closes #9\n')
yes('main() passes a body with no test task', code == 0 and 'nothing to check' in out)
os.environ.pop('PR_BODY', None)


def run_env():
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = pr_tasks.main([])
    return code, out.getvalue()


# ---- the body read from GitHub, as the workflow runs it
calls = []


def fake_get(token, path):
    calls.append(path)
    if path == 'repos/o/r/pulls/7':
        return {'number': 7, 'body': MAIN}
    if path.startswith('repos/o/r/pulls?state=open'):
        return [{'number': 8, 'body': DEV}] if 'engine-pin%2Fnext' in path else []
    if path.startswith('repos/o/r/issues/'):
        return {'number': int(path.rsplit('/', 1)[1]), 'state': 'open'}
    return None


real_get = pr_tasks._get
pr_tasks._get = fake_get
try:
    yes('a pull request by number is read from GitHub',
        pr_tasks.pr_body('o/r', 't', number='7') == (MAIN, 'pull request 7'))
    yes('a branch is read through its one open pull request, owner:branch',
        pr_tasks.pr_body('o/r', 't', head_ref='engine-pin/next') == (DEV, 'pull request 8')
        and 'head=o%3Aengine-pin%2Fnext' in calls[-1])
    yes('a branch with no open pull request has nothing to read',
        pr_tasks.pr_body('o/r', 't', head_ref='other')[0] is None)
    os.environ.update({'GITHUB_TOKEN': 't', 'GITHUB_REPOSITORY': 'o/r', 'PR_NUMBER': '7',
                       'PR_BODY': 'Test task for #1: x\n'})
    code, out = run_env()
    yes('main() reads the numbered pull request, not PR_BODY, and its issues',
        code == 0 and 'reading the body of pull request 7' in out and 'SKIP' not in out
        and 'repos/o/r/issues/101' in calls)
    os.environ['PR_NUMBER'] = ''
    os.environ['HEAD_REF'] = 'other'
    code, out = run_env()
    yes('main() passes a branch with no open pull request, and says so',
        code == 0 and 'nothing to check' in out)
finally:
    pr_tasks._get = real_get
    for k in ('GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'PR_NUMBER', 'HEAD_REF', 'PR_BODY'):
        os.environ.pop(k, None)

print()
if FAIL:
    print('%d check(s) failed' % len(FAIL))
    sys.exit(1)
print('all passed')
