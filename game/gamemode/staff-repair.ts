// ==== thornswood equipment testing repair ====
(function () {
  'use strict';
  var g = globalThis, USAGE = 'Usage: /repairgear or /repairgear for <person>.';
  function command(cmd, word, parts, pid, actor) {
    if (word !== '/repairgear') { return false; }
    var staff = g.__thornswoodStaff, refused = staff.authorizeTool(cmd, pid, actor, 'playtester');
    if (refused) { staff.tell(pid, refused); return true; }
    var target = actor, targetPid = pid;
    if (parts.length !== 1) {
      if (parts.length < 3 || String(parts[1]).toLowerCase() !== 'for') { staff.tell(pid, USAGE); return true; }
      var person = staff.takePerson(parts.slice(2));
      if (!person.actorId) { staff.tell(pid, person.why); return true; }
      if (person.rest.length) { staff.tell(pid, USAGE); return true; }
      if (person.pid !== pid) {
        refused = staff.authorizeTool(cmd, pid, actor, 'admin');
        if (refused) { staff.tell(pid, refused); return true; }
      }
      target = person.actorId; targetPid = person.pid;
    }
    var D = g.__thornswoodDurability;
    if (!D || !D.prepareTestingRepair || typeof mp.compareAndSetActorInventoryAndEquipment !== 'function' ||
        typeof mp.getActorRuntimeIdentity !== 'function' || typeof mp.getNpcAIState !== 'function') {
      staff.tell(pid, 'Equipment testing repair is unavailable on this server.'); return true;
    }
    var runtime, state, inventory, equipment, plan;
    try {
      runtime = mp.getActorRuntimeIdentity(target);
      state = mp.getNpcAIState(target);
      if (typeof runtime !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runtime) || !state ||
          state.profileId !== targetPid || !state.isHuman || !state.isConnected ||
          !Number.isSafeInteger(state.lifeGeneration) || state.lifeGeneration < 0) {
        staff.tell(pid, 'That character changed before repair. Nothing was requested.'); return true;
      }
      inventory = mp.get(target, 'inventory'); equipment = mp.get(target, 'equipment');
      plan = D.prepareTestingRepair(inventory, equipment);
    } catch (e) { staff.tell(pid, 'The server could not prepare that repair. Nothing was requested.'); return true; }
    if (!plan.ok) { staff.tell(pid, plan.line); return true; }
    if (!plan.items) { staff.tell(pid, 'No readable carried equipment needs repair.'); return true; }
    var name = staff.nameOf(target), me = staff.nameOf(actor), changed;
    try {
      changed = mp.compareAndSetActorInventoryAndEquipment(target, targetPid, {
        expectedInventory: inventory, replacementInventory: plan.inventory,
        expectedEquipment: equipment, replacementEquipment: plan.equipment,
        expectedLifeGeneration: state.lifeGeneration, expectedRuntimeIdentity: runtime
      });
    } catch (e) {
      staff.tell(pid, 'Repair could not be confirmed. Have the server problem checked before trying again.'); return true;
    }
    if (changed !== true) { staff.tell(pid, 'The equipment changed before repair. Nothing was repaired; check it and try again.'); return true; }
    staff.record('repair', pid, me, targetPid, name, 'restored equipment below sound to 100%', 0,
      { items: plan.items, stacks: plan.stacks });
    var pieces = plan.items + (plan.items === 1 ? ' piece' : ' pieces') + ' of equipment';
    staff.tell(pid, 'Repaired ' + pieces + ' to 100% for ' + name + '.');
    if (targetPid !== pid) { staff.tell(targetPid, 'An admin repaired ' + pieces + ' to 100% for testing.'); }
    return true;
  }
  g.__thornswoodStaffRepair = { command: command };
  g.__thornswoodCommandTools.register('repair', {
    command: command,
    help: [{ word: '/repairgear', role: 'playtester', syntax: '/repairgear',
      text: 'Repair your carried equipment below 100% for testing, preserving stronger pieces and every item extra.' },
      { word: '/repairgear', role: 'admin', syntax: '/repairgear for <person>',
        text: 'Repair another character\'s carried equipment for testing.' }]
  });
})();
// ==== end thornswood equipment testing repair ====
