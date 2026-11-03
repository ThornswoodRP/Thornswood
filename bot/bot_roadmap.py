"""
The site's Known Issues page and roadmap, and the watcher that keeps the
forums and the lists.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import os
import re
import urllib.parse

from bot_core import _state_read, _state_write, client, log
from bot_testing import (DEV_TASKS_NAME, KNOWN_NAME, KNOWN_STATE, SETUP_STATE,
    TASKS_NAME, _channel_named, _setup_rec, _utc_stamp, dev_tasks_forum)
from bot_github import (GITHUB_API, KNOWN_EVERY, KNOWN_REPO, _github_get,
    _labels, github_comments, github_token, pass_failure)
from bot_task_text import _marked, strip_footer
from bot_post_rules import post_problems, refuse
from bot_forums import dev_tasks_once, known_issues_once, test_tasks_once


# Issue #3140 (Patrick): the site's Known Issues page and its roadmap are built
# from the board, so they cannot go stale. Until then both were boards typed
# into site/data/board.json; the roadmap's Later lane said the emote wheel was
# never started while it shipped (test-roadmap.js), and the known board kept
# NPC behaviour that #504 had fixed. The bot already reads the board for the
# Discord forums, with the one issues token there is, so it writes both lists
# into one file the site reads:
#
#   known    the posts that are up in #known-issues, the same list, each as
#            its title, its words and where it was found (Main, Dev). One
#            rule decides both: known_issues_once.
#   roadmap  every open issue labelled "roadmap: now", "roadmap: next" or
#            "roadmap: later", in that lane. A closed one is off the
#            roadmap: it has no Done lane (Patrick, 26 Oct).
#            Its words are its last "Roadmap:" comment: the first line is
#            what is being built (45 characters at most), the lines under it
#            where it stands. The rules of a known issue hold for it (no
#            footer, no issue number, link or code), and so do the writing
#            rules of a public page (no em dash, never "player"). An issue
#            with a lane and no such comment, or one that breaks a rule, is
#            left off and gets one comment saying why (refuse).
#
# The file is PUBLIC_LISTS_FILE, in the site's data\from-bot folder, which
# holds only what the bot writes for the site: the site makes it, and
# Install-Bot.ps1 gives the bot's account Modify on it and nothing else of the
# site's (the other way round from for-bot, #1102). It is written whole after
# every pass, with the time of the pass, so the site can say how old it is;
# a part the bot could not read this pass is left out rather than written
# empty, and the site says that part could not be read.
PUBLIC_LISTS_FILE = os.environ.get(
    'PUBLIC_LISTS_FILE', r'C:\Thornswood-Docs\data\from-bot\lists.json')
ROADMAP_LANES = (('now', 'Being built now'), ('next', 'Next'), ('later', 'Later'))
ROADMAP_MARK = re.compile(r'^\s*roadmap\s*:\s*(.*)$', re.I)


def roadmap_label(lane):
    return 'roadmap: %s' % lane


def github_labelled(label, state, get=None):
    """Every issue (not pull request) with the label, open or closed (state),
       by number."""
    get = get or _github_get
    out = {}
    page = 1
    while True:
        url = ('%s/repos/%s/issues?state=%s&per_page=100&page=%d&labels=%s'
               % (GITHUB_API, KNOWN_REPO, state, page, urllib.parse.quote(label)))
        rows = get(url) or []
        for row in rows:
            if isinstance(row, dict) and 'pull_request' not in row:
                out.setdefault(int(row['number']), row)
        if len(rows) < 100:
            break
        page += 1
    return out


def roadmap_lanes_of(issue):
    """The lanes (now, next, later) the issue is labelled with."""
    names = [n.lower() for n in _labels(issue)]
    return [lane for lane, _name in ROADMAP_LANES if roadmap_label(lane) in names]


def roadmap_of(issue, comments):
    """(title, words, problems) for the issue's roadmap row, from its last
       "Roadmap:" comment. problems is empty when it may go on the site."""
    got = _marked(issue, comments, ROADMAP_MARK, room=None)
    if got is None:
        return None, None, ['Roadmap: the issue has a roadmap label and no '
                            'comment whose first line starts "Roadmap:", '
                            'which holds the words the site shows.']
    title, body = got[0], strip_footer(got[1])
    return title, body, post_problems('roadmap', title, body)


def roadmap_once(state, get=None, say=None):
    """
    One read of the roadmap off the board. state is the dict kept in
    known-issues.json, changed in place; its 'roadmap' part remembers each
    labelled issue's row by its updated_at, so comments are read only for an
    issue that changed (a label, a close and a comment all move it). Returns
    the roadmap as the site draws it: {lanes: [{name, rows: [{title, text}]}]},
    the lanes in order, each by issue number. Only open issues are read: the
    roadmap has no Done lane (Patrick, 26 Oct, "Done section needs removed
    from the roadmap"), so an issue that closes leaves it.
    """
    seen = {}
    for lane, _name in ROADMAP_LANES:
        for num, issue in github_labelled(roadmap_label(lane), 'open', get).items():
            seen[num] = issue
    rec = state.setdefault('roadmap', {})
    for key in [k for k in rec if int(k) not in seen]:
        rec.pop(key, None)
        state['_dirty'] = True
    rows = dict((name, []) for _lane, name in ROADMAP_LANES)
    for num in sorted(seen):
        issue = seen[num]
        key = str(num)
        have = rec.get(key)
        if not have or have.get('updated') != issue.get('updated_at'):
            title, body, problems = roadmap_of(issue, github_comments(num, get))
            lanes = roadmap_lanes_of(issue)
            if len(lanes) > 1:
                problems = problems + ['Roadmap: the issue is in %s at once; '
                                       'one lane only.' % ', '.join(
                                           roadmap_label(l) for l in lanes)]
            have = rec[key] = {'updated': issue.get('updated_at'),
                               'title': title, 'text': body,
                               'problems': problems}
            state['_dirty'] = True
        if refuse(state, 'roadmap', num, have.get('problems') or [], say):
            continue
        rows[dict(ROADMAP_LANES)[roadmap_lanes_of(issue)[0]]].append(
            {'title': have['title'], 'text': have['text']})
    return {'lanes': [{'name': name, 'rows': rows[name]}
                      for _lane, name in ROADMAP_LANES]}


def known_list(state):
    """The posts up in #known-issues, as the site shows them: title, words
       and where (Main, Dev), by issue number. The records hold each post's
       sig, which is exactly what went up (_sig)."""
    out = []
    for key in sorted((state.get('issues') or {}), key=int):
        sig = str((state['issues'][key] or {}).get('sig') or '')
        if not sig:
            continue
        title, rest = (sig.split('\n', 1) + [''])[:2]
        body, _, tags = rest.rpartition('\n')
        out.append({'title': title, 'text': body,
                    'where': [t for t in tags.split(',') if t]})
    return out


def write_public_lists(known, roadmap, path=None, now=None):
    """Writes the site's lists: known and roadmap as the passes made them,
       either None when it could not be read this pass, and so left out."""
    data = {'at': now or _utc_stamp()}
    if known is not None:
        data['known'] = known
    if roadmap is not None:
        data['roadmap'] = roadmap
    _state_write(path or PUBLIC_LISTS_FILE, data)
    return data


def _known_save(state, path=None):
    clean = dict((k, v) for k, v in state.items() if not k.startswith('_'))
    _state_write(path or KNOWN_STATE, clean)
    state.pop('_dirty', None)


async def watch_known_issues():
    await client.wait_until_ready()
    if not github_token():
        log('known issues: no GitHub token (GITHUB_TOKEN_FILE or GITHUB_TOKEN), so #%s, #%s and '
            '#%s are not kept' % (KNOWN_NAME, TASKS_NAME, DEV_TASKS_NAME))
        return
    state = _state_read(KNOWN_STATE)
    if state is None:
        log('known issues: %s will not read, so nothing is posted until it is '
            'fixed by hand (posting from empty would double every post)'
            % KNOWN_STATE)
        return
    said_text = said_dev = said_lists = False
    while not client.is_closed():
        try:
            known = tasks = dev = None
            for g in client.guilds:
                known = known or _channel_named(g, KNOWN_NAME, ('forum',))
                tasks = tasks or _channel_named(g, TASKS_NAME, ('forum',))
                # By the id the one-time setup recorded, read each pass so a
                # setup run while the bot is up is picked up without a restart.
                dev = dev or dev_tasks_forum(g)
                if (dev is None and not said_dev
                        and _setup_rec(g).get('dev_tasks_id')):
                    log('known issues: the #%s recorded in %s (id %s) is not on '
                        'the server, so dev test tasks are not posted. The '
                        'one-time step (python bot.py --setup-channels --apply) '
                        'makes it again.' % (DEV_TASKS_NAME, SETUP_STATE,
                                             _setup_rec(g).get('dev_tasks_id')))
                    said_dev = True
                if known is None and not said_text and _channel_named(g, KNOWN_NAME, ('text',)):
                    log('known issues: #%s is still a text channel. The one-time '
                        'step (python bot.py --setup-channels --apply) makes it '
                        'a forum.' % KNOWN_NAME)
                    said_text = True
            me = getattr(client.user, 'id', None)
            if known is not None:
                posted, edited, removed = await known_issues_once(
                    known, state, save=_known_save, me_id=me)
                if posted or edited or removed:
                    log('known issues: posted %s, edited %s, removed %s'
                        % (posted or 'none', edited or 'none', removed or 'none'))
            if tasks is not None:
                posted, edited, removed = await test_tasks_once(
                    tasks, state, save=_known_save, me_id=me)
                if posted or edited or removed:
                    log('test tasks: posted %s, edited %s, removed %s'
                        % (posted or 'none', edited or 'none', removed or 'none'))
            if dev is not None:
                posted, edited, removed = await dev_tasks_once(
                    dev, state, save=_known_save, me_id=me)
                if posted or edited or removed:
                    log('dev test tasks: posted %s, edited %s, removed %s'
                        % (posted or 'none', edited or 'none', removed or 'none'))
            # The site's lists (#3140): known only when #known-issues was
            # kept this pass, since it is that forum's list.
            roadmap = await asyncio.get_running_loop().run_in_executor(
                None, roadmap_once, state)
            if state.get('_dirty'):
                _known_save(state)
            try:
                write_public_lists(known_list(state) if known is not None else None,
                                   roadmap)
            except OSError as e:
                if not said_lists:
                    log('known issues: could not write the site\'s lists to %s '
                        '(%s). Install-Bot.ps1 gives the bot Modify on that '
                        'folder once Deploy-Docs.ps1 has made it.'
                        % (PUBLIC_LISTS_FILE, type(e).__name__))
                    said_lists = True
            else:
                said_lists = False
        except Exception as e:
            log('known issues: a pass failed: %s' % pass_failure(e))
            # What it read before it failed is kept, so the next pass does
            # not read it again, after a restart as well (#5184).
            if state.get('_dirty'):
                try:
                    _known_save(state)
                except OSError as e2:
                    log('known issues: could not save %s after the failed '
                        'pass (%s)' % (KNOWN_STATE, type(e2).__name__))
        await asyncio.sleep(KNOWN_EVERY)
