'use strict';
const assert=require('node:assert/strict');
const jobs=require('../../game/merchant-commission-state');
const human={desc:'000a:Skyrim.esm',profileId:7},other={desc:'a:skyrim.ESM',profileId:8};
const id='q-whiterun-smith-straps',at=2000000000000;
const terms={hash:'a'.repeat(64),item:{baseId:100,name:'Leather'},count:6,unit:3};
const copy=value=>JSON.parse(JSON.stringify(value));
let state=jobs.empty(),held=jobs.reserve(state,human,id,terms,at);
assert.equal(held.ok,true);state=held.next;
// Work taken holds none of the purse back: the pay is new gold (#6180).
assert.equal(jobs.reserved(state),18);assert.equal(jobs.spendable({purse:250,commissions:state}),250);
assert.equal(jobs.key(human,id),jobs.key({desc:'a:skyrim.ESM',profileId:7},id));
assert.notEqual(jobs.key(human,id),jobs.key(other,id));
assert.equal(jobs.reserve(state,human,id,terms,at).why,'open');
assert.equal(jobs.reserve(state,other,id,terms,at).ok,true,'a trader with an empty purse can still give out work');
assert.deepEqual(state,held.next,'pure reservation never mutates its caller');
const wrong=jobs.cancel(state,human,id,held.token+1,at);assert.equal(wrong.why,'session');
const released=jobs.cancel(state,human,id,held.token,at);assert.equal(released.ok,true);
assert.equal(jobs.reserved(released.next),0);assert.deepEqual(released.next.cool,{});
const again=jobs.reserve(released.next,human,id,terms,at);assert.ok(again.token>held.token);
assert.equal(jobs.cancel(again.next,human,id,held.token,at).why,'session');
const paid=jobs.finish(again.next,human,id,again.token,at);assert.equal(paid.ok,true);
assert.equal(paid.gold,18);assert.equal(jobs.reserved(paid.next),0);
assert.equal(jobs.reserve(paid.next,human,id,terms,at+jobs.WAIT-1).why,'cooldown');
assert.equal(jobs.reserve(paid.next,human,id,terms,at+jobs.WAIT).ok,true);
assert.equal(jobs.finish(paid.next,human,id,again.token,at).ok,false);
assert.equal(jobs.reserve(jobs.empty(),human,id,{...terms,unit:0},at).ok,true,'submitted zero price is valid');
assert.equal(jobs.reserve(jobs.empty(),human,id,{...terms,unit:null},at).why,'price');
assert.equal(jobs.reserve(jobs.empty(),human,id,{...terms,unit:2147483647},at).why,'price');
const exhausted=jobs.empty();exhausted.serial=Number.MAX_SAFE_INTEGER;
assert.equal(jobs.reserve(exhausted,human,id,terms,at).why,'counter');
for(const defect of [null,[],{v:1},{...state,v:99},{...state,unknown:1},
 {...state,serial:0},{...state,held:{[jobs.key(other,id)]:Object.values(state.held)[0]}},
 {...state,cool:{bad:at}},{...state,cool:{[jobs.key(human,id)]:at}},
 {...state,held:{[jobs.key(human,id)]:{...Object.values(state.held)[0],gold:1}}}])
 assert.throws(()=>jobs.read(defect),/commission/i);
assert.equal(jobs.spendable({purse:17,commissions:state}),17);
assert.throws(()=>jobs.spendable({purse:-1,commissions:state}),/purse/i);
const states=[{purse:250,commissions:state},{purse:250,commissions:jobs.reserve(jobs.empty(),human,'q-rift-tailor-work',terms,at).next}];
assert.equal(jobs.openCount(states,human),2);assert.equal(jobs.openCount(states,other),0);
assert.equal(jobs.openCount([null,...states,null],human),2,'uninitialized historical identities carry no promises');
const frozen=copy(states);jobs.openCount(states,human);assert.deepEqual(states,frozen);
{
 const near=jobs.empty();
 for(let i=0;i<jobs.MAX_COOL-1;i++)near.cool[jobs.key(human,'q-prior-'+i)]=at;
 const last=jobs.reserve(near,human,id,terms,at);assert.equal(last.ok,true);
 assert.equal(jobs.reserve(last.next,other,'q-another-job',terms,at).why,'capacity',
   'each accepted promise also reserves its eventual cooldown slot');
 assert.equal(jobs.finish(last.next,human,id,last.token,at).ok,true,'bounded history cannot strand an already accepted payment');
 const frozen=copy(last.next);assert.equal(jobs.reserve(last.next,other,'q-another-job',terms,at+jobs.WAIT-1).ok,false);
 assert.deepEqual(last.next,frozen,'capacity refusal does not evict active cooldown evidence');
 assert.equal(jobs.reserve(last.next,other,'q-another-job',terms,at+jobs.WAIT).ok,true);
}
console.log('PASS finite commission reservations, canonical ownership, original terms, cancellation, cooldown, exhaustion and malformed state');
