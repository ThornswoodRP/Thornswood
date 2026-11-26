'use strict';
// Execute the actual voice handler's bounded text preparation, including refusals.
const vm=require('node:vm'),headlines=require('../../voice/headlines');
module.exports=function relayCut(source){
 source=source.replace(/\r/g,'');
 const cut=/(const (?:rawLetter|rawCommand|long) = pageText\(msg\.text\)[\s\S]*?const text = [^\n]+)/.exec(source);
 const pageText=(/function pageText\(v\) \{[\s\S]*?\n\}/.exec(source)||[])[0];
 if(!cut||!pageText)throw Error('The actual relay text boundary is missing');
 const number=name=>Number((new RegExp('const '+name+' = (\\d+);').exec(source)||[])[1]);
 return function(line){
  const box={msg:{text:line},COMMAND_CHARS:number('COMMAND_CHARS'),JOURNAL_COMMAND_CHARS:number('JOURNAL_COMMAND_CHARS'),
   SAID_CHARS:number('SAID_CHARS'),headlines,ws:{send:function(){}},out:null};
  vm.runInNewContext(pageText+'\n(function(){'+cut[1]+'\nout=text;})();',box);
  return box.out;
 };
};
