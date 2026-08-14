/* XCOPUNKS — page controllers for live staking (Step 3) */
(function () {
  var X = window.XCP;
  var $ = function (id) { return document.getElementById(id); };
  var selected = {}, ownedIds = [], stakedIds = [], tickTimer = null, stakeMeta = {};

  function txt(id, v) { var e = $(id); if (e) e.textContent = v; }
  function show(el, on) { if (el) el.hidden = !on; }
  function status(msg, kind) {
    var e = $('txStatus'); if (!e) return;
    e.hidden = !msg; e.textContent = msg || '';
    e.className = 'tx-status' + (kind ? ' ' + kind : '');
  }
  function shortAddr(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : ''; }

  function walletBar() {
    var btn = $('connectBtn'), lbl = $('walletLabel');
    var a = X.account();
    if (a) {
      if (btn) { btn.textContent = shortAddr(a) + ' \u25BE'; btn.disabled = false; }
      if (lbl) lbl.hidden = true;
      checkNetwork();
    } else {
      if (btn) { btn.textContent = 'CONNECT WALLET'; btn.disabled = false; }
      if (lbl) lbl.hidden = true;
      var w = $('netWarn'); if (w) w.remove();
    }
  }

  async function checkNetwork() {
    var ok = true;
    try { ok = await X.networkOk(); } catch (e) { ok = true; }
    var bar = document.querySelector('.wallet-bar');
    var w = $('netWarn');
    if (ok) { if (w) w.remove(); return; }
    if (!w && bar) {
      w = document.createElement('div');
      w.id = 'netWarn'; w.className = 'net-warn';
      w.innerHTML = '<span>WRONG NETWORK — please switch to Robinhood Chain to continue.</span>' +
        '<button class="btn btn-yellow" id="netSwitch">SWITCH NETWORK</button>';
      bar.parentNode.insertBefore(w, bar.nextSibling);
      $('netSwitch').addEventListener('click', async function () {
        try { await X.switchNetwork(); checkNetwork(); }
        catch (e) { status(X.friendly(e), 'err'); }
      });
    }
  }

  /* ---- wallet selection modal ---- */
  function closeModal() { var m = $('walletModal'); if (m) m.remove(); }
  function openWalletModal() {
    closeModal();
    var opts = X.walletOptions();
    var m = document.createElement('div');
    m.id = 'walletModal'; m.className = 'wmodal';
    var rows = opts.length
      ? opts.map(function (o, i) {
          return '<button class="wopt" data-i="' + i + '">' +
            (o.icon ? '<img src="' + o.icon + '" alt="">' : '<span class="wdot"></span>') +
            '<span>' + o.name.toUpperCase() + '</span></button>';
        }).join('')
      : '<div class="wnone">No EVM wallet detected in this browser. Install MetaMask, Coinbase Wallet, ' +
        'or open xcopunks.xyz inside your wallet\u2019s browser.</div>';
    m.innerHTML = '<div class="wmodal-box">' +
      '<div class="wmodal-h">CONNECT WALLET</div>' +
      '<p class="wmodal-p">Select your preferred wallet.</p>' +
      '<div class="wlist">' + rows + '</div>' +
      '<button class="wclose" id="wClose">CLOSE</button></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    $('wClose').addEventListener('click', closeModal);
    m.querySelectorAll('.wopt').forEach(function (b) {
      b.addEventListener('click', async function () {
        var opt = opts[parseInt(b.getAttribute('data-i'), 10)];
        b.textContent = 'CONNECTING...'; b.disabled = true;
        try { await X.connectWith(opt); closeModal(); status(''); }
        catch (e) { closeModal(); status(X.friendly(e), 'err'); }
        walletBar(); refreshPage();
      });
    });
  }

  /* ---- connected wallet menu ---- */
  function openWalletMenu() {
    closeModal();
    var a = X.account(); if (!a) return;
    var m = document.createElement('div');
    m.id = 'walletModal'; m.className = 'wmodal';
    m.innerHTML = '<div class="wmodal-box">' +
      '<div class="wmodal-h">WALLET</div>' +
      '<div class="waddr" id="wFull">' + a + '</div>' +
      '<div class="wlist">' +
      '<button class="wopt" id="wCopy"><span class="wdot"></span><span>COPY ADDRESS</span></button>' +
      '<button class="wopt danger" id="wDisc"><span class="wdot"></span><span>DISCONNECT</span></button>' +
      '</div><button class="wclose" id="wClose">CLOSE</button></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    $('wClose').addEventListener('click', closeModal);
    $('wCopy').addEventListener('click', function () {
      var t = $('wCopy').querySelector('span:last-child');
      try {
        navigator.clipboard.writeText(a);
        t.textContent = 'COPIED \u2713';
      } catch (e) { t.textContent = 'COPY FAILED'; }
    });
    $('wDisc').addEventListener('click', function () {
      X.disconnect();
      closeModal();
      clearUserState();
      walletBar();
      refreshPage();
    });
  }

  /* Wipe every trace of the previous wallet from the UI. */
  function clearUserState() {
    selected = {}; ownedIds = []; stakedIds = []; stakeMeta = {};
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    status('');
    ['ownedGrid', 'mineGrid', 'lbBody'].forEach(function (id) { var e = $(id); if (e) e.innerHTML = ''; });
    ['uActive', 'uShare', 'aYours', 'aNfts'].forEach(function (id) { txt(id, '\u2014'); });
    ['uXcpn', 'uEth', 'aShare'].forEach(function (id) { txt(id, 'Connect wallet'); });
    var w = $('netWarn'); if (w) w.remove();
  }

  function refreshPage() {
    var p = document.body.getAttribute('data-page');
    if (p === 'stake') loadOwned();
    else if (p === 'mystaking') loadStaked();
    else if (p === 'season1') loadSeasonChain();
  }

  function onConnectClick() {
    if (X.account()) openWalletMenu(); else openWalletModal();
  }

  async function doConnect() { onConnectClick(); }

  /* ================= STAKE PAGE ================= */
  async function initStake() {
    walletBar();
    var cb = $('connectBtn'); if (cb) cb.addEventListener('click', onConnectClick);
    var sb = $('stakeBtn'); if (sb) sb.addEventListener('click', doStake);
    X.onAccount(function () { walletBar(); loadOwned(); });
    await X.restore();
    walletBar();
    loadOwned();
  }

  function setCount() {
    var n = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    txt('selCount', 'SELECTED: ' + n);
    var b = $('stakeBtn');
    if (b) {
      b.disabled = n === 0 || !X.account();
      b.textContent = n > 0 ? ('STAKE ' + n + ' XCOPUNKS') : 'SELECT XCOPUNKS TO STAKE';
      b.className = 'wl-submit' + (n > 0 && X.account() ? ' ready' : '');
    }
  }

  async function loadOwned() {
    var grid = $('ownedGrid'), empty = $('ownedEmpty'), load = $('ownedLoading');
    if (!grid) return;
    selected = {}; setCount();
    if (!X.account()) {
      grid.innerHTML = ''; show(load, false);
      if (empty) { empty.hidden = false; empty.innerHTML = 'Connect your wallet to load your XCOPUNKS.'; }
      return;
    }
    show(load, true); show(empty, false); grid.innerHTML = '';
    try {
      var load2 = $('ownedLoading');
      if (load2) { var h = load2.querySelector('.gtd-load-h'); if (h) h.innerHTML = '<span class="gtd-blip"></span>DETECTING XCOPUNKS — LOADING YOUR NFTs...'; }
      var all = await X.ownedTokenIds(X.account());
      // exclude anything already staked (contract is authoritative)
      var st = await X.readStaking('getUserStakedTokens', [X.account()]);
      stakedIds = st.map(function (b) { return b.toString(); });
      var stSet = {}; stakedIds.forEach(function (i) { stSet[i] = 1; });
      ownedIds = all.filter(function (i) { return !stSet[i]; });
      show(load, false);
      if (!ownedIds.length) {
        if (empty) {
          empty.hidden = false;
          empty.innerHTML = stakedIds.length
            ? 'All of your XCOPUNKS are currently staked. <a href="' + (window.XCP_BASE || '') + 'my-staking/">View MY STAKING →</a>'
            : '<strong style="font-family:\'Press Start 2P\',monospace;font-size:12px;color:#ff7a00;display:block;margin-bottom:10px;">NO XCOPUNKS FOUND</strong>No XCOPUNKS NFTs were found in this wallet. <a href="' + X.OPENSEA + '" target="_blank" rel="noopener">Get one on OpenSea →</a>';
        }
        return;
      }
      ownedIds.forEach(function (id) { grid.appendChild(card(id)); });
      ownedIds.forEach(function (id) {
        X.tokenImage(id).then(function (src) {
          var im = document.getElementById('img-' + id);
          if (im && src) im.src = src;
        });
      });
    } catch (e) {
      show(load, false);
      if (empty) { empty.hidden = false; empty.textContent = X.friendly(e); }
    }
  }

  function card(id) {
    var d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = '<img id="img-' + id + '" alt="XCOPUNKS #' + id + '">' +
      '<div class="card-body"><div class="card-id">XCO #' + id + '</div>' +
      '<div class="card-stat">AVAILABLE</div>' +
      '<div class="card-badge">SELECT</div></div>';
    d.addEventListener('click', function () {
      selected[id] = !selected[id];
      d.className = 'card' + (selected[id] ? ' sel' : '');
      d.querySelector('.card-badge').textContent = selected[id] ? 'SELECTED' : 'SELECT';
      var chk = d.querySelector('.card-check');
      if (selected[id] && !chk) {
        var c = document.createElement('div'); c.className = 'card-check'; c.textContent = '\u2713';
        d.insertBefore(c, d.firstChild);
      } else if (!selected[id] && chk) { chk.remove(); }
      setCount();
    });
    return d;
  }

  async function doStake() {
    var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
    if (!ids.length) return;
    var btn = $('stakeBtn'); if (btn) btn.disabled = true;
    try {
      var enabled = await X.readStaking('stakingEnabled', []);
      var glob = await X.readStaking('globalEnabled', []);
      if (!enabled || !glob) throw new Error('StakingIsDisabled');

      var nft = X.nftWrite();
      var approved = await X.readNft('isApprovedForAll', [X.account(), X.STAKING_ADDR]);
      if (!approved) {
        status('APPROVE XCOPUNKS IN YOUR WALLET');
        var ta = await nft.setApprovalForAll(X.STAKING_ADDR, true);
        status('WAITING FOR APPROVAL CONFIRMATION');
        await ta.wait();
      }
      status('CONFIRM STAKE IN YOUR WALLET');
      var c = await X.stakingWrite();
      var tx = await c.stake(ids.map(function (i) { return ethers.BigNumber.from(i); }));
      status('STAKING XCOPUNKS — WAITING FOR CONFIRMATION');
      await tx.wait();
      status('STAKE CONFIRMED', 'ok');
      selected = {};
      await loadOwned();
    } catch (e) {
      status(X.friendly(e), 'err');
    }
    setCount();
  }

  /* ================= MY STAKING PAGE ================= */
  async function initMyStaking() {
    walletBar();
    var cb = $('connectBtn'); if (cb) cb.addEventListener('click', onConnectClick);
    X.onAccount(function () { walletBar(); loadStaked(); });
    await X.restore();
    walletBar();
    loadStaked();
  }

  async function loadStaked() {
    var grid = $('mineGrid'), empty = $('mineEmpty'), load = $('mineLoading');
    if (!grid) return;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (!X.account()) {
      grid.innerHTML = ''; show(load, false);
      txt('uActive', '—'); txt('uShare', '—'); txt('uXcpn', 'Connect wallet'); txt('uEth', 'Connect wallet');
      if (empty) { empty.hidden = false; empty.innerHTML = 'Connect your wallet to view your staked XCOPUNKS.'; }
      return;
    }
    show(load, true); show(empty, false); grid.innerHTML = '';
    try {
      var ids = (await X.readStaking('getUserStakedTokens', [X.account()])).map(function (b) { return b.toString(); });
      var total = await X.readStaking('totalCurrentlyStaked', []);
      txt('uActive', String(ids.length));
      txt('uShare', total.gt(0) ? (Math.round(ids.length / total.toNumber() * 10000) / 100) + '%' : '0%');
      show(load, false);
      if (!ids.length) {
        txt('uXcpn', '0'); txt('uEth', '0');
        if (empty) { empty.hidden = false; empty.innerHTML = 'You have no staked XCOPUNKS. <a href="' + (window.XCP_BASE || '') + 'stake/">Go to STAKE →</a>'; }
        return;
      }
      var sumEth = ethers.BigNumber.from(0), sumXcpn = ethers.BigNumber.from(0);
      stakeMeta = {};
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var info = await X.readStaking('getStakeInfo', [id]);
        var rem = await X.readStaking('getRemainingLockTime', [id]);
        var elig = await X.readStaking('isEligibleForUnstake', [id]);
        var cEth = await X.readStaking('getClaimableETHReward', [id]);
        var cXcpn = await X.readStaking('getClaimableXCPNReward', [id]);
        sumEth = sumEth.add(cEth); sumXcpn = sumXcpn.add(cXcpn);
        stakeMeta[id] = { remaining: rem.toNumber(), unlock: info.unlockTime.toNumber() };
        grid.appendChild(stakeCard(id, info, rem.toNumber(), elig, cEth, cXcpn));
        X.tokenImage(id).then(function (tid) {
          return function (src) { var im = document.getElementById('mimg-' + tid); if (im && src) im.src = src; };
        }(id));
      }
      txt('uEth', X.fmtEth(sumEth) + ' ETH');
      txt('uXcpn', X.fmtUnits(sumXcpn) + ' XCPN');
      tickTimer = setInterval(tick, 1000);
    } catch (e) {
      show(load, false);
      if (empty) { empty.hidden = false; empty.textContent = X.friendly(e); }
    }
  }

  function tick() {
    Object.keys(stakeMeta).forEach(function (id) {
      var m = stakeMeta[id];
      if (m.remaining > 0) m.remaining -= 1;
      var e = document.getElementById('rem-' + id);
      if (e) e.textContent = X.dur(m.remaining);
      if (m.remaining === 0 && !m.flipped) { m.flipped = true; loadStaked(); }
    });
  }

  function stakeCard(id, info, remaining, eligible, cEth, cXcpn) {
    var unlocked = remaining <= 0 && eligible;
    var el = document.createElement('div');
    el.className = 'mcard' + (unlocked ? ' unlocked' : '');
    el.innerHTML =
      '<div class="mtop"><img id="mimg-' + id + '" alt="XCOPUNKS #' + id + '"><div>' +
      '<div class="card-id">XCO #' + id + '</div>' +
      '<div class="badge-state">' + (unlocked ? 'UNLOCKED' : 'LOCKED') + '</div>' +
      '<div class="mdates">Staked: ' + X.utc(info.stakeTime) + '<br>Unlock: ' + X.utc(info.unlockTime) + '</div>' +
      '</div></div>' +
      '<div class="mrew">' +
      '<div><div class="l">$XCPN</div><div class="v" style="color:#ffe500">' + X.fmtUnits(cXcpn) + '</div></div>' +
      '<div><div class="l">ETH</div><div class="v" style="color:#00e0ff">' + X.fmtEth(cEth) + '</div></div>' +
      '</div>' +
      '<div class="mfoot"><div class="mtimer">' + (unlocked ? 'UNSTAKE AVAILABLE' : 'TIME UNTIL 7-DAY UNLOCK') + '</div>' +
      '<div class="cd-line" id="rem-' + id + '">' + X.dur(remaining) + '</div>' +
      '<div class="mact">' +
      '<button class="claim" data-cx="' + id + '"' + (cXcpn.gt(0) ? '' : ' disabled') + '>CLAIM XCPN</button>' +
      '<button class="claim" data-ce="' + id + '"' + (cEth.gt(0) ? '' : ' disabled') + '>CLAIM ETH</button>' +
      '</div>' +
      '<div class="mact"><button class="unstake" data-un="' + id + '"' + (unlocked ? '' : ' disabled') + '>UNSTAKE</button></div>' +
      '</div>';
    el.querySelector('[data-cx]').addEventListener('click', function () { claim(id, 'xcpn'); });
    el.querySelector('[data-ce]').addEventListener('click', function () { claim(id, 'eth'); });
    el.querySelector('[data-un]').addEventListener('click', function () { unstake(id); });
    return el;
  }

  async function claim(id, kind) {
    try {
      var on = await X.readStaking(kind === 'eth' ? 'ethRewardsEnabled' : 'xcpnRewardsEnabled', []);
      if (!on) throw new Error(kind === 'eth' ? 'ETHRewardsDisabled' : 'XCPNRewardsDisabled');
      status('CONFIRM CLAIM IN YOUR WALLET');
      var c = await X.stakingWrite();
      var tx = kind === 'eth'
        ? await c.claimETHReward([ethers.BigNumber.from(id)])
        : await c.claimXCPNReward([ethers.BigNumber.from(id)]);
      status('CLAIMING — WAITING FOR CONFIRMATION');
      await tx.wait();
      status('CLAIM CONFIRMED', 'ok');
      await loadStaked();
    } catch (e) { status(X.friendly(e), 'err'); }
  }

  async function unstake(id) {
    try {
      var on = await X.readStaking('unstakingEnabled', []);
      if (!on) throw new Error('UnstakingIsDisabled');
      status('CONFIRM UNSTAKE IN YOUR WALLET');
      var c = await X.stakingWrite();
      var tx = await c.unstake([ethers.BigNumber.from(id)]);
      status('UNSTAKING — WAITING FOR CONFIRMATION');
      await tx.wait();
      status('UNSTAKE CONFIRMED', 'ok');
      await loadStaked();
    } catch (e) { status(X.friendly(e), 'err'); }
  }

  /* ================= VAULT PAGE ================= */
  async function initVault() {
    try {
      var total = await X.readStaking('totalCurrentlyStaked', []);
      txt('vNfts', total.toString());
    } catch (e) { txt('vNfts', '—'); }
    try {
      var lock = await X.readStaking('lockDuration', []);
      txt('vLock', Math.round(lock.toNumber() / 86400) + ' DAYS');
    } catch (e) {}
    // Mint Fee wallet — live ETH balance, split 90 / 10
    try {
      var mb = await X.withProvider(function (p) { return p.getBalance(X.MINT_FEE_WALLET); });
      txt('vMintTotal', X.fmtEth(mb) + ' ETH');
      txt('vMintStake', X.fmtEth(X.pct(mb, 90, 100)) + ' ETH');
      txt('vMintBuild', X.fmtEth(X.pct(mb, 10, 100)) + ' ETH');
    } catch (e) {
      txt('vMintTotal', 'NETWORK BUSY'); txt('vMintStake', '—'); txt('vMintBuild', '—');
    }
    // Creator Fee wallet — separate live ETH balance, split 7 / 3 of that stream
    try {
      var cb = await X.withProvider(function (p) { return p.getBalance(X.CREATOR_FEE_WALLET); });
      txt('vCrTotal', X.fmtEth(cb) + ' ETH');
      txt('vCrEth', X.fmtEth(X.pct(cb, 70, 100)) + ' ETH');
      txt('vCrBuild', X.fmtEth(X.pct(cb, 30, 100)) + ' ETH');
    } catch (e) {
      txt('vCrTotal', 'NETWORK BUSY'); txt('vCrEth', '—'); txt('vCrBuild', '—');
    }
    // $XCPN reward pool held by the staking contract (real token balance)
    try {
      var tok = await X.readStaking('xcpnToken', []);
      if (!tok || /^0x0{40}$/i.test(tok)) { txt('vXcpnPool', 'NOT CONFIGURED'); }
      else {
        var res = await X.withProvider(function (p) {
          var t = new ethers.Contract(tok, X.ERC20_ABI, p);
          return Promise.all([t.balanceOf(X.STAKING_ADDR), t.decimals()]);
        });
        txt('vXcpnPool', X.fmtUnits(res[0], res[1]) + ' XCPN');
      }
    } catch (e) { txt('vXcpnPool', 'NETWORK BUSY'); }
    // live status flags
    try {
      var f = await Promise.all([
        X.readStaking('stakingEnabled', []), X.readStaking('unstakingEnabled', []),
        X.readStaking('ethRewardsEnabled', []), X.readStaking('xcpnRewardsEnabled', [])
      ]);
      txt('vStatus', f[0] ? 'STAKING LIVE' : 'STAKING PAUSED');
      txt('vFlags', 'UNSTAKE ' + (f[1] ? 'ON' : 'OFF') + ' · ETH ' + (f[2] ? 'ON' : 'OFF') + ' · XCPN ' + (f[3] ? 'ON' : 'OFF'));
    } catch (e) { txt('vStatus', '—'); }
  }

  /* ================= SEASON 1 PAGE ================= */
  var SEASON_START = Date.UTC(2026, 7, 14, 14, 0, 0);
  var SEASON_END = Date.UTC(2026, 7, 21, 14, 0, 0);

  function initSeason() {
    var lbl = $('cdLabel');
    var cells = { d: $('cdD'), h: $('cdH'), m: $('cdM'), s: $('cdS') };
    function pad(n) { n = Math.max(0, Math.floor(n)); return (n < 10 ? '0' : '') + n; }
    function tick() {
      var now = Date.now(), target = null, label;
      if (now < SEASON_START) { target = SEASON_START; label = 'COUNTDOWN TO SEASON 1 START'; }
      else if (now < SEASON_END) { target = SEASON_END; label = 'SEASON 1 ACTIVE \u00b7 TIME REMAINING'; }
      else { label = 'SEASON 1 ENDED'; }
      if (lbl) lbl.textContent = label;
      var ms = target ? Math.max(0, target - now) : 0;
      if (cells.d) {
        cells.d.textContent = pad(ms / 86400000);
        cells.h.textContent = pad((ms / 3600000) % 24);
        cells.m.textContent = pad((ms / 60000) % 60);
        cells.s.textContent = pad((ms / 1000) % 60);
      }
    }
    tick(); setInterval(tick, 1000);
    loadSeasonChain();
    var cb = $('connectBtn');
    if (cb) cb.addEventListener('click', onConnectClick);
    X.onAccount(function () { walletBar(); loadSeasonChain(); });
    X.restore().then(function () { walletBar(); loadSeasonChain(); });
  }

  /* Real staking participation, read from the contract. */
  async function loadSeasonChain() {
    var lb = $('lbBody'), note = $('lbNote');
    try {
      var total = await X.readStaking('totalCurrentlyStaked', []);
      txt('aNfts', total.toString());
      var acct = X.account();
      if (!acct) {
        txt('aYours', '—');
        txt('aShare', 'Connect wallet');
        if (lb) lb.innerHTML = '';
        if (note) note.textContent = 'Connect your wallet to see your Season 1 staking position. Total staked is read live from the staking contract.';
        return;
      }
      var mine = await X.readStaking('getUserStakedTokens', [acct]);
      txt('aYours', String(mine.length));
      var share = total.gt(0) ? (Math.round(mine.length / total.toNumber() * 10000) / 100) + '%' : '0%';
      txt('aShare', share);
      if (lb) {
        if (!mine.length) {
          lb.innerHTML = '';
          if (note) note.textContent = 'You have no staked XCOPUNKS this season yet.';
          return;
        }
        var sumEth = ethers.BigNumber.from(0), sumXcpn = ethers.BigNumber.from(0);
        for (var i = 0; i < mine.length; i++) {
          sumEth = sumEth.add(await X.readStaking('getClaimableETHReward', [mine[i]]));
          sumXcpn = sumXcpn.add(await X.readStaking('getClaimableXCPNReward', [mine[i]]));
        }
        lb.innerHTML = '<div class="lb-row you"><div class="lb-rank" style="color:#ffe500">YOU</div>' +
          '<div class="lb-w you">' + shortAddr(acct) + '</div>' +
          '<div class="lb-staked">' + mine.length + '</div>' +
          '<div class="lb-share x">' + X.fmtUnits(sumXcpn) + '</div>' +
          '<div class="lb-share e">' + X.fmtEth(sumEth) + '</div></div>';
        if (note) note.textContent = 'Your live Season 1 position. Each staked XCOPUNKS is one equal reward share of the active pools.';
      }
    } catch (e) {
      txt('aNfts', '—'); txt('aYours', '—');
      if (note) note.textContent = X.friendly(e);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var p = document.body.getAttribute('data-page');
    if (p === 'stake') initStake();
    else if (p === 'mystaking') initMyStaking();
    else if (p === 'vault') initVault();
    else if (p === 'season1') initSeason();
  });
})();
