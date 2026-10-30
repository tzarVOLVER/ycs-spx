'use strict';
// Explicit additive upgrade for already-imported YCS ticker definitions.
// Stop the development runtime first. Existing fields, links and mappings stay intact.
const fs=require('node:fs/promises');const path=require('node:path');
async function upgrade(root,config){
  const changed=[];
  if(!config.ycs?.graphicsRoot)throw new Error('Configure the YCS graphicsRoot first');
  for(const stage of config.ycs.stages){
    const html=await fs.readFile(path.resolve(root,config.ycs.graphicsRoot,`YCS-Ticker-${Number(stage.id.match(/\d+$/)?.[0])}.html`),'utf8');
    const definition=JSON.parse(html.match(/window\.SPXGCTemplateDefinition = (\{[\s\S]*?\});/)?.[1]||'null');
    const list=definition?.DataFields.find(field=>field.field==='f14'&&field.ycsCollection?.version===1);if(!list)throw new Error('Update ycs-graphics before upgrading ticker fields');
    for(const relative of ['profile.json',path.join('data',stage.rundown+'.json')]){
      const file=path.resolve(root,config.general.dataroot,stage.project,relative),raw=await fs.readFile(file,'utf8'),document=JSON.parse(raw);let dirty=false;
      for(const item of document.templates||[]){if(item.relpath!==`/ycs/ticker/YCS-Ticker-${Number(stage.id.match(/\d+$/)?.[0])}.html`)continue;if(item.DataFields.some(field=>field.field==='f14'))continue;
        const field=structuredClone(list);const advanced=item.DataFields.find(field=>field.field==='f1')?.value;try{const override=JSON.parse(advanced||'{}');if(Array.isArray(override.tickerItems))field.value=JSON.stringify(override.tickerItems);}catch{/* Keep the existing override untouched; use the template's manual fallback. */}
        item.DataFields.push(field);item.ycsEditRevision=(item.ycsEditRevision||0)+1;dirty=true;
      }
      if(dirty){await fs.writeFile(file+'.before-playlists.json',raw,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});await fs.writeFile(file+'.playlist-tmp',JSON.stringify(document,null,2));await fs.rename(file+'.playlist-tmp',file);changed.push(file);}
    }
  }
  return changed;
}
if(require.main===module){const root=path.resolve(__dirname,'..');fs.readFile(path.resolve(root,process.argv[2]||'.local/ycs-dev.json'),'utf8').then(JSON.parse).then(config=>upgrade(root,config)).then(changed=>console.log(`Story fields added to ${changed.length} files. Saved values retained; exact backups created.`)).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={upgrade};
