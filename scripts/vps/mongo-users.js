// mongo-users.js (#6237)
//
// Run on the box by Install-Mongo.ps1 with mongosh, never by hand:
//
//     mongosh --nodb --quiet --file mongo-users.js
//
// with THORNSWOOD_MONGO_PLAN naming a plan file Install-Mongo.ps1 wrote in
// the locked access folder. The plan names files, never a password: each
// user's password is in its own connection-string file there, which this
// reads and nothing prints. What it does:
//   1. With no user on the server yet (a first install), it makes the admin
//      through MongoDB's localhost exception, which allows exactly that one
//      step on a server with authorization on and no users. A server that
//      already has users and no admin file of ours is refused: somebody else
//      made them, and this does not guess.
//   2. Signed in as the admin, it makes each user in the plan or, when it is
//      there, sets its password and roles to the plan's, so the file and the
//      server always agree.
//   3. It prints each user's name and roles, and the line USERS OK.
// A plan with no users only signs in and lists them (Install-Mongo.ps1
// -Status). A plan with shutdown: true signs in as the admin and asks mongod
// to stop cleanly, flushing what it holds, and prints SHUTDOWN SENT; the
// install does that before it changes mongod or its configuration.
// Any error ends it with exit code 1 and the error's message, which names no
// password (mongosh's own errors never carry one).

const fs = require('fs');

function fail(message) {
  print('MONGO-USERS FAILED: ' + message);
  quit(1);
}

function readUri(path) {
  const text = fs.readFileSync(path, 'utf8').trim();
  const url = new URL(text);
  if (url.protocol !== 'mongodb:') fail('a connection file is not a mongodb: URI: ' + path);
  return {
    text,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.host,
    authSource: url.searchParams.get('authSource') || 'admin',
  };
}

const planPath = process.env.THORNSWOOD_MONGO_PLAN;
if (!planPath) fail('THORNSWOOD_MONGO_PLAN names no plan');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const admin = readUri(plan.adminUri);
if (admin.authSource !== 'admin') fail('the admin must sign in to the admin database');

try {
  const bare = new Mongo('mongodb://' + admin.host + '/?directConnection=true');
  let users = null;
  try {
    users = bare.getDB('admin').runCommand({ usersInfo: 1 });
  } catch (e) {
    users = null;
  }
  const signedIn = users && users.ok === 1;
  if (plan.firstRun) {
    // The localhost exception lets usersInfo fail and createUser succeed only
    // while the server has no user at all.
    if (signedIn && users.users.length > 0) {
      fail('the server already has users, but the admin file is new; nothing was changed');
    }
    bare.getDB('admin').createUser({ user: admin.user, pwd: admin.password, roles: ['root'] });
    print('made the admin ' + admin.user);
  }

  const conn = new Mongo(admin.text);
  const db = conn.getDB('admin');
  const who = db.runCommand({ connectionStatus: 1 });
  if (!who.authInfo || !who.authInfo.authenticatedUsers.some((u) => u.user === admin.user)) {
    fail('could not sign in as the admin with the admin file');
  }

  if (plan.shutdown) {
    // mongod closes the connection as it stops, so the command's own answer
    // is a network error; what the install reads is the port going quiet.
    try {
      db.adminCommand({ shutdown: 1, timeoutSecs: 30 });
    } catch (e) {
      // The connection closing is the shutdown going ahead.
    }
    print('SHUTDOWN SENT');
    quit(0);
  }

  for (const u of plan.users || []) {
    const c = readUri(u.uri);
    if (c.user !== u.user || c.authSource !== u.db) {
      fail('the connection file for ' + u.user + ' names another user or database');
    }
    const target = conn.getDB(u.db);
    const found = target.getUser(u.user);
    if (found) {
      target.updateUser(u.user, { pwd: c.password, roles: u.roles });
      print('kept ' + u.user + '@' + u.db + ', password and roles set: ' + JSON.stringify(u.roles));
    } else {
      target.createUser({ user: u.user, pwd: c.password, roles: u.roles });
      print('made ' + u.user + '@' + u.db + ': ' + JSON.stringify(u.roles));
    }
  }

  // Every user the server has now, by name, so a stray one shows.
  const all = db.runCommand({ usersInfo: { forAllDBs: true } });
  for (const u of all.users) {
    print('user ' + u.user + '@' + u.db + ' ' + JSON.stringify(u.roles.map((r) => r.role + '@' + r.db)));
  }
  print('USERS OK');
} catch (e) {
  fail(String(e && e.message ? e.message : e));
}
