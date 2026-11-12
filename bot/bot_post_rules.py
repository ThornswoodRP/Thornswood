"""
The rules every forum post is held to before it goes up.

Part of the bot: bot.py loads it (#5357).
"""
import json
import re
import urllib.request

from bot_core import log
from bot_github import (GITHUB_API, KNOWN_REPO, TASK_MARK, _github_get,
    github_token, known_repo_now)
from bot_task_text import CLAUDE_WORDS, FOOTER_LINE, FOOTER_RULE, _all_marked
from bot_testing import TASK_BODY_ROOM


# The rules every post is checked against before it goes up (Patrick, 22
# Oct: "the bot checks every rule, in all three channels, before it posts").
# A post that breaks one is not made, nor is a post already up edited to the
# bad version; the issue gets one comment naming the rules broken, so the
# thread that owns it fixes it, and the bot tries again on its next pass.
POST_TITLE_ROOM = 45
# A finding with no "Known issue:" comment. The bot used to post it under its
# issue title cut to fit and one fixed line; it never makes up a post's words
# now (Patrick, 12 Nov: "the title is supposed to be a summary and the
# details in the actual post").
NO_KNOWN_COMMENT = (
    'Known issues: the issue has no "Known issue:" comment, which holds the '
    'words of its post. Write one: its first line "Known issue: " and a '
    'summary of a few words, whole, not cut off; then, in plain words for '
    'testers, what happens, where, how to avoid it, and what is being done '
    'about it. A "Server: Dev" or "Server: Main" line straight under the '
    'title sets the tag.')
# Off only in tests of the forum passes that predate the rules; the rules
# have their own test (test-post-rules.py).
POST_RULES = True
STEP_LINE = re.compile(r'^\s*\d+[.)]\s+\S', re.M)
ISSUE_NUMBER = re.compile(r'(?<![\w&])#\d+\b')
LINK = re.compile(r'https?://|www\.', re.I)
CODE = re.compile(r'`')
# Built from its code point, never pasted, as Check-Words.ps1 explains.
EM_DASH = re.compile(chr(0x2014) + r'|&mdash;|&#8212;|&#x2014;', re.I)
BANNED_WORD = re.compile(r'\bplayers?\b', re.I)
# Steps a Claude, the Desk, a harness, a workflow or a command can do: a
# dev test task is only for what a human dev must do in the game.
AUTOMATABLE = re.compile(
    r'\bclaude\b|\bthe desk\b|\bthe box\b|\bon the box\b|\bvps\b|\bharness'
    r'|\bworkflow\b|\bpowershell\b|\bcurl\b|\bssh\b|\bscript\b|\.ps1\b|\.py\b'
    r'|\bbot\.py\b|\bget-content\b|\bget-filehash\b|\bremote\.ps1'
    r'|\bserver\.log\b|\bserver log\b|\blauncher\.log\b|\bskyrim-platform\.log\b'
    r'|\bgamemode log\b|\blogs?\b(?=[^.\n]*\b(?:count|read|copy|look|check|grep)\b)'
    r'|\b(?:count|read|copy|check)\b[^.\n]*\blogs?\b'
    r'|\bstaff[- ]notice\b|\bmanifest\b', re.I)
# What makes a check a dev's and not a playtester's, the things
# docs/guide/the-board.md ("#dev-test-tasks") names: a staff or dev command,
# the dev server, the dev build (offered only to staff) or something only staff
# can set up. Logs and the box are dev's too, and AUTOMATABLE above refuses
# them, because a Claude does those. The dev server was left out until #4349,
# so steps that only need devs on it were refused as playtester steps.
DEV_ONLY = re.compile(
    r'(?:^|\s)/(?!helpme\b)[a-z]+|\bstaff\b|\bdev command|\badmin\b'
    r'|\bdev (?:build|launcher|install|release|server)\b|\bswitch(?:ed)?\b'
    r'|\bhand-?edit|\bsettings file\b|\bskse loader\b', re.I)
# A staff or dev command in a main test task, which every playtester runs.
STAFF_STEP = re.compile(
    r'(?:^|\s)/(?:tp|give|spawn|kick|ban|god|heal|npcs?|time|weather|item|gold'
    r'|setrank|rank|mute|summon|teleport|debug)\b|\bstaff command|\bdev command'
    r'|\badmin\b', re.I)


def _steps(body):
    return [l for l in str(body or '').split('\n') if STEP_LINE.match(l)]


def task_server_line(issue, comments, url):
    """The Server line written straight under the "Test task:" comment at
       url ('Dev' or 'Main'), or None when it has none."""
    for got in _all_marked(issue, comments, TASK_MARK):
        if got[4] == url:
            return got[2]
    return None


def post_problems(channel, title, body, *, server=None, issue=None,
                  merged_pr=False, has_task=False, fix_in_main=None,
                  taken_titles=(), written=True):
    """
    The rules the post breaks, in words for the issue comment; empty when
    it may go up. channel is 'dev', 'main' (#test-tasks) or 'known'. body is
    the post's text as written on the issue (before dev_render adds the
    links a dev post carries). server is the Server line the comment had.
    fix_in_main is True or False when the latest main release was read
    (None: not known, not refused for it). taken_titles are the titles other
    issues already hold in this channel. written False: there is no comment
    at all ("Known issue:" for a known issue), so nothing else is checked.

    Nothing is cut or filled in to fit (Patrick, 12 Nov): a title with
    nothing after the colon, a known issue with nothing under its title, or
    a #known-issues or #test-tasks post longer than one message is refused
    like any other rule, and the issue is told why.
    """
    if not written:
        return [NO_KNOWN_COMMENT] if channel == 'known' else []
    out = []
    text = str(body or '')
    lines = text.split('\n')
    if any(FOOTER_RULE.match(l) for l in lines) or any(
            FOOTER_LINE.match(l) and (CLAUDE_WORDS.search(l) or '\U0001f916' in l)
            for l in lines):
        out.append('Footer: the text has a "---" line or a "Generated by/with '
                   'Claude Code" line; no post carries either.')
    if not str(title or '').strip():
        out.append('Format: the first line has nothing after the colon. Put a '
                   'summary of a few words there, whole, not cut off; the '
                   'details go in the lines under it.')
    if len(str(title or '')) > POST_TITLE_ROOM:
        out.append('Format: the title is %d characters; it may be %d at most.'
                   % (len(str(title)), POST_TITLE_ROOM))
    if str(title or '') in set(taken_titles):
        out.append('Duplicates: another issue already has a post titled "%s" '
                   'in this channel; one post per issue.' % title)
    if ISSUE_NUMBER.search(text) or LINK.search(text) or CODE.search(text):
        out.append('Format: the text has an issue number, a link or code; '
                   'posts carry none.')
    if channel in ('known', 'roadmap'):
        # The site shows these two to anybody (#3140), so the writing rules
        # every public page keeps hold here too (Check-Words.ps1 reads the
        # repository; these words are on GitHub, so the bot reads them).
        words = '%s\n%s' % (title or '', text)
        if EM_DASH.search(words):
            out.append('Words: the text has an em dash; nothing written for '
                       'people has one.')
        if BANNED_WORD.search(words):
            out.append('Words: the text says "player"; write "people", '
                       '"characters" or "testers" instead.')
    if channel == 'roadmap':
        if not text.strip():
            out.append('Roadmap: the "Roadmap:" comment has nothing under its '
                       'first line, which is where the work stands.')
        return out
    if channel in ('known', 'main') and len(text) > TASK_BODY_ROOM:
        out.append('Format: the text is %d characters; the post is one message '
                   'of %d at most, and the bot cuts nothing.'
                   % (len(text), TASK_BODY_ROOM))
    if channel == 'known':
        if not text.strip():
            out.append('Known issues: nothing is written under the title. Say, '
                       'in plain words for testers, what happens, where, how '
                       'to avoid it, and what is being done about it.')
        if issue is not None and str(issue.get('state')) != 'open':
            out.append('Known issues: the issue is closed.')
        if merged_pr:
            out.append('Known issues: a merged pull request names the issue.')
        if has_task:
            out.append('Known issues: the issue has a "Test task:" comment.')
        return out
    want = 'Dev' if channel == 'dev' else 'Main'
    if server != want:
        out.append('Format: the line under "Test task:" must be "Server: %s" '
                   'for this channel.' % want)
    steps = _steps(text)
    if not steps:
        out.append('Format: the steps are not numbered (1. 2. 3.).')
    if channel == 'dev':
        auto = [s.strip() for s in steps if AUTOMATABLE.search(s)]
        if auto:
            out.append('Dev test tasks: a Claude, the Desk, a harness, a '
                       'workflow or a command can do these steps, so they '
                       'run them and post the result instead (a "Check '
                       '(Claude):" comment): ' + ' / '.join(a[:80] for a in auto[:3]))
        if steps and not any(DEV_ONLY.search(s) for s in steps):
            out.append('Dev test tasks: these are ordinary playtester steps '
                       'with no staff or dev command; that is a Main test '
                       'task, written once a main release carries the fix.')
    else:
        if fix_in_main is False:
            out.append('Main test tasks: the fix commit is not in the latest '
                       'main release yet.')
        staff = [s.strip() for s in steps if STAFF_STEP.search(s)]
        if staff:
            out.append('Main test tasks: these steps need staff or dev '
                       'commands, which makes it a Dev test task: '
                       + ' / '.join(s[:80] for s in staff[:3]))
    return out


def github_say(number, text):
    """Comments text on the issue. The bot's token needs issues write for
       this; when it cannot, the refusal is only logged."""
    token = github_token()
    req = urllib.request.Request(
        '%s/repos/%s/issues/%d/comments' % (GITHUB_API, known_repo_now(), int(number)),
        data=json.dumps({'body': text}).encode('utf-8'), method='POST',
        headers={'Accept': 'application/vnd.github+json',
                 'Authorization': 'Bearer ' + token,
                 'User-Agent': 'thornswood-bot',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


CHANNEL_NAMES = {'dev': 'dev-test-tasks', 'main': 'test-tasks',
                 'known': 'known-issues'}
# Where each kind of post goes, as the refusal comment says it.
POST_PLACES = {'dev': 'in #dev-test-tasks', 'main': 'in #test-tasks',
               'known': 'in #known-issues', 'roadmap': "on the site's roadmap"}


def refuse(state, channel, num, problems, say=None):
    """Remembers that the post for issue num in channel breaks problems and
       comments that on the issue once (again only when the rules broken
       change). With no problems, forgets any earlier refusal and returns
       False; otherwise True: the caller does not post.

       Remembered only once GitHub took the comment (#4348). It used to be
       remembered when the comment failed too, so a refusal GitHub would not
       take was never said again and nobody learned the post was held back.
       Now a failed one is logged and left unremembered, and the next pass,
       which reads the issue again anyway, says it again."""
    if not POST_RULES:
        return False
    seen = state.setdefault('refused', {})
    key = '%s:%s' % (channel, num)
    if not problems:
        if seen.pop(key, None) is not None:
            state['_dirty'] = True
        return False
    sig = '\n'.join(problems)
    if seen.get(key) == sig:
        return True
    text = ('The bot did not post this issue %s, because the post breaks '
            'these rules (%s):\n\n%s'
            '\n\nFix the comment and the bot tries again on its next pass.'
            % (POST_PLACES.get(channel, 'in #' + channel),
               'bot/README.md, "The site\'s known issues and roadmap"'
               if channel == 'roadmap'
               else 'docs/guide/the-board.md, "Test tasks and known issues"',
               '\n'.join('- ' + p for p in problems)))
    try:
        (say or github_say)(num, text)
    except Exception as e:
        log('refused %s post for #%s, and could not comment, so it is said '
            'again on the next pass: %s' % (channel, num, e))
        return True
    seen[key] = sig
    state['_dirty'] = True
    return True


def fix_in_main(prs, commits, get=None):
    """True when a fix commit of the issue (a merged pull request's merge
       commit, or a commit naming it) is in the newest release/main tag,
       False when none is, None when that cannot be read."""
    get = get or _github_get
    try:
        refs = get('%s/repos/%s/git/matching-refs/tags/release/main/'
                   % (GITHUB_API, KNOWN_REPO)) or []
        tags = sorted(str(r.get('ref') or '') for r in refs if isinstance(r, dict))
        if not tags:
            return None
        tag = tags[-1][len('refs/tags/'):]
        shas = list(commits or [])
        for pr in prs or []:
            if pr.get('merged_at'):
                got = get('%s/repos/%s/pulls/%d' % (GITHUB_API, KNOWN_REPO, pr['number']))
                if got and got.get('merge_commit_sha'):
                    shas.append(got['merge_commit_sha'])
        for sha in shas:
            cmp = get('%s/repos/%s/compare/%s...%s' % (GITHUB_API, KNOWN_REPO, tag, sha))
            if str((cmp or {}).get('status')) in ('identical', 'behind'):
                return True
        return False
    except Exception:
        return None
