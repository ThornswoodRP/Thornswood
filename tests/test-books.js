/*
  test-books.js

  The faction and business book from docs/systems/factions.md, run as the
  real thornswoodBooks() taken out of game/gamemode.js. A book is kept for
  the group in the server's private folder (#2582). It is not a page on one
  character.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GM = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(GM, 'utf8').split(CR).join('');
const start = src.indexOf('/* BOOKS-START */');
const end = src.indexOf('/* BOOKS-END */');
const block = start >= 0 && end > start ? src.slice(start, end) : '';

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

yes('the book block is in gamemode.js', !!block && /function thornswoodBooks\(/.test(block));
yes('a book command is answered, and a plain line is not a book line',
    /if \(word === '\/book'\)/.test(src) && src.indexOf("word === '/book'") > 0);
yes('the price list never moves gold or an item', block.indexOf('addItem') < 0 && block.indexOf('removeItem') < 0);

// A faction's book is owned by whoever holds its Leader role (#3317), so the
// account that founds The North Gate holds North Gate Leader.
function rolesFor(pid) {
  pid = Number(pid);
  if (pid === 1 || pid === 2) {
    return { business: true, leads: ['North Gate Leader'], staff: false, account: 'discord-a' };
  }
  if (pid === 9) { return { business: false, leads: [], staff: true, account: 'discord-staff' }; }
  if (pid === 4) { return { business: false, leads: [], staff: false, account: 'discord-b' }; }
  return { business: false, leads: [], staff: false, account: 'p:' + pid };
}

function make(dir, extra) {
  extra = extra || {};
  const box = {
    globalThis: null,
    env: {
      fs: fs,
      path: path,
      privDir: dir,
      now: function () { return extra.now ? extra.now() : Date.now(); },
      roles: extra.roles || rolesFor,
      silenced: extra.silenced || function () { return false; },
      nameOf: function (actorId, pid) {
        if (extra.names && extra.names[pid]) { return extra.names[pid]; }
        if (Number(pid) === 1) { return 'Ada'; }
        if (Number(pid) === 4) { return 'Bjorn'; }
        return 'M' + pid;
      },
      find: extra.find || function (actorId, who) {
        const n = Number(who);
        if (!n) { return { actorId: 0, pid: 0, name: '', why: 'Nobody here by that name.' }; }
        return { actorId: 50 + n, pid: n, name: 'M' + n, why: '' };
      },
      offer: function () { return ''; },
      refresh: function () { extra.pushes = (extra.pushes || 0) + 1; },
      online: function () { return extra.online ? extra.online() : {}; },
      atBox: extra.atBox || function () { return ''; }
    }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(block + '\nthis.api = thornswoodBooks(env);', box, { filename: 'books.js' });
  return box.api;
}

function parts(line) { return line.trim().split(/\s+/); }

if (block) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-books-'));
  let clock = 1700000000000;
  const online = {};
  let hush = false;
  const api = make(dir, {
    now: function () { return clock; },
    online: function () { return online; },
    silenced: function (pid) { return hush && Number(pid) === 1; }
  });

  yes('someone with no role and no book never sees the tab',
      api.view(3, {}).show === false);

  const bizOnly = make(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-books-')), {
    roles: function () { return { business: true, leads: [], staff: false, account: 'discord-c' }; }
  });
  yes('Business Owner cannot found a faction: that needs a faction\'s Leader role',
      /holds its Leader role in Discord, and your Discord account holds none/.test(bizOnly.command({
        actorId: 1, profileId: 5, parts: parts('/book new faction The North Gate')
      })));
  const noRole = make(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-books-')), {
    roles: function () { return { staff: true, business: false, leads: [], account: 'discord-staff' }; }
  });
  yes('staff without the Discord role cannot found a book',
      /does not hold Business Owner/.test(noRole.command({
        actorId: 1, profileId: 9, parts: parts('/book new business The Bee')
      })));
  const asDev = make(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-books-')), {
    roles: function () { return { staff: true, dev: true, business: false, leads: [], account: 'discord-dev' }; }
  });
  const devBefore = asDev.view(9, {});
  yes('a Dev may start one business, and no faction without its Leader role',
      devBefore.show === true && devBefore.canBusiness === true && devBefore.canFaction === false);
  yes('a Dev founds a business without Business Owner',
      asDev.command({ actorId: 1, profileId: 9, parts: parts('/book new business The Bee') }) === 'Founded The Bee.');
  yes('a Dev does not found a faction: a faction\'s book is its Leader\'s',
      /your Discord account holds none/.test(
        asDev.command({ actorId: 1, profileId: 9, parts: parts('/book new faction The North Gate') })));
  const devAfter = asDev.view(9, {});
  yes('a Dev who already has a business cannot found another',
      devAfter.canBusiness === false && devAfter.canFaction === false);
  yes('a second business from a Dev is refused',
      asDev.command({ actorId: 1, profileId: 9, parts: parts('/book new business Another Bee') }) === 'This account already has a business.');

  const founded = api.command({
    actorId: 1, profileId: 1, parts: parts('/book new business The Bee')
  });
  yes('a business is founded and named', founded === 'Founded The Bee.');
  const again = api.command({
    actorId: 2, profileId: 2, parts: parts('/book new business The Other Bee')
  });
  yes('a second business on the same account is refused',
      again === 'This account already has a business.');
  const faction = api.command({
    actorId: 1, profileId: 1, parts: parts('/book new faction The North Gate')
  });
  yes('the North Gate Leader founds its book as well',
      faction === 'Founded The North Gate.');
  yes('the book names the Leader role it follows',
      api.books().filter(function (b) { return b.name === 'The North Gate'; })[0].leader === 'North Gate Leader');
  const factionAgain = api.command({
    actorId: 1, profileId: 1, parts: parts('/book new faction Another Gate')
  });
  yes('a second book for the same faction is refused', factionAgain === 'Your faction already has its book.');

  const mine = api.view(1, {});
  yes('the founder sees the tab and both books, and cannot found another',
      mine.show === true && mine.books.length === 2 &&
      mine.canBusiness === false && mine.canFaction === false);
  const bee = mine.books.filter(function (b) { return b.name === 'The Bee'; })[0];
  yes('the founder is the owner and Member starts with read and speak',
      !!bee && bee.owner === true && bee.read === true && bee.speak === true &&
      bee.canPrices === true && bee.people.length === 1 && bee.people[0].role === 'Owner');
  const alt = api.view(2, {});
  const altBee = alt.books.filter(function (b) { return b.name === 'The Bee'; })[0];
  yes('another character on the account opens the book as its owner',
      alt.show === true && !!altBee && altBee.owner === true);

  yes('a stranger still does not see the tab before they accept',
      api.view(4, {}).show === false);
  const asked = api.command({
    actorId: 1, profileId: 1, parts: parts('/book invite ' + bee.id + ' 4')
  });
  yes('an invite names the 45 seconds', /45 seconds/.test(asked));
  yes('until they accept they still do not see the tab', api.view(4, {}).show === false);
  clock += 45001;
  const late = api.accept(4, 'Bjorn');
  yes('an invite dies after 45 seconds', late.ok === false && /gone/.test(late.text));
  clock -= 45001;
  api.command({ actorId: 1, profileId: 1, parts: parts('/book invite ' + bee.id + ' 4') });
  clock += 45000;
  const joined = api.accept(4, 'Bjorn');
  yes('accepting within 45 seconds puts them in the book',
      joined.ok === true && joined.text === 'You joined The Bee.');
  const memberView = api.view(4, {});
  const memberBee = memberView.books.filter(function (b) { return b.name === 'The Bee'; })[0];
  yes('a new member has read and speak, and not prices',
      memberView.show === true && !!memberBee && memberBee.read === true &&
      memberBee.speak === true && memberBee.canPrices === false && memberBee.owner === false);

  const refusedPrice = api.command({
    actorId: 4, profileId: 4,
    parts: parts('/book price ' + bee.id + ' | Iron dagger | 12 | -')
  });
  yes('prices are refused without the permission', /cannot set prices/.test(refusedPrice));
  const set = api.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + bee.id + ' | Iron dagger | 12 | -')
  });
  yes('a blank sell is kept and does not have to be a number', /Set Iron dagger/.test(set));
  const free = api.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + bee.id + ' | Water | 0 | 0')
  });
  yes('zero gold is free and is kept', /Set Water/.test(free));
  const bad = api.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + bee.id + ' | Mead | 1.5 | 2')
  });
  yes('a price has to be a whole number', /whole number/.test(bad));
  const priced = api.view(1, {}).books.filter(function (b) { return b.id === bee.id; })[0];
  const dagger = priced.priceList.filter(function (p) { return p.name === 'Iron dagger'; })[0];
  const water = priced.priceList.filter(function (p) { return p.name === 'Water'; })[0];
  yes('buy 12 and a blank sell are stored, and zero is stored as zero',
      dagger.buy === 12 && dagger.sell === null && water.buy === 0 && water.sell === 0);
  const submitted = api.command({
    actorId: 1, profileId: 1, parts: parts('/book submit ' + bee.id)
  });
  const afterSubmit = api.books().filter(function (b) { return b.id === bee.id; })[0];
  yes('submitting away from a box is refused and the list stays',
      /Stand at the hold/.test(submitted) && afterSubmit.prices.length === 2);

  for (let n = 0; n < 98; n++) {
    api.command({
      actorId: 1, profileId: 1,
      parts: parts('/book price ' + bee.id + ' | Line ' + n + ' | 1 | 1')
    });
  }
  const fullList = api.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + bee.id + ' | One more | 1 | 1')
  });
  yes('the 101st price line is refused', fullList === 'The list is full. 100 lines.');

  const said = api.command({
    actorId: 1, profileId: 1, parts: parts('/book say ' + bee.id + ' ' + 'where is the gate')
  });
  yes('a line goes into the book', said === 'Said in The Bee.');
  const long = api.command({
    actorId: 1, profileId: 1, parts: parts('/book say ' + bee.id + ' ' + 'x'.repeat(301))
  });
  yes('a long line is cut to 300', /Said in/.test(long));
  const storedChat = api.books().filter(function (b) { return b.id === bee.id; })[0].chat;
  yes('the stored line is 300 characters',
      storedChat[storedChat.length - 1].text.length === 300);
  api.command({
    actorId: 4, profileId: 4, parts: parts('/book say ' + bee.id + ' bring iron')
  });
  const heard = api.view(1, {}).books.filter(function (b) { return b.id === bee.id; })[0];
  const hidden = api.view(1, { 4: true }).books.filter(function (b) { return b.id === bee.id; })[0];
  const bjornLine = heard.chat.filter(function (c) { return c.text === 'bring iron'; });
  const hiddenLine = hidden.chat.filter(function (c) { return c.text === 'bring iron'; });
  yes('a personal text mute hides that line for you only',
      bjornLine.length === 1 && hiddenLine.length === 0 &&
      hidden.chat.length === heard.chat.length - 1);
  const drawn = heard.chat[heard.chat.length - 1];
  yes('the line is out of character text kept on the book, not a place',
      drawn.name === 'Bjorn' && drawn.text === 'bring iron');
  hush = true;
  const hushed = api.command({
    actorId: 1, profileId: 1, parts: parts('/book say ' + bee.id + ' I will shout')
  });
  hush = false;
  yes('staff silence stops a line for everybody',
      /silenced/.test(hushed) &&
      api.books().filter(function (b) { return b.id === bee.id; })[0].chat
        .filter(function (c) { return c.text === 'I will shout'; }).length === 0);

  for (let n = 0; n < 48; n++) {
    api.command({
      actorId: 1, profileId: 1, parts: parts('/book say ' + bee.id + ' line ' + n)
    });
  }
  const kept = api.books().filter(function (b) { return b.id === bee.id; })[0].chat;
  yes('only the last 50 lines are kept', kept.length === 50 && kept[0].text !== 'where is the gate');

  online[1] = 'Ada';
  api.noteTick();
  const never = api.view(4, {}).books.filter(function (b) { return b.id === bee.id; })[0];
  const bjornRow = never.people.filter(function (p) { return p.name === 'Bjorn'; })[0];
  yes('someone who has never left has no time on the row',
      !!bjornRow && bjornRow.on === false && bjornRow.left === 0);
  online[4] = 'Bjorn';
  api.noteTick();
  delete online[4];
  clock += 5000;
  api.noteTick();
  const away = api.view(1, {}).books.filter(function (b) { return b.id === bee.id; })[0];
  const awayBjorn = away.people.filter(function (p) { return p.name === 'Bjorn'; })[0];
  const adaRow = away.people.filter(function (p) { return p.name === 'Ada'; })[0];
  yes('leaving writes a time, and someone still here has none',
      awayBjorn.left === clock && adaRow.on === true && adaRow.left === 0);

  const api2 = make(dir, { now: function () { return clock; } });
  const back = api2.view(1, {}).books.filter(function (b) { return b.name === 'The Bee'; })[0];
  yes('the book, the prices and the chat survive a new load',
      !!back && back.priceList.length === 100 && back.chat.length === 50);
  const backBjorn = back.people.filter(function (p) { return p.name === 'Bjorn'; })[0];
  yes('the last time they left survives too', backBjorn.left === clock);

  const staffView = api.view(9, {});
  yes('staff see a book they were not invited to',
      staffView.show === true &&
      staffView.books.filter(function (b) { return b.name === 'The Bee'; }).length === 1);
  const handed = api.command({
    actorId: 9, profileId: 9, parts: parts('/book give ' + bee.id + ' | Bjorn')
  });
  yes('staff can hand the book to someone already in it', /Bjorn owns The Bee/.test(handed));
  const afterHand = api.books().filter(function (b) { return b.id === bee.id; })[0];
  yes('ownership moves to that character\'s account',
      afterHand.owner === 4 && afterHand.account === 'discord-b');
  const foundedAfter = api.command({
    actorId: 1, profileId: 1, parts: parts('/book new business The Second Bee')
  });
  yes('the old account can found again once the book has moved',
      foundedAfter === 'Founded The Second Bee.');

  for (let n = 10; n < 48; n++) {
    api.command({ actorId: 4, profileId: 4, parts: parts('/book invite ' + bee.id + ' ' + n) });
    api.accept(n, 'M' + n);
  }
  const packed = api.books().filter(function (b) { return b.id === bee.id; })[0];
  const overflowAsk = api.command({
    actorId: 4, profileId: 4, parts: parts('/book invite ' + bee.id + ' 70')
  });
  yes('the 41st person is refused',
      packed.members.length === 40 && /full/.test(overflowAsk));

  const left = api.command({ actorId: 10, profileId: 10, parts: parts('/book leave ' + bee.id) });
  yes('a member can leave, and the book name is in the answer', left === 'You left The Bee.');
  const ownerLeave = api.command({
    actorId: 4, profileId: 4, parts: parts('/book leave ' + bee.id)
  });
  yes('the owner is told to disband rather than leave', /disbands/.test(ownerLeave));

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }

  const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-books-'));
  let hold = '';
  const ledger = make(ledgerDir, {
    roles: function (pid) {
      if (Number(pid) === 1) {
        return { business: true, leads: ['Gate Leader'], staff: false, account: 'ledger-a' };
      }
      if (Number(pid) === 2) {
        return { business: true, leads: [], staff: false, account: 'ledger-b' };
      }
      if (Number(pid) === 4) {
        return { business: false, leads: [], staff: false, account: 'ledger-c' };
      }
      return { business: false, leads: [], staff: false, account: 'p:' + pid };
    },
    atBox: function () { return hold; }
  });
  ledger.command({ actorId: 1, profileId: 1, parts: parts('/book new business The Bee') });
  ledger.command({ actorId: 2, profileId: 2, parts: parts('/book new business The Other') });
  const beeId = ledger.books().filter(function (b) { return b.name === 'The Bee'; })[0].id;
  const otherId = ledger.books().filter(function (b) { return b.name === 'The Other'; })[0].id;
  ledger.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + beeId + ' | Iron dagger | 10 | -')
  });
  ledger.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + beeId + ' | Water | 0 | 0')
  });
  ledger.command({
    actorId: 2, profileId: 2,
    parts: parts('/book price ' + otherId + ' | Iron dagger | 11 | 14')
  });
  ledger.command({
    actorId: 2, profileId: 2,
    parts: parts('/book price ' + otherId + ' | Water | 1 | 1')
  });
  const notThere = ledger.command({
    actorId: 1, profileId: 1, parts: parts('/book submit ' + beeId)
  });
  yes('a list is not submitted until they are at the box', /Stand at the hold/.test(notThere));
  hold = 'Whiterun';
  const sent = ledger.command({
    actorId: 1, profileId: 1, parts: parts('/book submit ' + beeId)
  });
  const bookAfter = ledger.books().filter(function (b) { return b.id === beeId; })[0];
  yes('the box keeps a copy and the book still has its list',
      /Submitted The Bee to whiterun/.test(sent) && bookAfter.prices.length === 2);
  ledger.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + beeId + ' | Iron dagger | 99 | 99')
  });
  const held = ledger.ledgers().whiterun[beeId].prices.filter(function (p) {
    return p.name === 'Iron dagger';
  })[0];
  yes('editing the book does not change the copy until they submit again',
      held.buy === 10 && held.sell === null);
  ledger.command({
    actorId: 2, profileId: 2, parts: parts('/book submit ' + otherId)
  });
  /* WHAT A GUILD TRADER IS QUOTED (#4530, Patrick, 12 Nov 2026, docs/DECIDED.md):
     only a line with both a buy and a sell prices a trader, and a hold's
     buy and sell are averaged over those same lines. The Bee's dagger line
     has no sell, so it stays in the book and prices nothing. */
  const whiterun = ledger.guildPrice('whiterun', 'Iron dagger');
  const waterPrice = ledger.guildPrice('whiterun', 'Water');
  yes('a line with a blank is not averaged, zero is, and a half rounds up',
      whiterun.buy === 11 && whiterun.sell === 14 && waterPrice.buy === 1 && waterPrice.sell === 1);
  ledger.command({ actorId: 1, profileId: 1, parts: parts('/book new faction The Gate') });
  const gateId = ledger.books().filter(function (b) { return b.name === 'The Gate'; })[0].id;
  ledger.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + gateId + ' | Iron dagger | 20 | 20')
  });
  hold = 'solitude';
  ledger.command({ actorId: 1, profileId: 1, parts: parts('/book submit ' + gateId) });
  const own = ledger.guildPrice('whiterun', 'Iron dagger');
  const otherHold = ledger.guildPrice('riften', 'Iron dagger');
  const none = ledger.guildPrice('whiterun', 'Mead');
  yes('a hold keeps its own price, and a hold with none uses the others\' pairs whole',
      own.buy === 11 && own.sell === 14 && otherHold.buy === 16 && otherHold.sell === 17 &&
      none.buy === null && none.sell === null);
  const listed = ledger.catalog('riften');
  const listedDagger = listed.filter(function (row) { return row.name === 'Iron dagger'; })[0];
  yes('the hold catalogue is the same submitted average, with both sides on every row',
      listedDagger && listedDagger.buy === 16 && listedDagger.sell === 17 &&
      listed.every(function (row) { return row.buy !== null && row.sell !== null; }));
  ledger.command({
    actorId: 1, profileId: 1,
    parts: parts('/book price ' + beeId + ' | Iron dagger | 12 | 16')
  });
  hold = 'whiterun';
  ledger.command({ actorId: 1, profileId: 1, parts: parts('/book submit ' + beeId) });
  const replaced = ledger.guildPrice('whiterun', 'Iron dagger');
  yes('a later submission from the same book replaces the earlier copy',
      ledger.ledgers().whiterun[beeId].prices[0].sell === 16 && replaced.buy === 12 && replaced.sell === 15);
  ledger.command({ actorId: 1, profileId: 1, parts: parts('/book invite ' + beeId + ' 4') });
  ledger.accept(4, 'Bjorn');
  const memberSubmit = ledger.command({
    actorId: 4, profileId: 4, parts: parts('/book submit ' + beeId)
  });
  yes('a member without prices cannot submit', /cannot set prices/.test(memberSubmit));
  ledger.command({ actorId: 2, profileId: 2, parts: parts('/book disband ' + otherId) });
  yes('disbanding drops that book\'s copy, and the hold prices from the lines left',
      !ledger.ledgers().whiterun[otherId] &&
      ledger.ledgers().whiterun[beeId].prices[0].buy === 12 &&
      ledger.guildPrice('whiterun', 'Iron dagger').sell === 16);
  const reloaded = make(ledgerDir, { atBox: function () { return 'whiterun'; } });
  const reloadedPrice = reloaded.guildPrice('whiterun', 'Iron dagger');
  yes('the copy survives a new load',
      reloadedPrice.buy === 12 && reloadedPrice.sell === 16);
  try { fs.rmSync(ledgerDir, { recursive: true, force: true }); } catch (e2) { }

  /* A FACTION'S BOOK FOLLOWS ITS LEADER ROLE (#3317, Patrick, 22 Oct, page
     card q-3317-faction-books, A): whoever holds the Leader role in Discord
     owns the book, and it moves with the role. */
  const moveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-books-'));
  const accounts = { 1: 'kodlak', 4: 'aela', 5: 'aela' };
  const seat = { account: 'kodlak' };
  const moveRoles = function (pid) {
    const acc = accounts[Number(pid)] || ('p:' + pid);
    return {
      business: false, staff: Number(pid) === 9, account: acc,
      leads: acc === seat.account ? ['Companions Leader'] : []
    };
  };
  const mover = make(moveDir, {
    roles: moveRoles,
    names: { 1: 'Kodlak', 4: 'Aela' },
    online: function () { return { 1: 'Kodlak', 4: 'Aela', 5: 'Aela Two' }; }
  });
  yes('the Companions Leader founds the Companions book',
      mover.command({ actorId: 1, profileId: 1, parts: parts('/book new faction The Companions') }) ===
      'Founded The Companions.');
  yes('somebody else neither sees it nor may found a second one for the role',
      mover.view(4, {}).show === false);
  seat.account = 'aela';
  const newLead = mover.view(4, {});
  const theirs = newLead.books.filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('once the role is theirs in Discord, the new Leader opens the book as its owner',
      newLead.show === true && !!theirs && theirs.owner === true &&
      theirs.people.some(function (p) { return p.name === 'Aela' && p.role === 'Owner'; }));
  const moved = mover.books().filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('the book\'s owner and account are theirs now', moved.owner === 4 && moved.account === 'aela');
  const oldLead = mover.view(1, {}).books.filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('the old Leader keeps a seat in it and is no longer its owner',
      !!oldLead && oldLead.owner === false);
  const alt2 = mover.view(5, {}).books.filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('another character on the new Leader\'s account owns it too, and the book does not move to it',
      !!alt2 && alt2.owner === true &&
      mover.books().filter(function (b) { return b.name === 'The Companions'; })[0].owner === 4);
  yes('staff cannot hand it on: it moves with the role',
      /moves with the Companions Leader role in Discord/.test(mover.command({
        actorId: 9, profileId: 9, parts: parts('/book give ' + moved.id + ' | Kodlak')
      })));
  const again2 = make(moveDir, { roles: moveRoles });
  const keptMove = again2.books().filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('the move is saved', !!keptMove && keptMove.owner === 4 && keptMove.leader === 'Companions Leader');
  seat.account = 'nobody';
  const vacant = again2.view(4, {}).books.filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('while nobody holds the role, the last Leader is a member and owns nothing',
      !!vacant && vacant.owner === false);
  // A deleted character that led it (#2351): the book is the role's, so it
  // stays, vacant, until whoever holds the role next opens it.
  const gone = again2.release({ profile: function (pid) { return Number(pid) === 4; } });
  const vacantBook = again2.books().filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('a deleted Leader\'s character leaves the faction book standing, vacant, and is off it',
      gone.saved === true && gone.counts.books === 0 && !!vacantBook && vacantBook.owner === 0 &&
      vacantBook.account === '' && !vacantBook.members.some(function (m) { return m.pid === 4; }));
  const reread = make(moveDir, { roles: moveRoles, online: function () { return { 1: 'Kodlak' }; } });
  yes('a vacant faction book loads again', reread.books().some(function (b) { return b.name === 'The Companions' && b.owner === 0; }));
  seat.account = 'kodlak';
  const back2 = reread.view(1, {}).books.filter(function (b) { return b.name === 'The Companions'; })[0];
  yes('and whoever holds the role next opens it as its owner',
      !!back2 && back2.owner === true &&
      reread.books().filter(function (b) { return b.name === 'The Companions'; })[0].owner === 1);
  try { fs.rmSync(moveDir, { recursive: true, force: true }); } catch (e3) { }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
