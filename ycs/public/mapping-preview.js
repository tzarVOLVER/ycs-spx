// Isolated mapping monitor: no playback subscription, command or health report.
let frame, template, data, pending, running=false, sequence=0;
const report=(error='')=>parent.postMessage({type:'ycs-mapping-preview-status',error},location.origin);
function bounded(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Template preview timed out')),8000);})]).finally(()=>clearTimeout(timer));}
async function drain(){
  if(running)return;running=true;
  while(pending){const graphic=pending;pending=null;const current=++sequence;
    try{
      if(!graphic.template.startsWith('/templates/')||graphic.template.includes('..'))throw new Error('Invalid preview template');
      if(template!==graphic.template){
        frame?.remove();frame=document.createElement('iframe');frame.title='Graphic mapping preview';frame.style.background='transparent';template=graphic.template;data=undefined;
        const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(new Error('Template could not be loaded'));});frame.src=template;document.body.append(frame);await bounded(loaded);
        if(typeof frame.contentWindow.update!=='function'||typeof frame.contentWindow.play!=='function')throw new Error('Template is missing update/play functions');
        await bounded(Promise.resolve(frame.contentWindow.update(JSON.stringify(graphic.data))));await bounded(Promise.resolve(frame.contentWindow.play()));
      }else if(data!==JSON.stringify(graphic.data))await bounded(Promise.resolve(frame.contentWindow.update(JSON.stringify(graphic.data))));
      data=JSON.stringify(graphic.data);if(current===sequence)report();
    }catch(error){template=undefined;report(error.message);}
  }running=false;
}
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='ycs-mapping-preview')return;pending=event.data.graphic;if(pending&&typeof pending.template==='string'&&pending.data)drain();});
parent.postMessage({type:'ycs-mapping-preview-ready'},location.origin);
