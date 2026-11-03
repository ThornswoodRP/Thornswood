"""
The testing channels' one-time setup, and test tasks posted by hand.

Part of the bot: bot.py loads it (#5357).
"""
import datetime
import os
import typing

import discord

from bot_base import DATA_DIR
from bot_core import (_int_env, _role_tokens, _state_read, _state_write,
    _who_hits, log, tree)
from bot_holds import _say


# Patrick's card of 11 October. The Live smoke checklist that lived in
# #test-tasks (dated sessions, Pass/Fail/Skip/Fail-known rows, /live-smoke)
# is gone, and the testing channels are three things instead:
#
#   #test-tasks     a Forum. One thread per test task, tagged Main: the
#                   bot posts one, tagged Main, for each issue closed as fixed
#                   (see known issues below), and staff can post one by hand
#                   (/test-task, or python bot.py --post-task), tagged Main.
#   #test-findings  what #test-results was, renamed. Nothing else about it moves.
#   #known-issues   a Forum, read only: one bot post per open GitHub issue
#                   labelled Dev Findings or Main Findings, title only, no
#                   number and no link. The post goes when the issue is closed,
#                   which is when its fix is on main (Patrick, 11 Oct: one
#                   entry per issue, not one list).
#   #dev-test-tasks a Forum in Staff, staff only (Patrick, 12 Oct): the test
#                   tasks someone on dev has to measure, from comments that
#                   say "Server: Dev" (see known issues below), and staff
#                   can post one by hand (/test-task with the tag Dev, or
#                   --post-task --tag Dev). Most go to #test-tasks, because
#                   testers play on main in the alpha.
#
# THE ONE-TIME SETUP. Getting the server from the old shape to that one is the
# only channel change the bot makes, and Patrick's explicit exception to the
# never-touch-channels rule, for these three changes only. It runs only when
# asked, from the command line, never on a normal start:
#
#   python bot.py --setup-channels            says what it would do, changes nothing
#   python bot.py --setup-channels --apply    does it, once
#
# A finished apply is written to channel-setup.json in the data folder, and a
# second run reads it and does nothing at all. Each step also looks at the
# server before it acts, so an apply that stopped half way picks up where it
# stopped. Permission overwrites are copied, never invented.
#
# Discord cannot turn a text channel into a forum (a channel's type can only go
# between text and announcement). The edit is asked for anyway, in case that
# changes, and when Discord refuses it a new forum called test-tasks is made in
# the same category, at the same position, with the old channel's overwrites,
# and the old one is renamed test-tasks-archive with sending switched off for
# everyone but the bot. Nothing is deleted.
#
# #dev-test-tasks is the third one-time step (Patrick, 12 Oct), on a server
# that already had the first two: the forum is made in the category whose id
# is DEV_TASKS_CATEGORY, with that category's overwrites copied, so the same
# staff see it, and the bot's own forum rights from #test-tasks. Its id is
# written to channel-setup.json as dev_tasks_id, and from then on the bot
# finds it by that id and never by its name, so a rename keeps it and no
# second one is made. A forum of that name already in the category (made by
# hand or by Build-Discord.py) is taken as it is and its id recorded.
TASKS_NAME = os.environ.get('TEST_TASKS_CHANNEL', 'test-tasks').strip().lower()
TASKS_ARCHIVE = TASKS_NAME + '-archive'
FINDINGS_OLD = 'test-results'
FINDINGS_NAME = os.environ.get('TEST_FINDINGS_CHANNEL', 'test-findings').strip().lower()
KNOWN_NAME = os.environ.get('KNOWN_ISSUES_CHANNEL', 'known-issues').strip().lower()
DEV_TASKS_NAME = os.environ.get('DEV_TASKS_CHANNEL', 'dev-test-tasks').strip().lower()
# The Staff category (Patrick, 12 Oct: "a new forum under 1549254990110134374
# the Staff category").
DEV_TASKS_CATEGORY = _int_env('DEV_TASKS_CATEGORY', 1549254990110134374)
# The one tag a post in #dev-test-tasks carries.
DEV_TAG = 'Dev'
DEV_TOPIC = ('Test tasks someone on dev has to measure, from the board. Kept '
             'by the bot: a post goes when its issue closes as fixed or its '
             'test task no longer says Server: Dev.')
# What the bot is allowed in a forum it keeps: see it, make a post, write in
# a post, delete a post (manage threads), and read back what is there.
FORUM_BOT_NEEDS = ('view_channel', 'send_messages', 'send_messages_in_threads',
                   'manage_threads', 'read_message_history')
TASK_TAGS = ('Dev', 'Main')
# The tags a test task posted by hand may carry, and the forum each goes to
# (Patrick, 12 Oct, on #2276, reversing the Main only hand posts of #2413):
# Main, the default, to #test-tasks for testers on main; Dev to the staff
# #dev-test-tasks, for something someone on dev has to measure. #test-tasks
# itself is Main only: it keeps its Dev tag for older threads, nothing new
# gets it.
TASK_POST_TAG = 'Main'
HAND_TAGS = ('Main', 'Dev')
SETUP_STATE = os.path.join(DATA_DIR, 'channel-setup.json')
KNOWN_STATE = os.path.join(DATA_DIR, 'known-issues.json')
SETUP_REASON = 'Thornswood channel setup (one time, Patrick 11 Oct)'
# The send permissions switched off on the archived channel, and only those.
ARCHIVE_LOCK = ('send_messages', 'send_messages_in_threads',
                'create_public_threads', 'create_private_threads')
# Who may post a test task with /test-task. The same people who could run the
# Live smoke sessions, by id (preferred) or by name. A bot.env.json that still
# carries LIVE_SMOKE_ADMIN_ROLES (with the role ids in it) keeps working.
TASK_ROLE_NAMES = [r.strip() for r in
                   (os.environ.get('TEST_TASK_ROLES', '').strip()
                    or os.environ.get('LIVE_SMOKE_ADMIN_ROLES', '').strip()
                    or 'Owner,Dev,Lead Gamemaster,Lead GM').split(',')
                   if r.strip()]
# Forum titles are capped at 100 by Discord and a first message at 2000.
TASK_TITLE_ROOM = 100
TASK_BODY_ROOM = 2000


def _channel_named(guild, name, kinds=None):
    """Any channel in the server by name, text, forum or other, optionally of
       the given kinds ('text', 'forum'). guild.channels, not text_channels,
       because a forum is not in text_channels."""
    for ch in list(getattr(guild, 'channels', None) or []):
        if str(getattr(ch, 'name', '') or '').lower() != name:
            continue
        if kinds and _kind(ch) not in kinds:
            continue
        return ch
    return None


def _kind(ch):
    t = getattr(ch, 'type', None)
    return getattr(t, 'name', str(t or ''))


def _copy_overwrites(ch):
    """The channel's overwrites as a fresh dict, each one copied, so changing
       the copy never touches the original."""
    out = {}
    for target, ow in dict(getattr(ch, 'overwrites', None) or {}).items():
        allow, deny = ow.pair()
        out[target] = discord.PermissionOverwrite.from_pair(allow, deny)
    return out


def known_overwrites(guild, like):
    """
    #known-issues' overwrites: #test-findings' copied, so the same people see
    it, then made read only (Patrick, 11 Oct). Sending and threads are off for
    @everyone and every copied role or member; the bot alone may send.
    """
    out = _copy_overwrites(like) if like is not None else {}
    me = getattr(guild, 'me', None)
    everyone = getattr(guild, 'default_role', None)
    if everyone is not None and everyone not in out:
        out[everyone] = discord.PermissionOverwrite()
    for t, ow in out.items():
        if t == me:
            continue
        ow.update(**dict((n, False) for n in ARCHIVE_LOCK))
    if me is not None:
        mine = out.get(me) or discord.PermissionOverwrite()
        # In a forum, send_messages is making a post and manage_threads is
        # deleting one: the bot does both as issues come and go.
        mine.update(view_channel=True, send_messages=True,
                    send_messages_in_threads=True, manage_threads=True,
                    read_message_history=True)
        out[me] = mine
    return out


def setup_done(guild, path=None):
    """When the setup finished on this server, or None."""
    got = _state_read(path or SETUP_STATE) or {}
    rec = (got.get('guilds') or {}).get(str(getattr(guild, 'id', '')))
    return rec.get('done') if isinstance(rec, dict) else None


def _tags_missing(forum):
    have = set(str(getattr(t, 'name', '')).lower()
               for t in (getattr(forum, 'available_tags', None) or []))
    return [t for t in TASK_TAGS if t.lower() not in have]


async def channel_setup(guild, apply=False, path=None):
    """
    The one-time setup on one server. Returns what it did (or with apply
    False, what it would do), one line per change.

    Never runs twice: a server channel-setup.json says is done, with its
    #known-issues forum and its #dev-test-tasks forum (still there, by id),
    gets one line saying so, and nothing is asked of Discord. A server set up
    before a later step existed gets that step alone, once.
    """
    path = path or SETUP_STATE
    state = _state_read(path)
    if state is None:
        return ['%s is there but cannot be read, so nothing was changed. Look '
                'at it by hand.' % path]
    done = setup_done(guild, path)
    if (done and known_forum_done(guild, path)
            and dev_tasks_forum(guild, path) is not None):
        return ['already done on %s, nothing changed' % done]
    if not done:
        said, stop = await _first_setup(guild, apply, path)
        if stop:
            return said
    elif not known_forum_done(guild, path):
        # Set up before #known-issues was a forum: that one step, once.
        said = await known_forum_setup(guild, apply, path)
    else:
        said = []
    said += await dev_tasks_setup(guild, apply, path)
    if not said:
        said.append('nothing to change')
    return said


async def _first_setup(guild, apply, path):
    """The first one-time setup: #test-tasks a forum, #test-results renamed
       #test-findings, the #known-issues forum. Returns (lines, stop), stop
       True when nothing could be done and no later step should run."""
    said = []
    verb = '' if apply else 'would '

    # 1. #test-tasks becomes a forum.
    tasks = _channel_named(guild, TASKS_NAME, ('forum',))
    old = _channel_named(guild, TASKS_NAME, ('text',))
    if tasks is None and old is None:
        return ['there is no #%s in "%s", so nothing was changed. Make it '
                '(Build-Discord.py) and run this again.'
                % (TASKS_NAME, getattr(guild, 'name', '?'))], True
    if tasks is None:
        said.append('%stry to convert #%s to a forum' % (verb, TASKS_NAME))
        if apply:
            try:
                await old.edit(type=discord.ChannelType.forum, reason=SETUP_REASON)
                tasks = _channel_named(guild, TASKS_NAME, ('forum',))
                if tasks is not None:
                    old = None
            except (discord.HTTPException, TypeError, ValueError,
                    AttributeError) as e:
                said.append('Discord refused the conversion (%s), so the '
                            'fallback' % (getattr(e, 'text', '') or type(e).__name__))
        if tasks is None:
            said.append('%smake a new forum #%s in %s with the old channel\'s '
                        '%d permission overwrite(s) and the tags %s'
                        % (verb, TASKS_NAME,
                           getattr(old.category, 'name', None) or 'no category',
                           len(getattr(old, 'overwrites', {}) or {}),
                           ', '.join(TASK_TAGS)))
            if apply:
                tasks = await guild.create_forum(
                    TASKS_NAME, category=old.category,
                    position=getattr(old, 'position', None) or 0,
                    overwrites=_copy_overwrites(old),
                    topic='One thread per test task, tagged Main.',
                    available_tags=[discord.ForumTag(name=t) for t in TASK_TAGS],
                    reason=SETUP_REASON)
    if old is not None:
        # The text channel still called test-tasks, beside the new forum.
        said.append('%srename the old text #%s to #%s and switch off sending '
                    'in it for everyone but the bot (nothing deleted)'
                    % (verb, TASKS_NAME, TASKS_ARCHIVE))
        if apply:
            await old.edit(name=TASKS_ARCHIVE, reason=SETUP_REASON)
            me = getattr(guild, 'me', None)
            targets = [t for t in (getattr(old, 'overwrites', {}) or {})
                       if t != me]
            everyone = getattr(guild, 'default_role', None)
            if everyone is not None and everyone not in targets:
                targets.append(everyone)
            for t in targets:
                ow = old.overwrites_for(t)
                ow.update(**dict((n, False) for n in ARCHIVE_LOCK))
                await old.set_permissions(t, overwrite=ow, reason=SETUP_REASON)
    if tasks is not None:
        missing = _tags_missing(tasks)
        if missing:
            said.append('%sadd the forum tag(s) %s to #%s'
                        % (verb, ', '.join(missing), TASKS_NAME))
            if apply:
                tags = list(getattr(tasks, 'available_tags', None) or [])
                tags += [discord.ForumTag(name=t) for t in missing]
                await tasks.edit(available_tags=tags, reason=SETUP_REASON)

    # 2. #test-results becomes #test-findings. A rename keeps everything else.
    findings = _channel_named(guild, FINDINGS_NAME)
    if findings is None:
        was = _channel_named(guild, FINDINGS_OLD)
        if was is None:
            said.append('there is no #%s or #%s, so that rename was skipped'
                        % (FINDINGS_OLD, FINDINGS_NAME))
        else:
            said.append('%srename #%s to #%s' % (verb, FINDINGS_OLD, FINDINGS_NAME))
            if apply:
                await was.edit(name=FINDINGS_NAME, reason=SETUP_REASON)
            findings = was

    # 3. #known-issues, a forum beside #test-findings, with its overwrites.
    said += await _known_forum_make(guild, findings, apply, verb)

    if apply:
        state = _state_read(path) or {}
        now = _utc_stamp()
        rec = state.setdefault('guilds', {}).setdefault(str(guild.id), {})
        rec.update(done=now, known_forum=now, name=getattr(guild, 'name', ''))
        _state_write(path, state)
        said.append('recorded in %s, so this never runs again' % path)
    return said, False


def _utc_stamp():
    return (datetime.datetime.now(datetime.timezone.utc)
            .strftime('%Y-%m-%dT%H:%M:%SZ'))


def known_forum_done(guild, path=None):
    """When #known-issues was made a forum on this server, or None."""
    got = _state_read(path or SETUP_STATE) or {}
    rec = (got.get('guilds') or {}).get(str(getattr(guild, 'id', '')))
    return rec.get('known_forum') if isinstance(rec, dict) else None


async def _known_forum_make(guild, like, apply, verb):
    """The #known-issues forum, read only, with the Dev and Main tags, when
       there is none. One line per change."""
    said = []
    if _channel_named(guild, KNOWN_NAME, ('forum',)) is not None:
        return said
    said.append('%smake the forum #%s in %s with %s and the tags %s' % (
        verb, KNOWN_NAME,
        getattr(getattr(like, 'category', None), 'name', 'no category'),
        ('the %d permission overwrite(s) of #%s'
         % (len(getattr(like, 'overwrites', {}) or {}), FINDINGS_NAME))
        if like is not None else 'no overwrites of its own',
        ', '.join(TASK_TAGS)))
    said.append('%smake #%s read only: posting and replies off for @everyone '
                'and every copied overwrite; the bot alone posts and deletes '
                'there' % (verb, KNOWN_NAME))
    if apply:
        await guild.create_forum(
            KNOWN_NAME, category=getattr(like, 'category', None),
            position=(getattr(like, 'position', None) or 0) + 1,
            overwrites=known_overwrites(guild, like),
            topic='One post per known issue being worked on. Kept by the bot: '
                  'a post goes when its fix is on main and becomes a test task.',
            available_tags=[discord.ForumTag(name=t) for t in TASK_TAGS],
            reason=SETUP_REASON)
    return said


async def known_forum_setup(guild, apply=False, path=None):
    """
    The second one-time step (Patrick, 11 Oct): #known-issues is a forum with
    one post per known issue, not one channel of messages. On a server whose
    first setup made a text #known-issues, that channel goes: deleted when
    every message in it is the bot's own (all it ever held was the bot's
    list), otherwise renamed known-issues-archive and locked like the tasks
    archive. Then the forum is made. Recorded as known_forum, so it runs once.
    """
    path = path or SETUP_STATE
    verb = '' if apply else 'would '
    said = []
    old = _channel_named(guild, KNOWN_NAME, ('text',))
    if old is not None:
        me = getattr(guild, 'me', None)
        mine_only, n = True, 0
        async for msg in old.history(limit=1000):
            n += 1
            if getattr(msg.author, 'id', None) != getattr(me, 'id', None):
                mine_only = False
                break
        if mine_only:
            said.append('%sdelete the text #%s: its %d message(s) are all the '
                        'bot\'s own list' % (verb, KNOWN_NAME, n))
            if apply:
                await old.delete(reason=SETUP_REASON)
        else:
            archive = KNOWN_NAME + '-archive'
            said.append('%srename the text #%s to #%s and switch off sending in '
                        'it (it holds messages that are not the bot\'s, so '
                        'nothing is deleted)' % (verb, KNOWN_NAME, archive))
            if apply:
                await old.edit(name=archive, reason=SETUP_REASON)
                for t in list((getattr(old, 'overwrites', {}) or {})):
                    if t == me:
                        continue
                    ow = old.overwrites_for(t)
                    ow.update(**dict((x, False) for x in ARCHIVE_LOCK))
                    await old.set_permissions(t, overwrite=ow, reason=SETUP_REASON)
    findings = _channel_named(guild, FINDINGS_NAME)
    said += await _known_forum_make(guild, findings, apply, verb)
    tasks = _channel_named(guild, TASKS_NAME, ('forum',))
    me = getattr(guild, 'me', None)
    if tasks is not None and me is not None and not tasks.overwrites_for(me).manage_threads:
        said.append('%slet the bot delete posts in #%s (manage threads, for a '
                    'test task whose issue is reopened)' % (verb, TASKS_NAME))
        if apply:
            ow = tasks.overwrites_for(me)
            ow.update(view_channel=True, send_messages=True,
                      send_messages_in_threads=True, manage_threads=True)
            await tasks.set_permissions(me, overwrite=ow, reason=SETUP_REASON)
    if apply:
        state = _state_read(path) or {}
        rec = state.setdefault('guilds', {}).setdefault(str(guild.id), {})
        rec['known_forum'] = _utc_stamp()
        _state_write(path, state)
        said.append('recorded in %s, so this never runs again' % path)
    return said


def _setup_rec(guild, path=None):
    got = _state_read(path or SETUP_STATE) or {}
    rec = (got.get('guilds') or {}).get(str(getattr(guild, 'id', '')))
    return rec if isinstance(rec, dict) else {}


def _by_id(guild, cid):
    """The server's channel or category with this id, or None."""
    try:
        cid = int(cid or 0)
    except (TypeError, ValueError):
        return None
    if not cid:
        return None
    getter = getattr(guild, 'get_channel', None)
    return getter(cid) if getter is not None else None


def dev_tasks_forum(guild, path=None):
    """The #dev-test-tasks forum, by the id the setup recorded, or None when
       the setup has not made it or it has been deleted since. Never looked
       for by name: a rename keeps it."""
    ch = _by_id(guild, _setup_rec(guild, path).get('dev_tasks_id'))
    return ch if ch is not None and _kind(ch) == 'forum' else None


def dev_overwrites(guild, category, tasks=None):
    """
    #dev-test-tasks' overwrites: the category's copied, so it is staff only
    the way the category is, then the bot's own overwrite from #test-tasks
    with every forum right it needs there (FORUM_BOT_NEEDS) switched on.
    """
    out = _copy_overwrites(category) if category is not None else {}
    me = getattr(guild, 'me', None)
    if me is not None:
        mine = out.get(me) or discord.PermissionOverwrite()
        if tasks is not None and me in (getattr(tasks, 'overwrites', None) or {}):
            a, d = tasks.overwrites[me].pair()
            mine = discord.PermissionOverwrite.from_pair(a, d)
        mine.update(**dict((n, True) for n in FORUM_BOT_NEEDS))
        out[me] = mine
    return out


async def dev_tasks_setup(guild, apply=False, path=None):
    """
    The third one-time step (Patrick, 12 Oct): the #dev-test-tasks forum in
    the Staff category, staff only, tagged Dev. Recorded with its id as
    dev_tasks_id, so it runs once and the bot finds the forum by that id.
    Nothing to do when the recorded forum is still there.
    """
    path = path or SETUP_STATE
    verb = '' if apply else 'would '
    rec = _setup_rec(guild, path)
    if dev_tasks_forum(guild, path) is not None:
        return []
    said = []
    if rec.get('dev_tasks_id'):
        said.append('the #%s recorded in %s (id %s) is not on the server any '
                    'more' % (DEV_TASKS_NAME, path, rec.get('dev_tasks_id')))
    cat = _by_id(guild, DEV_TASKS_CATEGORY)
    if cat is None or _kind(cat) != 'category':
        return said + ['there is no category with id %d in "%s", so #%s was not '
                       'made. Set DEV_TASKS_CATEGORY in bot.env.json to the '
                       'Staff category\'s id and run this again.'
                       % (DEV_TASKS_CATEGORY, getattr(guild, 'name', '?'),
                          DEV_TASKS_NAME)]
    me = getattr(guild, 'me', None)
    there = [ch for ch in (getattr(cat, 'channels', None) or [])
             if str(getattr(ch, 'name', '')).lower() == DEV_TASKS_NAME]
    forum = next((ch for ch in there if _kind(ch) == 'forum'), None)
    if forum is None and there:
        return said + ['there is a #%s in %s that is not a forum, so nothing was '
                       'made. Rename or remove it by hand, then run this again.'
                       % (DEV_TASKS_NAME, getattr(cat, 'name', '?'))]
    if forum is not None:
        said.append('#%s is already in %s: %staken as it is, by its id %s'
                    % (DEV_TASKS_NAME, getattr(cat, 'name', '?'), verb, forum.id))
        if task_tag_of(forum, DEV_TAG) is None:
            said.append('%sadd the forum tag %s to #%s' % (verb, DEV_TAG, DEV_TASKS_NAME))
            if apply:
                tags = list(getattr(forum, 'available_tags', None) or [])
                tags.append(discord.ForumTag(name=DEV_TAG))
                await forum.edit(available_tags=tags, reason=SETUP_REASON)
        have = forum.overwrites_for(me) if me is not None else None
        if have is not None and not all(getattr(have, n) is True for n in FORUM_BOT_NEEDS):
            said.append('%slet the bot post, reply and delete its posts in #%s'
                        % (verb, DEV_TASKS_NAME))
            if apply:
                have.update(**dict((n, True) for n in FORUM_BOT_NEEDS))
                await forum.set_permissions(me, overwrite=have, reason=SETUP_REASON)
    else:
        tasks = _channel_named(guild, TASKS_NAME, ('forum',))
        said.append('%smake the forum #%s in %s with the category\'s %d '
                    'permission overwrite(s), so only the people who see %s '
                    'see it, and the tag %s'
                    % (verb, DEV_TASKS_NAME, getattr(cat, 'name', '?'),
                       len(getattr(cat, 'overwrites', {}) or {}),
                       getattr(cat, 'name', '?'), DEV_TAG))
        said.append('%sgive the bot its #%s rights there: see it, post, reply, '
                    'delete its posts and read them back' % (verb, TASKS_NAME))
        if apply:
            forum = await guild.create_forum(
                DEV_TASKS_NAME, category=cat,
                overwrites=dev_overwrites(guild, cat, tasks),
                topic=DEV_TOPIC,
                available_tags=[discord.ForumTag(name=DEV_TAG)],
                reason=SETUP_REASON)
    if apply:
        state = _state_read(path) or {}
        r = state.setdefault('guilds', {}).setdefault(str(guild.id), {})
        r['dev_tasks'] = _utc_stamp()
        r['dev_tasks_id'] = forum.id
        _state_write(path, state)
        said.append('recorded #%s (id %s) in %s, so this never runs again and '
                    'the bot finds it by that id' % (DEV_TASKS_NAME, forum.id, path))
    return said


# ------------------------------------------------------------ test tasks --
def is_task_poster(who):
    """Owner, Dev or Lead Gamemaster by TEST_TASK_ROLES. Nobody else."""
    try:
        ids, names = _role_tokens(TASK_ROLE_NAMES)
        return _who_hits(who, ids, names)
    except Exception:
        return False


def task_tag_of(forum, tag):
    """The forum's Dev or Main tag object, or None."""
    want = str(tag or '').strip().lower()
    for t in getattr(forum, 'available_tags', None) or []:
        if str(getattr(t, 'name', '')).lower() == want:
            return t
    return None


async def post_test_task(guild, title, body, tag=TASK_POST_TAG, path=None):
    """
    One thread, titled and tagged: Main (the default) in the #test-tasks
    forum, Dev in #dev-test-tasks, found by the id the one-time setup
    recorded (path, channel-setup.json). Any other tag is refused.

    Returns (thread or None, what to say). A thread already open under that
    exact title in that forum is not made twice; the existing one is handed
    back.
    """
    title = str(title or '').strip()
    body = str(body or '').strip()
    want = str(tag or TASK_POST_TAG).strip().capitalize()
    if want not in HAND_TAGS:
        return None, ('A test task is Main (for testers, in #%s) or Dev (for '
                      'staff on dev, in #%s), not %r.'
                      % (TASKS_NAME, DEV_TASKS_NAME, tag))
    if not title or not body:
        return None, 'A test task needs a title and a body.'
    if len(title) > TASK_TITLE_ROOM:
        return None, 'That title is %d characters; Discord takes %d.' % (
            len(title), TASK_TITLE_ROOM)
    if len(body) > TASK_BODY_ROOM:
        return None, 'That body is %d characters; Discord takes %d.' % (
            len(body), TASK_BODY_ROOM)
    if want == 'Dev':
        name = DEV_TASKS_NAME
        forum = dev_tasks_forum(guild, path)
        if forum is None:
            return None, ('#%s is not made yet. The one-time setup (python '
                          'bot.py --setup-channels --apply) makes it.' % name)
    else:
        name = TASKS_NAME
        forum = _channel_named(guild, TASKS_NAME, ('forum',))
        if forum is None:
            return None, ('#%s is not a forum yet. The one-time setup '
                          '(python bot.py --setup-channels --apply) makes it one.'
                          % TASKS_NAME)
    t = task_tag_of(forum, want)
    if t is None:
        return None, ('#%s has no %s tag. The one-time setup adds it.'
                      % (name, want))
    for th in list(getattr(forum, 'threads', None) or []):
        if (str(getattr(th, 'name', '')) == title
                and not getattr(th, 'archived', False)):
            return th, 'Already there: %s' % getattr(th, 'mention', title)
    made = await forum.create_thread(name=title, content=body,
                                     applied_tags=[t],
                                     reason='Thornswood test task')
    thread = getattr(made, 'thread', made)
    return thread, 'Posted: %s' % getattr(thread, 'mention', title)


@tree.command(name='test-task',
              description='Post a test task: Main for testers (#test-tasks), '
                          'Dev for staff on dev. Owner, Dev, Lead GM.')
@discord.app_commands.describe(title='The thread title.',
                               body='What to test, as the first post.',
                               tag='Main (the default): testers on main, in '
                                   '#test-tasks. Dev: staff on dev, in '
                                   '#dev-test-tasks.')
async def test_task_cmd(interaction: discord.Interaction, title: str,
                        body: str, tag: typing.Literal['Main', 'Dev'] = 'Main'):
    if interaction.guild is None:
        await _say(interaction, 'This one works in the server.')
        return
    if not is_task_poster(interaction.user):
        await _say(interaction, 'Only %s post test tasks.'
                   % ', '.join(TASK_ROLE_NAMES))
        return
    await interaction.response.defer(ephemeral=True, thinking=True)
    try:
        _, said = await post_test_task(interaction.guild, title, body, tag)
    except discord.HTTPException as e:
        log('test task: Discord refused a post: %s' % getattr(e, 'text', e))
        said = ('That did not go through. In #%s the bot needs View Channel, '
                'Send Messages and Create Posts.'
                % (DEV_TASKS_NAME if tag == 'Dev' else TASKS_NAME))
    await interaction.followup.send(said, ephemeral=True)
