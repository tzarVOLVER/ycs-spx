// Maps one source collection to the fields declared by the selected template.
window.YCSCollectionEditor=class CollectionEditor {
  constructor(workspace){this.workspace=workspace;this.$=workspace.$;this.sequence=0;this.$('close-playlist').onclick=()=>this.close();this.$('cancel-playlist').onclick=()=>this.close();this.$('test-playlist').onclick=()=>this.preview();this.$('use-playlist').onclick=()=>this.apply();this.$('playlist-dialog').addEventListener('close',()=>{this.sequence++;clearTimeout(this.timer);});}
  node(...args){return this.workspace.node(...args);}
  select(options,value,label){return this.workspace.control(options,value,label);}
  connection(){return this.workspace.getState().connections[this.connectionId];}
  async open(field){
    this.field=field;this.model=this.workspace.model;this.stage=this.workspace.stage;this.graphic=this.$('mapping-graphic').value;this.schema=field.ycsCollection;
    const binding=this.workspace.binding(field);this.connectionId=binding?.selection?.kind==='collection'?binding.connection:this.workspace.sourceId;
    const sources=Object.entries(this.workspace.getState().connections||{}).filter(([,source])=>!source.project||source.project===this.workspace.project());
    if(!sources.some(([id])=>id===this.connectionId))this.connectionId=sources[0]?.[0];
    this.$('playlist-title').textContent='Map '+field.title;const target=this.$('playlist-controls');target.replaceChildren();
    if(!this.connectionId){target.append(this.node('p','Add a Google Sheets or JSON API connection in Sources first.'));this.$('test-playlist').disabled=this.$('use-playlist').disabled=true;this.$('playlist-dialog').showModal();return;}
    this.binding=binding?.selection?.kind==='collection'?structuredClone(binding):null;this.render();this.$('playlist-dialog').showModal();await this.preview();
  }
  arrays(data){const result=[];const walk=(value,path,depth)=>{if(depth>12||result.length>100)return;if(Array.isArray(value)){result.push([path,path||'/ (root array)']);return;}if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))walk(child,path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'),depth+1);};walk(data,'',0);return result;}
  properties(records){const paths=new Set();const walk=(value,path,depth)=>{if(depth>10||paths.size>300)return;if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [key,child]of Object.entries(value))walk(child,path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'),depth+1);}else if(!Array.isArray(value))paths.add(path);};for(const item of (records||[]).slice(0,200))walk(item,'',0);return [...paths].map(path=>[path,path||'/ (item value)']);}
  at(data,path){for(const token of path?path.slice(1).split('/').map(key=>key.replaceAll('~1','/').replaceAll('~0','~')):[]){if(!data||typeof data!=='object'||!Object.hasOwn(data,token))return;data=data[token];}return data;}
  change(){this.sequence++;this.dirty=true;this.$('use-playlist').disabled=true;this.$('playlist-status').textContent='Previewing changes…';clearTimeout(this.timer);this.timer=setTimeout(()=>this.preview(),200);}
  render(){
    const target=this.$('playlist-controls');target.replaceChildren();this.$('playlist-result').replaceChildren();this.$('playlist-status').textContent='';
    const sources=Object.entries(this.workspace.getState().connections||{}).filter(([,item])=>!item.project||item.project===this.workspace.project());
    const connectionSelect=this.select(sources.map(([id,item])=>[id,item.label]),this.connectionId,'Playlist connection');connectionSelect.onchange=()=>{this.connectionId=connectionSelect.value;this.binding=null;this.render();this.change();};target.append(this.workspace.fieldLabel('Connection',connectionSelect));
    const connection=this.connection(),saved=this.binding?.connection===this.connectionId?this.binding.selection:null;
    this.format=connection.type==='json-api'?'json':'sheet';this.pick={kind:'collection',format:this.format,fields:{},required:this.schema.fields.filter(field=>field.required).map(field=>field.key)};
    let columns=[];
    if(this.format==='sheet'){
      const layout=this.node('div',undefined,'filters'),range=this.node('input'),header=this.node('input');range.value=saved?.range||connection.settings.range;range.setAttribute('aria-label','Playlist range');header.type='number';header.min=1;header.value=saved?.headerRow||Number(range.value.match(/\d+/)?.[0])||1;header.setAttribute('aria-label','Playlist header row');
      const update=()=>{this.pick.range=range.value;this.pick.headerRow=Number(header.value);};update();range.oninput=()=>{update();this.change();};header.onchange=()=>{update();this.binding={connection:this.connectionId,selection:{...this.pick}};this.render();this.change();};
      layout.append(this.workspace.fieldLabel('Range within this connection',range),this.workspace.fieldLabel('Header row',header));target.append(layout);
      const headers=connection.rows.find(row=>Number(row[0]?.address.match(/\d+$/)?.[0])===Number(header.value))||[];columns=headers.filter(cell=>cell.value?.trim()).map(cell=>[cell.value,cell.value]);
      const duplicates=new Set(columns.filter(([key],index)=>columns.findIndex(([other])=>other===key)!==index).map(([key])=>key));columns=columns.filter(([key])=>!duplicates.has(key));if(duplicates.size)target.append(this.node('p','Duplicate headers cannot be mapped: '+[...duplicates].join(', '),'warning'));
    }else{
      const arrays=this.arrays(connection.data);this.pick.pointer=saved?.pointer??arrays[0]?.[0]??'';if(saved&&!arrays.some(([path])=>path===saved.pointer))arrays.push([saved.pointer,saved.pointer+' (missing)']);
      const arraySelect=this.select(arrays,this.pick.pointer,'Story array');arraySelect.onchange=()=>{this.binding={connection:this.connectionId,selection:{...this.pick,pointer:arraySelect.value}};this.render();this.change();};target.append(this.workspace.fieldLabel('Story array',arraySelect));
      columns=this.properties(this.at(connection.data,this.pick.pointer));
    }
    this.$('test-playlist').disabled=false;
    const table=this.node('table',undefined,'playlist-map-table'),head=this.node('tr');for(const title of ['Story field','Source column / property','Transform','Fixed value / fallback'])head.append(this.node('th',title));const thead=this.node('thead');thead.append(head);table.append(thead);const body=this.node('tbody');table.append(body);target.append(table);
    const normal=text=>String(text).toLowerCase().replace(/[^a-z0-9]/g,'');
    const controls=[...this.schema.fields.map(field=>({...field,content:true})),{key:'enabled',title:'Published / enabled',aliases:['Published','Enabled'],empty:'All stories enabled'},{key:'order',title:'Order',empty:'Source row / array order'},{key:'id',title:'Story ID',aliases:['StoryID','ID'],empty:'Use content identity'}];
    for(const field of controls){
      let chosen=field.content?saved?.fields?.[field.key]:saved?.[field.key];
      if(!saved){const names=[field.key,field.title,...(field.aliases||[])].map(normal),matches=columns.filter(([path])=>names.includes(normal(this.format==='json'?path.split('/').pop():path)));if(matches.length===1)chosen=this.format==='sheet'?{kind:'column',name:matches[0][0]}:{kind:'property',pointer:matches[0][0]};}
      const options=[['',field.empty||'Unused'],['fixed','Fixed value'],...columns.map(([path,label])=>['ref:'+path,label])];
      const selected=!chosen?'':chosen.kind==='static'?'fixed':'ref:'+(chosen.name??chosen.pointer);if(chosen&&selected.startsWith('ref:')&&!options.some(([key])=>key===selected))options.push([selected,(chosen.name??chosen.pointer)+' (missing — remap)']);
      const input=this.select(options,selected,field.title+' mapping'),text=this.node('input');text.value=chosen?.kind==='static'?chosen.value:chosen?.fallback||'';text.placeholder=selected==='fixed'?'Fixed value':'Fallback for blank values';text.setAttribute('aria-label',field.title+' fallback or fixed value');
      const transformCell=this.node('td');let transformSelect,prefix;
      if(field.content){transformSelect=this.select([['none','None'],['uppercase','Uppercase'],['lowercase','Lowercase'],['trim','Trim whitespace'],['prefix','Prefix text']],chosen?.transform?.kind||'none',field.title+' transform');prefix=this.node('input');prefix.value=chosen?.transform?.kind==='prefix'?chosen.transform.value:'';prefix.placeholder='Prefix';prefix.maxLength=200;prefix.setAttribute('aria-label',field.title+' transform prefix');transformCell.append(transformSelect,prefix);}else transformCell.textContent='—';
      const set=()=>{let ref;if(input.value==='fixed')ref={kind:'static',value:text.value};else if(input.value.startsWith('ref:'))ref=this.format==='sheet'?{kind:'column',name:input.value.slice(4)}:{kind:'property',pointer:input.value.slice(4)};if(ref&&ref.kind!=='static'&&text.value)ref.fallback=text.value;if(ref&&transformSelect&&transformSelect.value!=='none')ref.transform={kind:transformSelect.value,...(transformSelect.value==='prefix'?{value:prefix.value}:{})};const object=field.content?this.pick.fields:this.pick;if(ref)object[field.key]=ref;else delete object[field.key];text.disabled=!input.value;if(transformSelect){transformSelect.disabled=!input.value;prefix.hidden=transformSelect.value!=='prefix';prefix.disabled=!input.value;}};set();input.onchange=()=>{set();this.change();};text.oninput=()=>{set();this.change();};if(transformSelect){transformSelect.onchange=()=>{set();this.change();};prefix.oninput=()=>{set();this.change();};}
      const row=this.node('tr'),source=this.node('td'),fallback=this.node('td');source.append(input);fallback.append(text);row.append(this.node('th',field.title+(field.required?' *':'')),source,transformCell,fallback);body.append(row);
    }
    target.append(this.node('p','Headers are matched by name, so columns can move. Renamed or missing headers need remapping. Unchecked rows are excluded; blank rows are ignored.','hint'));
  }
  currentBinding(){return {connection:this.connectionId,selection:structuredClone(this.pick)};}
  async preview(){
    clearTimeout(this.timer);const sequence=++this.sequence;this.$('use-playlist').disabled=true;
    if(!this.connectionId)return;
    try{
      const binding=this.currentBinding(),edits=[...this.model.edits.values()].filter(edit=>edit.field!==this.field.field);edits.push({field:this.field.field,scope:this.$('mapping-scope').value,binding});
      const data=await this.workspace.request(`/data/mappings/${this.stage}/${encodeURIComponent(this.graphic)}/preview`,{edits});if(sequence!==this.sequence||!this.$('playlist-dialog').open)return;
      const field=data.fields.find(field=>field.field===this.field.field),report=field.collection;this.report=report;
      this.$('playlist-status').textContent=field.error||`${report?.included??0} stories included · ${report?.excluded??0} unpublished · source updates apply after the visible stories finish`;
      this.$('playlist-status').className=field.error?'warning':'connected';this.$('use-playlist').disabled=Boolean(field.error)||!report;this.validBinding=field.error?null:binding;this.renderResult(report);
    }catch(error){if(sequence===this.sequence){this.$('playlist-status').textContent=error.message;this.$('playlist-status').className='warning';this.validBinding=null;this.renderResult(null);}}
  }
  renderResult(report){const target=this.$('playlist-result');target.replaceChildren();if(!report)return;const table=this.node('table'),head=this.node('tr');for(const title of ['Source','Playback','State',...this.schema.fields.map(field=>field.title),'Problem'])head.append(this.node('th',title));const thead=this.node('thead');thead.append(head);table.append(thead);const body=this.node('tbody');for(const entry of report.rows){if(entry.status==='blank')continue;const row=this.node('tr');row.className=entry.status==='invalid'?'field-warning':'';for(const text of [entry.location,entry.position??'—',entry.status,...this.schema.fields.map(field=>entry.values[field.key]||''),entry.error||''])row.append(this.node('td',text));body.append(row);}table.append(body);target.append(table);}
  apply(){if(this.$('use-playlist').disabled||!this.validBinding||this.workspace.model!==this.model)return;this.workspace.selectedField=this.field.field;this.workspace.assign(this.validBinding);this.close();}
  close(){clearTimeout(this.timer);this.sequence++;this.$('playlist-dialog').close();}
};
