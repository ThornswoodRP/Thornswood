"""
test-5187-release-news.py

Release news from the deploy agent (#5187): the agent leaves each deployed
Release's notes in for-bot\\news-<environment>.json (tools\\DeployAgent\\
News.cs), and the bot posts each tag once (bot.news_docs, news_plan,
news_post_parts, news_once).

It holds:
  - the files are read in the agent's shape; no folder is no news, a file
    that does not read is left out;
  - a dev release (dev, site or the bot) goes to the dev updates channel and
    a main one to #news, each tag once however many places it reached;
  - the notes merge-release.yml writes when nothing people would notice
    changed, empty notes, and a release deployed over a day ago are written
    down without a post;
  - the post (Patrick, 12 Nov 2026): the note's headline is the title, the
    footer says where, what the change touched and the build with "build"
    once ("Dev server · game server, launcher · build 1.3.51"), blue for dev
    and gold for main, no Claude Code footer, long notes cut at a line;
  - a Main Server change (only the bot or the site) is posted in #news once,
    labelled Main Server, read from the pull requests the Release carries;
  - a post that fails is tried again next pass and the releases after it in
    that channel wait; the other channel goes on;
  - the record is saved after each one and keeps the newest 200 a channel;
  - the loop is started with the others, and the channel ids are by id.

The real bot module is imported. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import json
import shutil
import tempfile
import time

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''

import harness_bot  # noqa: E402

bot = harness_bot.whole()
FAIL = []
NOW = 1_800_000_000


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def stamp(t):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))


def doc(env, tag, body='- The forge lists each ingot once.', name='', at=None):
    return {'environment': env, 'tag': tag, 'name': name or tag, 'body': body,
            'url': 'https://github.com/O/R/releases/tag/' + tag, 'commit': '0' * 40,
            'deployedUtc': stamp(NOW - 60 if at is None else at)}


class Msg:
    def __init__(self, i):
        self.id = i


class World:
    def __init__(self):
        self.posts, self.saves = [], 0
        self.down = set()

    async def send(self, channel, parts):
        if channel in self.down:
            return None
        self.posts.append((channel, parts))
        return Msg(500 + len(self.posts))

    def save(self, state):
        self.saves += 1


def run(state, w, docs, now=NOW):
    return asyncio.run(bot.news_once(state, docs, w.send, w.save, now=now))


# ---- the files -------------------------------------------------------------
tmp = tempfile.mkdtemp(prefix='tw-news-')
try:
    yes('no folder is no news', bot.news_docs(os.path.join(tmp, 'none')) == [])
    with open(os.path.join(tmp, 'news-dev.json'), 'w', encoding='utf-8') as f:
        json.dump(doc('dev', 'build-1'), f)
    with open(os.path.join(tmp, 'news-site.json'), 'w', encoding='utf-8') as f:
        f.write('{ not json')
    with open(os.path.join(tmp, 'other.json'), 'w', encoding='utf-8') as f:
        json.dump(doc('dev', 'build-9'), f)
    got = bot.news_docs(tmp)
    yes('a news file is read, one that does not read and other files are left out',
        [d['tag'] for d in got] == ['build-1'])
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# ---- one post a tag, to its channel ----------------------------------------
state, w = {}, World()
done = run(state, w, [doc('dev', 'build-1', at=NOW - 30), doc('site', 'build-1', at=NOW - 20),
                      doc('discord', 'build-1', at=NOW - 10)])
yes('a release that reached dev, the site and the bot is one post, in the dev updates channel',
    done == [('dev', 'build-1', 'post')] and len(w.posts) == 1 and w.posts[0][0] == 'dev')
yes('it is written down with its message', state['said']['dev']['build-1']['message'] == 501 and w.saves == 1)
run(state, w, [doc('dev', 'build-1')])
yes('and never posted again', len(w.posts) == 1)
done = run(state, w, [doc('main', 'build-1')])
yes('the same release reaching main is main news, in #news', done == [('main', 'build-1', 'post')] and w.posts[-1][0] == 'main')
yes('environments map to their news', bot.news_channel_of('Main') == 'main' and bot.news_channel_of('discord') == 'dev')

# ---- every release is posted (Patrick, 9 Nov); only a day-old one is not --
state, w = {}, World()
done = run(state, w, [doc('dev', 'build-2', body='Various bug fixes and improvements\n', at=NOW - 30),
                      doc('site', 'build-3', body='\n---\n_Generated by [Claude Code](https://claude.ai/code)_\n', at=NOW - 20),
                      doc('dev', 'build-5', body='Nothing people would notice: every change in this release says none.', at=NOW - 15),
                      doc('discord', 'build-4', at=NOW - 25 * 3600)])
yes('a quiet release, empty notes and the old nothing line are all posted; a day-old release is written down',
    sorted(done) == [('dev', 'build-2', 'post'), ('dev', 'build-3', 'post'), ('dev', 'build-4', 'old'), ('dev', 'build-5', 'post')]
    and len(w.posts) == 3 and all(t in state['said']['dev'] for t in ('build-2', 'build-3', 'build-4', 'build-5')))
yes('  each quiet one says various bug fixes and improvements',
    all(bot.news_post_parts('dev', doc('dev', t, body=b))['title'] == 'Various bug fixes and improvements'
        and bot.news_post_parts('dev', doc('dev', t, body=b))['description'] == ''
        for t, b in (('build-2', 'Various bug fixes and improvements\n'), ('build-3', ''), ('build-5', 'Nothing people would notice: every change in this release says none.'))))

# ---- the post --------------------------------------------------------------
p = bot.news_post_parts('dev', doc('dev', 'build-5', name='Forge fixes',
                                   body='- The forge lists each ingot once.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_'))
yes('notes with no headline are titled by the Release\'s own name, blue, with no Claude Code footer',
    p['title'] == 'Forge fixes' and p['color'] == 5477574 and p['footer'] == 'Dev server \u00b7 build 5'
    and p['description'] == '- The forge lists each ingot once.' and p['author'] == 'Thornswood dev')
p = bot.news_post_parts('dev', doc('dev', 'build-1.3.50', name='Release build-1.3.50',
                                   body='React to the rules to get in\n- Reacting gives Member.'),
                        ['game server', 'launcher'])
yes('a dev post is titled by the note\'s headline, not "Dev build: Release build-1.3.50"',
    p['title'] == 'React to the rules to get in' and p['description'] == '- Reacting gives Member.')
yes('  and its footer says where, what and the build, "build" once',
    p['footer'] == 'Dev server \u00b7 game server, launcher \u00b7 build 1.3.50'
    and p['footer'].lower().count('build') == 1)
yes('  and carries the time it was deployed, as the October posts did', p['at'] == NOW - 60)
p = bot.news_post_parts('main', doc('main', 'build-1.3.20', name='Release build-1.3.20', body='- A line.'))
yes('a main post is gold, says Main Server, and with no headline is the quiet title',
    p['title'] == 'Various bug fixes and improvements' and p['color'] == 13214795
    and p['author'] == 'Thornswood' and p['footer'] == 'Main Server \u00b7 build 1.3.20')
long = '\n'.join('- line %d of the notes' % i for i in range(400))
p = bot.news_post_parts('dev', doc('dev', 'build-6', body=long))
yes('long notes are cut at a line, under Discord\'s 4096', len(p['description']) <= 4004
    and p['description'].endswith('\n...') and '\n- line' in p['description'])

# ---- what a Release carries, from GitHub (release_about) --------------------
API = bot.GITHUB_API + '/repos/' + bot.KNOWN_REPO
BODY = ('## What changed\n\nWords.\n\n## Release note\n\n<!-- say it -->\n\n'
        'Release note: %s\n%s\n\n## Before you send it\n')
ANSWERS = {
    API + '/releases?per_page=100': [{'tag_name': 'build-1.3.51', 'draft': True},
                                     {'tag_name': 'build-1.3.49', 'draft': False},
                                     {'tag_name': 'build-1.3.48', 'draft': False},
                                     {'tag_name': 'main-build-1.3.20', 'draft': False}],
    API + '/compare/build-1.3.49...build-1.3.50': {'commits': [
        {'commit': {'message': 'Refuse an empty voice address (#5924)\n\nmore'}},
        {'commit': {'message': 'React to the rules for Member (#5934)'}},
        {'commit': {'message': 'Merge branch x'}},
        {'commit': {'message': 'Forge prices (#5940)'}}]},
    API + '/pulls/5924': {'body': BODY % ('none', '')},
    API + '/pulls/5924/files?per_page=100&page=1': [{'filename': 'scripts/deploy/Install-Voice.ps1'},
                                                    {'filename': 'voice/voice-server.js'}],
    API + '/pulls/5934': {'body': BODY % ('React to the rules to get in', '- Reacting gives Member.')},
    API + '/pulls/5934/files?per_page=100&page=1': [{'filename': 'bot/bot_rules_gate.py'},
                                                    {'filename': 'site/data/site/privacy.md'},
                                                    {'filename': 'docs/systems/discord.md'},
                                                    {'filename': 'tests/test-member-role-wording.js'}],
    API + '/pulls/5940': {'body': BODY % ('The forge shows the price', '- Each metal and how much.')},
    API + '/pulls/5940/files?per_page=100&page=1': [{'filename': 'game/gamemode/forge.ts'},
                                                    {'filename': 'launcher/app/News.cs'},
                                                    {'filename': 'bot/content.py'}],
}
asked = []


def fake_get(url):
    asked.append(url)
    return ANSWERS[url]


info = bot.release_about('build-1.3.50', get=fake_get)
yes('release_about reads the merges since the published build before it, not a draft',
    API + '/compare/build-1.3.49...build-1.3.50' in asked)
yes('  the build changes touched the game server, the launcher, voice and Discord',
    info['areas'] == ['game server', 'launcher', 'voice', 'Discord'])
yes('  the change that touched only the bot, the site, docs and tests is a Main Server change, with its note',
    info['live'] == [(5934, ('React to the rules to get in', ['- Reacting gives Member.']), ['site', 'Discord'])])
yes('  a tag that is not a build Release is not read', bot.release_about('main-build-1.3.20', get=fake_get) is None)
yes('a Main Server change is only the bot or the site, with docs and tests beside',
    bot.is_main_server_change(['bot/bot.py', 'docs/x.md']) and bot.is_main_server_change(['site/lib/x.js'])
    and not bot.is_main_server_change(['bot/bot.py', 'scripts/x.ps1'])
    and not bot.is_main_server_change(['docs/x.md', 'tests/y.js']) and not bot.is_main_server_change([]))
ms = json.load(open(os.path.join(os.path.dirname(HERE), 'scripts', 'release', 'main-server-paths.json')))
yes('  the same paths Collect-ReleaseNotes.ps1 reads',
    sorted(ms['live']) == sorted(p for p, a in bot.AREAS if a in bot.LIVE_AREAS)
    and tuple(ms['neutral']) == bot.NEUTRAL)
p = bot.main_server_parts(info['live'][0][1], info['live'][0][2], NOW)
yes('a Main Server post is gold, titled by its headline, and labelled Main Server',
    p['title'] == 'React to the rules to get in' and p['description'] == '- Reacting gives Member.'
    and p['footer'] == 'Main Server \u00b7 site, Discord' and p['color'] == 13214795)


def about_of(table):
    async def about(tag):
        return table.get(tag)
    return about


state, w = {}, World()
done = asyncio.run(bot.news_once(state, [doc('discord', 'build-1.3.50', body='Voice\n- A line.', at=NOW - 30)],
                                 w.send, w.save, now=NOW, about=about_of({'build-1.3.50': info})))
yes('a pass posts the dev release with its areas, and its Main Server change in #news',
    [c for c, _p in w.posts] == ['dev', 'main'] and 'game server' in w.posts[0][1]['footer']
    and w.posts[1][1]['footer'].startswith('Main Server') and ('main-server', '#5934', 'post') in done)
asyncio.run(bot.news_once(state, [doc('site', 'build-1.3.50', at=NOW - 20)], w.send, w.save, now=NOW,
                          about=about_of({'build-1.3.50': info})))
yes('  and posts neither again', len(w.posts) == 2)
state, w = {}, World()
w.down.add('main')
asyncio.run(bot.news_once(state, [doc('dev', 'build-1.3.50', at=NOW - 30)], w.send, w.save, now=NOW,
                          about=about_of({'build-1.3.50': info})))
yes('a Main Server post that fails is tried again next pass',
    'build-1.3.50' not in state['said'].get('live', {}))
w.down.clear()
asyncio.run(bot.news_once(state, [doc('dev', 'build-1.3.50', at=NOW - 30)], w.send, w.save, now=NOW,
                          about=about_of({'build-1.3.50': info})))
yes('  and goes when it can', [c for c, _p in w.posts] == ['dev', 'main'] and 'build-1.3.50' in state['said']['live'])
state, w = {}, World()
asyncio.run(bot.news_once(state, [doc('dev', 'build-1.3.50', at=NOW - 30)], w.send, w.save, now=NOW,
                          about=about_of({})))
yes('when GitHub cannot say, the dev post goes with no areas and the Main Server changes wait',
    [c for c, _p in w.posts] == ['dev'] and w.posts[0][1]['footer'] == 'Dev server \u00b7 build 1.3.50'
    and 'build-1.3.50' not in state['said'].get('live', {}))
state, w = {}, World()
asyncio.run(bot.news_once(state, [doc('dev', 'build-1.3.50', at=NOW - 25 * 3600)], w.send, w.save, now=NOW,
                          about=about_of({'build-1.3.50': info})))
yes('a day-old release posts no Main Server change', not w.posts
    and state['said']['live']['build-1.3.50']['how'] == 'old')

# ---- a post that fails -----------------------------------------------------
state, w = {}, World()
w.down.add('dev')
done = run(state, w, [doc('dev', 'build-7', at=NOW - 30), doc('dev', 'build-8', at=NOW - 20),
                      doc('main', 'build-6', at=NOW - 10)])
yes('a failed post waits with the ones after it, and the other channel goes on',
    done == [('main', 'build-6', 'post')] and 'build-7' not in state['said'].get('dev', {}))
w.down.clear()
done = run(state, w, [doc('dev', 'build-7', at=NOW - 30), doc('dev', 'build-8', at=NOW - 20)])
yes('next pass they go, in order', done == [('dev', 'build-7', 'post'), ('dev', 'build-8', 'post')])

# ---- the record keeps the newest -------------------------------------------
state, w = {'said': {'dev': dict(('old-%d' % i, {'at': i}) for i in range(bot.NEWS_KEEP))}}, World()
run(state, w, [doc('dev', 'build-9')])
yes('the record keeps the newest 200 a channel', len(state['said']['dev']) == bot.NEWS_KEEP
    and 'build-9' in state['said']['dev'] and 'old-0' not in state['said']['dev'])

# ---- started, by id --------------------------------------------------------
src = harness_bot.source()
yes('the loop is started with the others', 'asyncio.create_task(watch_release_news())' in src)
yes('dev news goes to the id in dev-channel.txt',
    bot.DEV_NEWS_ID == int(open(os.path.join(HERE, 'dev-channel.txt')).read().strip()))
# #news was named by no file until 9 Nov, so no main release was ever posted.
yes('main news goes to the id in news-channel.txt, which is there',
    bot.MAIN_NEWS_ID != 0 and bot.MAIN_NEWS_ID == int(open(os.path.join(HERE, 'news-channel.txt')).read().strip()))
yes('the folder is the one the agent writes', bot.NEWS_DIR == r'C:\Thornswood-Deploys\for-bot'
    or os.environ.get('THORNSWOOD_NEWS_DIR'))

print()
print('%d failed' % len(FAIL) if FAIL else 'all passed')
sys.exit(1 if FAIL else 0)
