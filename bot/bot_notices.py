"""
Staff notices filed as issues.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import datetime
import json
import os
import re
import time
import urllib.error
import urllib.request

import discord

from bot_base import DATA_DIR
from bot_core import (WATCH_ID, _int_env, _state_read, _state_write, client,
    log)
from bot_staff_channel import watch_send
from bot_github import GITHUB_API, github_token, known_repo_now, pass_failure
from bot_task_text import strip_footer
from bot_post_rules import github_say
from bot_roadmap import github_labelled


# A staff notice can be an issue on the board labelled "notice: staff" (#5187):
# its body is the notice. Each pass reads the open ones, says each in
# #staff-updates through watch_send, the way the watchdog's outbox is said,
# writes down the Discord message it became in staff-notices.json, and only
# then comments on the issue and closes it. So a failed comment or close is
# tried again next pass, and the notice is never said twice. A cloud thread
# files one with Say-Staff.ps1, which needs no ssh, no runner and no key on
# the box.
#
# Who may: GitHub lets only people with triage or more put a label on, and no
# issue form here puts this one on. The bot also holds the issue's author to
# the team (OWNER, MEMBER, COLLABORATOR) or one of the Apps installed on the
# repository, so a team member labelling somebody else's issue does not say
# it in the staff channel. The same limits as say-staff.ps1 on the box: 1800
# characters, 30 an hour for each sender, mentions off; and like the
# watchdog's outbox, a notice that waited a day is not said.
#
# Taking one back: the label "notice: take back" on its issue. The bot
# deletes the message, or withholds a notice not said yet, comments what it
# did once, and writes it down.
#
# Both lists are asked with the ETag of the last answer, so a pass where
# nothing changed is answered 304, which GitHub does not count against the
# bot's hourly limit (the bot's rereads used up the shared quota, #5260).
STAFF_NOTICE_LABEL = os.environ.get('STAFF_NOTICE_LABEL', 'notice: staff').strip()
STAFF_TAKE_BACK_LABEL = os.environ.get('STAFF_TAKE_BACK_LABEL', 'notice: take back').strip()
STAFF_NOTICES = os.path.join(DATA_DIR, 'staff-notices.json')
NOTICE_EVERY = max(30, _int_env('STAFF_NOTICE_EVERY', 60))
NOTICE_MAX = 1800
NOTICE_PER_HOUR = 30
NOTICE_MAX_AGE = 24 * 3600
NOTICE_TEAM = ('OWNER', 'MEMBER', 'COLLABORATOR')
# Say-Staff.ps1's title, which names who the notice is from: its -From.
NOTICE_FROM = re.compile(r'^\s*staff notice from ([a-z][a-z0-9-]{0,30})\s*$', re.I)
# A said notice is remembered this long, for taking it back and the hourly limit.
NOTICE_KEEP = 30 * 24 * 3600


def _github_time(text):
    """A GitHub time (2026-11-01T19:12:00Z) in unix seconds, or None."""
    try:
        return datetime.datetime.strptime(str(text or ''), '%Y-%m-%dT%H:%M:%SZ').replace(
            tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return None


def _github_get_cached(url, cache, opener=None):
    """_github_get, asked with the ETag of the answer last kept in cache for
       url: a 304 gives that answer again. A failure raises, as there."""
    token = github_token()
    headers = {'Accept': 'application/vnd.github+json',
               'Authorization': 'Bearer ' + token,
               'User-Agent': 'thornswood-bot',
               'X-GitHub-Api-Version': '2022-11-28'}
    held = cache.get(url)
    if held:
        headers['If-None-Match'] = held[0]
    req = urllib.request.Request(url, headers=headers)
    try:
        with (opener or urllib.request.urlopen)(req, timeout=20) as r:
            got = json.loads(r.read().decode('utf-8'))
            etag = r.headers.get('ETag')
    except urllib.error.HTTPError as e:
        if e.code == 304 and held:
            return held[1]
        raise
    if etag:
        cache[url] = (etag, got)
    else:
        cache.pop(url, None)
    return got


def github_close(number, reason='completed'):
    """Closes the issue with reason (completed or not_planned)."""
    token = github_token()
    req = urllib.request.Request(
        '%s/repos/%s/issues/%d' % (GITHUB_API, known_repo_now(), int(number)),
        data=json.dumps({'state': 'closed', 'state_reason': reason}).encode('utf-8'),
        method='PATCH',
        headers={'Accept': 'application/vnd.github+json',
                 'Authorization': 'Bearer ' + token,
                 'User-Agent': 'thornswood-bot',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def notice_sender(issue):
    """Who the notice is from: the word Say-Staff.ps1's title names, else the
       author's login, lower case and without [bot]."""
    m = NOTICE_FROM.match(str(issue.get('title') or ''))
    if m:
        return m.group(1).lower()
    login = str((issue.get('user') or {}).get('login') or 'unknown').lower()
    return re.sub(r'\[bot\]$', '', login) or 'unknown'


def notice_of(issue, now):
    """(sender, text, problems) for the issue's notice. problems is empty when
       it may be said; each one is a sentence for the refusal comment."""
    sender = notice_sender(issue)
    text = strip_footer(str(issue.get('body') or '').replace('\r\n', '\n')).strip()
    problems = []
    user = issue.get('user') or {}
    if (str(issue.get('author_association') or '') not in NOTICE_TEAM
            and str(user.get('type') or '') != 'Bot'):
        problems.append('The issue was filed by %s, who is not on the team. A '
                        'notice is said only from an issue the team or one of '
                        "the repository's Apps filed."
                        % (user.get('login') or 'somebody unknown'))
    if not text:
        problems.append('The issue has no body, and the body is the notice.')
    elif len(text) > NOTICE_MAX:
        problems.append('The notice is %d characters and %d is the most. '
                        'Nothing was cut.' % (len(text), NOTICE_MAX))
    made = _github_time(issue.get('created_at'))
    if made is not None and now - made > NOTICE_MAX_AGE:
        problems.append('The issue was filed more than a day ago, and a notice '
                        'a day late is noise, not news.')
    return sender, text, problems


def notices_this_hour(state, sender, now):
    return sum(1 for r in (state.get('said') or {}).values()
               if isinstance(r, dict) and r.get('from') == sender
               and now - (r.get('at') or 0) < 3600)


async def staff_notices_once(state, notices, take_backs, send, delete,
                             comment, close, save, now=None):
    """
    One pass. notices are the open issues labelled STAFF_NOTICE_LABEL and
    take_backs every issue labelled STAFF_TAKE_BACK_LABEL, by number. send
    says a text in the staff channel and gives the message or None; delete
    takes a message id away and gives 'deleted' or 'gone'; comment and close
    (number, reason) write to GitHub and raise on failure. state is
    staff-notices.json's dict, changed in place and saved with save(state)
    after every message said, before anything else is done. Returns the
    numbers said, the numbers taken back and the numbers refused.
    """
    now = time.time() if now is None else now
    said = state.setdefault('said', {})
    refused = state.setdefault('refused', {})
    unsaid = state.setdefault('unsaid', {})
    out_said, out_back, out_refused = [], [], []

    def finish(num, rec):
        # Each step written down as it is done, so a failed one is the only
        # one tried again.
        if not rec.get('told'):
            comment(num, 'Said in #staff-updates. The label "%s" on this issue '
                    'takes it out again.' % STAFF_TAKE_BACK_LABEL)
            rec['told'] = True
            save(state)
        if not rec.get('closed'):
            close(num, 'completed')
            rec['closed'] = True
            save(state)

    for num in sorted(take_backs):
        key = str(num)
        if key in unsaid:
            continue
        rec = said.get(key)
        if rec:
            result = await delete(rec.get('message'))
            words = ('The notice is taken out of #staff-updates.' if result == 'deleted'
                     else 'The notice was already gone from #staff-updates.')
        elif num in notices:
            result = 'withheld'
            words = 'The notice was not said yet, and now it never is.'
        else:
            result = 'unknown'
            words = ('The bot has no notice from this issue to take back, so '
                     'nothing was done.')
        unsaid[key] = result
        save(state)
        out_back.append(num)
        try:
            comment(num, words)
            if result == 'withheld':
                close(num, 'not_planned')
        except Exception as e:
            log('notices: took back #%s (%s), and the comment or close failed: %s'
                % (num, result, pass_failure(e)))

    for num in sorted(notices):
        key = str(num)
        if key in unsaid:
            continue
        if key in said:
            finish(num, said[key])
            continue
        sender, text, problems = notice_of(notices[num], now)
        if problems:
            sig = '\n'.join(problems)
            if refused.get(key) != sig:
                comment(num, 'The bot did not say this notice in #staff-updates:\n\n'
                        + '\n'.join('- ' + p for p in problems)
                        + '\n\nFix the issue and the bot tries again on its next pass.')
                refused[key] = sig
                save(state)
                out_refused.append(num)
            continue
        if notices_this_hour(state, sender, now) >= NOTICE_PER_HOUR:
            # Left open, in order: it goes when the hour has room.
            break
        msg = await send('[%s] %s' % (sender, text))
        if msg is None:
            # Left for the next pass, and the rest after it, so they stay in order.
            break
        said[key] = {'message': getattr(msg, 'id', None), 'at': int(now),
                     'from': sender, 'told': False, 'closed': False}
        refused.pop(key, None)
        save(state)
        out_said.append(num)
        finish(num, said[key])

    for key in [k for k, r in said.items()
                if isinstance(r, dict) and r.get('closed') and now - (r.get('at') or 0) > NOTICE_KEEP]:
        said.pop(key, None)
        unsaid.pop(key, None)
    return out_said, out_back, out_refused


async def _notice_delete(message_id):
    ch = client.get_channel(WATCH_ID) if WATCH_ID else None
    if ch is None or not message_id:
        return 'gone'
    try:
        await ch.get_partial_message(int(message_id)).delete()
        return 'deleted'
    except discord.NotFound:
        return 'gone'


async def watch_staff_notices():
    await client.wait_until_ready()
    if not github_token():
        log('notices: no GitHub token (GITHUB_TOKEN_FILE or GITHUB_TOKEN), so '
            'issues labelled "%s" are not said' % STAFF_NOTICE_LABEL)
        return
    state = _state_read(STAFF_NOTICES)
    if state is None:
        log('notices: %s will not read, so no notice is said until it is fixed '
            'by hand (saying from empty could say one twice)' % STAFF_NOTICES)
        return
    loop = asyncio.get_running_loop()
    cache = {}

    def get(url):
        return _github_get_cached(url, cache)

    async def send(text):
        _ok, msg = await watch_send(text)
        return msg

    def save(s):
        _state_write(STAFF_NOTICES, s)

    while not client.is_closed():
        try:
            notices = await loop.run_in_executor(
                None, github_labelled, STAFF_NOTICE_LABEL, 'open', get)
            take_backs = await loop.run_in_executor(
                None, github_labelled, STAFF_TAKE_BACK_LABEL, 'all', get)
            said, back, refused = await staff_notices_once(
                state, notices, take_backs, send, _notice_delete,
                github_say, github_close, save)
            if said or back or refused:
                log('notices: said %s, took back %s, refused %s'
                    % (said or 'none', back or 'none', refused or 'none'))
        except Exception as e:
            log('notices: a pass failed: %s' % pass_failure(e))
        await asyncio.sleep(NOTICE_EVERY)
