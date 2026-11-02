"""
test-site-links.py

Every site address a Discord post names is one people can click (#3317).

Patrick, 22 Oct 2026, of the welcome post's "Everything else" lines: the
thornswood.net/help, /known, /roadmap and /credits lines "are not linked".
Discord makes a link only of an address that starts with https:// (bare, in
<angle brackets>, or as a [label](target)), so "thornswood.net/help" was
plain text. This proves, for every post the build writes (drafts included) and the
bot's ticket panels:

  L1 no thornswood.net address without https:// in front of it
  L2 no [label](target) whose target is not an https:// address
  L3 the welcome's four site lines are links

content.py and bot.py are imported for real. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import re

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''  # nor the box admin service's (#5184)

import bot  # noqa: E402
import content as C  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


BARE = re.compile(r'(?<![\w/.])(?:www\.)?thornswood\.net\b')
MASKED = re.compile(r'\]\(<?([^)>]*)>?\)')

posts = dict(('DOCS ' + k, v) for k, v in C.DOCS.items())
posts['bot PANEL_ALPHA'] = bot.PANEL_ALPHA
posts['bot PANEL_OPEN'] = bot.PANEL_OPEN

for name, text in sorted(posts.items()):
    bare = [text[max(0, m.start() - 20):m.end() + 12].replace('\n', ' ')
            for m in BARE.finditer(text)
            if not text[:m.start()].endswith(('https://', 'http://'))]
    yes('L1 %s names no site address without https://%s'
        % (name, (': ' + ' | '.join(bare)) if bare else ''), not bare)
    loose = [t for t in MASKED.findall(text) if not t.startswith('https://')]
    yes('L2 %s has no masked link to a target Discord cannot open%s'
        % (name, (': ' + ', '.join(loose)) if loose else ''), not loose)

for page in ('help', 'known', 'roadmap', 'credits'):
    yes('L3 the welcome links https://thornswood.net/%s' % page,
        '<https://thornswood.net/%s>' % page in C.WELCOME)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
