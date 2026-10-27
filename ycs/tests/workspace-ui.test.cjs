'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const {JSDOM}=require('jsdom');
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
async function fixture(t){
 const dom=new JSDOM(await fs.readFile(path.join(__dirname,'../public/data-manager.html'),'utf8'),{url:'http://localhost/ycs/data-manager',runScripts:'outside-only'}),window=dom.window;window.structuredClone=structuredClone;
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 window.eval(await fs.readFile(path.join(__dirname,'../public/mapping-workspace.js'),'utf8'));
 const state={revision:1,defaults:[],sources:{},connections:{sheet:{label:'Guests',type:'google-sheets',project:'ShowA',settings:{url:'https://docs.google.com/spreadsheets/d/1PUBLIC_SHEET_TEST_1234567890/edit',worksheet:'42',range:'A1:B3'},rows:[[{address:'A1',value:'Name'},{address:'B1',value:'Title'}],[{address:'A2',value:'Guest One'},{address:'B2',value:'Expert'}],[{address:'A3',value:'Guest Two'},{address:'B3',value:'Guest'}]],health:'ok'},api:{label:'API',type:'json-api',project:'ShowB',settings:{url:'https://api.example.com'},health:'ok',data:{person:{name:'JSON Name'}}}}};
 const posts=[],message=[];let conflict=false;
 const model=id=>({title:id,revision:1,template:'/test.html',fields:[{field:'f0',title:'Name',ftype:'textfield',type:'Text',manual:'Manual',value:'Manual',binding:null},{field:'f1',title:'Title',ftype:'textfield',type:'Text',manual:'Manual title',value:'Manual title',binding:null}]});
 const workspace=new window.YCSMappingWorkspace({getState:()=>state,message:(text,error)=>message.push({text,error}),onSaved:()=>{},request:async(url,body)=>{
  if(body){posts.push({url,body:structuredClone(body)});if(conflict&&!url.endsWith('/preview'))throw new Error('Data changed elsewhere');if(url.endsWith('/preview'))return {...model('guest'),graphic:{id:'guest',template:'/templates/test.html',data:{f0:'Preview'}},fields:model('guest').fields};return state;}
  if(url.endsWith('/graphics'))return [{id:'guest',title:'Guest',template:'/test.html',slot:'lower-third',fields:model('guest').fields,mapped:0},{id:'other',title:'Other',template:'/test.html',slot:'lower-third',fields:model('guest').fields,mapped:0}];return model(url.split('/').pop());
 }});
 await workspace.initialize([{id:'a',title:'Stage A',project:'ShowA',rundown:'Main'},{id:'b',title:'Stage B',project:'ShowB',rundown:'Main'}]);await flush();t.after(()=>{workspace.dispose();window.close();});
 return {window,workspace,state,posts,message,conflict:()=>{conflict=true;},$:id=>window.document.getElementById(id)};
}
test('mapping workspace scopes sources to projects and retains separate graphic drafts across navigation',async t=>{
 const r=await fixture(t);assert.deepEqual([...r.$('mapping-source').options].map(option=>option.value),['sheet']);
 r.window.document.querySelector('.source-card').click();assert.equal(r.workspace.model.edits.get('f0').binding.selection.cell,'A1');
 r.$('mapping-graphic').value='other';await r.workspace.selectGraphic();assert.equal(r.workspace.model.edits.size,0);
 r.$('mapping-graphic').value='guest';await r.workspace.selectGraphic();assert.equal(r.workspace.model.edits.size,1);
 r.$('mapping-project').value='ShowB';await r.workspace.selectProject();assert.deepEqual([...r.$('mapping-source').options].map(option=>option.value),['api']);
 r.$('mapping-project').value='ShowA';await r.workspace.selectProject();assert.equal(r.workspace.model.edits.size,1);
});
test('table-row auto-map is explicit, transforms preserve edits, Revert discards only the selected draft, and conflicts retain it',async t=>{
 const r=await fixture(t);r.workspace.tableMode=true;r.workspace.renderSourceContext();r.workspace.autoMap();
 assert.equal(r.workspace.model.edits.get('f0').binding.selection.cell,'A2');assert.equal(r.workspace.model.edits.get('f1').binding.selection.cell,'B2');
 const transform=r.window.document.querySelector('[aria-label="Name transform"]');transform.value='uppercase';transform.dispatchEvent(new r.window.Event('change'));assert.equal(r.workspace.model.edits.get('f0').binding.transform.kind,'uppercase');
 r.state.revision=99;r.workspace.update(r.state);r.conflict();await r.workspace.save();const saved=r.posts.find(post=>post.url.startsWith('/data/mappings/')&&!post.url.endsWith('/preview'));assert.equal(saved.body.revision,1);assert.equal(r.workspace.model.edits.size,2);assert.match(r.message.at(-1).text,/changed elsewhere/);
 await r.workspace.selectGraphic(true);assert.equal(r.workspace.model.edits.size,0);assert.equal(r.$('save-mappings').disabled,true);
});
test('cell and JSON browsing never require table headers and source drag payloads target the selected graphic field',async t=>{
 const r=await fixture(t);r.workspace.selectedField='f1';r.workspace.openCells();const cell=r.$('mapping-cell-grid').querySelector('button[aria-label="B3: Guest"]');cell.click();assert.equal(r.workspace.model.edits.get('f1').binding.selection.cell,'B3');
 r.$('mapping-project').value='ShowB';await r.workspace.selectProject();r.window.document.querySelector('.source-card').click();assert.equal(r.workspace.model.edits.get('f0').binding.selection.pointer,'/person/name');
 const row=r.$('mapping-fields').querySelector('[data-field="f1"]'),event=new r.window.Event('drop',{bubbles:true,cancelable:true});event.dataTransfer={getData:()=>JSON.stringify({connection:'api',selection:{kind:'json',pointer:'/person/name'}})};row.dispatchEvent(event);assert.equal(r.workspace.model.edits.get('f1').binding.selection.pointer,'/person/name');
});

test('known local saves advance compatible draft revisions without discarding other graphics or bypassing older conflicts',async t=>{
 const r=await fixture(t);r.window.document.querySelector('.source-card').click();const first=r.workspace.model;
 r.$('mapping-graphic').value='other';await r.workspace.selectGraphic();r.window.document.querySelector('.source-card').click();const second=r.workspace.model;
 r.workspace.acceptRevision(1,2);assert.equal(first.revision,2);assert.equal(second.revision,2);assert.equal(first.edits.size,1);assert.equal(second.edits.size,1);
 first.revision=1;r.workspace.acceptRevision(2,3);assert.equal(first.revision,1);assert.equal(second.revision,3);
});
