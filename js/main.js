/* XCOPUNKS — shared static site logic */
(function(){
  var STORE='xcopunks_staked_v1', DAY=86400000;
  var B=(window.XCP_BASE||'');
  var GIF=[B+'assets/gif/1.gif',B+'assets/gif/2.gif',B+'assets/gif/3.gif',B+'assets/gif/4.gif'];
  var GOOGLE_SCRIPT_URL='https://script.google.com/macros/s/AKfycbzfw2pvnfAbzRwSK5mATsi0MN2sDhHxMQjKB_hcbVo1vTZOsysv5yIlGAmMWpsP-N4j/exec';

  function seeds(){ return [
    {uid:'seed1',id:'#7781',img:GIF[1],start:Date.UTC(2026,7,4,12,0,0),claimed:false},
    {uid:'seed2',id:'#8420',img:GIF[3],start:Date.UTC(2026,7,9,14,0,0),claimed:false},
    {uid:'seed3',id:'#9134',img:GIF[2],start:Date.UTC(2026,7,11,10,0,0),claimed:false} ]; }
  function loadStaked(){ try{ var r=localStorage.getItem(STORE); if(r) return JSON.parse(r); }catch(e){} var s=seeds(); saveStaked(s); return s; }
  function saveStaked(a){ try{ localStorage.setItem(STORE, JSON.stringify(a)); }catch(e){} }
  function ownedNFTs(){ return [
    {id:'#0417',img:GIF[0]},{id:'#1180',img:GIF[1]},{id:'#2093',img:GIF[2]},
    {id:'#3341',img:GIF[3]},{id:'#4602',img:GIF[1]},{id:'#5518',img:GIF[0]} ]; }
  function demoWallets(){ return [
    {addr:'0x9F2aE4b71C71',staked:42},{addr:'0x1b7Dc9930A9',staked:37},{addr:'0x4Ce20d1F8B2',staked:29},
    {addr:'0x77aB3e5540D',staked:18},{addr:'0xE0c81aa27C4',staked:11} ]; }
  function pad(n){ n=Math.max(0,Math.floor(n)); return (n<10?'0':'')+n; }
  function countdown(t,now){ var ms=t-now; if(ms<0) ms=0; return {d:pad(ms/DAY),h:pad((ms/3600000)%24),m:pad((ms/60000)%60),s:pad((ms/1000)%60)}; }
  function fmtPct(v){ if(!isFinite(v)||v<=0) return '0%'; return (Math.round(v*10000)/100)+'%'; }
  function fmtDate(ts){ var d=new Date(ts),M=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return d.getUTCDate()+' '+M[d.getUTCMonth()]+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+' UTC'; }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var SEASON_START=Date.UTC(2026,7,14,14,0,0), SEASON_END=Date.UTC(2026,7,21,14,0,0);
  var toastTimer;
  function toast(msg){ var t=document.getElementById('toast'); if(!t) return; t.textContent=msg; t.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.hidden=true;},2400); }

  /* ---- mobile menu (every page) ---- */
  function initMenu(){
    var b=document.getElementById('burger'), m=document.getElementById('menu'), c=document.getElementById('menuClose');
    if(b&&m) b.addEventListener('click',function(){ m.hidden=false; });
    if(c&&m) c.addEventListener('click',function(){ m.hidden=true; });
  }

  /* ---- HOME / gallery ---- */
  function initHome(){
    var intro=document.getElementById('intro');
    if(intro) setTimeout(function(){ intro.hidden=true; },4600);
    var walls=['NORTH','EAST','SOUTH','WEST'], n=GIF.length, gi=0;
    var front=document.getElementById('gFront'), west=document.getElementById('gWest'), east=document.getElementById('gEast');
    var idLbl=document.getElementById('gId'), wallLbl=document.getElementById('gWall'), idx=document.getElementById('gIdx');
    function paint(glitch){
      if(front){ front.src=GIF[gi]; if(glitch){ front.classList.remove('glitch-out'); void front.offsetWidth; front.classList.add('glitch-out'); } }
      if(west) west.src=GIF[(gi+n-1)%n];
      if(east) east.src=GIF[(gi+1)%n];
      if(idLbl) idLbl.textContent='XCO '+['#0417','#1180','#2093','#3341'][gi];
      if(wallLbl) wallLbl.textContent=walls[gi%4]+' WALL';
      if(idx) idx.textContent=(gi+1)+' / '+n;
    }
    var p=document.getElementById('gPrev'), b=document.getElementById('gBack'), nx=document.getElementById('gNext');
    if(p) p.addEventListener('click',function(){ gi=(gi-1+n)%n; paint(true); });
    if(nx) nx.addEventListener('click',function(){ gi=(gi+1)%n; paint(true); });
    if(b) b.addEventListener('click',function(){ gi=0; paint(true); });
    paint(false);
  }

  /* ---- STAKE ---- */
  function initStake(){
    var staked=loadStaked(), selected={};
    var grid=document.getElementById('ownedGrid'), empty=document.getElementById('ownedEmpty');
    var selCount=document.getElementById('selCount'), btn=document.getElementById('stakeBtn');
    function render(){
      var ids={}; staked.forEach(function(s){ ids[s.id]=true; });
      var owned=ownedNFTs().filter(function(o){ return !ids[o.id]; });
      grid.innerHTML='';
      if(!owned.length){ if(empty) empty.hidden=false; grid.hidden=true; } else { if(empty) empty.hidden=true; grid.hidden=false; }
      owned.forEach(function(c){
        var sel=!!selected[c.id];
        var d=document.createElement('div'); d.className='card'+(sel?' sel':'');
        d.innerHTML=(sel?'<div class="card-check">\u2713</div>':'')+'<img src="'+c.img+'" alt="XCOPUNKS NFT"><div class="card-body"><div class="card-id">XCO '+esc(c.id)+'</div><div class="card-badge">'+(sel?'SELECTED':'SELECT')+'</div></div>';
        d.addEventListener('click',function(){ selected[c.id]=!selected[c.id]; render(); });
        grid.appendChild(d);
      });
      var cnt=Object.keys(selected).filter(function(k){return selected[k];}).length;
      if(selCount) selCount.textContent='SELECTED: '+cnt;
      if(btn){ btn.textContent=cnt>0?('STAKE '+cnt+' XCOPUNKS'):'SELECT XCOPUNKS TO STAKE'; btn.disabled=cnt===0; btn.className='wl-submit'+(cnt>0?' ready':''); }
    }
    if(btn) btn.addEventListener('click',function(){
      var ids=Object.keys(selected).filter(function(k){return selected[k];});
      if(!ids.length) return;
      var owned=ownedNFTs();
      ids.forEach(function(id,i){ var o=owned.filter(function(x){return x.id===id;})[0]; staked.push({uid:'u'+Date.now()+'_'+i,id:id,img:o?o.img:GIF[0],start:Date.now(),claimed:false}); });
      saveStaked(staked); selected={}; render(); toast('Staked '+ids.length+' XCOPUNKS');
    });
    render();
  }

  /* ---- MY STAKING ---- */
  function initMyStaking(){
    var staked=loadStaked();
    var grid=document.getElementById('mineGrid'), empty=document.getElementById('mineEmpty');
    var uActive=document.getElementById('uActive'), uShare=document.getElementById('uShare'), uX=document.getElementById('uXcpn'), uE=document.getElementById('uEth');
    function totals(){ var t=demoWallets().reduce(function(a,b){return a+b.staked;},0)+staked.length; return {total:t, share:fmtPct(staked.length/t)}; }
    function render(){
      var now=Date.now(), t=totals();
      if(uActive) uActive.textContent=staked.length;
      if(uShare) uShare.textContent=t.share;
      if(uX) uX.textContent=t.share+' of pool · pending';
      if(uE) uE.textContent=t.share+' of pool · pending';
      grid.innerHTML='';
      if(!staked.length){ if(empty) empty.hidden=false; grid.hidden=true; return; }
      if(empty) empty.hidden=true; grid.hidden=false;
      staked.forEach(function(d){
        var unlock=d.start+7*DAY, cd=countdown(unlock,now), unlocked=now>=unlock;
        var el=document.createElement('div'); el.className='mcard'+(unlocked?' unlocked':'');
        el.innerHTML=
          '<div class="mtop"><img src="'+d.img+'" alt="staked XCOPUNKS"><div><div class="card-id">XCO '+esc(d.id)+'</div>'+
          '<div class="badge-state">'+(unlocked?'UNLOCKED':'LOCKED')+'</div>'+
          '<div class="mdates">Staked: '+fmtDate(d.start)+'<br>Unlock: '+fmtDate(unlock)+'</div></div></div>'+
          '<div class="mrew"><div><div class="l">$XCPN</div><div class="v" style="color:#ffe500">'+t.share+' · pending</div></div>'+
          '<div><div class="l">ETH</div><div class="v" style="color:#00e0ff">'+t.share+' · pending</div></div></div>'+
          '<div class="mfoot"><div class="mtimer">'+(unlocked?'CLAIM & UNSTAKE AVAILABLE':'TIME UNTIL 7-DAY UNLOCK')+'</div>'+
          '<div class="cd"><div class="cd-cell"><div class="cd-num">'+cd.d+'</div><div class="cd-lbl">DAY</div></div>'+
          '<div class="cd-cell"><div class="cd-num">'+cd.h+'</div><div class="cd-lbl">HR</div></div>'+
          '<div class="cd-cell"><div class="cd-num">'+cd.m+'</div><div class="cd-lbl">MIN</div></div>'+
          '<div class="cd-cell"><div class="cd-num">'+cd.s+'</div><div class="cd-lbl">SEC</div></div></div>'+
          '<div class="mact"><button class="'+(d.claimed?'claimed':'claim')+'" data-claim="'+d.uid+'"'+((unlocked&&!d.claimed)?'':' disabled')+'>'+(d.claimed?'CLAIMED':'CLAIM')+'</button>'+
          '<button class="unstake" data-unstake="'+d.uid+'"'+(unlocked?'':' disabled')+'>UNSTAKE</button></div></div>';
        grid.appendChild(el);
      });
      grid.querySelectorAll('[data-claim]').forEach(function(b){ b.addEventListener('click',function(){
        var uid=b.getAttribute('data-claim'), it=staked.filter(function(x){return x.uid===uid;})[0];
        if(!it||Date.now()<it.start+7*DAY) return; it.claimed=true; saveStaked(staked); render(); toast('Reward claim recorded'); }); });
      grid.querySelectorAll('[data-unstake]').forEach(function(b){ b.addEventListener('click',function(){
        var uid=b.getAttribute('data-unstake'), it=staked.filter(function(x){return x.uid===uid;})[0];
        if(!it||Date.now()<it.start+7*DAY) return; staked=staked.filter(function(x){return x.uid!==uid;}); saveStaked(staked); render(); toast('XCOPUNKS unstaked'); }); });
    }
    render(); setInterval(render,1000);
  }

  /* ---- SEASON 1 ---- */
  function initSeason(){
    var staked=loadStaked();
    var lblEl=document.getElementById('cdLabel');
    var cells={d:document.getElementById('cdD'),h:document.getElementById('cdH'),m:document.getElementById('cdM'),s:document.getElementById('cdS')};
    var total=demoWallets().reduce(function(a,b){return a+b.staked;},0)+staked.length;
    var aStakers=document.getElementById('aStakers'), aNfts=document.getElementById('aNfts'), aYours=document.getElementById('aYours');
    if(aStakers) aStakers.textContent=demoWallets().length+(staked.length>0?1:0);
    if(aNfts) aNfts.textContent=total;
    if(aYours) aYours.textContent=staked.length;
    // leaderboard
    var lb=document.getElementById('lbBody');
    if(lb){
      var rows=demoWallets().map(function(w){return {addr:w.addr,staked:w.staked,you:false};});
      rows.push({addr:'YOU',staked:staked.length,you:true});
      rows.sort(function(a,b){ return b.staked-a.staked || a.addr.localeCompare(b.addr); });
      lb.innerHTML=rows.map(function(r,i){
        var rank=i+1, rc=rank===1?'#ffe500':rank===2?'#b8ff00':rank===3?'#ff7a00':'#fff';
        var w=r.addr==='YOU'?'YOU':r.addr.slice(0,5)+'...'+r.addr.slice(-3);
        var sh=fmtPct(r.staked/total);
        return '<div class="lb-row'+(r.you?' you':(rank<=3?' top':''))+'"><div class="lb-rank" style="color:'+rc+'">#'+rank+'</div>'+
          '<div class="lb-w'+(r.you?' you':'')+'">'+w+'</div><div class="lb-staked">'+r.staked+'</div>'+
          '<div class="lb-share x">'+sh+'</div><div class="lb-share e">'+sh+'</div></div>';
      }).join('');
    }
    function tick(){
      var now=Date.now(), target, label;
      if(now<SEASON_START){ target=SEASON_START; label='COUNTDOWN TO SEASON 1 START'; }
      else if(now<SEASON_END){ target=SEASON_END; label='SEASON 1 ACTIVE \u00b7 TIME REMAINING'; }
      else { label='SEASON 1 ENDED'; }
      if(lblEl) lblEl.textContent=label;
      var cd=target?countdown(target,now):{d:'00',h:'00',m:'00',s:'00'};
      if(cells.d){cells.d.textContent=cd.d;cells.h.textContent=cd.h;cells.m.textContent=cd.m;cells.s.textContent=cd.s;}
    }
    tick(); setInterval(tick,1000);
  }

  /* ---- VAULT ---- */
  function initVault(){
    var staked=loadStaked();
    var total=demoWallets().reduce(function(a,b){return a+b.staked;},0)+staked.length;
    var s1=document.getElementById('vStakers'), s2=document.getElementById('vNfts'), st=document.getElementById('vStatus');
    if(s1) s1.textContent=demoWallets().length+(staked.length>0?1:0);
    if(s2) s2.textContent=total;
    function tick(){ var now=Date.now(); if(st) st.textContent=now<SEASON_START?'STARTS SOON':(now<SEASON_END?'ACTIVE':'ENDED'); }
    tick(); setInterval(tick,1000);
  }

  /* ---- WHITELIST ---- */
  function initWhitelist(){
    var st={x:'',follow:false,followV:false,like:false,likeV:false,commentDone:false,commentV:false,commentLink:'',wallet:'',submitting:false};
    var $=function(id){return document.getElementById(id);};
    var okBox=$('wlOk'), form=$('wlForm');
    function walletOk(){ return /^0x[a-fA-F0-9]{6,}$/.test(st.wallet.trim()); }
    function setTask(id,locked){ var t=$(id); if(t) t.className='task'+(locked?' locked':''); }
    function setAction(id,done,label){ var a=$(id); if(a){ a.className='task-a'+(done?' done':''); a.textContent=label; } }
    function setVerify(id,ready,done){ var v=$(id); if(v){ v.className='task-v'+(done?' done':(ready?' ready':'')); v.textContent=done?'VERIFIED \u2713':'VERIFY'; } }
    function render(){
      setTask('t2',!st.x.trim()); setTask('t3',!st.followV); setTask('t4',!st.likeV); setTask('t5',!st.commentV); setTask('t6',!st.commentV||!st.commentLink.trim());
      setAction('aFollow',st.follow,st.follow?'OPENED \u2713':'OPEN & FOLLOW');
      setVerify('vFollow',st.follow,st.followV);
      setAction('aLike',st.like,st.like?'OPENED \u2713':'LIKE + REPOST');
      setVerify('vLike',st.like,st.likeV);
      setAction('aComment',st.commentDone,st.commentDone?'OPENED \u2713':'COMMENT + TAG 2');
      setVerify('vComment',st.commentDone,st.commentV);
      var can=st.commentV && !!st.commentLink.trim() && walletOk() && !st.submitting;
      var b=$('wlSubmit'); if(b){ b.className='wl-submit'+(can?' ready':''); b.disabled=!can; b.textContent=st.submitting?'SUBMITTING...':(can?'SUBMIT WHITELIST':'COMPLETE ALL TASKS'); }
    }
    var xi=$('wlX'); if(xi) xi.addEventListener('input',function(e){ st.x=e.target.value; hideFail(); render(); });
    var cl=$('wlComment'); if(cl) cl.addEventListener('input',function(e){ st.commentLink=e.target.value; hideFail(); render(); });
    var wa=$('wlWallet'); if(wa) wa.addEventListener('input',function(e){ st.wallet=e.target.value; hideFail(); render(); });
    function bindAction(aid,vid,doneFlag,vFlag){
      var a=$(aid); if(a) a.addEventListener('click',function(){ st[doneFlag]=true; render(); });
      var v=$(vid); if(v) v.addEventListener('click',function(){ if(st[doneFlag]) { st[vFlag]=true; render(); } });
    }
    bindAction('aFollow','vFollow','follow','followV');
    bindAction('aLike','vLike','like','likeV');
    bindAction('aComment','vComment','commentDone','commentV');
    function hideFail(){ var f=$('wlFail'); if(f) f.hidden=true; }
    var sb=$('wlSubmit');
    if(sb) sb.addEventListener('click',function(){
      var can=st.commentV && !!st.commentLink.trim() && walletOk() && !st.submitting;
      if(!can) return;
      st.submitting=true; render();
      var fd=new URLSearchParams();
      fd.append('xUsername',st.x.trim()); fd.append('commentLink',st.commentLink.trim()); fd.append('walletAddress',st.wallet.trim());
      fetch(GOOGLE_SCRIPT_URL,{method:'POST',body:fd}).then(function(r){ return r.json().catch(function(){return {success:true};}); })
        .then(function(data){ if(data&&data.success===false){ st.submitting=false; render(); var f=$('wlFail'); if(f) f.hidden=false; }
          else { if(form) form.hidden=true; if(okBox) okBox.hidden=false; } })
        .catch(function(){ st.submitting=false; render(); var f=$('wlFail'); if(f) f.hidden=false; });
    });
    render();
  }

  document.addEventListener('DOMContentLoaded',function(){
    initMenu();
    var p=document.body.getAttribute('data-page');
    if(p==='home') initHome();
    else if(p==='stake') initStake();
    else if(p==='mystaking') initMyStaking();
    else if(p==='season1') initSeason();
    else if(p==='vault') initVault();
    else if(p==='whitelist') initWhitelist();
  });
})();
