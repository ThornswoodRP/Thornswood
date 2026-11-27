"""
pr_tasks.py

The test tasks a pull request carries in its body, read the way
.github/workflows/done-on-merge.yml reads them at the merge, and checked
against the bot's own post rules (post_problems in bot_post_rules.py) while the pull
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
  - a Main body fits the one post the bot makes of it (TASK_BODY_ROOM),
    which is one of post_problems' rules since 12 Nov: the bot used to cut a
    longer one there, and now refuses it as this check does;
  - one block per issue and kind in the pull request (the bot posts the last
    one of each kind and nobody would see the first);
  - with an issue reader (the workflow passes one, from the run's own token):
    #N is an issue of this repository, not a pull request, and open, because
    done-on-merge.yml passes over a closed one and the test task is lost;
  - the body does not also say Closes, Fixes or Resolves #N, which closes
    the issue at the merge, before done-on-merge.yml can copy the task.

KNOWN ISSUES (#7080), with an issue reader: each "Known issue for #N:
<title>" block, with the lines under it, is held to the rules the bot posts a
known issue with, and #N must be an open finding (Main Findings or Dev
Findings). Every open finding the body names with Refs, Closes, Fixes or
Resolves and no test task for needs one, or "Known issue for #N: unchanged",
so a change says what it means for a problem testers still meet; Done on
merge writes the block on the issue. The engine pin's own pull request
(engine-pin/...) is not asked, using the requested pull request's verified
same-repository head metadata, never a caller's HEAD_REF prefix.

A TEST TASK IN ANOTHER SHAPE is refused too, when the body has no block:
a heading or a line that starts "Test task", "Test tasks", "Main test
task" or "Dev test task" ("## Test task (Dev)", "Main test task, for two
members of staff:"). done-on-merge.yml copies only the shape below, so one
written any other way never reached its issue, the issue never went to Done,
and no Ship closed it: 15 Nov, the Bots' pull requests #5853, #5856, #5956,
#6067, #6070 and #6115 all passed this check that way and left their issues
open. A line that says none ("Test tasks: none", or a heading whose next
line says it) is a body with no test task, and passes.

THE GRAMMAR is done-on-merge.yml's, line for line: a line "Test task for #N:
<title>" starts a block; a heading, a "---" line, a line starting with an
emoji (the "Generated with" footer) or the next such line ends it; the rest
of the block, trimmed, is the steps, and its first line is the Server line.
The three patterns below are written in that workflow too, and
bot/tests/test-5199-pr-tasks.py fails when the two stop matching.

    python bot/pr_tasks.py              a pull_request run's first attempt: the
                                        body its event carries, in PR_EVENT_BODY;
                                        else the pull request PR_NUMBER names, or
                                        the open one whose head is HEAD_REF, read
                                        from GitHub; with neither, the body in
                                        PR_BODY
    python bot/pr_tasks.py --file x.md  the body in a file

A pull_request run checks the body its own event carries (#5900): the
workflow's concurrency group cancels it when a newer event on the pull
request arrives, so that is the body as it is now, and reading it back from
GitHub only added a read that could fail. When GitHub answered that read
with a 503, the check failed the pull request, and as the newest run on the
head it stood over an earlier run that had passed. A re-run, the merge queue
and a run started by hand read the body from GitHub, since their event
carries none or an old one (engine-pin.yml starts one on its pin branch,
whose pull request its own token opened and which no event reached), and
each fails closed when it cannot. It prints a line per block, PASS or FAIL
with each rule broken, and exits 1 when any rule is broken. GITHUB_TOKEN and
GITHUB_REPOSITORY, when both are set, let it read the pull request and each
issue it names; without them the issues are said and skipped. It never
writes anything anywhere.
"""
import json
import os
import re
import sys
import types
import urllib.error
import urllib.parse
import urllib.request

# done-on-merge.yml's three patterns, the same text in its PowerShell.
START = re.compile(r'^\s*Test task for #(\d+)\s*:\s*(.+?)\s*$')
KNOWN_START = re.compile(r'^\s*Known issue for #(\d+)\s*:\s*(.+?)\s*$')
HEADING = re.compile(r'^\s*#{1,6}\s')
RULE = re.compile(r'^\s*---\s*$')
# PowerShell's '^\s*[\uD800-\uDBFF]' is a character past U+FFFF, the high
# half of its UTF-16 pair; Python sees the whole character.
EMOJI = re.compile(r'^\s*[\U00010000-\U0010FFFF]')
DEV_LINE = re.compile(r'^\s*Server\s*:\s*Dev\s*(\n|$)')
SERVER_LINE = re.compile(r'^\s*server\s*:\s*(dev|main)\s*$', re.I)
# A line that reads as a test task but is not done-on-merge.yml's shape, and
# the word that says there is none.
LOOSE = re.compile(r'^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(?:(?:main|dev)\s+)?test\s+tasks?\b', re.I)
NONE = re.compile(r'\bnone\b', re.I)
FENCE = re.compile(r'^\s*(```|~~~)')
# What closes an issue at the merge (GitHub's closing keywords).
CLOSES = re.compile(r'\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b', re.I)
# Every issue a "Refs", "Closes", "Fixes" or "Resolves" line names, lists
# ("Refs #1, #2") included.
NAMES = re.compile(r'\b(?:refs?|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:#\d+\b[\s,]*(?:and\s+)?)+)', re.I)
# A known issue the pull request leaves as it is says so.
UNCHANGED = re.compile(r'^\s*unchanged\b', re.I)
# What the bot keeps #known-issues from (bot_github.KNOWN_LABELS).
FINDINGS = ('Dev Findings', 'Main Findings')
# The engine pin's branch: its body carries the fork's pull requests, whose
# changes are the fork's, and engine-pin.yml writes it.
PIN_HEAD = 'engine-pin/'


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
        if cur is not None and (HEADING.match(line) or RULE.match(line) or EMOJI.match(line)
                                or KNOWN_START.match(line)):
            cur = None
            continue
        if cur is not None:
            cur['rest'].append(line)
    for b in out:
        b['steps'] = '\n'.join(b.pop('rest')).strip()
        b['kind'] = 'Dev' if DEV_LINE.match(b['steps']) else 'Main'
    return out


def known_blocks(body):
    """Every "Known issue for #N: <title>" block in a pull request's body, in
       order, as dicts of issue, title, text (the lines under it, trimmed)
       and unchanged (its title says the known issue stays as it is, and
       nothing is copied). It ends where a test task block does, or at the
       next block of either kind (#7080)."""
    out, cur = [], None
    for line in str(body or '').replace('\r\n', '\n').split('\n'):
        m = KNOWN_START.match(line)
        if m:
            cur = {'issue': int(m.group(1)), 'title': m.group(2), 'rest': []}
            out.append(cur)
            continue
        if cur is not None and (HEADING.match(line) or RULE.match(line) or EMOJI.match(line)
                                or START.match(line)):
            cur = None
            continue
        if cur is not None:
            cur['rest'].append(line)
    for b in out:
        b['text'] = '\n'.join(b.pop('rest')).strip()
        b['unchanged'] = bool(UNCHANGED.match(b['title'])) and not b['text']
    return out


def named(body):
    """The issue numbers the body names with Refs, Closes, Fixes or
       Resolves, outside HTML comments, as a set."""
    text = re.sub(r'<!--.*?(-->|$)', '', str(body or ''), flags=re.S)
    out = set()
    for m in NAMES.finditer(text):
        out.update(int(n) for n in re.findall(r'#(\d+)', m.group(1)))
    return out


def known_comment_of(block):
    """The "Known issue:" comment done-on-merge.yml writes for the block."""
    return 'Known issue: ' + block['title'] + '\n' + block['text']


def loose(body):
    """[(line number, line), ...]: the lines of a body with no "Test task for
       #N:" block that read as a test task in another shape, which
       done-on-merge.yml would never copy. Empty when the body has a block
       (a heading over the blocks is only a heading), and for a line that
       says none, or whose next line with text does, and inside a fenced
       block or an HTML comment (the template's own notes, left in)."""
    if blocks(body):
        return []
    # An HTML comment is blanked, its line breaks kept, so the line numbers
    # said stay the body's own.
    text = re.sub(r'<!--.*?(-->|$)', lambda m: '\n' * m.group(0).count('\n'),
                  str(body or '').replace('\r\n', '\n'), flags=re.S)
    lines = text.split('\n')
    out, fenced = [], False
    for i, line in enumerate(lines):
        if FENCE.match(line):
            fenced = not fenced
            continue
        m = None if fenced else LOOSE.match(line)
        if not m:
            continue
        nxt = next((x for x in lines[i + 1:] if x.strip()), '')
        if NONE.search(line[m.end():]) or NONE.search(nxt[:40]):
            continue
        out.append((i + 1, line.strip()))
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
    # The four things read here, from the modules of the bot that have them
    # (#5357).
    from bot_github import KNOWN_MARK, TASK_MARK  # noqa: E402
    from bot_task_text import _all_marked, _marked  # noqa: E402
    from bot_post_rules import post_problems  # noqa: E402
    from bot_testing import TASK_BODY_ROOM  # noqa: E402
    return types.SimpleNamespace(TASK_MARK=TASK_MARK, KNOWN_MARK=KNOWN_MARK,
                                 _all_marked=_all_marked, _marked=_marked,
                                 post_problems=post_problems,
                                 TASK_BODY_ROOM=TASK_BODY_ROOM)


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
            issue_stub, [{'body': comment_of(b)}], bot.TASK_MARK)[0]
        channel = 'dev' if b['kind'] == 'Dev' else 'main'
        rules = list(bot.post_problems(channel, b['title'], text, server=server,
                                       fix_in_main=None))
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


def _finding(issue):
    labels = {str(l.get('name') if isinstance(l, dict) else l) for l in (issue or {}).get('labels') or []}
    return bool(labels & set(FINDINGS))


def known_problems(body, read_issue=None, bot=None, head_ref=''):
    """[(what, [rule broken, ...]), ...] for the known issues of a pull
       request (#7080), and a list of what was not checked.

       Each "Known issue for #N" block is held to the rules the bot posts a
       known issue with (post_problems, channel 'known'), read back the way
       the bot reads the comment done-on-merge.yml writes for it, and #N must
       be an open finding, which is all the bot posts.

       And every open finding the body names (Refs, Closes, Fixes, Resolves)
       with no test task in the body needs a known issue block: what the
       pull request changes about the problem testers still meet is said
       with the change, so the post never falls behind it. On 26 Nov 2026
       five of the sixteen open findings had no post at all and three said
       what was true two weeks before. "Known issue for #N: unchanged", with
       nothing under it, says it stays as it is. The engine pin's own pull
       request (engine-pin/...) is not asked: it carries the fork's changes,
       which are said where they were made. head_ref is verified PR context
       from pr_context/_event_pr_head, never the caller's queue or branch hint."""
    bot = bot or _bot()
    out, skipped = [], []
    kb = known_blocks(body)
    tasks = {b['issue'] for b in blocks(body)}
    seen = set()
    for b in kb:
        what = 'known issue for issue %d, "%s"' % (b['issue'], b['title'])
        rules = []
        if b['issue'] in seen:
            rules.append('Duplicates: this pull request has another known issue for issue %d; '
                         'the bot posts only the last, so write one.' % b['issue'])
        seen.add(b['issue'])
        issue = None
        if read_issue is None:
            if 'issues' not in skipped:
                skipped.append('issues')
        else:
            issue = read_issue(b['issue'])
        if not b['unchanged']:
            # The issue as it will be at the merge: open, as the rules below
            # hold it, whatever it is read as here.
            stub = dict(issue or {}, number=b['issue'], state='open')
            stub.setdefault('labels', [])
            got = bot._marked(stub, [{'body': known_comment_of(b)}], bot.KNOWN_MARK)
            title, text = (got[0], got[1]) if got else (b['title'], b['text'])
            rules += list(bot.post_problems('known', title, text, issue=stub, written=True,
                                            has_task=False, taken_titles=()))
        if read_issue is not None:
            if issue is None or issue.get('pull_request'):
                rules.append('Issue: %d is not an issue of this repository.' % b['issue'])
            elif str(issue.get('state')) != 'open':
                rules.append('Issue: issue %d is closed, so it has no known issue to update.'
                             % b['issue'])
            elif not _finding(issue):
                rules.append('Issue: issue %d is not labelled Main Findings or Dev Findings, '
                             'and the bot posts known issues only for those.' % b['issue'])
        out.append((what, rules))
    if read_issue is None or str(head_ref or '').startswith(PIN_HEAD):
        return out, skipped
    have = tasks | {b['issue'] for b in kb}
    for n in sorted(named(body) - have):
        issue = read_issue(n)
        if issue is None or issue.get('pull_request') or str(issue.get('state')) != 'open':
            continue
        if not _finding(issue):
            continue
        out.append(('open finding %d, which the body names' % n, [
            'Known issues: issue %d is a finding people still meet, and this pull request '
            'names it with no test task. Say what the change means for them: a "Known issue '
            'for #%d: <title>" block with what happens, where, how to avoid it and what is '
            'being done, which the merge writes on the issue for the bot to post; or "Known '
            'issue for #%d: unchanged" when it stays as it is.' % (n, n, n)]))
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


def _verified_pr_head(pr, repo, number):
    """Only this requested PR's same-repository head can identify a pin."""
    if (not isinstance(pr, dict) or not isinstance(number, int) or isinstance(number, bool)
            or number <= 0 or pr.get('number') != number):
        return ''
    base, head = pr.get('base'), pr.get('head')
    if not isinstance(base, dict) or not isinstance(head, dict):
        return ''
    for side in (base, head):
        source = side.get('repo')
        if not isinstance(source, dict) or str(source.get('full_name') or '').lower() != repo.lower():
            return ''
    ref = head.get('ref')
    return ref if isinstance(ref, str) else ''


def pr_context(repo, token, number=None, head_ref=None):
    """(body, what, verified head) from one requested PR response.
       A queue's synthetic ref is a selector, never the actual PR's head."""
    if number:
        number = int(number)
        pr = _get(token, 'repos/%s/pulls/%d' % (repo, number))
        if pr is None:
            return None, 'there is no pull request %s' % number, ''
        if not isinstance(pr, dict) or pr.get('number') != number:
            raise ValueError('the pull request response does not match the requested number')
    else:
        owner = repo.split('/')[0]
        got = _get(token, 'repos/%s/pulls?state=open&per_page=10&head=%s'
                   % (repo, urllib.parse.quote('%s:%s' % (owner, head_ref), safe=''))) or []
        if len(got) != 1:
            return None, '%d open pull requests have %s as their head' % (len(got), head_ref), ''
        pr = got[0]
        if not isinstance(pr, dict):
            raise ValueError('the pull request response is not an object')
        number = pr.get('number')
        head = pr.get('head')
        if not isinstance(head, dict):
            head = {}
        if head.get('ref') is not None and head.get('ref') != head_ref:
            raise ValueError('the pull request response does not match the requested head')
    return str(pr.get('body') or ''), 'pull request %s' % number, _verified_pr_head(pr, repo, number)


def pr_body(repo, token, number=None, head_ref=None):
    """The existing (body, what) interface; provenance stays in pr_context."""
    body, what, _head = pr_context(repo, token, number, head_ref)
    return body, what


def _event_pr_head(repo, number, body):
    """Keep first-event body validation local; decline unverified context."""
    path = os.environ.get('GITHUB_EVENT_PATH', '')
    if not path or not number or not repo:
        return ''
    try:
        with open(path, encoding='utf-8') as f:
            event = json.load(f)
        if not isinstance(event, dict) or event.get('number') != int(number):
            return ''
        pr = event.get('pull_request')
        if not isinstance(pr, dict) or str(pr.get('body') or '') != body:
            return ''
        return _verified_pr_head(pr, repo, int(number))
    except (OSError, ValueError):
        # Missing or invalid metadata grants no exception to the ordinary gate.
        return ''


def from_event():
    """Whether this run checks the body its pull_request event carries
       (PR_EVENT_BODY) rather than reading it from GitHub (#5900). Only a
       pull_request run's first attempt: the workflow's concurrency group
       cancels it when a newer event on the pull request arrives, so its
       event's body is the body as it is now. A re-run keeps its first
       attempt's event, which an edit since may have left behind, and the
       merge queue and a run by hand carry no body; each of those reads it
       from GitHub, and fails closed when it cannot."""
    if os.environ.get('GITHUB_EVENT_NAME', '').strip() != 'pull_request':
        return False
    if 'PR_EVENT_BODY' not in os.environ:
        return False
    return (os.environ.get('GITHUB_RUN_ATTEMPT', '').strip() or '1') == '1'


def main(argv):
    token = os.environ.get('GITHUB_TOKEN', '').strip()
    repo = os.environ.get('GITHUB_REPOSITORY', '').strip()
    number = os.environ.get('PR_NUMBER', '').strip()
    head_ref = os.environ.get('HEAD_REF', '').strip()
    verified_head = ''
    if '--file' in argv:
        with open(argv[argv.index('--file') + 1], encoding='utf-8-sig') as f:
            body = f.read()
    elif from_event():
        # The body this run was started for (#5900). Read back from GitHub,
        # a GitHub error on that read was this required check failing the
        # pull request, as the newest run on its head, over one that passed.
        body = os.environ.get('PR_EVENT_BODY', '')
        verified_head = _event_pr_head(repo, number, body)
        print('reading the body the pull_request event carries, of pull request %s' % (number or '?'))
    elif token and repo and (number or head_ref):
        try:
            body, what, verified_head = pr_context(repo, token, number, head_ref)
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
        known, kskipped = known_problems(body, reader, head_ref=verified_head)
    except (urllib.error.URLError, OSError, ValueError) as e:
        print('FAIL  an issue the body names could not be read from GitHub, so the check did not finish: %s' % e)
        return 1
    kbad = 0
    for what, rules in known:
        if rules:
            kbad += 1
            print('FAIL  ' + what)
            for r in rules:
                print('        ' + r)
                if os.environ.get('GITHUB_ACTIONS') == 'true':
                    print('::error title=Known issue::' + r)
        else:
            print('PASS  ' + what)
    if kbad:
        print('\n%d known issue(s) break a rule. Edit the pull request body; this check runs '
              'again on the edit. docs/guide/the-board.md, "Test tasks and known issues", has '
              'the shapes.' % kbad)
    if kbad and not results:
        return 1
    if not results:
        stray = loose(body)
        for n, line in stray:
            why = ('line %d, "%s", reads as a test task, but done-on-merge.yml copies only a '
                   '"Test task for #N: <title>" line with its steps under it, so this one would '
                   'never reach its issue and no Ship would close it. Write it in that shape (the '
                   'pull request template has it), or write "No test task: nobody would notice '
                   'this fix." when nobody would.' % (n, line[:80]))
            print('FAIL  ' + why)
            if os.environ.get('GITHUB_ACTIONS') == 'true':
                print('::error title=Test task in another shape::' + why)
        if stray:
            return 1
        print('PASS  no "Test task for #N:" line in the body, so there is nothing to check')
        return 1 if kbad else 0
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
    return 1 if kbad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
