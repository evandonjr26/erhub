/* Mesa de Corte v1.8 — barra simples de navegação abaixo do monitor */
(() => {
  'use strict';
  const previewBox = document.getElementById('previewBox');
  const originalSeek = document.getElementById('seek');
  if (!previewBox || !originalSeek || document.getElementById('simpleVideoNavigation')) return;
  const wrap = document.createElement('section');
  wrap.id = 'simpleVideoNavigation';
  wrap.className = 'simple-video-navigation';
  wrap.setAttribute('aria-label', 'Navegar pelo vídeo');

  const beginning = document.createElement('button');
  beginning.type = 'button';
  beginning.id = 'goVideoStart';
  beginning.className = 'simple-video-start';
  beginning.textContent = '⏮ Início';
  beginning.setAttribute('aria-label', 'Voltar ao início do vídeo sem apagar os cortes');

  const progress = document.createElement('input');
  progress.type = 'range';
  progress.id = 'simpleVideoSeek';
  progress.min = '0';
  progress.max = '1';
  progress.step = '0.01';
  progress.value = '0';
  progress.disabled = true;
  progress.setAttribute('aria-label','Arraste para qualquer ponto do vídeo');

  const time = document.createElement('span');
  time.id = 'simpleVideoTime';
  time.className = 'simple-video-time';
  time.textContent = '00:00 / 00:00';

  wrap.append(beginning, progress, time);
  previewBox.insertAdjacentElement('afterend',wrap);

  // A barra original continua funcionando por trás, para preservar a timeline.
  // Os botões de pular deixam de ocupar espaço na interface.
  ['backOne','fwdOne'].forEach(id => {
    const button=document.getElementById(id);
    if(button){button.setAttribute('aria-hidden','true');button.tabIndex=-1}
  });
  const fmt = seconds => {
    seconds=Math.max(0,Number(seconds)||0);
    const whole=Math.floor(seconds);
    const h=Math.floor(whole/3600),m=Math.floor((whole%3600)/60),s=whole%60;
    return h ? [h,m,s].map((v,i)=>String(v).padStart(i?2:1,'0')).join(':') :
      String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  };
  let scrubbing=false,wasPlaying=false;

  function refresh() {
    const available=ready.every(Boolean)&&Number.isFinite(duration)&&duration>.01;
    beginning.disabled=!available;
    progress.disabled=!available;
    const max=available?duration:1;
    progress.max=String(max);
    const now=available?Math.min(duration,Math.max(0,current())):0;
    if(!scrubbing)progress.value=String(now);
    const displayed=scrubbing?Math.min(max,Number(progress.value)||0):now;
    time.textContent=fmt(displayed)+' / '+fmt(available?duration:0);
    progress.style.setProperty('--seek-progress',(available?Math.min(100,Math.max(0,displayed/duration*100)):0)+'%');
  }
  function scrubTo(t) {
    if(!ready.every(Boolean))return;
    seekTo(Math.max(0,Math.min(duration,Number(t)||0)));
    refresh();
  }
  progress.addEventListener('pointerdown',()=>{
    if(progress.disabled)return;
    wasPlaying=playing;scrubbing=true;
    pause();
  });
  progress.addEventListener('input',event=>{
    if(progress.disabled)return;
    scrubTo(event.target.value);
  });
  const finish=()=>{
    if(!scrubbing)return;
    scrubbing=false;
    const resume=wasPlaying;wasPlaying=false;
    refresh();
    if(resume)void play();
  };
  progress.addEventListener('pointerup',finish);
  progress.addEventListener('pointercancel',finish);
  progress.addEventListener('change',finish);
  beginning.addEventListener('click',()=>{
    if(!ready.every(Boolean))return;
    pause();
    seekTo(0);
    refresh();
  });
  const v1Node=document.getElementById('video1');
  if(v1Node) {
    v1Node.addEventListener('loadedmetadata',refresh);
    v1Node.addEventListener('timeupdate',refresh);
    v1Node.addEventListener('seeked',refresh);
  }
  const v2Node=document.getElementById('video2');
  if(v2Node)v2Node.addEventListener('loadedmetadata',refresh);
  ['file1','file2'].forEach(id=>{
    const input=document.getElementById(id);
    if(input)input.addEventListener('change',()=>{scrubbing=false;refresh()});
  });
  // A prévia usa um relógio de reprodução via requestAnimationFrame e não emite
  // atualizações de tempo a cada quadro; acompanhar sem alterar a lógica do editor.
  let last=0;
  function watch(now) {
    if(now-last>110){last=now;refresh()}
    requestAnimationFrame(watch);
  }
  requestAnimationFrame(watch);
  refresh();
})();