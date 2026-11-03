"""
Release news in the updates channels.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import re
import time

import discord

from bot_base import DATA_DIR, HERE
from bot_core import SITE, _int_env, _state_read, _state_write, client, log
from bot_task_text import strip_footer
from bot_notices import _github_time


# A release's news is posted when it is deployed, not when somebody remembers
# to run a step after a Ship. The box's deploy agent, once it has set a
# Deployment to success, leaves that Release's tag, name and notes in
# NEWS_DIR as news-<environment>.json (tools\DeployAgent\News.cs), a folder
# only SYSTEM, Administrators and this bot's account read. Each pass reads
# them and posts each tag not said yet: a dev release (every merge, to Dev,
# Site or Discord bot) in the dev updates channel, by the id in
# dev-channel.txt, and a main release in #news, by the id in news-channel.txt
# (by id and never by name: there are two channels called news). One post a
# tag, however many environments it reached, written down in news-said.json.
# A release whose notes say nothing people would notice (merge-release.yml's
# NOTHING_TO_TELL line) and one deployed over a day ago are written down
# without a post. With no news-said.json yet, what is there already is
# written down unposted: a first start must not announce old releases again.
NEWS_DIR = os.environ.get('THORNSWOOD_NEWS_DIR', r'C:\Thornswood-Deploys\for-bot')
NEWS_SAID = os.path.join(DATA_DIR, 'news-said.json')
NEWS_EVERY = max(30, _int_env('NEWS_EVERY', 60))
NEWS_MAX_AGE = 24 * 3600
NEWS_NOTHING = re.compile(r'^\s*nothing people would notice\b', re.I)
NEWS_KEEP = 200


def _channel_file_id(name):
    """The channel id in name beside this file. 0 without."""
    try:
        with open(os.path.join(HERE, name)) as f:
            return int(f.read().strip())
    except Exception:
        return 0


DEV_NEWS_ID = _int_env('DEV_NEWS_CHANNEL_ID', _channel_file_id('dev-channel.txt'))
MAIN_NEWS_ID = _int_env('NEWS_CHANNEL_ID', _channel_file_id('news-channel.txt'))


def news_channel_of(env):
    """Which news a deployed environment's release is: main for main, dev
       for everything a merge deploys."""
    return 'main' if str(env or '').lower() == 'main' else 'dev'


def news_docs(folder=None):
    """Every news-*.json in the folder as a dict, [] when there is no
       folder, and None when it is there and cannot be read, so an unreadable
       folder is never taken for no news. A file that does not read as news
       is left out."""
    folder = NEWS_DIR if folder is None else folder
    try:
        names = sorted(n for n in os.listdir(folder)
                       if n.startswith('news-') and n.endswith('.json'))
    except FileNotFoundError:
        return []
    except OSError:
        return None
    out = []
    for n in names:
        try:
            with open(os.path.join(folder, n), encoding='utf-8-sig') as f:
                doc = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(doc, dict) and str(doc.get('tag') or '').strip():
            out.append(doc)
    return out


def news_plan(docs, state, now):
    """(channel, doc, how) for each release not written down yet, oldest
       deployment first, each tag once. how is 'post', 'nothing' (its notes
       say nothing people would notice) or 'old' (deployed over a day ago)."""
    said = state.get('said') or {}
    out, seen = [], set()
    for doc in sorted(docs, key=lambda d: str(d.get('deployedUtc') or '')):
        channel = news_channel_of(doc.get('environment'))
        tag = str(doc.get('tag')).strip()
        if tag in (said.get(channel) or {}) or (channel, tag) in seen:
            continue
        seen.add((channel, tag))
        body = strip_footer(str(doc.get('body') or '')).strip()
        at = _github_time(doc.get('deployedUtc'))
        if not body or NEWS_NOTHING.match(body):
            how = 'nothing'
        elif at is not None and now - at > NEWS_MAX_AGE:
            how = 'old'
        else:
            how = 'post'
        out.append((channel, doc, how))
    return out


def news_post_parts(channel, doc):
    """The embed's title, description, footer and colour, in
       Publish-Discord.ps1's shape: the dev build's title says so, blue for
       dev and gold for main."""
    dev = channel == 'dev'
    tag = str(doc.get('tag')).strip()
    title = str(doc.get('name') or '').strip() or tag
    if dev:
        title = 'Dev build: ' + title
    if len(title) > 250:
        title = title[:247] + '...'
    body = strip_footer(str(doc.get('body') or '')).strip()
    if len(body) > 4000:
        cut = body[:4000].rsplit('\n', 1)[0]
        body = (cut if cut else body[:4000]).rstrip() + '\n...'
    return {'title': title, 'description': body,
            'footer': ('dev build ' if dev else '') + tag,
            'color': 5477574 if dev else 13214795,
            'author': 'Thornswood dev' if dev else 'Thornswood'}


async def news_once(state, docs, send, save, now=None):
    """
    One pass. send(channel, parts) posts and gives the message or None.
    state is news-said.json's dict, changed in place; save(state) after each
    release written down. Returns the (channel, tag, how) done this pass. A
    release that could not be posted is left for the next pass, and the ones
    after it in that channel wait, so they stay in order.
    """
    now = time.time() if now is None else now
    said = state.setdefault('said', {})
    done, stuck = [], set()
    for channel, doc, how in news_plan(docs, state, now):
        if channel in stuck:
            continue
        tag = str(doc.get('tag')).strip()
        rec = {'at': int(now), 'how': how}
        if how == 'post':
            msg = await send(channel, news_post_parts(channel, doc))
            if msg is None:
                stuck.add(channel)
                continue
            rec['message'] = getattr(msg, 'id', None)
        mine = said.setdefault(channel, {})
        mine[tag] = rec
        for old in sorted(mine, key=lambda t: mine[t].get('at') or 0)[:-NEWS_KEEP]:
            mine.pop(old, None)
        save(state)
        done.append((channel, tag, how))
    return done


async def _news_send(channel, parts, said_once):
    cid = DEV_NEWS_ID if channel == 'dev' else MAIN_NEWS_ID
    where = 'the dev updates channel' if channel == 'dev' else '#news'
    ch = client.get_channel(cid) if cid else None
    if ch is None:
        if channel not in said_once:
            log('news: %s is %s, so its releases wait unposted'
                % (where, ('channel %d, which this bot cannot see' % cid) if cid else
                   'named by no id (%s beside bot.py)'
                   % ('dev-channel.txt' if channel == 'dev' else 'news-channel.txt')))
            said_once.add(channel)
        return None
    logo = SITE + '/logo.png'
    e = discord.Embed(title=parts['title'], url=SITE + '/news',
                      description=parts['description'], color=parts['color'])
    e.set_author(name=parts['author'], url=SITE, icon_url=logo)
    e.set_thumbnail(url=logo)
    e.set_footer(text=parts['footer'], icon_url=logo)
    try:
        msg = await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except Exception as ex:
        if channel not in said_once:
            log('news: could not post in %s: %s' % (where, type(ex).__name__))
            said_once.add(channel)
        return None
    said_once.discard(channel)
    return msg


async def watch_release_news():
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    state = _state_read(NEWS_SAID)
    if state is None:
        log('news: %s will not read, so no release news is posted until it is '
            'fixed by hand (posting from empty would say old releases again)'
            % NEWS_SAID)
        return
    said_once = set()
    first = not os.path.exists(NEWS_SAID)
    while not client.is_closed():
        try:
            docs = await loop.run_in_executor(None, news_docs)
            if docs is None:
                if 'folder' not in said_once:
                    log('news: %s will not read, so no release news is posted'
                        % NEWS_DIR)
                    said_once.add('folder')
            elif first:
                # What was deployed before this bot kept a record is written
                # down unposted, once.
                for channel, doc, _how in news_plan(docs, state, time.time()):
                    state.setdefault('said', {}).setdefault(channel, {})[
                        str(doc.get('tag')).strip()] = {'at': int(time.time()), 'how': 'before'}
                _state_write(NEWS_SAID, state)
                first = False
                log('news: started a record in %s; releases deployed from now are posted'
                    % NEWS_SAID)
            else:
                said_once.discard('folder')
                done = await news_once(
                    state, docs, lambda c, p: _news_send(c, p, said_once),
                    lambda s: _state_write(NEWS_SAID, s))
                for channel, tag, how in done:
                    log('news: %s %s (%s)' % (tag, 'posted' if how == 'post' else
                                              'not posted: ' + how, channel))
        except Exception as e:
            log('news: a pass failed: %s' % type(e).__name__)
        await asyncio.sleep(NEWS_EVERY)
