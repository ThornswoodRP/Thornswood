'use strict';
// Execute the real prompt builder and its generated browser script. These
// names arrive from the near roster, including old/custom markup-like names.
const fs=require('fs'),path=require('path');
const source=fs.readFileSync(process.env.FRONT||path.join(__dirname,'../plugins/thornswood-front.js'),'utf8').replace(/\r/g,'');
const prompt=/  function drawPrompt\(row\) \{[\s\S]*?\n  \}\n/.exec(source);
const escape=/  function escapeHtml\(s\) \{[\s\S]*?\n  \}\n/.exec(source);
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
yes('the actual prompt builder and shared HTML helper exist',!!prompt&&!!escape);
if(prompt&&escape){
  const elements={},browser={};
  const document={
    getElementById(id){return elements[id]||null;},
    createElement(){return {id:'',style:{},innerHTML:''};},
    body:{appendChild(node){elements[node.id]=node;}}
  };
  const scripts=[];
  const T={js(script){scripts.push(script);new Function('document','window',script)(document,browser);}};
  const draw=new Function('T',
    "let lookingSig='';const LOOK_CSS='position:fixed';"+
    "const FRIEND_NAME='Y',TRADE_NAME='H',MUTE_NAME='L',PARTY_NAME='P',SLEEP_NAME='U',APPRENTICE_NAME='K',HAIR_DYE_NAME='K',CONTRACT_NAME='K',TREAT_NAME='X';"+
    "function deliverName(){return 'E';}"+escape[0]+prompt[0]+'return drawPrompt;')(T);
  function nameHtml(){return /^<div[^>]*>([\s\S]*?)<\/div>/.exec(elements['ts-look'].innerHTML)[1];}
  function decodeTextOnce(text){return text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
  const names=[
    '<img src=x onerror="window.__lookInjected=1">',
    'Aldis </div><div>another prompt',
    'Frey & Sons',
    'A literal &copy; name',
    'A literal &lt;name&gt;',
    '";window.__lookInjected=1;//',
    "Brenna O'Rún 雪"
  ];
  for(const name of names){
    draw({n:name,f:0,m:0,y:0});
    const html=nameHtml();
    yes('the name remains literal text: '+JSON.stringify(name),!/[<>]/.test(html)&&!/&(?!(?:amp|lt|gt);)/.test(html)&&decodeTextOnce(html)===name);
    yes('the action rows survive the name: '+JSON.stringify(name),/Add friend/.test(elements['ts-look'].innerHTML)&&/Trade/.test(elements['ts-look'].innerHTML)&&/Mute/.test(elements['ts-look'].innerHTML));
  }
  yes('name content cannot escape the generated JavaScript string',browser.__lookInjected===undefined);
  draw({n:'Aldis <friend>',f:1,m:1,y:1});
  yes('trusted party markup is preserved beside the escaped name',elements['ts-look'].innerHTML.includes('Aldis &lt;friend&gt;<span')&&/your party/.test(elements['ts-look'].innerHTML));
  yes('friend and mute state still select their established actions',/Remove friend/.test(elements['ts-look'].innerHTML)&&/Unmute/.test(elements['ts-look'].innerHTML));
  const before=scripts.length;draw({n:'Aldis <friend>',f:1,m:1,y:1});
  yes('the unchanged roster row does not redraw every poll',scripts.length===before);
  draw(null);yes('clearing the prompt still hides it',elements['ts-look'].style.display==='none');
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
