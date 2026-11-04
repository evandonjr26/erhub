/* v1.7 — marcadores visuais sobre as ondas reais de cada áudio. */
(() => {
  'use strict';
  const previous=document.getElementById('clapSimple'),panel=document.querySelector('.sync-panel');
  if(!previous||!panel||document.getElementById('waveMarkerSimple'))return;
  const $=id=>document.getElementById(id),videos=[v1,v2],marks=[null,null],chosen=[null,null];
  let waves=[null,null],gain=[1,1],active=0,frame=0,synced=false;
  const both=()=>marks[0]!==null&&marks[1]!==null;
  const fmt=t=>{t=Math.max(0,Number(t)||0);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t%60)).padStart(2,'0')+','+String(Math.floor((t%1)*100)).padStart(2,'0')};
  const clip=(t,v)=>Math.max(0,Math.min(Math.max(0,(Number(v.duration)||0)-.01),t));
  const get=(slot)=>chosen[slot-1]??videos[slot-1].currentTime??0;
  const view=(slot)=>{
    const same=both()&&!active,offset=same&&slot===2?marks[1]-marks[0]:0;
    const t=same?marks[0]:(active===slot?videos[slot-1].currentTime:(marks[slot-1]??get(slot)));
    return {start:Math.max(0,t-3.5),offset,span:8,same};
  };
  const ui=document.createElement('section');ui.id='waveMarkerSimple';ui.className='clap-simple marker-simple';
  ui.innerHTML='<p class="clap-simple-intro">▶ Ouça a palma, <b>toque no pico da onda</b> e depois em <b>📍 Marcar</b>.</p>'+
    [1,2].map(n=>'<div class="clap-simple-step" id="wmCard'+n+'">'+
    '<div class="clap-simple-title"><span class="clap-step-num">'+n+'</span><strong>Áudio '+n+'</strong><span class="clap-simple-done" id="wmDone'+n+'">Aguardando</span></div>'+
    '<div class="clap-simple-actions"><button id="wmListen'+n+'" class="clap-listen" type="button" disabled>▶ Ouvir</button><button id="wmMark'+n+'" class="clap-mark" type="button" disabled>📍 Marcar</button></div>'+
    '<div class="wm-wave-title"><span>Onda do áudio '+n+'</span><span id="wmWaveLabel'+n+'">Preparando…</span></div>'+
    '<canvas class="wm-canvas" id="wmCanvas'+n+'" width="600" height="120" tabindex="0" role="slider" aria-label="Onda do áudio '+n+'. Toque ou arraste para escolher um pico da palma" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></canvas>'+
    '<div class="wm-legend"><span>│ Cursor branco</span><span>│ Marcador amarelo</span></div>'+
    '<div class="clap-simple-seek"><input id="wmSeek'+n+'" type="range" min="0" max="1" step="0.01" value="0" disabled aria-label="Navegar pelo áudio '+n+'"/><span id="wmTime'+n+'">00:00,00</span></div></div>').join('')+
    '<div id="wmAligned" class="wm-aligned" hidden>✓ Os dois marcadores estão alinhados nas ondas. Confira e sincronize.</div>'+
    '<button type="button" id="wmSync" class="clap-sync" disabled>✓ SINCRONIZAR VÍDEOS</button>'+
    '<div id="wmMessage" class="clap-simple-result" role="status" aria-live="polite">Carregue as duas câmeras.</div>'+
    '<button type="button" id="wmCheck" class="clap-check" hidden>▶ Conferir sincronização</button>'+
    '<small class="clap-simple-help">Pode voltar pela barrinha, tocar ou arrastar na onda e remarcar. A onda só mostra áudio real do arquivo.</small>';
  previous.before(ui);previous.hidden=true;
  const h=panel.querySelector('.sync-heading strong'),small=panel.querySelector('.sync-heading small');
  if(h)h.textContent='Sincronizar com marcadores';
  if(small)small.textContent='OUVIR · VER A ONDA · MARCAR · ALINHAR';
  const help=document.querySelector('.sources .help-tip p');
  if(help)help.textContent='Ouça cada áudio, toque no pico da palma e marque. Sincronize quando os dois marcadores estiverem posicionados.';
  function gainOf(w){
    if(!w?.peaks?.length)return 1;
    const values=[],step=Math.max(1,Math.floor(w.peaks.length/1000));
    for(let j=0;j<w.peaks.length;j+=step)if(w.peaks[j]>4)values.push(w.peaks[j]);
    values.sort((a,b)=>a-b);return Math.max(14,values[Math.floor(values.length*.96)]||14);
  }
  function draw(slot){
    const canvas=$('wmCanvas'+slot),ctx=canvas.getContext('2d');
    if(!ctx)return;
    const rect=canvas.getBoundingClientRect(),w=Math.max(100,Math.round(rect.width||320)),h=Math.max(70,Math.round(rect.height||92));
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#09141b';ctx.fillRect(0,0,w,h);
    const {start,offset,span,same}=view(slot),wave=waves[slot-1];
    ctx.lineWidth=1;ctx.strokeStyle='#294451';ctx.fillStyle='#99acb9';ctx.font='10px system-ui';
    for(let n=0;n<=4;n++){const x=w*n/4;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.fillText(fmt(start+offset+span*n/4).slice(0,5),Math.min(w-34,x+3),12)}
    ctx.strokeStyle='#40535d';ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
    if(wave?.peaks?.length){
      const step=Number(wave.step)||.02,peaks=wave.peaks,max=gain[slot-1];
      ctx.fillStyle=slot===1?'#43dfaa':'#70a5ff';
      for(let x=0;x<w;x++){
        const begin=Math.max(0,Math.floor((start+offset+x/w*span)/step));
        const end=Math.min(peaks.length-1,Math.ceil((start+offset+(x+1)/w*span)/step));
        let p=0;for(let j=begin;j<=end;j++)p=Math.max(p,peaks[j]||0);
        if(p){const hh=Math.max(1,Math.min((h-26)/2,Math.sqrt(p/max)*(h-26)*.43));ctx.fillRect(x,h/2-hh,1.5,2*hh)}
      }
    }else{ctx.fillStyle='#adc3d0';ctx.font='12px system-ui';ctx.fillText(ready[slot-1]?'Preparando onda de áudio…':'Selecione o vídeo '+slot,12,h/2-10)}
    const mark=marks[slot-1];
    if(mark!==null){
      const x=(mark-offset-start)/span*w;
      if(x>=0&&x<=w){ctx.strokeStyle='#ffcc65';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.fillStyle='#ffcc65';ctx.fillRect(x-5,0,10,7)}
    }
    const cursor=get(slot),cursorX=(cursor-offset-start)/span*w;
    if(cursorX>=0&&cursorX<=w){ctx.strokeStyle='white';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(cursorX,14);ctx.lineTo(cursorX,h);ctx.stroke()}
    if(same&&mark!==null){ctx.fillStyle='#ffcc65';ctx.font='bold 10px system-ui';ctx.fillText('✓ ALINHADO',w-83,h-8)}
    canvas.setAttribute('aria-valuemax',String(Number(videos[slot-1].duration)||0));
    canvas.setAttribute('aria-valuenow',String(Math.round(cursor*100)/100));
    canvas.setAttribute('aria-valuetext',fmt(cursor));
  }
  function redraw(){draw(1);draw(2)}
  function refresh(){
    for(let slot=1;slot<=2;slot++){
      const video=videos[slot-1],ok=!!ready[slot-1],seek=$('wmSeek'+slot);
      $('wmListen'+slot).disabled=!ok;$('wmMark'+slot).disabled=!ok;seek.disabled=!ok;
      if(ok){seek.max=String(Math.max(.01,video.duration-.01));if(document.activeElement!==seek)seek.value=String(clip(get(slot),video))}
      $('wmTime'+slot).textContent=fmt(get(slot));
      $('wmDone'+slot).textContent=marks[slot-1]===null?(ok?'Escolha o pico':'Aguardando'):'📍 '+fmt(marks[slot-1]);
      $('wmCard'+slot).classList.toggle('is-marked',marks[slot-1]!==null);
      $('wmListen'+slot).textContent=active===slot&&!video.paused?'Ⅱ Pausar':'▶ Ouvir';
      $('wmWaveLabel'+slot).textContent=waves[slot-1]?.peaks?.length?'Toque no pico':'Aguardando onda…';
    }
    $('wmSync').disabled=!ready.every(Boolean)||!both();$('wmAligned').hidden=!both();redraw();
  }
  function say(t,state='idle'){$('wmMessage').textContent=t;$('wmMessage').dataset.state=state}
  function stop(){
    if(frame)cancelAnimationFrame(frame);frame=0;
    if(active){videos.forEach(v=>v.pause());active=0;applyAudioSource()}
    refresh();
  }
  function tick(){if(!active)return;const v=videos[active-1];if(v.paused||v.ended){stop();return}refresh();frame=requestAnimationFrame(tick)}
  function listen(slot){
    if(!ready[slot-1])return;
    const v=videos[slot-1];
    if(active===slot&&!v.paused){stop();return}
    stop();pause();active=slot;chosen[slot-1]=null;
    videos[0].muted=slot!==1;videos[1].muted=slot!==2;
    v.play().then(()=>{if(active===slot){refresh();frame=requestAnimationFrame(tick)}})
     .catch(()=>{stop();toast('Toque em Ouvir novamente para habilitar o áudio no Safari.')});
    refresh();
  }
  function seek(slot,t){
    if(!ready[slot-1])return;
    if(active)stop();
    const v=videos[slot-1],at=clip(t,v);chosen[slot-1]=at;
    try{v.currentTime=at}catch{}refresh();
  }
  function mark(slot){
    if(!ready[slot-1])return;
    const at=clip(get(slot),videos[slot-1]);stop();marks[slot-1]=Math.round(at*100)/100;chosen[slot-1]=marks[slot-1];
    synced=false;$('wmCheck').hidden=true;
    say(both()?'✓ Os dois marcadores estão alinhados visualmente. Confira e toque em SINCRONIZAR.':'✓ Marcador colocado. Agora marque o mesmo pico no outro áudio.','ready');
    refresh();
  }
  for(let slot=1;slot<=2;slot++){
    $('wmListen'+slot).onclick=()=>listen(slot);$('wmMark'+slot).onclick=()=>mark(slot);
    $('wmSeek'+slot).addEventListener('input',e=>seek(slot,Number(e.target.value)));
    const c=$('wmCanvas'+slot);let pointer=null,gesture=null;
    const at=e=>{
      const r=c.getBoundingClientRect(),x=Math.max(0,Math.min(r.width,e.clientX-r.left));
      return gesture.start+gesture.offset+(r.width?x/r.width*gesture.span:0);
    };
    c.addEventListener('pointerdown',e=>{
      if(!ready[slot-1])return;
      e.preventDefault();pointer=e.pointerId;gesture=view(slot);
      try{c.setPointerCapture(pointer)}catch{}
      seek(slot,at(e));
    });
    c.addEventListener('pointermove',e=>{if(pointer===e.pointerId&&gesture)seek(slot,at(e))});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])c.addEventListener(type,e=>{if(pointer===e.pointerId){pointer=null;gesture=null}});
    c.addEventListener('keydown',e=>{
      if(!ready[slot-1]||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();let t=get(slot);
      t=e.key==='Home'?0:e.key==='End'?videos[slot-1].duration-.01:t+(e.key==='ArrowLeft'?-0.01:0.01);
      seek(slot,t);
    });
    videos[slot-1].addEventListener('loadedmetadata',refresh);
    videos[slot-1].addEventListener('timeupdate',()=>{if(!active)refresh()});
    $('file'+slot).addEventListener('change',()=>{
      stop();marks[0]=marks[1]=null;chosen[0]=chosen[1]=null;waves=[null,null];synced=false;
      $('wmCheck').hidden=true;say('Ouça cada áudio, toque no pico da palma e marque.');refresh();
    });
  }
  $('wmSync').onclick=()=>{
    if(!ready.every(Boolean)||!both())return;
    stop();const offset=Math.round((marks[1]-marks[0])*100)/100;
    const overlap=Math.min(v1.duration-Math.max(0,-offset),v2.duration-Math.max(0,offset));
    if(!Number.isFinite(overlap)||overlap<.25||Math.abs(offset)>900){say('Marque o mesmo som nas duas gravações e tente novamente.','error');return}
    applyOffset(offset);
    if(Math.abs(offsetSeconds-offset)>.011){say('Não foi possível aplicar o deslocamento. Confira os marcadores.','error');return}
    seekTo(Math.max(0,marks[0]-sourceStart1-.4));synced=true;
    say('✓ Sincronizado! Confira na Prévia antes de exportar.','success');$('wmCheck').hidden=false;refresh();
  };
  $('wmCheck').onclick=()=>{if(synced&&ready.every(Boolean)){stop();play()}};
  document.addEventListener('click',e=>{if(active&&e.target.closest?.('#previewBottom,#playBtn,#scene1,#scene2'))stop()},true);
  function hook(){
    const old=window.mesaWaveformsReady;
    if(typeof old!=='function'||old.__markerSimple)return false;
    const fn=function(data,...args){
      const answer=old.call(this,data,...args);
      if(Array.isArray(data?.waves)&&data.waves.length===2){waves=data.waves;gain=waves.map(gainOf);refresh()}
      return answer;
    };
    fn.__markerSimple=true;window.mesaWaveformsReady=fn;return true;
  }
  if(!hook())window.addEventListener('load',hook,{once:true});
  window.addEventListener('resize',redraw);refresh();
})();