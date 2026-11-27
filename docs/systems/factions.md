# Factions and businesses

A book a group keeps together. It is a tab on J, beside the personal
journals on [Journals](journal.md). It is not a page in those
journals, and it does not count toward the 12.

It is not the [Free Skyrim Trading Company](trading-company.md) and
it is not a hold's [Merchant's Guild](merchants-guild.md). Those have
their own purposes. The Merchant's Guild is the NPC traders and cannot
be joined. This book is the group's prices,
its people, and a place to talk when they are not standing together.

The book is kept by the server for the group. It is not stored on one
character. It survives a restart, and it is still there when the
owner is away.

## Who can see the tab

The tab is not drawn at all unless one of these is true.

- The Discord account holds Business Owner, or a faction's Leader role.
- This character has been invited into a faction or a business, and
  has accepted.
- The Discord account is staff.

Staff are the roles the server already uses for a staff seat: Owner,
Gamemaster, Dev, Loremaster, Moderator.

Anyone else never sees the tab. There is no empty page and no locked
row.

## Named factions

There are sixteen factions, each with a Leader role in Discord (the
faction's short name and "Leader", such as Companions Leader) and a
member role the Leader gives from the faction panel in that faction's
own seats channel, such as #companions-seats. The
names live in `bot/factions.json`, and each one's place in 4E 252 is
in `lore/factions.md`. Applying is Apply: Faction Leader in Discord.
Accepting one gives that faction's Leader role, which is already
there: the application does not make a new Discord role. A faction has
one leader.
No GM or staff member (Loremaster, Discord Moderator, or any other staff role) may hold an in-game RP role with faction leadership, such as a Jarl or a faction lead.
A new faction comes only through that application, as Other, and gets
its Leader role the same way.

Each faction has one book, and it is its Leader's (#3317, Patrick, 22
Oct). Whoever holds the faction's Leader role in Discord owns the
book. When the role goes to somebody else, the book goes with it: the
first time one of the new Leader's characters opens J, they are put in
the book as its owner. The old Leader stays a member until the new one
removes them. Staff do not hand a faction's book on; giving the role
in Discord is how it moves. While two accounts hold the same Leader
role, neither owns the book, as with a Jarl role two accounts hold.

## Founding one

Business Owner may found one business, and name it. A second is
refused. Founding is on the account, so another character on the
same account does not get a second book. Any character on that
account can open the book as its owner.

A faction's Leader may found that faction's book, and name it, once.
A second book for the same faction is refused. Somebody who leads two
factions may found one for each.

On the tab: type the name, then New business or New faction. A Dev
may found one business without holding Business Owner. A faction's
book needs its Leader role, whoever founds it, Dev or staff included.
Any other staff seat can found a business only when they also hold
Business Owner. They do not need a role to open a book that already
exists.

## Roles

The founder is the owner inside the book. The owner makes the roles
and sets what each role may do. A member cannot take the owner's
permissions away.

| Permission | What it allows |
| --- | --- |
| Read | The price list, the people, and the chat |
| Prices | Add, change, and remove a price line |
| Invite | Invite someone, and remove someone who is not the owner |
| Roles | Make a role, rename it, and set its permissions |
| Speak | Write in the group's chat |

A person who just accepted is on a role called Member. Member starts
with Read and Speak. The owner changes that on the tab: each role is
a row, and each permission on it is a button that is lit while the
role holds it. New role and Rename role are beside them. Prices,
invites, and roles are the tab, and nothing in the book is typed into
the chat.

The owner can rename the book. The owner can disband it. A member
can leave.

Staff have every permission on every book, including a book they were
not invited to. Staff can rename, remove someone, disband, and hand a
business to a character who is already a member. A faction's book is
not handed on: it moves with its Leader role. Removing someone from
the book does not take a Discord role off the account.

When somebody's account is deleted at their request, the game lets go of
their characters at its next start (#2351): they leave every book, the
lines they wrote in a book's chat go, and a business one of them owns
is disbanded. Staff who are told the group wants to keep it hand it to
another member first. A faction's book stays, with no owner, until
whoever holds its Leader role next opens it.

## The price list

Each line is a name they type, a buy price, and a sell price. A blank
buy means the group does not buy it. A blank sell means they do not
sell it. A price is a whole number of gold. 0 is free.

100 lines. A 101st is refused.

The list does not move gold and it does not move items. A sale is
still a [trade](trade.md), or coin handed over. The list is what they
posted, so a customer can read it when they have been invited, and so
the group can agree a price before anyone meets.

Someone with the Prices permission can submit the list at a hold's
drop box. The box is on [Property](property.md). The submission is a
copy. The book stays in the journal. A later submission from the
same book replaces the earlier one in that hold. The
[Merchant's Guild](merchants-guild.md) of that hold averages the
copies it has, and its traders buy and sell at that average. A book
can be submitted to more than one hold. Each hold keeps its own copy.

## The people

40 members, counting the owner. A 41st accept is refused.

Each row is the character, their role, whether they are in the world,
and the last time that character left the world. In the world, the
row says they are here. Away, it says when they left. A character who
has never left yet has no time on the row.

Online is the same fact a friend list already uses: they are in the
world right now. Last played is new. It is a time, not a place.

You invite the character in front of you, or by name. Open J while
looking at them, and the tab has Invite with their name on it. The
name field beside it is for someone in the world who is not in front
of you. The offer stands for 45 seconds. It comes up on their P
prompt, which names the book, with Accept and Refuse. Until they
accept, they do not see the tab.

Leave on the tab drops this character from that book.

A character may belong to more than one book. Founding is what the
Discord role caps, not membership.

## The chat

Each book has a text channel on the same tab. It is how the group
asks a question when they are not in the same place. It is out of
character. A line is drawn in brackets, the same way `/ooc` is, and
it does not happen in the world.

It does not float above a head. It does not use the local distances
on [Text chat](chat.md). Everyone in the group who is in the world
can read it, wherever they are standing. It is not voice.

The box on the tab is the only way in. A line typed into the world
chat never lands here.

A line longer than 300 characters is cut to 300. The last 50 lines
are kept, and they survive a restart, so a question is still there
when someone comes back.

Speak is the permission. Read is the permission for seeing them.
Staff can read and speak in every book's chat.

A personal text mute, on [Voice](voice.md), hides that person's lines
here too, for you only. A staff silence stops them writing here at
all, for everybody.

## Where this is

The tab, the price list, the group role, and the group chat are in
the server. Everything in the book is done on J: founding, the price
lines, the chat, inviting the person in front of you or by name,
setting a role's permissions, renaming a role, removing someone,
leaving, renaming and disbanding. The invite reads as one on the P
prompt (#1591). The panel sends the server a line for each button;
nobody is told to type it, and no help names it (#1630). The book is
kept for the group and survives a restart. The time a character last
left is kept too. J draws the tab only for
a Discord account that holds Business Owner or a faction's Leader
role, for a character who has accepted an invite, and for staff.

Someone with the Prices permission stands at that hold's notice
board, which is the drop box, and submits a copy of the list. The book stays in the journal. A later
submission from the same book replaces the earlier one in that hold.
Each hold keeps its own copy. The average of those copies is what
that hold's traders would charge. Each trader buys and sells from
their own purse, so they buy only as much as their gold covers: see
[The trader's purse](merchants-guild.md#the-traders-purse) on the
Merchant's Guild page.

Staff seats read Owner, Gamemaster, Dev, Loremaster, and Moderator
off the Discord account. Business Owner and the faction Leader roles
are read the same way; the site sends each Leader role with the
profiles of the account that holds it (`factionLeaderProfiles`), and
leaves out a Leader role two accounts hold. A Dev may found one
business. Any other staff seat founds a business only when the
account also holds Business Owner. One business is capped on the
account, and one book on each faction.
