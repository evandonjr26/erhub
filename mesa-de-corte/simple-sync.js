/* Mesa de Corte v1.5: sincronização simples, sem alterar exportação */
(() => {
  'use strict';
  const panel=document.querySelector('.sync-panel'), sources=[v1,v2];
  if(!panel||!sources.every(Boolean)||document.getElementById('clapSimple'))return;
  const heading=panel.querySelector('.sync-heading');
  if(heading){
    const title=heading.querySelector('strong'),sub=heading.querySelector('small');
    if(title)title.textContent='Sincronizar pelas palmas';
    if(sub)sub.textContent='OUVIR · MARCAR · SINCRONIZAR';
  }
  const section=document.createElement('section');
  section.id='clapSimple';section.className='clap-simple';section.setAttribute('aria-label','Sincronização fácil em três passos');
  section.innerHTML=[
    '<p class="clap-simple-intro">Ouça a palma em cada gravação e toque em <b>Marcar palma</b>. Depois toque em <b>Sincronizar</b>.</p>',
    '<div class="clap-simple-step" id="clapCard1"><div class="clap-simple-title"><span class="clap-step-num">1</span><strong>Câmera 1</strong><span class="clap-simple-done" id="clapDone1">Aguardando</span></div>',
    '<div class="clap-simple-actions"><button type="button" class="clap-listen" id="clapPlay1" disabled>▶ Ouvir</button><button type="button" class="clap-mark" id="clapMark1" disabled>👏 Marcar palma</button></div>',
    '<div class="clap-simple-seek"><input type="range" id="clapSeek1" min="0" max="1" step="0.01" value="0" disabled aria-label="Avançar ou voltar no áudio da câmera 1"><span id="clapTime1">00:00</span></div></div>',
    '<div class="clap-simple-step" id="clapCard2"><div class="clap-simple-title"><span class="clap-step-num">2</span><strong>Câmera 2</strong><span class="clap-simple-done" id="clapDone2">Aguardando</span></div>',
    '<div class="clap-simple-actions"><button type="button" class="clap-listen" id="clapPlay2" disabled>▶ Ouvir</button><button type="button" class="clap-mark" id="clapMark2" disabled>👏 Marcar palma</button></div>',
    '<div class="clap-simple-seek"><input type="range" id="clapSeek2" min="0" max="1" step="0.01" value="0" disabled aria-label="Avançar ou voltar no áudio da câmera 2"><span id="clapTime2">00:00</span></div></div>',
    '<button type="button" id="clapDoSync" class="clap-sync" disabled>3 · ✓ SINCRONIZAR VÍDEOS</button>',
    '<div id="clapSimpleResult" class="clap-simple-result" role="status" aria-live="polite">Carregue as duas câmeras para começar.</div>',
    '<button type="button" id="clapCheck" class="clap-check" hidden>▶ Conferir sincronização</button>',
    '<small class="clap-simple-help">Passou da palma? Volte um pouco na barrinha e ouça novamente. Pode remarcar quantas vezes quiser.</small>'
  ].join('');
  const advanced=document.createElement('details');advanced.className='clap-advanced';
  const summary=document.createElement('summary');summary.textContent='⚙️ Ajuste avançado (ondas e precisão)';
  const advancedContent=document.createElement('div');advancedContent.className='clap-advanced-content';
  const audioLabel=panel.querySelector('label[for="audioSource"]');
  const audioSelect=panel.querySelector('#audioSource');
  const audioNote=panel.querySelector('.sync-note');
  const keep=new Set([heading,audioLabel,audioSelect,audioNote]);
  for(const child of [...panel.children])if(!keep.has(child))advancedContent.appendChild(child);
  advanced.append(summary,advancedContent);
  panel.append(section,advanced);
  if(audioLabel)panel.appendChild(audioLabel);
  if(audioSelect)panel.appendChild(audioSelect);
  if(audioNote)panel.appendChild(audioNote);
  const tip=document.querySelector('.sources .help-tip p');
  if(tip)tip.textContent='Toque em Ouvir, marque a mesma palma nas duas câmeras e sincronize. Não é preciso comparar ondas.';
  const el=id=>document.getElementById(id);
  let marks=[null,null],listening=0,frameId=0,synched=false;
  function clock(seconds){
    const t=Math.max(0,Number(seconds)||0);
    return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t%60)).padStart(2,'0');
  }
  function refresh(){
    for(let slot=1;slot<=2;slot++){
      const ok=Boolean(ready[slot-1]),video=sources[slot-1],seek=el('clapSeek'+slot);
      el('clapPlay'+slot).disabled=!ok;el('clapMark'+slot).disabled=!ok;seek.disabled=!ok;
      if(ok&&Number.isFinite(video.duration)){
        seek.max=String(Math.max(.01,video.duration-.01));
        if(document.activeElement!==seek)seek.value=String(Math.max(0,Math.min(video.duration-.01,video.currentTime||0)));
      }
      el('clapTime'+slot).textContent=clock(video.currentTime);
      const marked=marks[slot-1]!==null;
      el('clapDone'+slot).textContent=marked?'✓ Palma marcada':(ok?'Falta marcar':'Aguardando');
      el('clapCard'+slot).classList.toggle('is-marked',marked);
      el('clapPlay'+slot).textContent=listening===slot&&!video.paused?'Ⅱ Pausar':'▶ Ouvir';
    }
    el('clapDoSync').disabled=!ready.every(Boolean)||marks.some(t=>t===null);
  }
  function stopListening(){
    if(frameId)cancelAnimationFrame(frameId);frameId=0;
    if(listening){sources[0].pause();sources[1].pause();listening=0;applyAudioSource();}
    refresh();
  }
  function followPlayback(){
    if(!listening)return;
    const video=sources[listening-1];
    if(video.paused||video.ended){stopListening();return}
    refresh();frameId=requestAnimationFrame(followPlayback);
  }
  function listen(slot){
    const video=sources[slot-1];if(!ready[slot-1])return;
    if(listening===slot&&!video.paused){stopListening();return}
    stopListening();pause();listening=slot;
    sources[0].muted=slot!==1;sources[1].muted=slot!==2;
    video.play().then(()=>{
      if(listening!==slot)return;
      refresh();frameId=requestAnimationFrame(followPlayback);
    }).catch(()=>{
      stopListening();toast('Não foi possível reproduzir. Toque em Ouvir novamente.');
    });
    refresh();
  }
  function mark(slot){
    if(!ready[slot-1])return;
    const moment=Number(sources[slot-1].currentTime);
    if(!Number.isFinite(moment)||moment<0){toast('Volte à palma e tente novamente.');return}
    stopListening();marks[slot-1]=moment;synched=false;el('clapCheck').hidden=true;
    el('clapSimpleResult').textContent=marks.every(t=>t!==null)
      ?'As duas palmas foram marcadas. Toque em SINCRONIZAR VÍDEOS.'
      :'✓ Primeira palma marcada! Agora ouça a outra câmera.';
    el('clapSimpleResult').dataset.state='ready';refresh();
  }
  for(let slot=1;slot<=2;slot++){
    el('clapPlay'+slot).addEventListener('click',()=>listen(slot));
    el('clapMark'+slot).addEventListener('click',()=>mark(slot));
    el('clapSeek'+slot).addEventListener('input',event=>{
      if(!ready[slot-1])return;
      if(listening&&listening!==slot)stopListening();
      try{sources[slot-1].currentTime=Number(event.target.value)}catch{}
      el('clapTime'+slot).textContent=clock(sources[slot-1].currentTime);
    });
    sources[slot-1].addEventListener('loadedmetadata',refresh);
    sources[slot-1].addEventListener('ended',refresh);
    el('file'+slot).addEventListener('change',()=>{
      stopListening();marks=[null,null];synched=false;
      el('clapCheck').hidden=true;
      el('clapSimpleResult').textContent='Ouça a palma em cada câmera e marque.';
      el('clapSimpleResult').dataset.state='idle';refresh();
    });
  }
  el('clapDoSync').addEventListener('click',()=>{
    if(!ready.every(Boolean)||marks.some(t=>t===null))return;
    stopListening();
    const seconds=Math.round((marks[1]-marks[0])*100)/100;
    const overlap=Math.min(v1.duration-Math.max(0,-seconds),v2.duration-Math.max(0,seconds));
    if(!Number.isFinite(overlap)||overlap<.25||Math.abs(seconds)>900){
      el('clapSimpleResult').textContent='As marcações não têm tempo em comum. Confira as palmas e marque novamente.';
      el('clapSimpleResult').dataset.state='error';return;
    }
    applyOffset(seconds);
    if(Math.abs(offsetSeconds-seconds)>.011){
      el('clapSimpleResult').textContent='Não foi possível aplicar o alinhamento. Confira as marcações.';
      el('clapSimpleResult').dataset.state='error';return;
    }
    seekTo(Math.max(0,marks[0]-sourceStart1-.5));
    synched=true;
    el('clapSimpleResult').textContent='✓ Sincronizado! Confira o resultado antes de exportar.';
    el('clapSimpleResult').dataset.state='success';
    el('clapCheck').hidden=false;refresh();
  });
  el('clapCheck').addEventListener('click',()=>{if(synched&&ready.every(Boolean)){stopListening();play()}});
  for(const name of ['playBtn','scene1','scene2'])
    el(name).addEventListener('click',()=>{if(listening)stopListening()},true);
  refresh();
})();