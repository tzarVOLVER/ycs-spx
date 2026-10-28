'use strict';
const {schema,normalizeValue}=require('./collections.cjs');
const types={textfield:'Text',textarea:'Text',number:'Number',checkbox:'Boolean',dropdown:'Choice',filelist:'Image / file',color:'Colour'};
function linkable(item,field) {return item.DataFields.some(def=>def.field===field&&Object.hasOwn(types,def.ftype));}
function normalizeField(field,value,{manual=false}={}) {
  if(schema(field))return normalizeValue(field,value);
  if(value===undefined||value===null||typeof value==='object') throw new Error('Select a single compatible value');
  const text=String(value);
  const limit=manual&&field.ftype==='textarea'?65536:300;
  if(text.length>limit) throw new Error('Value exceeds '+limit+' characters');
  if(field.required===true&&!text.trim())throw new Error('A value is required');
  if(field.ftype==='number') {
    if(!text.trim()||!Number.isFinite(Number(text))) throw new Error('Expected a number');
    const number=Number(text);
    if(field.min!==undefined&&Number.isFinite(Number(field.min))&&number<Number(field.min))throw new Error('Minimum value is '+field.min);
    if(field.max!==undefined&&Number.isFinite(Number(field.max))&&number>Number(field.max))throw new Error('Maximum value is '+field.max);
    return String(number);
  }
  if(field.ftype==='checkbox') {if(['1','true','yes','on'].includes(text.toLowerCase()))return '1';if(['0','false','no','off'].includes(text.toLowerCase()))return '0';throw new Error('Expected true/false or 1/0');}
  if(field.ftype==='color'&&!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text))throw new Error('Expected a hex colour');
  if(field.ftype==='filelist'&&/^\s*(?:javascript|data|vbscript):/i.test(text))throw new Error('Unsupported asset URL');
  if(field.ftype==='dropdown'&&Array.isArray(field.items)&&!field.items.some(item=>String(item.value??item.text??item)===text))throw new Error('Value is not in the template choices');
  return text;
}
module.exports={types,linkable,normalizeField};
