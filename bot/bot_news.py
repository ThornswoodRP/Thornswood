"""
Release news in the updates channels.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import datetime
import json
import base64
import os
import re
import shutil
import subprocess
import time

import aiohttp
import discord

from bot_base import CONTEXT, DATA_DIR, HERE
from bot_core import SITE, _int_env, _state_read, _state_write, client, log
from bot_task_text import strip_footer
from bot_notices import _github_time
from bot_pings import NEWS_PING_ROLE, ping_role
from bot_github import GITHUB_API, KNOWN_REPO, _github_get, pass_failure


# A release's news is posted when it is deployed, not when somebody remembers
# to run a step after a Ship. The box's deploy agent, once it has set a
# Deployment to success, leaves that Release's tag, name and notes in
# NEWS_DIR as news-<environment>.json (tools\DeployAgent\News.cs), a folder
# only SYSTEM, Administrators and this bot's account read. Each pass reads
# them and posts each tag not said yet: a dev release (every merge, to Dev,
# Site or Discord bot) in #staff-news, by the id in
# dev-channel.txt, and a main release in #news, by the id in news-channel.txt
# (by id and never by name: there are two channels called news). One post a
# tag, however many environments it reached, written down in news-said.json.
# Every release is posted (Patrick, 9 Nov: "still make an announcement"), so
# the numbers in the channel never jump. One whose notes are empty, or the line
# Releases before 9 Nov carried when every change said none, is posted as
# merge-release.yml's QUIET_NOTE. One deployed over a day ago is written down
# without a post. With no news-said.json yet, what is there already is
# written down unposted: a first start must not announce old releases again.
NEWS_DIR = os.environ.get('THORNSWOOD_NEWS_DIR', r'C:\Thornswood-Deploys\for-bot')
NEWS_SAID = os.path.join(DATA_DIR, 'news-said.json')
NEWS_EVERY = max(30, _int_env('NEWS_EVERY', 60))
NEWS_MAX_AGE = 24 * 3600
NEWS_QUIET = 'Various bug fixes and improvements'
NEWS_WAS_NOTHING = re.compile(r'^\s*nothing people would notice\b', re.I)
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
       deployment first, each tag once. how is 'post' or 'old' (deployed
       over a day ago)."""
    said = state.get('said') or {}
    out, seen = [], set()
    for doc in sorted(docs, key=lambda d: str(d.get('deployedUtc') or '')):
        channel = news_channel_of(doc.get('environment'))
        tag = str(doc.get('tag')).strip()
        if tag in (said.get(channel) or {}) or (channel, tag) in seen:
            continue
        seen.add((channel, tag))
        at = _github_time(doc.get('deployedUtc'))
        if at is not None and now - at > NEWS_MAX_AGE:
            how = 'old'
        else:
            how = 'post'
        out.append((channel, doc, how))
    return out


# WHAT A POST SAYS (Patrick, 12 Nov 2026). The title is the change itself,
# the note's headline, as the posts of October were, and the footer says
# where it went, what it changed and the build, "build" once: "Dev server ·
# game server, launcher · build 1.3.51". Until then the title was the
# Release's name, "Dev build: Release build-1.3.50", and the footer "dev
# build build-1.3.50". What a change touched is read from the files of the
# pull requests the Release carries (release_about), by AREAS.
#
# MAIN SERVER CHANGES. A pull request that changed only the Discord bot or
# the site (and docs or tests) goes live on its merge, not to dev: its note
# is kept out of the build Release's notes (scripts/release/
# Collect-ReleaseNotes.ps1, by scripts/release/main-server-paths.json) and
# posted here in #news, where main updates go, labelled Main Server (Patrick,
# 12 Nov: "Those are live and not dev and should be put where main updates
# go", "It should be labeled Main Server").
AREAS = (
    ('launcher/', 'launcher'),
    ('game/plugins/', 'game'),
    ('records/client-build.json', 'game'),
    ('game/', 'game server'),
    ('engine/', 'game server'),
    ('records/server-build.json', 'game server'),
    ('voice/', 'voice'),
    ('site/', 'site'),
    ('bot/', 'Discord'),
)
LIVE_AREAS = ('site', 'Discord')
# Files that change no part: they neither make a change a build change nor
# say where it went.
NEUTRAL = ('docs/', 'tests/')
AREA_ORDER = ('game server', 'game', 'launcher', 'voice', 'site', 'Discord')
TAG_NUMBER = re.compile(r'^build-1\.3\.(\d{1,9})$')
MAIN_COLOUR = 13214795
DEV_COLOUR = 5477574


def area_of(path):
    path = str(path or '').replace('\\', '/')
    for prefix, label in AREAS:
        if path.startswith(prefix):
            return label
    return None


def areas_of(files):
    """The areas a list of changed files touched, in AREA_ORDER."""
    got = set(a for a in (area_of(f) for f in files) if a)
    return [a for a in AREA_ORDER if a in got]


def is_main_server_change(files):
    """Every file under the bot, the site or NEUTRAL, one at least under the
       bot or the site: Collect-ReleaseNotes.ps1's Test-MainServerChange."""
    files = [str(f).replace('\\', '/') for f in files or () if f]
    live = False
    for f in files:
        if area_of(f) in LIVE_AREAS:
            live = True
        elif not f.startswith(NEUTRAL):
            return False
    return live


# How a pull request's "Release note:" line is read is tools/ReleaseNotes/
# NoteRules.cs, the one copy (#5354): PrNote.Read, which the "Release note"
# check and Collect-ReleaseNotes.ps1 use. The bot has no reader of its own
# (#6004). It asks that file, compiled by pwsh's Add-Type the way the
# release scripts compile it, with every body on standard input as JSON, and
# reads back one answer each. On the box the file is beside the bot
# (Install-Bot.ps1 and App-Part.ps1 send it); in a checkout it is in tools.
_READ_NOTES = r"""
$ErrorActionPreference = 'Stop'
Add-Type -LiteralPath $env:THORNSWOOD_NOTE_RULES
$bodies = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
$answers = @(foreach ($b in $bodies) {
    $n = [Thornswood.ReleaseNotes.PrNote]::Read([string]$b)
    [ordered]@{ found = $n.Found; none = $n.None; headline = $n.Headline; details = @($n.Details) }
})
ConvertTo-Json -InputObject $answers -Depth 4 -Compress
"""


def note_rules_file():
    """NoteRules.cs beside the bot, or in the checkout's tools; None without."""
    for path in (os.path.join(HERE, 'NoteRules.cs'),
                 os.path.join(os.path.dirname(HERE), 'tools', 'ReleaseNotes', 'NoteRules.cs')):
        if os.path.isfile(path):
            return path
    return None


def _pwsh():
    return shutil.which('pwsh') or r'C:\Program Files\PowerShell\7\pwsh.exe'


def pr_release_notes(bodies):
    """For each pull request body, (headline, [details]) of its Release note
       line as PrNote.Read in tools/ReleaseNotes/NoteRules.cs reads it, or
       None for none or no line. Raises when the rules cannot be asked, so
       the release is tried again next pass."""
    bodies = [str(b or '') for b in bodies]
    if not bodies:
        return []
    rules = note_rules_file()
    if not rules:
        raise RuntimeError('NoteRules.cs is not beside the bot, so no release note can be read')
    script = base64.b64encode(_READ_NOTES.encode('utf-16-le')).decode('ascii')
    env = dict(os.environ, THORNSWOOD_NOTE_RULES=rules)
    done = subprocess.run([_pwsh(), '-NoProfile', '-NonInteractive', '-EncodedCommand', script],
                          input=json.dumps(bodies).encode('utf-8'), capture_output=True,
                          env=env, timeout=120)
    if done.returncode != 0:
        raise RuntimeError('the release note rules did not answer: '
                           + done.stderr.decode('utf-8', 'replace').strip()[-400:])
    answers = json.loads(done.stdout.decode('utf-8'))
    if not isinstance(answers, list) or len(answers) != len(bodies):
        raise RuntimeError('the release note rules gave %r answers for %d bodies'
                           % (len(answers) if isinstance(answers, list) else answers, len(bodies)))
    return [(a['headline'], list(a.get('details') or []))
            if a.get('found') and not a.get('none') else None for a in answers]


def _version(tag):
    return re.sub(r'^(main-)?build-', '', str(tag or '').strip())


def _cut(body):
    if len(body) > 4000:
        cut = body[:4000].rsplit('\n', 1)[0]
        body = (cut if cut else body[:4000]).rstrip() + '\n...'
    return body


def news_picture(line):
    """One captioned first-party screenshot, matching the site and launcher."""
    m = re.fullmatch(r'!\[([^\]\r\n]{1,160})\]\((https://thornswood\.net/news-[a-z0-9][a-z0-9-]{0,119}\.(?:png|jpg|webp))\)', line)
    if not m:
        return None
    # ECMAScript's trim set, shared with the native and browser parsers.
    alt = m[1].strip('\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')
    if not alt or len(m[1].encode('utf-16-le', errors='surrogatepass')) > 320 or re.search(r'[\x00-\x1f\x7f]', alt):
        return None
    return {'url': m[2], 'alt': alt}


def _news_literal(text):
    # Keep backticks themselves outside the code spans rather than replacing
    # them. Everything else, including links and Discord tags, stays literal.
    return '\\`'.join('`' + part + '`' if part else '' for part in text.split('`'))


def _news_picture_lines(lines):
    image, rest = None, []
    for line in lines:
        said = line.strip()
        bullet = said.startswith('- ')
        if bullet:
            said = said[2:].strip()
        picture = news_picture(said) if bullet and image is None else None
        if picture:
            image = picture
        else:
            # Invalid image notation is literal, never a masked external
            # link or a spoiler. A code span also stops URL auto-linking.
            rest.append(_news_literal(line) if '![' in said else line)
    return image, rest


def news_post_parts(channel, doc, areas=None):
    """The embed's title, description, footer, colour and time: the note's
       headline as the title, the rest under it, blue for dev and gold for
       main, and the footer saying where, what and which build."""
    dev = channel == 'dev'
    tag = str(doc.get('tag')).strip()
    body = strip_footer(str(doc.get('body') or '')).strip()
    if not body or NEWS_WAS_NOTHING.match(body):
        body = NEWS_QUIET
    lines = body.split('\n')
    name = str(doc.get('name') or '').strip()
    if lines[0].lstrip().startswith('- '):
        # Notes with no headline line: the Release's own name, when it is
        # more than "Release <tag>", or the quiet line.
        plain = name and name not in (tag, 'Release ' + tag)
        title, rest = (name if plain else NEWS_QUIET), lines
    else:
        title, rest = lines[0].strip(), lines[1:]
    if len(title) > 250:
        title = title[:247] + '...'
    footer = ['Dev server' if dev else 'Main Server']
    if areas:
        footer.append(', '.join(areas))
    footer.append('build ' + _version(tag))
    image, rest = _news_picture_lines(rest)
    return {'title': title, 'description': _cut('\n'.join(rest).strip()),
            'image': image,
            'footer': ' \u00b7 '.join(footer),
            'color': DEV_COLOUR if dev else MAIN_COLOUR,
            'author': 'Thornswood dev' if dev else 'Thornswood',
            'at': _github_time(doc.get('deployedUtc'))}


def main_server_parts(note, areas, at=None):
    """A Main Server change's post in #news: its headline, its lines, and
       the footer "Main Server · Discord"."""
    head, details = note
    image, details = _news_picture_lines(details)
    return {'title': head[:250], 'description': _cut('\n'.join(details)),
            'image': image,
            'footer': ' \u00b7 '.join(['Main Server'] + ([', '.join(areas)] if areas else [])),
            'color': MAIN_COLOUR, 'author': 'Thornswood', 'at': at}


def release_about(tag, get=None):
    """What a build Release carries, read from GitHub: {'areas': the areas
       its build changes touched, 'live': [(number, note, areas)] of its Main
       Server changes that have a note}. The pull requests are the merges
       since the published build Release before it, as
       Collect-ReleaseNotes.ps1 reads them. None for a tag that is not a
       build-1.3.<n>. Raises when GitHub does not answer, or when the
       release note rules cannot be asked (pr_release_notes)."""
    get = get or _github_get
    m = TAG_NUMBER.match(str(tag or '').strip())
    if not m:
        return None
    n = int(m.group(1))
    repo = GITHUB_API + '/repos/' + KNOWN_REPO
    before = -1
    for rel in get(repo + '/releases?per_page=100') or []:
        t = TAG_NUMBER.match(str(rel.get('tag_name') or ''))
        if t and not rel.get('draft') and before < int(t.group(1)) < n:
            before = int(t.group(1))
    if before < 0:
        return {'areas': [], 'live': []}
    cmp = get('%s/compare/build-1.3.%d...%s' % (repo, before, tag)) or {}
    areas, live = set(), []
    for c in cmp.get('commits') or []:
        subject = str((c.get('commit') or {}).get('message') or '').split('\n')[0]
        pm = re.search(r'\(#(\d+)\)\s*$', subject)
        if not pm:
            continue
        number = int(pm.group(1))
        pr = get('%s/pulls/%d' % (repo, number)) or {}
        files = []
        for page in range(1, 31):
            got = get('%s/pulls/%d/files?per_page=100&page=%d' % (repo, number, page)) or []
            for f in got:
                files.append(f.get('filename'))
                if f.get('previous_filename'):
                    files.append(f.get('previous_filename'))
            if len(got) < 100:
                break
        if is_main_server_change(files):
            live.append((number, pr.get('body'), areas_of(files)))
        else:
            areas.update(areas_of(files))
    notes = pr_release_notes([body for _n, body, _a in live])
    live = [(number, note, where) for (number, _b, where), note in zip(live, notes) if note]
    return {'areas': [a for a in AREA_ORDER if a in areas], 'live': live}


def _keep_newest(mine):
    for old in sorted(mine, key=lambda t: mine[t].get('at') or 0)[:-NEWS_KEEP]:
        mine.pop(old, None)


async def news_once(state, docs, send, save, now=None, about=None):
    """
    One pass. send(channel, parts) posts and gives the message or None.
    state is news-said.json's dict, changed in place; save(state) after each
    release written down. Returns the (channel, tag, how) done this pass. A
    release that could not be posted is left for the next pass, and the ones
    after it in that channel wait, so they stay in order.

    about(tag), when given, is release_about's answer for a tag, or None when
    GitHub could not say: the dev post's footer names the areas from it, and
    each Main Server change it names is posted in #news once (said['live-pr']
    by pull request), a tag written down in said['live'] when all of them
    are. A tag GitHub could not say is tried again next pass.
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
            info = await about(tag) if (about and channel == 'dev') else None
            msg = await send(channel, news_post_parts(channel, doc,
                                                      (info or {}).get('areas')))
            if msg is None:
                stuck.add(channel)
                continue
            rec['message'] = getattr(msg, 'id', None)
        mine = said.setdefault(channel, {})
        mine[tag] = rec
        _keep_newest(mine)
        save(state)
        done.append((channel, tag, how))
    if about is None or 'main' in stuck:
        return done
    for doc in sorted(docs, key=lambda d: str(d.get('deployedUtc') or '')):
        if news_channel_of(doc.get('environment')) != 'dev':
            continue
        tag = str(doc.get('tag')).strip()
        tags = said.setdefault('live', {})
        if tag in tags:
            continue
        at = _github_time(doc.get('deployedUtc'))
        if at is not None and now - at > NEWS_MAX_AGE:
            tags[tag] = {'at': int(now), 'how': 'old'}
            _keep_newest(tags)
            save(state)
            continue
        info = await about(tag)
        if info is None:
            continue
        prs = said.setdefault('live-pr', {})
        whole = True
        for number, note, areas in info.get('live') or []:
            if str(number) in prs:
                continue
            msg = await send('main', main_server_parts(note, areas, at))
            if msg is None:
                whole = False
                break
            prs[str(number)] = {'at': int(now), 'tag': tag, 'message': getattr(msg, 'id', None)}
            _keep_newest(prs)
            save(state)
            done.append(('main-server', '#%d' % number, 'post'))
        if not whole:
            break
        tags[tag] = {'at': int(now), 'how': 'post'}
        _keep_newest(tags)
        save(state)
    return done


async def _news_picture_ready(image):
    """Do not announce a screenshot before the site has deployed its file."""
    timeout = aiohttp.ClientTimeout(total=8)
    async with aiohttp.ClientSession(timeout=timeout, cookie_jar=aiohttp.DummyCookieJar()) as session:
        async with session.head(image['url'], allow_redirects=False, ssl=CONTEXT,
                                headers={'User-Agent': 'ThornswoodNews/1'}) as response:
            types = response.headers.getall('Content-Type', [])
            kind = types[0].split(';')[0].strip().lower() if len(types) == 1 and ',' not in types[0] else ''
            return response.status == 200 and str(response.url) == image['url'] and kind in ('image/png', 'image/jpeg', 'image/webp')


async def _news_send(channel, parts, said_once):
    cid = DEV_NEWS_ID if channel == 'dev' else MAIN_NEWS_ID
    where = '#staff-news' if channel == 'dev' else '#news'
    ch = client.get_channel(cid) if cid else None
    if ch is None:
        if channel not in said_once:
            log('news: %s is %s, so its releases wait unposted'
                % (where, ('channel %d, which this bot cannot see' % cid) if cid else
                   'named by no id (%s beside bot.py)'
                   % ('dev-channel.txt' if channel == 'dev' else 'news-channel.txt')))
            said_once.add(channel)
        return None
    if parts.get('image'):
        deadline = time.monotonic() + 8
        try:
            ready = await asyncio.wait_for(_news_picture_ready(parts['image']), timeout=8)
        except Exception as ex:
            if channel not in said_once:
                log('news: screenshot unavailable (%s); the %s post waits for the site' % (type(ex).__name__, channel))
            said_once.add(channel)
            return None
        if not ready or time.monotonic() >= deadline:
            if channel not in said_once:
                log('news: screenshot is not served as an image yet; the %s post waits for the site' % channel)
            said_once.add(channel)
            return None
    logo = SITE + '/logo.png'
    e = discord.Embed(title=parts['title'], url=SITE + '/news',
                      description=parts['description'], color=parts['color'])
    e.set_author(name=parts['author'], url=SITE, icon_url=logo)
    e.set_thumbnail(url=logo)
    e.set_footer(text=parts['footer'], icon_url=logo)
    if parts.get('image'):
        e.set_image(url=parts['image']['url'])
        caption = _news_literal(parts['image']['alt'])
        e.add_field(name='Screenshot', value=caption + '\n[Open full screenshot](' + parts['image']['url'] + ')', inline=False)
    if parts.get('at'):
        e.timestamp = datetime.datetime.fromtimestamp(parts['at'], datetime.timezone.utc)
    # A post pings News Pings, the role its button in #welcome promises
    # (bot_pings.py); nothing pinged it before 12 Nov 2026. #staff-news, the
    # staff side of #news, pings it too, so staff who took the role hear of
    # a dev release the way everybody hears of a main one (Patrick, 15 Nov
    # 2026). Only staff see #staff-news, so only staff are pinged there.
    role = ping_role(getattr(ch, 'guild', None), NEWS_PING_ROLE)
    try:
        msg = await ch.send(content=role.mention if role else None, embed=e,
                            allowed_mentions=discord.AllowedMentions(
                                everyone=False, users=False,
                                roles=[role] if role else False))
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
    known = {}

    async def about(tag):
        """release_about for a tag, kept once read; None when GitHub could
           not say, which is logged once until it can again."""
        if tag in known:
            return known[tag]
        try:
            info = await loop.run_in_executor(None, release_about, tag)
        except Exception as e:
            if 'about' not in said_once:
                log('news: GitHub could not say what %s carries (%s); its post names '
                    'no areas and its Main Server changes wait' % (tag, pass_failure(e)))
                said_once.add('about')
            return None
        said_once.discard('about')
        known[tag] = info or {'areas': [], 'live': []}
        return known[tag]
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
                for doc in docs:
                    state.setdefault('said', {}).setdefault('live', {})[
                        str(doc.get('tag')).strip()] = {'at': int(time.time()), 'how': 'before'}
                _state_write(NEWS_SAID, state)
                first = False
                log('news: started a record in %s; releases deployed from now are posted'
                    % NEWS_SAID)
            else:
                said_once.discard('folder')
                done = await news_once(
                    state, docs, lambda c, p: _news_send(c, p, said_once),
                    lambda s: _state_write(NEWS_SAID, s), about=about)
                for channel, tag, how in done:
                    log('news: %s %s (%s)' % (tag, 'posted' if how == 'post' else
                                              'not posted: ' + how, channel))
        except Exception as e:
            log('news: a pass failed: %s' % type(e).__name__)
        await asyncio.sleep(NEWS_EVERY)
