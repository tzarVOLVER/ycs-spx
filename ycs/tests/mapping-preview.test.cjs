'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const {JSDOM}=require('jsdom');
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
test('mapping monitor updates one isolated iframe without replaying Play or sending commands',async t=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/ycs/mapping-preview.html',runScripts:'outside-only'}),{window}=dom,calls=[];
 const append=window.document.body.append.bind(window.document.body);window.document.body.append=frame=>{append(frame);frame.contentWindow.update=value=>calls.push({method:'update',value:JSON.parse(value)});frame.contentWindow.play=()=>calls.push({method:'play'});queueMicrotask(()=>frame.dispatchEvent(new window.Event('load')));};
 window.fetch=()=>{throw new Error('Mapping monitor must not call an API');};window.eval(await fs.readFile(path.join(__dirname,'../public/mapping-preview.js'),'utf8'));t.after(()=>window.close());
 const send=(name,origin='http://localhost')=>window.dispatchEvent(new window.MessageEvent('message',{origin,source:window.parent,data:{type:'ycs-mapping-preview',graphic:{template:'/templates/test.html',data:{f0:name}}}}));
 send('First');await flush();const frame=window.document.querySelector('iframe');send('Second');await flush();assert.equal(window.document.querySelector('iframe'),frame);assert.equal(calls.filter(call=>call.method==='play').length,1);assert.equal(calls.at(-1).value.f0,'Second');
 send('Untrusted','https://elsewhere.example');await flush();assert.equal(calls.at(-1).value.f0,'Second');
});
