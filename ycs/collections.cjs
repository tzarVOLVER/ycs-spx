'use strict';
// Collection selectors describe records, not a particular ticker or sheet layout.
const {parseRange}=require('./public-sheets.cjs');
const LIMIT=65536, MAX_ITEMS=200;
const safeKey=key=>typeof key==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)&&!['constructor','prototype','__proto__'].includes(key);
function fail(message){const error=new Error(message);error.status=400;throw error;}
function pointer(value){if(typeof value!=='string'||value.length>2048||(value&&!/^\/(?:[^~]|~[01])*$/.test(value)))fail('Choose a valid JSON path');return value;}
function at(value,path){for(const token of path?path.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~')):[]){if(value===null||typeof value!=='object'||!Object.hasOwn(value,token))return undefined;value=value[token];}return value;}
function scalar(value,max=4000){if(value===null||value===undefined)return '';if(typeof value==='object'||!['string','number','boolean'].includes(typeof value)||String(value).length>max)throw new Error('Expected text up to '+max+' characters');return String(value);}
function boolean(value){if(typeof value==='boolean')return value;const text=String(value??'').trim().toLowerCase();if(['true','1','yes','on'].includes(text))return true;if(['false','0','no','off',''].includes(text))return false;throw new Error('Published / enabled must be true or false');}
function normalizeSelection(input,settings){
  if(!input||input.kind!=='collection'||!['sheet','json'].includes(input.format))fail('Choose a spreadsheet range or JSON array');
  const result={kind:'collection',format:input.format};
  if(input.format==='sheet'){
    const range=parseRange(input.range),source=parseRange(settings.range),headerRow=Number(input.headerRow);
    if(range.firstRow<source.firstRow||range.lastRow>source.lastRow||range.firstColumn<source.firstColumn||range.lastColumn>source.lastColumn)fail('Playlist range must be inside the saved connection range');
    if(!Number.isInteger(headerRow)||headerRow<range.firstRow||headerRow>=range.lastRow)fail('Choose a header row inside the playlist range, before the stories');
    Object.assign(result,{range:range.a1,headerRow});
  }else result.pointer=pointer(input.pointer);
  if(!input.fields||Array.isArray(input.fields)||typeof input.fields!=='object'||!Object.keys(input.fields).length||Object.keys(input.fields).length>20)fail('Map at least one story field');
  function pick(value){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('Choose a story property');
    if(value.kind==='static')return {kind:'static',value:scalar(value.value)};
    const extra=value.fallback===undefined?{}:{fallback:scalar(value.fallback)};
    if(input.format==='sheet'&&value.kind==='column'&&typeof value.name==='string'&&value.name.trim()&&value.name.length<=300)return {kind:'column',name:value.name,...extra};
    if(input.format==='json'&&value.kind==='property')return {kind:'property',pointer:pointer(value.pointer),...extra};
    fail('Choose a compatible column or JSON property');
  }
  result.fields={};for(const [key,value]of Object.entries(input.fields)){if(!safeKey(key)||key==='id')fail('Invalid story field');result.fields[key]=pick(value);}
  result.required=Array.isArray(input.required)?input.required:[];
  if(result.required.some(key=>!safeKey(key))||result.required.length>20)fail('Invalid required story fields');
  for(const key of ['enabled','order','id'])if(input[key])result[key]=pick(input[key]);
  return result;
}
function resolveCollection(data,pick){
  let records,read,location;
  if(pick.format==='sheet'){
    if(!Array.isArray(data))throw new Error('Waiting for the first successful sheet read');
    const range=parseRange(pick.range),number=cell=>Number(cell?.address?.match(/\d+$/)?.[0]),column=cell=>{const letters=cell?.address?.match(/^[A-Z]+/)?.[0]||'';return [...letters].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);};
    const inside=row=>row.filter(cell=>column(cell)>=range.firstColumn&&column(cell)<=range.lastColumn);
    const header=inside(data.find(row=>number(row[0])===pick.headerRow)||[]),names=header.map(cell=>cell.value);
    const referenced=[...Object.values(pick.fields),pick.enabled,pick.order,pick.id].filter(value=>value?.kind==='column');
    for(const ref of referenced)if(names.filter(name=>name===ref.name).length!==1)throw new Error('Column is missing or duplicated: '+ref.name+'. Remap the header; column positions are not guessed.');
    records=data.filter(row=>number(row[0])>pick.headerRow&&number(row[0])<=range.lastRow&&number(row[0])>=range.firstRow).map(inside);
    read=(row,ref)=>ref.kind==='static'?ref.value:row[names.indexOf(ref.name)]?.value;
    location=row=>'Row '+number(row[0]);
  }else{
    records=at(data,pick.pointer);if(!Array.isArray(records))throw new Error('The selected JSON path must contain an array of stories');
    read=(row,ref)=>ref.kind==='static'?ref.value:at(row,ref.pointer);location=(_,index)=>'Item '+(index+1);
  }
  const get=read;read=(record,ref)=>{const value=get(record,ref);return value===undefined||value===null||value===''?ref.fallback??value:value;};
  if(records.length>MAX_ITEMS)throw new Error('Use a playlist of at most '+MAX_ITEMS+' stories');
  const rows=[],valid=[],ids=new Set();
  for(const [index,record]of records.entries()){
    const detail={location:location(record,index),status:'included',values:{}};rows.push(detail);
    try{
      if(pick.format==='sheet'&&record.every(cell=>!String(cell.value??'').trim())){detail.status='blank';continue;}
      if(pick.enabled&&!boolean(read(record,pick.enabled))){detail.status='excluded';for(const [key,ref]of Object.entries(pick.fields)){try{detail.values[key]=scalar(read(record,ref));}catch{detail.values[key]='';}}continue;}
      for(const [key,ref]of Object.entries(pick.fields))detail.values[key]=scalar(read(record,ref));
      for(const key of pick.required)if(!detail.values[key]?.trim())throw new Error('Missing required story field: '+key);
      if(pick.id){const id=scalar(read(record,pick.id),200).trim();if(!id)throw new Error('Story ID is empty');if(ids.has(id))throw new Error('Duplicate Story ID: '+id);ids.add(id);detail.values.id=id;}
      const order=pick.order?scalar(read(record,pick.order),100):String(index);
      if(!order.trim()||!Number.isFinite(Number(order)))throw new Error('Order must be a number');
      valid.push({values:detail.values,order:Number(order),index,detail});
    }catch(error){detail.status='invalid';detail.error=error.message;}
  }
  valid.sort((a,b)=>a.order-b.order||a.index-b.index);
  valid.forEach((item,index)=>item.detail.position=index+1);
  const items=valid.map(item=>item.values),value=JSON.stringify(items),invalid=rows.filter(row=>row.status==='invalid').length;
  if(Buffer.byteLength(value,'utf8')>LIMIT)throw new Error('Playlist exceeds 64 KB; choose fewer or shorter stories');
  return {items,value,rows,included:items.length,excluded:rows.filter(row=>row.status==='excluded').length,invalid,error:invalid?invalid+' invalid stor'+(invalid===1?'y':'ies')+'; holding the last valid playlist':''};
}
function schema(field){const value=field?.ycsCollection;if(!value||value.version!==1||!Array.isArray(value.fields)||!value.fields.length||value.fields.length>20)return null;const keys=new Set();for(const item of value.fields){if(!safeKey(item.key)||item.key==='id'||keys.has(item.key))return null;keys.add(item.key);}return value;}
function normalizeValue(field,value){
  const definition=schema(field);if(!definition)throw new Error('Template does not declare a supported story collection');
  if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>LIMIT)throw new Error('Playlist must be JSON up to 64 KB');
  let items;try{items=JSON.parse(value);}catch{throw new Error('Playlist must be a JSON array');}
  if(!Array.isArray(items)||items.length>MAX_ITEMS)throw new Error('Playlist must contain at most 200 stories');
  const ids=new Set();for(const item of items){if(!item||Array.isArray(item)||typeof item!=='object')throw new Error('Every story must be an object');for(const field of definition.fields){const value=item[field.key];if(value!==undefined&&typeof value!=='string')throw new Error(field.title+' must be text');if((value||'').length>4000)throw new Error(field.title+' is too long');if(field.required&&!value?.trim())throw new Error(field.title+' is required');}if(item.id!==undefined){if(typeof item.id!=='string'||!item.id.trim()||item.id.length>200||ids.has(item.id))throw new Error('Story IDs must be nonempty and unique');ids.add(item.id);}}
  return JSON.stringify(items.map(item=>Object.fromEntries([...definition.fields.filter(field=>item[field.key]!==undefined).map(field=>[field.key,item[field.key]]),...(item.id===undefined?[]:[['id',item.id]])])));
}
module.exports={normalizeSelection,resolveCollection,schema,normalizeValue,LIMIT,at,pointer};
