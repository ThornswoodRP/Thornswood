'use strict';
/*
  Scenario: systems/trade.md
  #6618: the real localized Hammer FULL is a string ID, not the bytes '.J'.
  Drive the whole gamemode and queued commands, retaining exact piece identity.
*/
const standIn = require('../../tests/stand-in-server.js');
const fs=require('node:fs'),path=require('node:path');
const stage=JSON.parse(fs.readFileSync(path.join(__dirname,'../gamemode-tables/MERCHANT_STAGE.json'),'utf8'));
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({name:'6618-hammer-trade',pluginFlags:{'Skyrim.esm':0x80,'Thornswood-Content.esp':0}});
const HAMMER='5cae1:Skyrim.esm', OTHER='5cae1:Thornswood-Content.esp', UNKNOWN='fffffe:Thornswood-Content.esp';
const LOCALIZED='fffffe:Skyrim.esm', SHORT='fffffd:Thornswood-Content.esp', NO_PROVENANCE='fffffe:Update.esm';
const FOUR_LETTERS='fffffc:Thornswood-Content.esp';
w.record(HAMMER,'MISC',{editorId:'BlacksmithHammer01',fields:[{type:'FULL',data:[46,74,0,0]}]});
w.record(OTHER,'MISC',{editorId:'OtherHammer',fields:[{type:'FULL',data:Array.from(Buffer.from('Other Hammer\0'))}]});
w.record(UNKNOWN,'MISC',{editorId:'CopperToken',fields:[]});
w.record(LOCALIZED,'MISC',{editorId:'WorkshopToken',flags:0,fields:[{type:'FULL',data:[46,74,0,0]}]});
w.record(SHORT,'MISC',{editorId:'RubyToken',flags:0x80,fields:[{type:'FULL',data:Array.from(Buffer.from('Ink\0'))}]});
w.record(NO_PROVENANCE,'MISC',{editorId:'UnverifiedToken',fields:[{type:'FULL',data:[46,74,0,0]}]});
w.record(FOUR_LETTERS,'MISC',{editorId:'NotTheDisplayName',fields:[{type:'FULL',data:Array.from(Buffer.from('Ruby\0'))}]});
const id=w.idOf;
const a=w.person(0xff001801,{profileId:1000,name:'Aldis',prof:'cook',cell:'3c:Skyrim.esm',pos:[130000,-9000,9000],
  inventory:{entries:[{baseId:id(HAMMER),count:2},{baseId:id(HAMMER),count:1,name:'Aldis Hammer'},
    {baseId:id(OTHER),count:1},{baseId:id(UNKNOWN),count:1},{baseId:id(LOCALIZED),count:1},
    {baseId:id(SHORT),count:1},{baseId:id(NO_PROVENANCE),count:1},{baseId:id(FOUR_LETTERS),count:1}]}});
const b=w.person(0xff001802,{profileId:1002,name:'Brenna',prof:'tailor',cell:'3c:Skyrim.esm',pos:[130100,-9000,9000],inventory:{entries:[]}});
yes('whole gamemode boots',w.boot());
if(!w.loaded())t.done(w);
[a,b].forEach(w.arrive);w.run(30000);
// Guild merchant lookup/admission is a separate path. Do not widen its
// specialist tables or invent a saved price book to hide a vendor refusal.
const resolved=w.box().__thornswoodResolveItem('Hammer');
yes('guild resolver identifies the actual Hammer record',resolved.name==='Hammer'&&resolved.baseId===id(HAMMER));
yes('authored Smith table already permits buying and selling Hammer',stage.tables.Smith.buy.includes(HAMMER)&&stage.tables.Smith.sell.includes(HAMMER));
yes('other specialists still exclude Hammer',Object.entries(stage.tables).filter(([role])=>role!=='Smith').every(([,table])=>!table.buy.includes(HAMMER)&&!table.sell.includes(HAMMER)));
function say(actor,line){w.say(actor,line);w.run(300);}
function view(actor){return w.prop(actor,'thornswoodTrade')||{};}
function start(){say(a,'/trade '+b.toString(16));say(b,'/yes');}
function finish(){say(a,'/trade ok');say(b,'/trade ok');}
function count(actor,name){return w.row(actor).inventory.entries.filter(e=>e.baseId===id(HAMMER)&&(e.name||'')===name).reduce((n,e)=>n+e.count,0);}
start();
let pack=view(a).pack||[];
yes('Hammer uses decoded content name, never printable localized ID',pack.some(e=>e.id===id(HAMMER)&&e.n==='Hammer')&&!pack.some(e=>e.n==='.J'));
yes('custom inventory name takes precedence',pack.some(e=>e.n==='Aldis Hammer'));
yes('same local form in another plugin cannot inherit Hammer name',pack.some(e=>e.id===id(OTHER)&&e.n==='Other Hammer'));
yes('unknown content record keeps editor-ID fallback',pack.some(e=>e.id===id(UNKNOWN)&&e.n==='Copper Token'));
yes('unknown localized record never interprets a printable string ID as text',pack.some(e=>e.id===id(LOCALIZED)&&e.n==='Workshop Token'));
yes('four-byte unlocalized text remains readable despite individual record flags',pack.some(e=>e.id===id(SHORT)&&e.n==='Ink'));
yes('four-letter unlocalized FULL keeps its actual name',pack.some(e=>e.id===id(FOUR_LETTERS)&&e.n==='Ruby'));
yes('missing plugin provenance uses editor-ID fallback',pack.some(e=>e.id===id(NO_PROVENANCE)&&e.n==='Unverified Token'));
say(a,'/trade add Hammer 1');
yes('label-based Hammer offer succeeds',view(a).mine.some(e=>e.n==='Hammer'&&e.c===1));
finish();
yes('label-based trade transfers exactly one plain Hammer',count(a,'')===1&&count(b,'')===1&&count(a,'Aldis Hammer')===1&&!view(a).open);
start();
pack=view(a).pack||[];
const plain=pack.find(e=>e.id===id(HAMMER)&&e.n!=='Aldis Hammer');
const beforeA=count(a,''),beforeB=count(b,'');
say(a,'/trade add #'+(plain?plain.p:0)+' 1');
yes('piece-ID Hammer offer succeeds',view(a).mine.some(e=>e.n==='Hammer'&&e.c===1));
finish();
yes('piece-ID trade transfers one plain Hammer without custom piece',count(a,'')===beforeA-1&&count(b,'')===beforeB+1&&count(a,'Aldis Hammer')===1&&!view(a).open);
yes('no trade handler or timer threw',w.threw.length===0&&w.faults.length===0);
t.done(w);
