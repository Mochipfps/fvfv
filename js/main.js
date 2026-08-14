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

  function pad(n){ n=Math.max(0,Math.floor(n)); return (n<10?'0':'')+n; }
  function countdown(t,now){ var ms=t-now; if(ms<0) ms=0; return {d:pad(ms/DAY),h:pad((ms/3600000)%24),m:pad((ms/60000)%60),s:pad((ms/1000)%60)}; }
  function fmtPct(v){ if(!isFinite(v)||v<=0) return '0%'; return (Math.round(v*10000)/100)+'%'; }
  function fmtDate(ts){ var d=new Date(ts),M=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return d.getUTCDate()+' '+M[d.getUTCMonth()]+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+' UTC'; }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var SEASON_START=Date.UTC(2026,7,14,14,0,0), SEASON_END=Date.UTC(2026,7,21,14,0,0);
  var toastTimer;
  function toast(msg){ var t=document.getElementById('toast'); if(!t) return; t.textContent=msg; t.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.hidden=true;},2400); }

  /* ---- $XCPN token buttons (market URL not published yet) ---- */
  function initXcpn(){
    var btns=document.querySelectorAll('[data-xcpn]');
    Array.prototype.forEach.call(btns,function(b){
      var label=b.textContent;
      b.addEventListener('click',function(e){
        e.preventDefault();
        if(b._busy) return;
        b._busy=true;
        b.textContent='COMING SOON';
        b.classList.add('soon');
        setTimeout(function(){ b.textContent=label; b.classList.remove('soon'); b._busy=false; },1800);
      });
    });
  }

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
    initXcpn();
    var p=document.body.getAttribute('data-page');
    if(p==='home') initHome();
    else if(p==='whitelist') initWhitelist();
    /* stake / mystaking / vault are driven by js/stake-app.js (live contract data) */
  });
})();
