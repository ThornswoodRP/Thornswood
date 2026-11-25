"""The real startup panel helper against required-tag forum refusals.

No Discord connection, report filing or live channel writes. The final case
also runs discord.py's actual create_thread serializer up to a local HTTP
capture, so a stand-in cannot silently accept a tag name instead of its ID.
"""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401
import asyncio
import tempfile
from types import SimpleNamespace as NS

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ['PROBLEM_CHANNEL'] = 'test-findings'
os.environ['GITHUB_TOKEN_FILE'] = ''
os.environ.pop('GITHUB_TOKEN', None)
PRIVATE = tempfile.TemporaryDirectory(prefix='tw5241-')
os.environ['THORNSWOOD_BOT_DATA'] = PRIVATE.name
import discord  # noqa: E402
import harness_bot  # noqa: E402
bot = harness_bot.whole()
LOG = []
bot.log = lambda *parts: LOG.append(' '.join(map(str, parts)))
bot.client = NS(user=NS(id=50))
passed = failed = 0


def yes(name, ok):
    global passed, failed
    print(('PASS ' if ok else 'FAIL ') + name)
    if ok:
        passed += 1
    else:
        failed += 1


def refusal(code, message, status=400):
    return discord.HTTPException(NS(status=status, reason=message),
                                 {'code': code, 'message': message})


def tag(tid, name):
    return discord.ForumTag.from_data(state=None, data={
        'id': str(tid), 'name': name, 'moderated': False,
        'emoji_id': None, 'emoji_name': None})


class Message:
    def __init__(self, content, owner=50):
        self.content, self.author = content, NS(id=owner)
        self.components = [NS(children=[NS(custom_id='thornswood:problem')])]
        self.edits = []
        self.thread = None

    async def edit(self, **kw):
        if self.thread and self.thread.archived:
            raise refusal(50083, 'Thread is archived')
        self.edits.append(kw)
        self.content = kw.get('content', self.content)


class Thread:
    def __init__(self, tid, message, owner=50, archived=False):
        self.id, self.owner_id, self.message = tid, owner, message
        self.archived, self.flags, self.edits = archived, NS(pinned=False), []
        self.message.thread = self

    async def fetch_message(self, mid):
        assert mid == self.id
        return self.message

    async def edit(self, **kw):
        self.edits.append(kw)
        self.archived = kw.get('archived', self.archived)
        self.flags.pinned = kw.get('pinned', self.flags.pinned)


class Forum:
    name, type = 'test-findings', discord.ChannelType.forum

    def __init__(self, required=True, tags=None):
        self.flags = discord.ChannelFlags()
        self.flags.require_tag = required
        self.available_tags = [tag(101, 'Main'), tag(202, 'Dev')] if tags is None else tags
        self.threads, self.archived, self.calls = [], [], []
        self.deny = False

    async def archived_threads(self, limit=None):
        assert limit is None
        for th in self.archived:
            yield th

    async def create_thread(self, **kw):
        self.calls.append(kw)
        applied = kw.get('applied_tags', [])
        if self.flags.require_tag and not applied:
            raise refusal(40067, 'A tag is required to create a forum post in this channel')
        if any(not isinstance(t, discord.ForumTag) or t not in self.available_tags for t in applied):
            raise refusal(40066, 'Invalid forum tag')
        if self.deny:
            raise refusal(50013, 'Missing Permissions', 403)
        th = Thread(500, Message(kw['content']))
        self.threads.append(th)
        return NS(thread=th)


async def ensure(ch):
    await bot.ensure_problem_panel(NS(name='Fixture guild', channels=[ch]))


async def main():
    required = Forum()
    try:
        await required.create_thread(name='Counterfactual', content='x')
    except discord.HTTPException as e:
        yes('the forum fixture actually rejects untagged creation with Discord40067', e.code == 40067)
    required.calls.clear()
    await ensure(required)
    yes('required-tag creation uses one actual available tag in configured order',
        len(required.calls) == 1 and required.calls[0].get('applied_tags') == required.available_tags[:1])
    yes('the startup panel is created with its real content and persistent button',
        len(required.threads) == 1 and required.threads[0].message.content == bot.PROBLEM_PANEL
        and required.calls[0]['view'].timeout is None
        and required.calls[0]['view'].children[0].custom_id == 'thornswood:problem')
    yes('the new panel is pinned and success is logged only after posting',
        bool(required.threads) and required.threads[0].flags.pinned
        and any('posted and pinned' in line for line in LOG))
    before = len(required.calls)
    await ensure(required)
    yes('a second start reuses the existing current panel instead of duplicating it',
        len(required.calls) == before and len(required.threads) == 1
        and any('already current' in line for line in LOG))

    archived = Forum()
    old = Thread(100, Message(bot.PROBLEM_PANEL), archived=True)
    other = Thread(99, Message(bot.PROBLEM_PANEL, owner=70), owner=70, archived=True)
    archived.archived = [other, old]
    await ensure(archived)
    yes('a current archived owned panel is reopened and pinned without a new post',
        not archived.calls and old.message.content == bot.PROBLEM_PANEL
        and not old.archived and old.flags.pinned and not other.edits)

    outdated = Forum()
    previous = Thread(101, Message('Old wording'))
    outdated.threads = [previous]
    await ensure(outdated)
    yes('an outdated open panel is edited and pinned without creating a duplicate',
        not outdated.calls and previous.message.content == bot.PROBLEM_PANEL and previous.flags.pinned)

    optional = Forum(required=False)
    await ensure(optional)
    yes('optional-tag forums keep the existing untagged behavior',
        len(optional.threads) == 1 and not optional.calls[0].get('applied_tags'))

    optional_empty = Forum(required=False, tags=[])
    await ensure(optional_empty)
    yes('a forum with optional tags does not need any available tag', len(optional_empty.threads) == 1)

    empty = Forum(tags=[])
    LOG.clear()
    await ensure(empty)
    yes('a required forum with no available tag is refused before creation', not empty.calls)
    yes('the missing-tag refusal tells staff which setting to repair',
        any('#test-findings' in line and 'tag' in line and 'available' in line for line in LOG)
        and not any('posted and pinned' in line for line in LOG))

    denied = Forum()
    denied.deny = True
    LOG.clear()
    await ensure(denied)
    yes('another Discord refusal remains visible and never claims success',
        not denied.threads and any('Missing Permissions' in line for line in LOG)
        and not any('posted and pinned' in line for line in LOG))

    class Text:
        name, type = 'test-findings', discord.ChannelType.text
        def __init__(self):
            self.messages = []
        async def history(self, limit):
            assert limit == 50
            for message in self.messages:
                yield message
        async def send(self, content, **kw):
            self.messages.append(Message(content))
    text = Text()
    await ensure(text)
    await ensure(text)
    yes('text-channel configuration still posts once and reuses the existing panel',
        len(text.messages) == 1 and text.messages[0].content == bot.PROBLEM_PANEL)

    class Wire:
        payload = None
        async def start_thread_in_forum(self, channel_id, *, params, reason):
            self.payload = params.payload
            raise RuntimeError('fixture stops at captured SDK HTTP boundary; no network')
    class SdkForum(Forum):
        id, default_auto_archive_duration = 42, 1440
        async def create_thread(self, **kw):
            return await discord.ForumChannel.create_thread(self, **kw)
    wire = Wire()
    sdk = SdkForum()
    sdk._state = NS(allowed_mentions=None, http=wire)
    await ensure(sdk)
    yes('actual discord.py serializes the selected available tag ID on the wire',
        wire.payload is not None and wire.payload.get('applied_tags') == ['101'])
    yes('actual SDK request retains panel content, button and suppressed mentions',
        wire.payload is not None and wire.payload['message']['content'] == bot.PROBLEM_PANEL
        and wire.payload['message']['components'][0]['components'][0]['custom_id'] == 'thornswood:problem'
        and wire.payload['message']['allowed_mentions']['parse'] == [])


try:
    asyncio.run(main())
finally:
    PRIVATE.cleanup()
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
