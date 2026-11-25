'use strict';
// Actual ship/cart page and bridge -> authenticated queue -> canonical draft.
const fs=require('node:fs'),path=require('node:path');
const makePage=require('../../tests/fixtures/panel-page');
const standIn=require('../../tests/stand-in-server'),cargo=require('../trade-cargo');
const ROOT=standIn.REPO_DIR,t=standIn.checks(),yes=t.yes;
const routes={v:1,ports:[
  {key:'solitude',name:'Solitude',hold:'solitude',world:'3c:Skyrim.esm',pos:[100,0,0],crate:'1a001:Skyrim.esm'},
  {key:'windhelm',name:'Windhelm',hold:'windhelm',world:'3c:Skyrim.esm',pos:[200,0,0],crate:'1a002:Skyrim.esm'}
],routes:[]};
const saved=driven=>cargo.saveRegister(cargo.adoptRoutes(cargo.openRegister(null,{driven}),routes));
const w=standIn.world({name:'4557-port-form',settings:{thornswoodTradeShips:true,thornswoodDevs:[1001]},
  files:{'private/trade-cargo.json':saved(false),'private/trade-carts.json':saved(true)}});
function page(view,send){
  const p=makePage();
  p.run('bridge',fs.readFileSync(path.join(ROOT,'game/ui/thornswood-bridge.js'),'utf8'));
  p.run('ship',fs.readFileSync(process.env.SHIP_UI||path.join(ROOT,'game/ui/thornswood-ship.js'),'utf8'));
  p.api=p.win.thornswoodShip;
  p.feed=value=>{
    p.api.setData(value);
    // Native value/validity APIs over the shared DOM stand-in. Browser proof
    // checks the real implementations separately, without this adapter.
    for(const node of p.doc.querySelectorAll('input,select')){
      const options=node.querySelectorAll('option');
      node.value=node.tagName==='SELECT' ? ((options.find(o=>o.hasAttribute('selected'))||options[0]||{}).getAttribute?.('value')||'') : (node.getAttribute('value')||'');
      node.max=node.getAttribute('max')||'';
      node.validationMessage='';node.setCustomValidity=function(message){this.validationMessage=String(message);};
      node.reportValidity=function(){this.reported=true;return !this.validationMessage;};
    }
  };
  p.field=name=>p.doc.getElementById('ts-ship-'+name);
  p.edit=(name,value)=>{const node=p.field(name);node.value=value;p.fire(node,node.tagName==='SELECT'?'change':'input','');return node;};
  p.press=act=>{const button=p.doc.querySelector('[data-act="'+act+'"]');if(button)p.fire(button,'click','');return button;};
  p.win.thornswoodNet.say=line=>{p.sent.push(line);send(line,p);return true;};
  p.api.open();p.feed(view);return p;
}
try{
  const actor=w.person(0xff004557,{profileId:1001,name:'Port Keeper',cell:'3c:Skyrim.esm',pos:[10,0,0]});
  const other=w.person(0xff004558,{profileId:1002,name:'Visitor',cell:'3c:Skyrim.esm',pos:[10,0,0]});
  const crate=w.idOf('1a003:Skyrim.esm');
  w.record('17696:Skyrim.esm','CONT');w.ref(crate,{base:'17696:Skyrim.esm',cell:'3c:Skyrim.esm',pos:[12,0,0]});
  yes('the full gamemode boots with normal staff ship/cart routes',w.boot());
  if(w.loaded()){
    w.arrive(actor);w.arrive(other);w.run(15000);w.activate(crate,actor);
    for(const [word,file]of[['ship','trade-cargo.json'],['cart','trade-carts.json']]){
      const viewKey=word==='cart'?'thornswoodCartView':'thornswoodShipView';
      w.say(actor,'/'+word+' staff');
      const initial=w.prop(actor,viewKey);
      yes(word+' actual staff response exposes the active draft and opened crate',initial&&initial.mode==='staff'&&initial.draft.ports.length===2&&initial.crate&&initial.crate.here);
      yes(word+' response belongs to the requested transport panel',word==='cart'?initial.kind==='cart'&&initial.word==='/cart':initial.kind!=='cart');
      if(!initial||!initial.draft)continue;
      const p=page(initial,(line,pg)=>{w.say(actor,line);pg.feed(w.prop(actor,viewKey));});
      const before=JSON.stringify(w.readPrivate(file)),pack=JSON.stringify(w.row(actor).inventory);
      const key=p.field('pkey'),hint=key&&p.doc.getElementById(key.getAttribute('aria-describedby'));
      yes(word+' key has visible, associated canonical character/start/length guidance',hint&&/64/.test(hint.textContent)&&/letter|digit/.test(hint.textContent)&&/space/.test(hint.textContent)&&/:/.test(hint.textContent)&&/_/.test(hint.textContent)&&/\./.test(hint.textContent)&&/-/.test(hint.textContent));
      yes(word+' route starts with different valid endpoints',p.field('rfrom').value!==p.field('rto').value);
      for(const bad of['bad key','bad@key',':key','_key','.key','-key','a'.repeat(65),'']){
        p.feed(initial);p.edit('pkey',bad);p.edit('phold','whiterun');p.edit('pname','New Quay');
        const field=p.field('pkey'),count=p.sent.length;p.press('port');
        yes(word+' invalid key '+JSON.stringify(bad)+' gives local reason/focus and sends nothing',
          p.sent.length===count&&/key/i.test(field.validationMessage)&&field.reported&&p.doc.activeElement===field&&JSON.stringify(w.readPrivate(file))===before);
      }
      p.feed(initial);p.edit('pkey','bad@key');p.edit('phold','whiterun');p.edit('pname','New Quay');p.press('port');
      const field=p.edit('pkey','  North:Quay_1.a-b  ');
      yes(word+' editing the key clears its prior native validity error',field.validationMessage==='');
      p.press('port');
      const next=w.prop(actor,viewKey);
      yes(word+' normalized valid key reaches the actual queued canonical draft once',
        p.sent.at(-1)==='/'+word+' draft port north:quay_1.a-b whiterun New Quay'&&next.draft.ports.some(port=>port.key==='north:quay_1.a-b')&&/draft changed/i.test(next.note));
      yes(word+' a valid draft does not commit routes or touch inventory',JSON.stringify(w.readPrivate(file))===before&&JSON.stringify(w.row(actor).inventory)===pack);
      p.edit('rto',p.field('rfrom').value);const same=p.field('rto'),count=p.sent.length;p.press('route');
      yes(word+' equal endpoints name the problem/focus To and do not send',p.sent.length===count&&/different/.test(same.validationMessage)&&same.reported&&p.doc.activeElement===same&&JSON.stringify(w.readPrivate(file))===before);
      p.edit('rfrom','windhelm');
      yes(word+' editing From also clears the dependent To validity error',same.validationMessage==='');
      p.press('route');
      yes(word+' a valid route still reaches the queued canonical draft',p.sent.at(-1)==='/'+word+' draft route windhelm solitude 60'&&w.prop(actor,viewKey).draft.routes.some(route=>route.from==='windhelm'&&route.to==='solitude'));
      yes(word+' route drafting retains confirmation and no-write semantics',JSON.stringify(w.readPrivate(file))===before);
      for(const size of[0,1]){
        const limited=JSON.parse(JSON.stringify(initial));limited.draft.ports=limited.draft.ports.slice(0,size);p.feed(limited);
        yes(word+' '+size+' ports shows no bogus route form',!p.field('rfrom')&&!p.field('rto')&&!p.doc.querySelector('[data-act="route"]'));
      }
      w.say(actor,'/'+word+' close');
    }
    w.say(other,'/ship staff');
    yes('normal server staff authorization remains in force',w.heard(other).some(line=>/Only staff/.test(line)));
    yes('the actual queue and timers record no faults',!w.faults.length&&!w.threw.length);
  }
  t.done(w);
}finally{w.done();}
