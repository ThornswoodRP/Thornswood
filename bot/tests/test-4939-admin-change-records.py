"""Actual bot formatter for the site's admin audit rows; no Discord sends."""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
import harness_bot  # noqa: E402

bot = harness_bot.whole()
passed = failed = 0


def yes(name, okay):
    global passed, failed
    print(('PASS ' if okay else 'FAIL ') + name)
    if okay:
        passed += 1
    else:
        failed += 1


picture = '20261125-' + 'a' * 40 + '.png'
for did, words in [('docsave', 'saved page'),
                   ('inboxdismiss', 'marked inbox report not doing this:'),
                   ('inboxreopen', 'reopened inbox report'),
                   ('inboxdelete', 'deleted inbox report'),
                   ('uploaddelete', 'deleted upload')]:
    subject = picture if did == 'uploaddelete' else 'help' if did == 'docsave' else '4d33a687b49f4e6b80a67865c7cfb5ff'
    row = {'did': did, 'byName': 'Current Aela', 'whoName': subject}
    text = bot.moderation_text('site', row)
    yes(did + ' says action, verified actor and actual page/report/file subject',
        text is not None and '**Staff on the site:** Current Aela ' + words in text
        and subject in text and 'profile ' not in text)
    hostile = bot.moderation_text('site', {'did': did,
        'byName': '@everyone <@111111111111111111>',
        'whoName': '**[x](http://e.invalid).png @everyone'})
    yes(did + ' escapes names and cannot ping or format injected text',
        hostile is not None and '@everyone' not in hostile and '@\u200beveryone' in hostile
        and '<@111111111111111111>' not in hostile
        and '\\[x](http://e.invalid)' in hostile and '\\*\\*' in hostile)
    bounded = bot.moderation_text('site', {'did': did, 'byName': 'a' * 5000, 'whoName': 'b' * 5000})
    yes(did + ' stays within the existing message limit', bounded is not None and len(bounded) <= 1900)

actor_id = '111111111111111111'
text = bot.moderation_text('site', {'did': 'uploaddelete', 'phase': 'metadata',
    'byName': 'Current Aela', 'byId': actor_id, 'whoName': picture})
yes('upload listing cleanup has its own escaped action and does not print the private actor ID',
    text is not None and 'Current Aela removed the upload listing for ' + picture in text and actor_id not in text)

print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
