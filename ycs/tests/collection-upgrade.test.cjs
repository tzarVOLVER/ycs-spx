'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const {fixture}=require('./playback.test.cjs');const {upgrade}=require('../upgrade-ticker-fields.cjs');
test('existing imports gain only a missing collection field, preserve custom stories and have exact idempotent backups',async t=>{
 const {root,stages,repository}=await fixture(t),graphics=path.join(root,'graphics');await fs.mkdir(graphics);const originals=new Map();
 for(const [index,stage]of stages.entries()){
  const definition={DataFields:[{field:'f14',ftype:'textarea',value:'[]',ycsCollection:{version:1,fields:[{key:'subtopic',title:'Crawler',required:true}]}}]};await fs.writeFile(path.join(graphics,`YCS-Ticker-${index+1}.html`),'window.SPXGCTemplateDefinition = '+JSON.stringify(definition)+';');
  const document=await repository.read(stage.id);document.templates[0].relpath=`/ycs/ticker/YCS-Ticker-${index+1}.html`;document.templates[0].DataFields.push({field:'f1',ftype:'textarea',value:JSON.stringify({tickerItems:[{subtopic:'Custom saved story'}]})});await repository.write(stage.id,document);await fs.writeFile(path.join(root,stage.project,'profile.json'),JSON.stringify(document));originals.set(stage.id,await fs.readFile(repository.stage(stage.id).file,'utf8'));
 }
 const config={general:{dataroot:'.'},ycs:{graphicsRoot:graphics,stages}};assert.equal((await upgrade(root,config)).length,6);
 for(const stage of stages){const saved=await repository.read(stage.id),list=saved.templates[0].DataFields.find(field=>field.field==='f14');assert.equal(JSON.parse(list.value)[0].subtopic,'Custom saved story');assert.equal(saved.templates[0].ycsEditRevision,1);assert.equal(await fs.readFile(repository.stage(stage.id).file+'.before-playlists.json','utf8'),originals.get(stage.id));assert.equal(saved.templates[1].DataFields.length,2);}
 assert.equal((await upgrade(root,config)).length,0);
});
