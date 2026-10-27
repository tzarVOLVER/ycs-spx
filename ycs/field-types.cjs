'use strict';
const types={textfield:'Text',textarea:'Text',number:'Number',checkbox:'Boolean',dropdown:'Choice',filelist:'Image / file',color:'Colour'};
function linkable(item,field) {return item.DataFields.some(def=>def.field===field&&Object.hasOwn(types,def.ftype));}
function normalizeField(field,value) {
  if(value===undefined||value===null||typeof value==='object') throw new Error('Select a single compatible value');
  const text=String(value);
  if(text.length>300) throw new Error('Value exceeds 300 characters');
  if(field.ftype==='number') {if(!text.trim()||!Number.isFinite(Number(text))) throw new Error('Expected a number');return String(Number(text));}
  if(field.ftype==='checkbox') {if(['1','true','yes','on'].includes(text.toLowerCase()))return '1';if(['0','false','no','off'].includes(text.toLowerCase()))return '0';throw new Error('Expected true/false or 1/0');}
  if(field.ftype==='color'&&!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text))throw new Error('Expected a hex colour');
  if(field.ftype==='filelist'&&/^\s*(?:javascript|data|vbscript):/i.test(text))throw new Error('Unsupported asset URL');
  if(field.ftype==='dropdown'&&Array.isArray(field.items)&&!field.items.some(item=>String(item.value??item.text??item)===text))throw new Error('Value is not in the template choices');
  return text;
}
module.exports={types,linkable,normalizeField};
