"""
test-3457-doc-change-lines.py

    python tests/test-3457-doc-change-lines.py

Issue #3457: #3445 rewrote the join and rules pages, which #start-here,
#welcome, #faq and #game-rules are read out of, and added no change line for
them in bot/content.py. Its build was green, because the one check that a doc
has its line (Build-Discord.py, check_docs) ran only in the bot's harnesses,
and those need discord.py and run only at night. So main went red there and
the next Discord build would have refused to run.

The fingerprints live in content.py now (doc_print, unrecorded), which needs
nothing but the standard library, so this runs on every pull request and a
change to a doc's words without its line goes red on the change itself. The
nightly still runs check_docs over the build's own list of written channels
(bot/tests/test-3317-layout.py, bot/tests/test-3336-changelogs.py). It proves:
  - every doc that is not a draft has its change line today;
  - with the newest line of one doc taken off, unrecorded names that doc
    and the fingerprint its words have;
  - with a doc's words changed, unrecorded names it;
  - a doc with no changelog at all is named, and a draft never is;
  - check_docs asks content.py, and Build-Discord.py keeps no fingerprint of
    its own to drift from it.
Read only. Never connects to anything.
"""
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bot'))
os.environ.pop('THORNSWOOD_OPEN', None)
import content as C  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


live = sorted(k for k in C.DOCS if k not in C.DRAFTS)
missing = C.unrecorded(sorted(C.DOCS))
for key, fp in missing:
    print("      %s: add ('<YYYY-MM-DD>', '<what changed and why>', '%s') to the "
          "end of CHANGES['%s'] in bot/content.py" % (key, fp, key))
yes('every live doc has its change line (%d docs)' % len(live), missing == [] and len(live) > 0)

# Planted, in memory only: the file is never written.
key = 'WELCOME'
fp = C.doc_print(key)
saved = C.CHANGES[key]
try:
    C.CHANGES[key] = saved[:-1]
    yes('a doc whose newest line is taken off is named, with its words\' fingerprint',
        C.unrecorded([key]) == [(key, fp)])
    C.CHANGES[key] = saved[:-1] + [(saved[-1][0], saved[-1][1], '000000000000')]
    yes('a doc whose newest line is for other words is named',
        C.unrecorded([key]) == [(key, fp)])
    del C.CHANGES[key]
    yes('a doc with no changelog at all is named', C.unrecorded([key]) == [(key, fp)])
finally:
    C.CHANGES[key] = saved
yes('and with its line back it is not', C.unrecorded([key]) == [])

draft = C.DRAFTS[0]
yes('a draft (%s) is never named, line or not' % draft,
    draft not in C.CHANGES and C.unrecorded([draft]) == [])

yes('the fingerprint is twelve hex digits',
    len(fp) == 12 and all(c in '0123456789abcdef' for c in fp))

src = (ROOT / 'bot' / 'Build-Discord.py').read_text(encoding='utf-8')
start = src.index('def check_docs():')
body = src[start:src.index('\ndef ', start + 1)]
yes('check_docs asks content.py which docs have no line', 'C.unrecorded(' in body)
yes('Build-Discord.py keeps no fingerprint of its own',
    'def doc_print' not in src and 'def doc_texts' not in src and 'sha256' not in src)

print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
