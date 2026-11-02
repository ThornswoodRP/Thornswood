"""
pr_tasks.py

The test tasks a pull request carries in its body, read the way
.github/workflows/done-on-merge.yml reads them at the merge, and checked
against the bot's own post rules (post_problems in bot.py) while the pull
request is still open (#5199).

WHY. A fix people would notice carries its test task in its pull request,
"Test task for #N: <title>" with the steps under it. done-on-merge.yml copies
that block onto the issue at the merge, and the main Ship closes the issue
with it, and only then does the bot read it and check its rules. A block
that breaks one (a title over 45 characters, no Server line, a link, a step
a workflow could do) was found days after the merge, on an issue already in
Done, by a comment the bot left there for a thread that had long finished.
The redesign's part 18: the pull request's check runs the same rules, so a
bad one is caught before the merge.

WHAT IT HOLDS, for each "Test task for #N" block in the body:
  - every rule post_problems holds for the forum its Server line names
    (Dev for "Server: Dev", Main otherwise), the same function the bot posts
    with, so the two can never disagree; whether the fix is in the newest
    main release is not asked, because it never is before the merge;
  - a Main body fits the first post the bot makes of it (bot.TASK_BODY_ROOM),
    since the bot cuts a Main one there and the rest would never be seen;
  - one block per issue and kind in the pull request (the bot posts the last
    one of each kind and nobody would see the first);
  - with an issue reader (the workflow passes one, from the run's own token):
    #N is an issue of this repository, not a pull request, and open, because
    done-on-merge.yml passes over a closed one and the test task is lost;
  - the body does not also say Closes, Fixes or Resolves #N, which closes
    the issue at the merge, before done-on-merge.yml can copy the task.

THE GRAMMAR is done-on-merge.yml's, line for line: a line "Test task for #N:
<title>" starts a block; a heading, a "---" line, a line starting with an
emoji (the "Generated with" footer) or the next such line ends it; the rest
of the block, trimmed, is the steps, and its first line is the Server line.
The three patterns below are written in that workflow too, and
bot/tests/test-5199-pr-tasks.py fails when the two stop matching.

    python bot/pr_tasks.py              the pull request PR_NUMBER names, or the
                                        open one whose head is HEAD_REF, read from
                                        GitHub; with neither, the body in PR_BODY
    python bot/pr_tasks.py --file x.md  the body in a file

The body is read from GitHub when it can be, not from the event, so a run
started by hand on a branch (engine-pin.yml starts one on its pin branch,
whose pull request its own token opened and which no event reached) reads
the body the pull request has now. It prints a line per block, PASS or FAIL
with each rule broken, and exits 1 when any rule is broken. GITHUB_TOKEN and
GITHUB_REPOSITORY, when both are set, let it read the pull request and each
issue it names; without them the issues are said and skipped. It never
writes anything anywhere.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# done-on-merge.yml's three patterns, the same text in its PowerShell.
START = re.compile(r'^\s*Test task for #(\d+)\s*:\s*(.+?)\s*$')
HEADING = re.compile(r'^\s*#{1,6}\s')
RULE = re.compile(r'^\s*---\s*$')
# PowerShell's '^\s*[\uD800-\uDBFF]' is a character past U+FFFF, the high
# half of its UTF-16 pair; Python sees the whole character.
EMOJI = re.compile(r'^\s*[\U00010000-\U0010FFFF]')
DEV_LINE = re.compile(r'^\s*Server\s*:\s*Dev\s*(\n|$)')
SERVER_LINE = re.compile(r'^\s*server\s*:\s*(dev|main)\s*$', re.I)
# What closes an issue at the merge (GitHub's closing keywords).
CLOSES = re.compile(r'\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b', re.I)


def blocks(body):
    """Every "Test task for #N" block in a pull request's body, in order, as
       dicts of issue (int), title, steps (the block's lines, trimmed, as
       done-on-merge.yml writes them under "Test task: <title>") and kind
       ('Dev' or 'Main', as done-on-merge.yml decides it)."""
    out, cur = [], None
    for line in str(body or '').replace('\r\n', '\n').split('\n'):
        m = START.match(line)
        if m:
            cur = {'issue': int(m.group(1)), 'title': m.group(2), 'rest': []}
            out.append(cur)
            continue
        if cur is not None and (HEADING.match(line) or RULE.match(line) or EMOJI.match(line)):
            cur = None
            continue
        if cur is not None:
            cur['rest'].append(line)
    for b in out:
        b['steps'] = '\n'.join(b.pop('rest')).strip()
        b['kind'] = 'Dev' if DEV_LINE.match(b['steps']) else 'Main'
    return out


def comment_of(block):
    """The "Test task:" comment done-on-merge.yml writes for the block, as the
       bot will read it."""
    return 'Test task: ' + block['title'] + '\n' + block['steps']


def _bot():
    # Imported only to check, so reading the blocks needs nothing but Python.
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
    import bot  # noqa: E402
    return bot


def problems(body, read_issue=None, bot=None):
    """[(block, [rule broken, ...]), ...] for every block in body, and a list
       of what was not checked. read_issue(n) returns the issue's JSON as
       GitHub gives it, or None when there is no such issue; None skips the
       issue checks."""
    bot = bot or _bot()
    got = blocks(body)
    closes = {int(n) for n in CLOSES.findall(str(body or ''))}
    skipped = []
    seen = {}
    out = []
    for b in got:
        # The comment done-on-merge.yml writes, read back the way the bot
        # reads a comment: its title, its Server line and its body.
        issue_stub = {'number': b['issue'], 'title': b['title']}
        title, text, server, _c, _u = bot._all_marked(
            issue_stub, [{'body': comment_of(b)}], bot.TASK_MARK, room=None)[0]
        channel = 'dev' if b['kind'] == 'Dev' else 'main'
        rules = list(bot.post_problems(channel, b['title'], text, server=server,
                                       fix_in_main=None))
        if channel == 'main' and len(text) > bot.TASK_BODY_ROOM:
            rules.append('Format: the steps are %d characters; the bot posts a Main '
                         'test task in one message of %d, and cuts the rest.'
                         % (len(text), bot.TASK_BODY_ROOM))
        key = (b['issue'], b['kind'])
        if key in seen:
            rules.append('Duplicates: this pull request has another %s test task for '
                         'issue %d; the bot posts only the last, so write one.'
                         % (b['kind'], b['issue']))
        seen[key] = True
        if b['issue'] in closes:
            rules.append('Closing: the body also closes issue %d, so the merge closes it '
                         'and the test task is never copied onto it; write Refs '
                         'instead.' % b['issue'])
        if read_issue is None:
            if 'issues' not in skipped:
                skipped.append('issues')
        else:
            issue = read_issue(b['issue'])
            if issue is None:
                rules.append('Issue: there is no issue %d in this repository.' % b['issue'])
            elif issue.get('pull_request'):
                rules.append('Issue: %d is a pull request, not an issue.' % b['issue'])
            elif str(issue.get('state')) != 'open':
                rules.append('Issue: issue %d is closed, and a merge passes over a closed '
                             'issue, so the test task would be lost.' % b['issue'])
        out.append((b, rules))
    return out, skipped


def _get(token, path):
    """GET path of GitHub's REST API with token; None for 404 or 410."""
    req = urllib.request.Request(
        'https://api.github.com/' + path,
        headers={'Authorization': 'Bearer ' + token,
                 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return None
        raise


def github_reader(repo, token):
    """read_issue for problems(), from GitHub's REST API with the given token."""
    return lambda n: _get(token, 'repos/%s/issues/%d' % (repo, n))


def pr_body(repo, token, number=None, head_ref=None):
    """(body, what) of the pull request numbered number, or of the one open
       pull request whose head is head_ref in repo; (None, why) when there is
       none to read."""
    if number:
        pr = _get(token, 'repos/%s/pulls/%d' % (repo, int(number)))
        if pr is None:
            return None, 'there is no pull request %s' % number
        return str(pr.get('body') or ''), 'pull request %s' % number
    owner = repo.split('/')[0]
    got = _get(token, 'repos/%s/pulls?state=open&per_page=10&head=%s'
               % (repo, urllib.parse.quote('%s:%s' % (owner, head_ref), safe=''))) or []
    if len(got) != 1:
        return None, '%d open pull requests have %s as their head' % (len(got), head_ref)
    return str(got[0].get('body') or ''), 'pull request %s' % got[0].get('number')


def main(argv):
    token = os.environ.get('GITHUB_TOKEN', '').strip()
    repo = os.environ.get('GITHUB_REPOSITORY', '').strip()
    number = os.environ.get('PR_NUMBER', '').strip()
    head_ref = os.environ.get('HEAD_REF', '').strip()
    if '--file' in argv:
        with open(argv[argv.index('--file') + 1], encoding='utf-8-sig') as f:
            body = f.read()
    elif token and repo and (number or head_ref):
        try:
            body, what = pr_body(repo, token, number, head_ref)
        except (urllib.error.URLError, OSError, ValueError) as e:
            print('FAIL  the pull request could not be read from GitHub, so nothing was checked: %s' % e)
            return 1
        if body is None:
            print('PASS  nothing to check: ' + what)
            return 0
        print('reading the body of ' + what)
    else:
        body = os.environ.get('PR_BODY', '')
    reader = github_reader(repo, token) if token and repo else None
    try:
        results, skipped = problems(body, reader)
    except (urllib.error.URLError, OSError, ValueError) as e:
        print('FAIL  an issue the body names could not be read from GitHub, so the check did not finish: %s' % e)
        return 1
    if not results:
        print('PASS  no "Test task for #N:" line in the body, so there is nothing to check')
        return 0
    bad = 0
    for b, rules in results:
        what = '%s test task for issue %d, "%s"' % (b['kind'], b['issue'], b['title'])
        if rules:
            bad += 1
            print('FAIL  ' + what)
            for r in rules:
                print('        ' + r)
                if os.environ.get('GITHUB_ACTIONS') == 'true':
                    print('::error title=Test task for issue %d::%s' % (b['issue'], r))
        else:
            print('PASS  ' + what)
    if 'issues' in skipped:
        print('SKIP  whether each issue is open: no GITHUB_TOKEN and GITHUB_REPOSITORY to read it with')
    if bad:
        print('\n%d of %d test task(s) break a rule. Edit the pull request body; this '
              'check runs again on the edit. docs/guide/the-board.md, "Test tasks and known '
              'issues", has the shapes.' % (bad, len(results)))
        return 1
    print('\nevery test task in the body passes the bot\'s rules')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
