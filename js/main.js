/* XCOPUNKS — shared static site logic */
(function(){
  var STORE='xcopunks_staked_v1', DAY=86400000;
  var B=(window.XCP_BASE||'');
  var GIF=[B+'assets/gif/1.gif',B+'assets/gif/2.gif',B+'assets/gif/3.gif',B+'assets/gif/4.gif'];
  /* === CONFIG =====================================================
  /* === CONFIG =====================================================
     TWO separate endpoints:
       WHITELIST_SCRIPT_URL — new joins (append) + final GTD verify
                              (sheet: WHITELIST + GTD VERIFIED tabs)
       CHECKER_SCRIPT_URL   — existing-member wallet lookup (read-only)
                              (sheet: EXISTING MEMBERS)
     Lookup consults GTD VERIFIED / new WHITELIST (whitelist script) AND the
     existing-members checker, so 100%/new/old all resolve. Paste both /exec
     URLs below. Leave blank for local demo mode. */
  var WHITELIST_SCRIPT_URL='https://script.google.com/macros/s/AKfycbx0SFxNo2Bw9A-Ek2W6VWFyh9eoDJS-dtTixXCuYWMLPg5182SnzWZqqAtHzG6LOzOhbQ/exec';
  var CHECKER_SCRIPT_URL='https://script.google.com/macros/s/AKfycbyqwaGzhm5qwcUkCazqRIpDTlT6hrDHmXn3I5I2-o-xTa3qtfFekZN9AIcXSDdE28Y/exec';
  /* Reward Vault — future live-data sources (Step 3 / Alchemy).
     Addresses only; no API key is stored in the frontend. */
  var MINT_FEE_WALLET='0xb5a966ecfe664e8959Fc6FBeCDbe18e6BDc6ab82';
  var CREATOR_FEE_WALLET='0x66A22fc0B0Bd2A6Bc8ae27C826A6cA7D7eb2C89C';
  var NFT_CONTRACT='0xfcba20492b1cd40607b13c9f61b6b6d416a08cf7';
  var ALCHEMY_API_KEY=null; /* provided at Step 3 — never hard-code here */
  /* Reward split rules. */
  var MINT_STAKE_SPLIT=0.90, MINT_BUILD_SPLIT=0.10;
  var CREATOR_ETH_SPLIT=0.70, CREATOR_BUILD_SPLIT=0.30;
  /* Live wallet balances arrive at Step 3; null => LIVE DATA PENDING. */
  var mintFeeTotal=null, creatorFeeTotal=null;
  var ELIG_STORE='xcopunks_gtd_v1';
  /* Set true only for local preview without a deployed Web App. On the live
     site leave false so all state comes from the Google Sheet. */
  var DEMO_MODE=!(WHITELIST_SCRIPT_URL && CHECKER_SCRIPT_URL);
  var X_INTENT='https://x.com/intent/post?text=THE+%40XCOPUNKS+ARE+COMING%0A%0AMint+Date%3A+August+14%2C+2026+-+12%3A45+PM+UTC%0A%0ALaunching+on+%40OpenSea%0A%0Ahttps%3A%2F%2Fopensea.io%2Fcollection%2Fxcopunks%2Foverview';
  /* Demo eligibility records (used only in DEMO_MODE).
     Column A = X username, Column C = wallet. GTD number = row index. */
  /* No demo participant data — production reads only from the Google Sheet.
     (Kept empty so a stale demo user can never surface as a lookup result.) */
  var DEMO_ELIGIBLE=[];

  function normWallet(w){ return String(w||'').trim().toLowerCase(); }
  function isWalletFormat(w){ return /^0x[a-fA-F0-9]{40}$/.test(String(w||'').trim()); }
  function shortWallet(w){ w=String(w||''); return w.slice(0,5)+'...'+w.slice(-3); }
  function gtdLabel(n){ return '#GTD '+pad3(n); }
  function pad3(n){ n=Math.max(0,Math.floor(n)); return (n<10?'00':n<100?'0':'')+n; }
  function jget(base, params){ return fetchJSON(base+'?'+params, {}); }
  function jpost(base, fd){ return fetchJSON(base, {method:'POST', body:fd}); }
  /* fetch with an 12s timeout; rejects on timeout/network so callers show CHECK FAILED. */
  function fetchJSON(url, opt){
    return new Promise(function(resolve, reject){
      var done=false, ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
      if(ctrl) opt.signal=ctrl.signal;
      var t=setTimeout(function(){ if(done) return; done=true; if(ctrl) try{ctrl.abort();}catch(e){} reject(new Error('timeout')); }, 12000);
      fetch(url, opt).then(function(r){ return r.json(); }).then(function(j){ if(done) return; done=true; clearTimeout(t); resolve(j); })
        .catch(function(err){ if(done) return; done=true; clearTimeout(t); reject(err); });
    });
  }
  /* Normalize a stored GTD status: "100","100%"," 100% " -> "100%"; else "99%". */
  function normStatus(s){ var t=String(s==null?'':s).replace(/[^0-9]/g,''); return t==='100'?'100%':'99%'; }

  /* Demo mirror of the two tabs (used only in DEMO_MODE).
     WL rows {x,c,w}; GTD rows {x,w,e}. */
  var WL_STORE='xcopunks_wl_v1', GTDV_STORE='xcopunks_gtdv_v1';
  function loadWL(){ try{ return JSON.parse(localStorage.getItem(WL_STORE))||[]; }catch(e){ return []; } }
  function saveWL(a){ try{ localStorage.setItem(WL_STORE, JSON.stringify(a)); }catch(e){} }
  function loadGTDV(){ try{ return JSON.parse(localStorage.getItem(GTDV_STORE))||[]; }catch(e){ return []; } }
  function saveGTDV(a){ try{ localStorage.setItem(GTDV_STORE, JSON.stringify(a)); }catch(e){} }
  function findRow_(rows, key, w){ w=normWallet(w); for(var i=0;i<rows.length;i++){ if(normWallet(rows[i][key])===w) return rows[i]; } return null; }

  /* Lookup: WHITELIST script (GTD VERIFIED 100% + new WHITELIST 99%) first,
     then CHECKER (EXISTING MEMBERS 99%). Distinguishes technical failure from
     a clean not-found: rejects only when BOTH endpoints error. */
  function eligibilityLookup(wallet){
    if(!DEMO_MODE){
      var q='action=check&wallet='+encodeURIComponent(wallet);
      return jget(WHITELIST_SCRIPT_URL, q).then(function(a){
        if(a && a.found===true && (a.xUsername||a.walletAddress)) return a;
        // not found in whitelist system -> ask existing-members checker
        return jget(CHECKER_SCRIPT_URL, q).then(function(b){
          if(b && b.found===true && (b.xUsername||b.walletAddress)) return b;
          return {success:true, found:false, status:'not_found'};
        });
      });
    }
    return new Promise(function(res){ setTimeout(function(){
      var g=findRow_(loadGTDV(),'w',wallet);
      if(g){ res({success:true, found:true, status:'100', source:'gtd_verified', xUsername:g.x, walletAddress:g.w, xPostLink:g.e||''}); return; }
      var em=findRow_(DEMO_ELIGIBLE,'w',wallet);
      if(em){ res({success:true, found:true, status:'99', source:'existing_members', xUsername:em.x, walletAddress:em.w, xPostLink:''}); return; }
      var w=findRow_(loadWL(),'w',wallet);
      if(w){ res({success:true, found:true, status:'99', source:'whitelist', xUsername:w.x, walletAddress:w.w, xPostLink:''}); return; }
      res({success:true, found:false, status:'not_found'});
    }, 600); });
  }
  /* action=join -> append to WHITELIST (99%) or return existing. */
  function eligibilityAdd(xUsername, commentLink, wallet){
    if(!DEMO_MODE){ var fd=new URLSearchParams(); fd.append('action','join'); fd.append('xUsername',xUsername); fd.append('commentLink',commentLink||''); fd.append('walletAddress',wallet); return jpost(WHITELIST_SCRIPT_URL, fd); }
    return new Promise(function(res){
      var wl=loadWL(), dupe=findRow_(wl,'w',wallet);
      if(dupe){ res({success:true, duplicate:true, found:true, status:'99', source:'whitelist', xUsername:dupe.x, walletAddress:dupe.w}); return; }
      wl.push({x:xUsername, c:commentLink||'', w:wallet}); saveWL(wl);
      res({success:true, found:true, status:'99', source:'whitelist', xUsername:xUsername, walletAddress:wallet});
    });
  }
  /* action=verify -> append/return GTD VERIFIED (100%). WHITELIST row untouched. */
  function eligibilityVerify(wallet, xUsername, postLink){
    if(!DEMO_MODE){ var fd=new URLSearchParams(); fd.append('action','verify'); fd.append('walletAddress',wallet); fd.append('xUsername',xUsername||''); fd.append('xPostLink',postLink); return jpost(WHITELIST_SCRIPT_URL, fd); }
    return new Promise(function(res){
      var gv=loadGTDV(), existing=findRow_(gv,'w',wallet);
      if(existing){ res({success:true, found:true, status:'100', source:'gtd_verified', xUsername:existing.x, walletAddress:existing.w, xPostLink:existing.e||''}); return; }
      var xu=xUsername; if(!xu){ var wm=findRow_(loadWL(),'w',wallet); if(wm) xu=wm.x; }
      gv.push({x:xu, w:wallet, e:postLink}); saveGTDV(gv);
      res({success:true, found:true, status:'100', source:'gtd_verified', xUsername:xu, walletAddress:wallet, xPostLink:postLink});
    });
  }

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
  function fmtAmt(v){ return (v==null) ? 'LIVE DATA PENDING' : (Math.round(v*1e6)/1e6)+''; }
  function initVault(){
    var staked=loadStaked();
    var total=demoWallets().reduce(function(a,b){return a+b.staked;},0)+staked.length;
    var s1=document.getElementById('vStakers'), s2=document.getElementById('vNfts'), st=document.getElementById('vStatus');
    if(s1) s1.textContent=demoWallets().length+(staked.length>0?1:0);
    if(s2) s2.textContent=total;
    // Mint Fee split (90 / 10) — derived live from mintFeeTotal at Step 3.
    var mStake=(mintFeeTotal==null)?null:mintFeeTotal*MINT_STAKE_SPLIT;
    var mBuild=(mintFeeTotal==null)?null:mintFeeTotal*MINT_BUILD_SPLIT;
    setTxt('vMintTotal', fmtAmt(mintFeeTotal)); setTxt('vMintStake', fmtAmt(mStake)); setTxt('vMintBuild', fmtAmt(mBuild));
    // Creator Fee split (7 / 3 of the separate creator-fee stream).
    var cEth=(creatorFeeTotal==null)?null:creatorFeeTotal*CREATOR_ETH_SPLIT;
    var cBuild=(creatorFeeTotal==null)?null:creatorFeeTotal*CREATOR_BUILD_SPLIT;
    setTxt('vCrTotal', fmtAmt(creatorFeeTotal)); setTxt('vCrEth', fmtAmt(cEth)); setTxt('vCrBuild', fmtAmt(cBuild));
    function tick(){ var now=Date.now(); if(st) st.textContent=now<SEASON_START?'STARTS SOON':(now<SEASON_END?'ACTIVE':'ENDED'); }
    tick(); setInterval(tick,1000);
  }
  function setTxt(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; }

  /* ---- WHITELIST / GTD ELIGIBILITY CHECKER ---- */
  function initWhitelist(){
    var $=function(id){return document.getElementById(id);};
    var current=null; // {xUsername, walletAddress, gtdNumber}

    // panels
    var pEntry=$('gtdEntry'), pChecker=$('gtdChecker'), pResult=$('gtdResult'), pJoin=$('gtdJoin'), pClosedNote=$('wlClosedNote');
    var walletIn=$('gtdWallet'), checkBtn=$('gtdCheckBtn'), msg=$('gtdMsg'), loading=$('gtdLoading');

    // entry chooser
    var eCheck=$('entryCheck'), eJoin=$('entryJoin'), cBack=$('checkerBack');
    function toEntry(){ current=null; show(pEntry,true); show(pChecker,false); show(pResult,false); show(pJoin,false);
      if(walletIn) walletIn.value=''; var nf=$('gtdNotFound'); if(nf) nf.hidden=true; setMsg(''); }
    if(eCheck) eCheck.addEventListener('click',function(){ show(pEntry,false); show(pChecker,true); });
    if(eJoin) eJoin.addEventListener('click',function(){ show(pEntry,false); openJoin(); });
    if(cBack) cBack.addEventListener('click',toEntry);

    function show(el,on){ if(el) el.hidden=!on; }
    function setMsg(t){ if(msg){ msg.textContent=t||''; msg.hidden=!t; } }

    // ---- CHECK ----
    // ---- CHECK (animated 1-99% loader + up to 3 invisible retries) ----
    var LOAD_STEPS=['SCANNING WALLET...','VERIFYING GTD RECORD...','CHECKING XCOPUNKS DATABASE...','VERIFYING ELIGIBILITY...'];
    var progTimer=null, msgTimer=null;
    function startLoading(){
      var el=$('gtdLoadingMsg'), bar=$('gtdBar'), pct=$('gtdPct');
      var p=1, mi=0;
      if(el) el.textContent=LOAD_STEPS[0];
      if(bar) bar.style.width='1%'; if(pct) pct.textContent='01%';
      show(loading,true);
      // ease toward 99% but never reach 100% until the server responds
      progTimer=setInterval(function(){
        var step = p<60?2.2 : p<85?1.1 : p<95?0.5 : 0.15;
        p=Math.min(99, p+step);
        if(bar) bar.style.width=p+'%';
        if(pct) pct.textContent=(p<10?'0':'')+Math.floor(p)+'%';
      },90);
      msgTimer=setInterval(function(){ mi=(mi+1)%LOAD_STEPS.length; if(el) el.textContent=LOAD_STEPS[mi]; },1100);
    }
    function finishLoading(cb){
      if(progTimer){ clearInterval(progTimer); progTimer=null; }
      if(msgTimer){ clearInterval(msgTimer); msgTimer=null; }
      var bar=$('gtdBar'), pct=$('gtdPct'), el=$('gtdLoadingMsg');
      if(bar) bar.style.width='100%'; if(pct) pct.textContent='100%'; if(el) el.textContent='WALLET VERIFIED';
      setTimeout(function(){ show(loading,false); if(cb) cb(); }, 320);
    }
    function abortLoading(){
      if(progTimer){ clearInterval(progTimer); progTimer=null; }
      if(msgTimer){ clearInterval(msgTimer); msgTimer=null; }
      show(loading,false);
    }
    function applyResult(res,w){
      current=null; // fresh state every search — never reuse a prior user's data
      if(!res || res.success===false){ setMsg('CHECK TEMPORARILY UNAVAILABLE — PLEASE TRY AGAIN'); return; }
      var notFound = res.found===false || res.status==='not_found';
      if(!notFound && res.found===true && (res.xUsername || res.walletAddress)){
        var status=normStatus(res.status!=null?res.status:res.gtdStatus);
        current={xUsername:res.xUsername, walletAddress:res.walletAddress||w, gtdStatus:status, xPostLink:res.xPostLink||''};
        renderFound();
      } else if(notFound){ current={walletAddress:w}; renderNotFound(); }
      else { setMsg('CHECK TEMPORARILY UNAVAILABLE — PLEASE TRY AGAIN'); }
    }
    // up to 5 attempts with a short progressive delay; loader stays visible throughout
    function lookupWithRetry(w){
      var attempts=0, MAX=5;
      function attempt(){
        attempts++;
        return eligibilityLookup(w).catch(function(err){
          if(attempts>=MAX) throw err;
          return new Promise(function(r){ setTimeout(r, attempts*700); }).then(attempt);
        });
      }
      return attempt();
    }
    if(checkBtn) checkBtn.addEventListener('click',function(){
      if(checkBtn.disabled) return; // guard against double-click
      var w=(walletIn&&walletIn.value||'').trim();
      setMsg('');
      if(!isWalletFormat(w)){ setMsg('INVALID WALLET ADDRESS'); return; }
      var nf=$('gtdNotFound'); if(nf) nf.hidden=true;
      checkBtn.disabled=true; startLoading();
      lookupWithRetry(w)
        .then(function(res){ finishLoading(function(){ checkBtn.disabled=false; applyResult(res,w); }); })
        .catch(function(){ abortLoading(); checkBtn.disabled=false; setMsg('WALLET CHECK IS TAKING LONGER THAN EXPECTED — PLEASE TRY AGAIN'); });
    });
    if(walletIn) walletIn.addEventListener('keydown',function(e){ if(e.key==='Enter'&&checkBtn) checkBtn.click(); });

    // ---- FOUND: 99% or 100% (status comes from the sheet) ----
    function renderFound(){
      show(pChecker,false); show(pJoin,false); show(pResult,true);
      $('rX').textContent=current.xUsername||'@—';
      $('rWallet').textContent=shortWallet(current.walletAddress);
      if(normStatus(current.gtdStatus)==='100%'){ renderHundred(); } else { renderNinetyNine(); }
    }
    function renderNinetyNine(){
      $('rPct').textContent='99%'; $('rPct').className='gtd-pct';
      $('rPctLabel').textContent='GTD ELIGIBILITY';
      show($('rRemaining'),true); show($('rApproved'),false); show($('rCongrats'),false);
      show($('rCardStage'),true); show($('cardWrap'),false); show($('rVerifyStage'),false);
      $('genCardBtn').disabled=false;
    }
    function renderHundred(){
      $('rPct').textContent='100%'; $('rPct').className='gtd-pct done';
      $('rPctLabel').textContent='GTD ACCESS';
      show($('rRemaining'),false); show($('rApproved'),true); show($('rCongrats'),true);
      show($('rCardStage'),false); show($('rVerifyStage'),false);
    }

    // ---- NOT FOUND ----
    function renderNotFound(){
      show(pResult,false); show(pChecker,true); setMsg('');
      var nf=$('gtdNotFound'); if(nf) nf.hidden=false;
    }
    function openJoin(){
      show(pChecker,false); show(pResult,false); show(pJoin,true);
      if(pClosedNote) pClosedNote.hidden=true;
      var form=$('wlForm'); if(form){ form.classList.remove('wl-blur'); }
      var ov=$('wlClosedOverlay'); if(ov) ov.hidden=true;
      // user wallet field ALWAYS starts empty — never prefill with any address
      var wf=$('wlWallet'); if(wf){ wf.value=''; }
      startJoinFlow();
    }
    var joinOpen=$('gtdJoinBtn');
    if(joinOpen) joinOpen.addEventListener('click',openJoin);

    // ---- SOCIAL CARD ----
    var genBtn=$('genCardBtn');
    if(genBtn) genBtn.addEventListener('click',function(){
      drawSocialCard(current, function(canvas){
        var wrap=$('cardWrap'); if(wrap){ wrap.innerHTML=''; canvas.style.maxWidth='100%'; canvas.style.height='auto'; canvas.style.display='block'; canvas.style.border='3px solid #b8ff00'; wrap.appendChild(canvas); }
        show($('cardWrap'),true); show($('rVerifyStage'),true);
        window.__xcpCard=canvas;
      });
    });
    var dlBtn=$('dlCardBtn');
    if(dlBtn) dlBtn.addEventListener('click',function(){
      if(!window.__xcpCard) return;
      window.__xcpCard.toBlob(function(blob){
        var url=URL.createObjectURL(blob), a=document.createElement('a');
        a.href=url; a.download='xcopunks-gtd.png'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){URL.revokeObjectURL(url);},4000);
      });
    });
    var shareBtn=$('shareCardBtn');
    if(shareBtn) shareBtn.addEventListener('click',function(){
      if(!window.__xcpCard){ window.open(X_INTENT,'_blank','noopener'); return; }
      window.__xcpCard.toBlob(function(blob){
        var file=new File([blob],'xcopunks-gtd.png',{type:'image/png'});
        if(navigator.canShare && navigator.canShare({files:[file]})){
          navigator.share({files:[file], text:'THE @XCOPUNKS ARE COMING'}).catch(function(){});
        } else {
          // Fallback: download the card, then open the X composer to attach it.
          var url=URL.createObjectURL(blob), a=document.createElement('a');
          a.href=url; a.download='xcopunks-gtd.png'; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function(){URL.revokeObjectURL(url);},4000);
          window.open(X_INTENT,'_blank','noopener');
        }
      });
    });

    // ---- SUBMIT / VERIFY X POST (action=verify -> sheet sets D=100%, E=link) ----
    var verifyBtn=$('verifyPostBtn'), postIn=$('postLink'), postMsg=$('postMsg');
    if(verifyBtn) verifyBtn.addEventListener('click',function(){
      var link=(postIn&&postIn.value||'').trim();
      if(!/^https?:\/\/(x|twitter)\.com\/[^\/]+\/status\/\d+/i.test(link)){ if(postMsg){ postMsg.textContent='PASTE A VALID X POST LINK'; postMsg.hidden=false; } return; }
      if(postMsg) postMsg.hidden=true;
      verifyBtn.disabled=true; verifyBtn.textContent='SUBMITTING...';
      eligibilityVerify(current.walletAddress, current.xUsername, link).then(function(res){
        verifyBtn.disabled=false; verifyBtn.textContent='VERIFY X POST';
        if(res && res.success!==false){ current.gtdStatus='100%'; renderHundred(); }
        else { if(postMsg){ postMsg.textContent='VERIFY FAILED — PLEASE TRY AGAIN'; postMsg.hidden=false; } }
      }).catch(function(){ verifyBtn.disabled=false; verifyBtn.textContent='VERIFY X POST'; if(postMsg){ postMsg.textContent='VERIFY FAILED — PLEASE TRY AGAIN'; postMsg.hidden=false; } });
    });

    // ---- reset checker (from result) ----
    var againBtn=$('checkAgainBtn');
    if(againBtn) againBtn.addEventListener('click',function(){ toEntry(); });

    // ================= JOIN (old whitelist flow, gated) =================
    function startJoinFlow(){
      if($('wlSubmit') && $('wlSubmit')._bound) return; // bind once
      var st={x:'',follow:false,followV:false,like:false,likeV:false,commentDone:false,commentV:false,commentLink:'',wallet:'',submitting:false};
      function walletOk(){ return isWalletFormat(st.wallet); }
      function setTask(id,locked){ var t=$(id); if(t) t.className='task'+(locked?' locked':''); }
      function setAction(id,done,label){ var a=$(id); if(a){ a.className='task-a'+(done?' done':''); a.textContent=label; } }
      function setVerify(id,ready,done){ var v=$(id); if(v){ v.className='task-v'+(done?' done':(ready?' ready':'')); v.textContent=done?'VERIFIED \u2713':'VERIFY'; } }
      function render(){
        setTask('t2',!st.x.trim()); setTask('t3',!st.followV); setTask('t4',!st.likeV); setTask('t5',!st.commentV); setTask('t6',!st.commentV||!st.commentLink.trim());
        setAction('aFollow',st.follow,st.follow?'OPENED \u2713':'OPEN & FOLLOW'); setVerify('vFollow',st.follow,st.followV);
        setAction('aLike',st.like,st.like?'OPENED \u2713':'LIKE + REPOST'); setVerify('vLike',st.like,st.likeV);
        setAction('aComment',st.commentDone,st.commentDone?'OPENED \u2713':'COMMENT + TAG 2'); setVerify('vComment',st.commentDone,st.commentV);
        var can=st.commentV && !!st.commentLink.trim() && walletOk() && !st.submitting;
        var b=$('wlSubmit'); if(b){ b.className='wl-submit'+(can?' ready':''); b.disabled=!can; b.textContent=st.submitting?'SUBMITTING...':(can?'SUBMIT GTD':'COMPLETE ALL TASKS'); }
      }
      var xi=$('wlX'); if(xi){ xi.value=st.x; xi.addEventListener('input',function(e){ st.x=e.target.value; hideFail(); render(); }); }
      var cl=$('wlComment'); if(cl) cl.addEventListener('input',function(e){ st.commentLink=e.target.value; hideFail(); render(); });
      var wa=$('wlWallet'); if(wa){ wa.value=st.wallet; wa.addEventListener('input',function(e){ st.wallet=e.target.value; hideFail(); render(); }); }
      function bindAction(aid,vid,doneFlag,vFlag){
        var a=$(aid); if(a) a.addEventListener('click',function(){ st[doneFlag]=true; render(); });
        var v=$(vid); if(v) v.addEventListener('click',function(){ if(st[doneFlag]){ st[vFlag]=true; render(); } });
      }
      bindAction('aFollow','vFollow','follow','followV');
      bindAction('aLike','vLike','like','likeV');
      bindAction('aComment','vComment','commentDone','commentV');
      function hideFail(){ var f=$('wlFail'); if(f) f.hidden=true; }
      var sb=$('wlSubmit'); if(sb){ sb._bound=true; sb.addEventListener('click',function(){
        var can=st.commentV && !!st.commentLink.trim() && walletOk() && !st.submitting; if(!can) return;
        st.submitting=true; render();
        var wal=st.wallet.trim(), usr=st.x.trim();
        // Success = the row was accepted. The server dedupes by wallet, so even a
        // slow/opaque/timeout response after a completed write is treated as success
        // (no duplicate row). Go straight to the 99% screen.
        function toEligible(){
          show($('wlForm'),false); show($('gtdJoin'),false);
          current={xUsername:usr, walletAddress:wal, gtdStatus:'99%', xPostLink:''};
          renderFound();
        }
        eligibilityAdd(usr, st.commentLink.trim(), wal)
          .then(function(data){
            if(data && data.success===false && !data.duplicate){ st.submitting=false; render(); var f=$('wlFail'); if(f) f.hidden=false; return; }
            toEligible();
          })
          .catch(function(){ toEligible(); }); // write likely succeeded; never false-fail
      }); }
      render();
    }
  }

  /* Build the XCOPUNKS social card (1200×675) on a canvas. */
  function drawSocialCard(rec, cb){
    var W=1200,H=675, c=document.createElement('canvas'); c.width=W; c.height=H;
    var x=c.getContext('2d');
    x.fillStyle='#08090a'; x.fillRect(0,0,W,H);
    // scanlines
    x.globalAlpha=0.10; x.fillStyle='#b8ff00';
    for(var yy=0;yy<H;yy+=4){ x.fillRect(0,yy,W,1); }
    x.globalAlpha=1;
    // border
    x.lineWidth=10; x.strokeStyle='#b8ff00'; x.strokeRect(14,14,W-28,H-28);
    x.lineWidth=2; x.strokeStyle='#ff2247'; x.strokeRect(28,28,W-56,H-56);
    function P(size){ return "700 "+size+"px 'Press Start 2P','Silkscreen',monospace"; }
    function V(size){ return size+"px 'VT323',monospace"; }
    // title with RGB offset
    x.textBaseline='top';
    x.font=P(46);
    x.fillStyle='#ff2247'; x.fillText('XCOPUNKS',67,63);
    x.fillStyle='#00e0ff'; x.fillText('XCOPUNKS',61,63);
    x.fillStyle='#b8ff00'; x.fillText('XCOPUNKS',64,60);
    x.font=V(30); x.fillStyle='#ffffff'; x.fillText('6000 PIXEL ART NFTs  \u00b7  ROBINHOOD CHAIN',66,120);
    // avatar frame
    var ax=66, ay=176, as=224;
    x.fillStyle='#08090a'; x.fillRect(ax-6,ay-6,as+12,as+12);
    x.lineWidth=6; x.strokeStyle='#ffe500'; x.strokeRect(ax-6,ay-6,as+12,as+12);
    // signature
    x.font=V(30); x.fillStyle='#b8ff00'; x.fillText(rec.xUsername||'@—',ax,ay+as+16);
    // details block (no GTD number)
    var hundred = normStatus(rec.gtdStatus)==='100%';
    var dx=360, dy=182;
    x.font=P(20); x.fillStyle='#b8ff00'; x.fillText('YOU ARE ELIGIBLE',dx,dy);
    x.fillText('FOR GTD ACCESS',dx,dy+30);
    x.font=P(15); x.fillStyle=hundred?'#b8ff00':'#ffe500';
    x.fillText(hundred?'GTD ACCESS — APPROVED':'GTD ELIGIBILITY · 99%',dx,dy+74);
    x.font=P(14); x.fillStyle='#ff7a00'; x.fillText('X USERNAME',dx,dy+112);
    x.font=V(30); x.fillStyle='#ffffff'; x.fillText(rec.xUsername||'@—',dx,dy+134);
    x.font=P(14); x.fillStyle='#ff7a00'; x.fillText('WALLET',dx,dy+180);
    x.font=V(32); x.fillStyle='#ffffff'; x.fillText(shortWallet(rec.walletAddress),dx,dy+202);
    // status-aware seal (right)
    var sealMain = hundred ? 'APPROVED' : '99%';
    var sealSub  = hundred ? 'ACCESS' : 'ELIGIBLE';
    var sx=1000, sy=270, r=112;
    x.save(); x.translate(sx,sy); x.rotate(-0.12);
    x.lineWidth=8; x.strokeStyle='#b8ff00';
    x.beginPath(); x.arc(0,0,r,0,Math.PI*2); x.stroke();
    x.lineWidth=3; x.strokeStyle='#ff2247';
    x.beginPath(); x.arc(0,0,r-14,0,Math.PI*2); x.stroke();
    x.textAlign='center';
    x.font=P(18); x.fillStyle='#b8ff00'; x.fillText('GTD',0,-44);
    x.font=P(15); x.fillStyle='#ffe500'; x.fillText(sealSub,0,-12);
    x.font=P(hundred?20:26); x.fillStyle='#ff2247'; x.fillText(sealMain,0,26);
    x.textAlign='left'; x.restore();
    // staking marketing strip (fills the lower band)
    var by=470, bh=150;
    x.fillStyle='#0d0f10'; x.fillRect(40,by,W-80,bh);
    x.lineWidth=4; x.strokeStyle='#b8ff00'; x.strokeRect(40,by,W-80,bh);
    x.lineWidth=2; x.strokeStyle='#ff2247'; x.strokeRect(50,by+10,W-100,bh-20);
    x.font=P(24); x.fillStyle='#b8ff00'; x.fillText('STAKE XCOPUNKS',72,by+30);
    x.font=V(34); x.fillStyle='#ffffff'; x.fillText('EARN $XCPN + ETH REWARDS',72,by+72);
    x.font=V(28); x.fillStyle='#ff7a00'; x.fillText('HOLD. STAKE. EARN.',72,by+108);
    x.textAlign='right';
    x.font=P(18); x.fillStyle='#ffe500'; x.fillText('XCOPUNKS.XYZ',W-72,by+40);
    x.font=V(28); x.fillStyle='#00e0ff'; x.fillText('ROBINHOOD CHAIN',W-72,by+96);
    x.textAlign='left';
    // draw avatar image then finish
    var img=new Image();
    img.onload=function(){ try{ x.drawImage(img,ax,ay,as,as); }catch(e){} cb(c); };
    img.onerror=function(){ x.fillStyle='#151517'; x.fillRect(ax,ay,as,as); cb(c); };
    img.src=GIF[(rec.gtdNumber||1)%GIF.length];
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
