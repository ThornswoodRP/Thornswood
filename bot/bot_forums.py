"""
Keeping #known-issues, #test-tasks and #dev-test-tasks in step with the
board.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio

import discord

from bot_core import _state_read, _state_write, log
from bot_testing import FINDINGS_NAME, KNOWN_STATE, _utc_stamp, task_tag_of
from bot_github import (DEV_FORM, KNOWN_FORM, KNOWN_MARK, TASK_FORM, TASK_MARK,
    TASK_TAG, finding_gone, github_changed_since, github_closed_since,
    github_comments, github_issue, github_open_findings, github_timeline,
    issue_tags_found, merged_fix)
from bot_task_text import (_all_marked, _marked, dev_chunks, dev_render,
    dev_task_of, fix_refs, issue_tags, known_body, known_title, last_task,
    main_task_of, strip_footer, test_task_of)
from bot_post_rules import (fix_in_main, post_problems, refuse,
    task_server_line)


def known_of(issue, comments):
    """(title, body, tags) for the #known-issues post: the last "Known
       issue:" comment, or the issue's title and a plain line until somebody
       writes one."""
    got = _marked(issue, comments, KNOWN_MARK)
    if got:
        return got[0], strip_footer(got[1]) or known_body(issue), issue_tags(issue, got[2])
    return known_title(issue), known_body(issue), issue_tags(issue)


def _sig(title, body, tags):
    return '%s\n%s\n%s' % (title, body, ','.join(sorted(tags)))


def default_task_body(issue):
    """The body for a fixed finding nobody wrote a test task for. Its issue
       closed when the fix reached main, so that is where to check it."""
    return ('This was fixed and the fix is on main. Check it on main, and say '
            'in #%s if it still happens.' % FINDINGS_NAME)


def task_post_of(issue, comments, dev_since=None):
    """(title, body, tags) for an issue's #test-tasks post, from its Main
       test task, or None when it gets none: not a finding and nobody wrote a
       test task, or its only test tasks say Server: Dev, which are
       #dev-test-tasks'."""
    task = main_task_of(issue, comments, dev_since)
    if task is not None:
        return task[0], strip_footer(task[1]) or 'Check this on main.', [TASK_TAG]
    if last_task(issue, comments, dev_since) is not None:
        return None
    if issue_tags_found(issue):
        return known_title(issue), default_task_body(issue), [TASK_TAG]
    return None


async def _forum_thread(forum, tid):
    """The thread by id, or None when it is gone."""
    guild = getattr(forum, 'guild', None)
    th = None
    getter = getattr(guild, 'get_thread', None)
    if getter is not None:
        th = getter(int(tid))
    if th is None and guild is not None:
        try:
            th = await guild.fetch_channel(int(tid))
        except discord.NotFound:
            return None
    return th


async def _bot_threads(forum, me_id=None):
    """Every post of the bot's in the forum, open and closed, oldest first.
       forum.threads holds only the open ones: a post staff closed, or one
       Discord closed after a few quiet days, is only in the archive."""
    mine = {}
    for th in list(getattr(forum, 'threads', None) or []):
        if me_id is None or getattr(th, 'owner_id', me_id) == me_id:
            mine[th.id] = th
    archived = getattr(forum, 'archived_threads', None)
    if archived is not None:
        async for th in archived(limit=None):
            if me_id is None or getattr(th, 'owner_id', me_id) == me_id:
                mine.setdefault(th.id, th)
    return [mine[k] for k in sorted(mine)]


async def _forum_post(forum, title, body, tags, me_id=None):
    """A post in the forum, tagged; a post of the bot's with that exact title,
       open or closed, is handed back rather than made twice. Returns the
       thread. Closed ones count since 22 Oct: Patrick found duplicates, and
       a post closed by staff or by Discord after quiet days was not looked
       at, so one whose record was lost was made again."""
    for th in await _bot_threads(forum, me_id):
        if str(getattr(th, 'name', '')) == title:
            return th
    applied = [t for t in (task_tag_of(forum, x) for x in tags) if t is not None]
    made = await forum.create_thread(name=title, content=body,
                                     applied_tags=applied,
                                     allowed_mentions=discord.AllowedMentions.none(),
                                     reason='Thornswood known issues and test tasks')
    return getattr(made, 'thread', made)


async def _forum_drop(forum, tid):
    th = await _forum_thread(forum, tid)
    if th is not None:
        await th.delete()


async def _forum_edit(forum, tid, title, body, tags):
    """Brings an existing post to this title, body and tags. False when the
       post is gone (deleted by hand), so the caller can make it again."""
    th = await _forum_thread(forum, tid)
    if th is None:
        return False
    applied = [x for x in (task_tag_of(forum, n) for n in tags) if x is not None]
    await th.edit(name=title, applied_tags=applied)
    msg = getattr(th, 'starter_message', None)
    if msg is None:
        try:
            msg = await th.fetch_message(th.id)
        except discord.NotFound:
            msg = None
    if msg is not None:
        await msg.edit(content=body, allowed_mentions=discord.AllowedMentions.none())
    return True


async def _thread_more(th, me_id):
    """The bot's own messages in a thread after its first post, oldest
       first, by id: the follow-ups of a long dev post."""
    out = []
    async for m in th.history(limit=100, oldest_first=True):
        if (getattr(m, 'id', None) != getattr(th, 'id', None)
                and (me_id is None or getattr(getattr(m, 'author', None), 'id', None) == me_id)):
            out.append(m.id)
    return out


async def _sync_more(th, texts, more):
    """
    Brings the follow-up messages of a post to texts, in order, and returns
    their ids. Each one still there is edited; from the first one that is
    gone (deleted by hand), every later one is deleted and the rest sent
    again, so the thread always reads in order. Extra old ones are deleted.
    """
    none = discord.AllowedMentions.none()
    ids, keep = [], list(more or [])
    i = 0
    while i < len(texts) and i < len(keep):
        try:
            msg = await th.fetch_message(int(keep[i]))
        except discord.NotFound:
            break
        await msg.edit(content=texts[i], allowed_mentions=none)
        ids.append(msg.id)
        i += 1
    for mid in keep[i:]:
        try:
            msg = await th.fetch_message(int(mid))
        except discord.NotFound:
            continue            # already gone, which is what is wanted
        await msg.delete()
    for text in texts[i:]:
        sent = await th.send(text, allowed_mentions=none)
        ids.append(sent.id)
    return ids


async def _dev_post(forum, title, chunks, tags, me_id=None):
    """A #dev-test-tasks post over as many messages as its text takes.
       (thread, follow-up ids). A post of the bot's with this title, open or
       closed, made before a crash or whose record was lost, is taken up with
       what it already holds, never made twice."""
    found = None
    for th in await _bot_threads(forum, me_id):
        if str(getattr(th, 'name', '')) == title:
            found = th
            break
    if found is None:
        th = await _forum_post(forum, title, chunks[0], tags, me_id)
        more = []
    else:
        th = found
        await _forum_edit(forum, th.id, title, chunks[0], tags)
        more = await _thread_more(th, me_id)
    return th, await _sync_more(th, chunks[1:], more)


async def known_issues_once(forum, state, get=None, save=None, me_id=None, say=None):
    """
    One pass over #known-issues, a forum. state is the dict kept in
    known-issues.json, changed in place; the caller writes it. Returns the
    issue numbers posted, edited and removed.

    A known issue is a finding people still meet: an open issue labelled
    Dev Findings or Main Findings whose fix has not landed (Patrick, 22 Oct,
    and #3140). Its fix has landed when the issue gets a "Test task:"
    comment or is in Done: done-on-merge.yml's comment on it (merged_fix),
    A card is never moved to Done by hand (#5185): it follows that same
    merged test task. A closed or unlabelled issue is not a finding at all. Then its post goes: the fix is a test task, not
    a known issue. A merged pull request alone does not take it down: until
    26 Oct any one that named the issue did, and a measuring step on the
    scripts finding, a partial fix, and a Refs written by mistake each kept
    a bug people still meet off the list (#3140).
    An issue the label lists leave out is read itself first, and its post
    stays unless that read says it is closed, unlabelled, moved or deleted
    (finding_gone, #3438).

    Comments are read only for an issue GitHub says changed since the last
    pass (its updated_at), or whose record was made with an older form of
    the post (KNOWN_FORM), so an untouched issue costs nothing. A label put
    on or a comment written moves updated_at, so nothing else is read. That
    holds for an issue that ends with no post as well (a test task, a merged
    fix, a post that breaks a rule): state['known_read'] keeps the updated_at
    it was read at. Until 1 Nov only a posted issue was remembered, so every
    pass read the comments of every other one again (#5184).
    """
    loop = asyncio.get_running_loop()
    issues = await loop.run_in_executor(None, github_open_findings, get)
    rec = state.setdefault('issues', {})
    read = state.setdefault('known_read', {})
    for key in [k for k in read if int(k) not in issues]:
        read.pop(key, None)
        state['_dirty'] = True

    def unposted(key, mark):
        # Read at this update time and left with no post (mark), or with the
        # post already up kept as it was (mark + '|kept').
        if read.get(key) != mark:
            read[key] = mark
            state['_dirty'] = True
    # Records from before #known-issues was a forum point at messages in a
    # channel that is gone: they are forgotten, not deleted again.
    for key, have in list(rec.items()):
        if have.get('channel_id') != getattr(forum, 'id', None) or 'thread_id' not in have:
            rec.pop(key, None)
            state['_dirty'] = True
    if state.pop('known_changed', None) is not None:
        state['_dirty'] = True      # the merged pull requests the old rule kept
    posted, edited, removed, listed = [], [], [], set()
    # Why each issue that is not listed is not, said when its post comes
    # down. Ten posts came down and went back up as a set several times
    # before 26 Oct with no line saying why (#3140).
    why = {}
    for num in sorted(issues):
        key = str(num)
        issue = issues[num]
        have = rec.get(key)
        if (have and have.get('updated') == issue.get('updated_at')
                and have.get('form') == KNOWN_FORM):
            listed.add(num)
            continue
        mark = '%s|%s' % (issue.get('updated_at'), KNOWN_FORM)
        if have and read.get(key) == mark + '|kept':
            listed.add(num)         # its post breaks a rule: the one up stays
            continue
        if not have and read.get(key) == mark:
            continue                # read at this update time: no post
        comments = await loop.run_in_executor(None, github_comments, num, get)
        if _all_marked(issue, comments, TASK_MARK, room=None):
            why[key] = 'it has a "Test task:" comment'
            unposted(key, mark)
            continue                # it has a test task: being checked, not known
        if merged_fix(comments):
            why[key] = 'done-on-merge wrote its merged fix on it'
            unposted(key, mark)
            continue                # fixed, waiting on main: not a known issue
        title, body, tags = known_of(issue, comments)
        taken = [v.get('sig', '').split('\n')[0] for k, v in rec.items() if k != key]
        if refuse(state, 'known', num, post_problems(
                'known', title, body, issue=issue,
                has_task=False, taken_titles=taken), say):
            if have:
                listed.add(num)     # the post already up stays as it was
            why[key] = 'its post breaks a rule'
            unposted(key, mark + ('|kept' if have else ''))
            continue
        listed.add(num)
        if read.pop(key, None) is not None:
            state['_dirty'] = True
        sig = _sig(title, body, tags)
        if have:
            if have.get('sig') != sig:
                try:
                    if not await _forum_edit(forum, have['thread_id'], title, body, tags):
                        have = None
                        rec.pop(key, None)
                    else:
                        edited.append(num)
                except discord.HTTPException:
                    continue
            if have:
                have.update(sig=sig, updated=issue.get('updated_at'),
                            form=KNOWN_FORM)
                state['_dirty'] = True
                continue
        th = await _forum_post(forum, title, body, tags, me_id)
        rec[key] = {'thread_id': th.id, 'channel_id': forum.id, 'sig': sig,
                    'updated': issue.get('updated_at'), 'form': KNOWN_FORM}
        state['_dirty'] = True
        if save:
            save(state)      # straight away, so a crash cannot double it
        posted.append(num)
    # An issue the label lists left out is read itself before its post comes
    # down (finding_gone). Every read is made before anything is taken down,
    # so a read that fails fails the pass with every post still up.
    for key in list(rec):
        if int(key) in listed or int(key) in issues:
            continue                # listed, or not for a reason found above
        gone = await loop.run_in_executor(None, finding_gone, int(key), get)
        if gone is None:
            log('known issues: the open findings GitHub listed left out #%s, '
                'which is still open and labelled; its post stays' % key)
            listed.add(int(key))
        else:
            why[key] = gone
    for key, have in list(rec.items()):
        if int(key) in listed:
            continue
        try:
            await _forum_drop(forum, have['thread_id'])
        except discord.HTTPException:
            continue
        rec.pop(key, None)
        state['_dirty'] = True
        removed.append(int(key))
        log('known issues: took #%s down: %s'
            % (key, why.get(key, 'no reason was recorded')))
    return posted, edited, removed


async def test_tasks_once(forum, state, get=None, save=None, me_id=None, now=None,
                         say=None):
    """
    One pass over #test-tasks. An issue closed as fixed gets a post when it
    was closed after state['since'] (set to now on the first pass, so nothing
    from before this began floods in), or when its latest "Test task:"
    comment was written after since. Every post is tagged Main (TASK_TAG).
    A rewritten comment edits the post, and so does a record made with an
    older form of the post (TASK_FORM), once; an issue that is reopened
    loses it. An issue whose last test task says Server: Dev, from the day
    #dev-test-tasks began (state['dev_since']), gets no post here: it is
    in #dev-test-tasks. Returns the issue numbers posted, edited and removed.
    """
    loop = asyncio.get_running_loop()
    dev_since = state.get('dev_since')
    since = state.get('since')
    if not since:
        state['since'] = since = now or _utc_stamp()
        state['_dirty'] = True
    rec = state.setdefault('tasks', {})

    async def broken(num, issue, comments, post):
        # The rules check before a #test-tasks post goes up or is edited.
        task = main_task_of(issue, comments, dev_since)
        if task is None:
            return False    # the bot's own line for a fixed finding
        timeline = await loop.run_in_executor(None, github_timeline, num, get)
        refs = await loop.run_in_executor(None, fix_refs, timeline, get)
        inmain = await loop.run_in_executor(None, fix_in_main, *refs, get)
        taken = [v.get('sig', '').split('\n')[0] for k, v in rec.items()
                 if k != str(num)]
        return refuse(state, 'main', num, post_problems(
            'main', post[0], post[1],
            server=task_server_line(issue, comments, task[4]),
            fix_in_main=inmain, taken_titles=taken), say)

    closed = await loop.run_in_executor(None, github_closed_since, since, get)
    # Each closed issue read at its update time and left with no post (or
    # with the post up kept as it was, '|kept'), so it is read again only
    # once it changes. Until 1 Nov only a posted issue was remembered, and
    # every pass read the comments of every other issue closed since 'since'
    # again: about 1,200 calls a pass, the whole hourly allowance in four
    # passes (#5184).
    read = state.setdefault('tasks_read', {})
    for key in [k for k in read if int(k) not in closed]:
        read.pop(key, None)
        state['_dirty'] = True

    def unposted(key, mark):
        if read.get(key) != mark:
            read[key] = mark
            state['_dirty'] = True

    posted, edited, removed = [], [], []
    for num in sorted(closed):
        key = str(num)
        issue = closed[num]
        have = rec.get(key)
        if (issue.get('state_reason') or 'completed') != 'completed':
            continue
        if (have and have.get('updated') == issue.get('updated_at')
                and have.get('form') == TASK_FORM):
            continue
        mark = '%s|%s' % (issue.get('updated_at'), TASK_FORM)
        if read.get(key) == (mark + '|kept' if have else mark):
            continue                # read at this update time: nothing to do
        comments = await loop.run_in_executor(None, github_comments, num, get)
        task = test_task_of(issue, comments, dev_since)
        new_enough = (str(issue.get('closed_at') or '') >= since
                      or (task is not None and task[2] >= since))
        if not have and not new_enough:
            unposted(key, mark)
            continue
        post = task_post_of(issue, comments, dev_since)
        if post is None:
            # Not a finding and no Main test task: none was written, or the
            # one there was taken back (its comment no longer starts "Test
            # task:"), or it is a Dev one, which is #dev-test-tasks'. A post
            # already here goes: it is no longer a test task for testers.
            if have:
                try:
                    await _forum_drop(forum, have['thread_id'])
                except discord.HTTPException:
                    continue
                rec.pop(key, None)
                state['_dirty'] = True
                removed.append(num)
            unposted(key, mark)
            continue
        title, body, tags = post
        sig = _sig(title, body, tags)
        if (not have or have.get('sig') != sig) and await broken(num, issue, comments, post):
            unposted(key, mark + ('|kept' if have else ''))
            continue        # not posted, and a post already up keeps its text
        if read.pop(key, None) is not None:
            state['_dirty'] = True
        if have:
            if have.get('sig') != sig:
                try:
                    if await _forum_edit(forum, have['thread_id'], title, body, tags):
                        edited.append(num)
                    else:
                        rec.pop(key, None)     # deleted by hand: confirmed
                        state['_dirty'] = True
                        continue
                except discord.HTTPException:
                    continue
            have.update(sig=sig, updated=issue.get('updated_at'), form=TASK_FORM)
            state['_dirty'] = True
            continue
        th = await _forum_post(forum, title, body, tags, me_id)
        rec[key] = {'thread_id': th.id, 'channel_id': forum.id, 'sig': sig,
                    'updated': issue.get('updated_at'), 'form': TASK_FORM}
        state['_dirty'] = True
        if save:
            save(state)
        posted.append(num)
    for key, have in list(rec.items()):
        if int(key) in closed:
            continue
        try:
            issue = await loop.run_in_executor(None, github_issue, int(key), get)
        except Exception:
            continue
        if str(issue.get('state')) == 'open':
            try:
                await _forum_drop(forum, have['thread_id'])
            except discord.HTTPException:
                continue
            rec.pop(key, None)
            state['_dirty'] = True
            removed.append(int(key))
        elif (have.get('updated') != issue.get('updated_at')
                or have.get('form') != TASK_FORM):
            # Closed before since, and changed since the last pass (an adopted
            # post whose comment was rewritten) or made with an older form of
            # the post: brought up to date.
            comments = await loop.run_in_executor(None, github_comments, int(key), get)
            post = task_post_of(issue, comments, dev_since)
            if post is None:
                # Its test task was taken back: the post goes, as above.
                try:
                    await _forum_drop(forum, have['thread_id'])
                except discord.HTTPException:
                    continue
                rec.pop(key, None)
                state['_dirty'] = True
                removed.append(int(key))
                continue
            sig = _sig(*post)
            if have.get('sig') != sig and await broken(int(key), issue, comments, post):
                continue
            if have.get('sig') != sig:
                try:
                    if await _forum_edit(forum, have['thread_id'], *post):
                        edited.append(int(key))
                except discord.HTTPException:
                    continue
            have['sig'] = sig
            have['updated'] = issue.get('updated_at')
            have['form'] = TASK_FORM
            state['_dirty'] = True
    return posted, edited, removed


async def dev_tasks_once(forum, state, get=None, save=None, me_id=None, now=None,
                        say=None):
    """
    One pass over #dev-test-tasks, found by the id the setup recorded. An
    issue, open or closed, with a "Test task:" comment saying Server: Dev
    gets a post tagged Dev from its last one (dev_task_of), written for
    developers (dev_render: the issue, its pull requests and commits,
    labels, build, and the whole test task, over as many messages as it
    takes); it goes when that comment is taken back, and stays beside a
    Main one. A rewritten comment, or any other change to the issue that
    changes the post, edits it.

    The first pass sets state['dev_since'] to now: nothing written before it
    counts as a dev test task, so nothing from before floods in and no post
    already in #test-tasks moves. Each pass reads only the issues GitHub says
    changed since the last (state['dev_seen'], GitHub's own update time of
    the last issue read), so an untouched issue costs nothing. An issue
    Discord refused is read again on the next pass.
    Returns the issue numbers posted, edited and removed.
    """
    loop = asyncio.get_running_loop()
    since = state.get('dev_since')
    if not since:
        state['dev_since'] = since = now or _utc_stamp()
        state['_dirty'] = True
    mark = state.get('dev_seen') or since
    rec = state.setdefault('dev', {})
    read = state.setdefault('dev_read', {})
    changed = await loop.run_in_executor(None, github_changed_since, mark, get)
    posted, edited, removed, refused = [], [], [], []
    newest = mark
    for num in sorted(changed):
        key = str(num)
        issue = changed[num]
        upd = str(issue.get('updated_at') or '')
        newest = max(newest, upd)
        have = rec.get(key)
        if read.get(key) == upd and (not have or have.get('form') == DEV_FORM):
            continue            # read at this update time on an earlier pass
        comments = await loop.run_in_executor(None, github_comments, num, get)
        task = dev_task_of(issue, comments, since)
        post = None
        if task is not None:
            taken = [v.get('sig', '').split('\n')[0] for k, v in rec.items() if k != key]
            if refuse(state, 'dev', num, post_problems(
                    'dev', task[0], task[1], server=task[2],
                    taken_titles=taken), say):
                read[key] = upd     # the post already up, if any, keeps its text
                state['_dirty'] = True
                continue
            timeline = await loop.run_in_executor(None, github_timeline, num, get)
            refs = await loop.run_in_executor(None, fix_refs, timeline, get)
            post = dev_render(issue, task, *refs)
        try:
            if post is None:
                if have:
                    await _forum_drop(forum, have['thread_id'])
                    rec.pop(key, None)
                    removed.append(num)
            else:
                title, body, tags = post
                sig = _sig(title, body, tags)
                chunks = dev_chunks(body)
                if have and have.get('sig') != sig:
                    if await _forum_edit(forum, have['thread_id'], title, chunks[0], tags):
                        th = await _forum_thread(forum, have['thread_id'])
                        have['more'] = await _sync_more(th, chunks[1:],
                                                        have.get('more') or [])
                        edited.append(num)
                    else:
                        rec.pop(key, None)     # deleted by hand: made again
                        have = None
                if have:
                    have.update(sig=sig, updated=upd, form=DEV_FORM)
                else:
                    th, more = await _dev_post(forum, title, chunks, tags, me_id)
                    rec[key] = {'thread_id': th.id, 'channel_id': forum.id,
                                'more': more, 'sig': sig, 'updated': upd,
                                'form': DEV_FORM}
                    if save:
                        save(state)    # straight away, so a crash cannot double it
                    posted.append(num)
        except discord.HTTPException:
            refused.append(upd)
            continue
        read[key] = upd
        state['_dirty'] = True
    # GitHub's since is inclusive, so the next pass starts at the newest
    # update read, or at the oldest one Discord refused, to try it again.
    mark = min([newest] + refused)
    if state.get('dev_seen') != mark:
        state['dev_seen'] = mark
        state['_dirty'] = True
    for key in [k for k, v in read.items() if v < mark]:
        read.pop(key, None)
        state['_dirty'] = True
    return posted, edited, removed


async def forum_check(forum, records, me_id=None, apply=False):
    """
    The duplicates in one of the three forums, and with apply, gone. records
    maps a thread id to the issue whose post it is (known-issues.json). Two
    posts of the bot's with the same title are one too many: the one an issue
    owns is kept, or the oldest when none is, and the rest are deleted. Two
    posts that two issues own under one title are said and left: both issues
    carry the same test task, which is fixed on the issues. Returns the lines
    it says.
    """
    lines, by_title = [], {}
    threads = await _bot_threads(forum, me_id)
    for th in threads:
        by_title.setdefault(str(getattr(th, 'name', '')), []).append(th)
    owned = [th for th in threads if th.id in records]
    lines.append('#%s: %d post(s) of the bot\'s, %d owned by an issue'
                 % (getattr(forum, 'name', '?'), len(threads), len(owned)))
    gone = 0
    for title in sorted(by_title):
        group = by_title[title]
        if len(group) < 2:
            continue
        mine = [th for th in group if th.id in records]
        keep = mine or group[:1]
        extra = [th for th in group if th not in keep]
        lines.append('  "%s": %d posts; keeps %s%s' % (
            title, len(group),
            ', '.join('%d (#%s)' % (th.id, records.get(th.id, '-')) for th in keep),
            '; two issues own this title, fix it on the issues' if len(mine) > 1 else ''))
        for th in extra:
            if apply:
                await th.delete()
                gone += 1
                lines.append('    deleted %d' % th.id)
            else:
                lines.append('    would delete %d' % th.id)
    if apply:
        lines.append('  %d deleted' % gone)
    return lines


def forum_records(state):
    """{thread id: issue number} for each of the three forums' records."""
    def of(part):
        return dict((int(v['thread_id']), int(k)) for k, v in
                    (state.get(part) or {}).items()
                    if isinstance(v, dict) and v.get('thread_id'))
    return {'known': of('issues'), 'tasks': of('tasks'), 'dev': of('dev')}


def adopt_task(number, thread_id, path=None):
    """Records a test task post made by hand (--post-task) as issue number's,
       so later passes edit it and take it down if the issue reopens. Run
       with the bot stopped: the running bot holds the file in memory."""
    path = path or KNOWN_STATE
    state = _state_read(path)
    if state is None:
        raise RuntimeError('%s will not read; nothing was changed' % path)
    state.setdefault('tasks', {})[str(int(number))] = {
        'thread_id': int(thread_id), 'channel_id': None, 'sig': '', 'updated': ''}
    _state_write(path, state)
    return 'issue %d now owns test task post %d' % (int(number), int(thread_id))
