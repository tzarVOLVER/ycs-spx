'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {PublicSheets}=require('../public-sheets.cjs');
const settings={url:'https://docs.google.com/spreadsheets/d/1PUBLIC_SHEET_TEST_1234567890/edit',worksheet:'Ticker',range:'A1:C4',refreshSeconds:5};
const response=values=>new Response('ycsSheet('+JSON.stringify({status:'ok',table:{cols:values[0].map(()=>({})),rows:values.map(row=>({c:row.map(value=>value===null?null:{v:value})}))}})+');',{headers:{'Content-Type':'application/javascript'}});
test('isolated header reads restore text above checkbox and numeric columns without losing original addresses',async()=>{
 const calls=[],sheets=new PublicSheets(async url=>{const range=url.searchParams.get('range');calls.push(range);if(range==='A1:C1')return response([['Published','Order','Subtopic']]);if(range==='A3:C3')return response([['Live','Priority','Message']]);return response([[null,null,'Subtopic'],[true,10,'Story'],[null,null,'Message'],[false,20,'Other']]);});
 const result=await sheets.read(settings,{headerRows:[1,3]});assert.deepEqual(calls,['A1:C4','A1:C1','A3:C3']);assert.equal(result.rows[0][0].value,'Published');assert.equal(result.rows[0][1].value,'Order');assert.equal(result.rows[1][0].value,'TRUE');assert.equal(result.rows[2][0].address,'A3');assert.equal(result.rows[2][0].value,'Live');assert.deepEqual(result.headerRows,[1,3]);
});
