/* XCOPUNKS — /reward/ 24-HOUR REWARD CAMPAIGN controller (LIVE)
 * ---------------------------------------------------------------
 * Independent of the live 7-day staking system. The only 7-day call made
 * here is a read of getUserStakedTokens, so NFTs locked in that campaign
 * are not offered twice.
 *
 * Contract: 0x529D05EC42f750d13544F4896568C18ef59a0C92 (deployed ABI).
 * The contract is authoritative for cap, totals, reward, campaign window,
 * per-token lock, claim eligibility and unstake eligibility. Nothing is
 * reported as done until the transaction is confirmed on chain.
 *
 * Staking is push-based: the ABI has onERC721Received and no stake(), so a
 * stake is NFT.safeTransferFrom(user, staking, tokenId) — one tx per token.
 */
(function () {
  var X = window.XCP, C = window.XCP_REWARD;
  var $ = function (id) { return document.getElementById(id); };
  var selected = {}, ownedIds = [], lockedElsewhere = {}, positions = {}, tick1 = null;
  var campaign = { start: null, end: null, cap: null, total: null, reward: null, decimals: 18,
                   stakingOn: null, unstakingOn: null, rewardsOn: null };

  var NFT_TRANSFER_ABI = [
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'function ownerOf(uint256 tokenId) view returns (address)'
  ];

  function txt(id, v) { var e = $(id); if (e) e.textContent = v; }
  function show(el, on) { if (el) el.hidden = !on; }
  function shortAddr(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : ''; }
  function status(msg, kind) {
    var e = $('txStatus'); if (!e) return;
    e.hidden = !msg; e.textContent = msg || '';
    e.className = 'tx-status' + (kind ? ' ' + kind : '');
  }
  function num(bn) { try { return bn.toNumber ? bn.toNumber() : Number(bn); } catch (e) { return Number(bn.toString()); } }
  function group(n) { return Number(n).toLocaleString('en-US'); }
  /* Token amounts, grouped to 2 dp: 136,525.39 XCPN. web3.js's fmtUnits is
     shared with the live 7-day pages, so the grouping lives here. */
  function fmtToken(bn, decimals) {
    try {
      var n = parseFloat(ethers.utils.formatUnits(bn, decimals == null ? 18 : decimals));
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) { return '\u2014'; }
  }

  /* Contract errors specific to the 24-hour campaign, in plain language.
     Falls back to the site-wide handler for wallet/network/RPC cases. */
  var R_ERRORS = {
    CampaignCapReached: 'The campaign is full — all 2,000 slots have been taken.',
    CampaignEnded: 'The 24-hour entry window has closed.',
    CampaignNotStarted: 'The campaign has not opened yet.',
    StakingNotEnabled: 'Staking is currently turned off for this campaign.',
    UnstakingNotEnabled: 'Unstaking is currently turned off for this campaign.',
    RewardsNotEnabled: 'Reward claims are currently turned off.',
    RewardAlreadyClaimed: 'The reward for that XCOPUNKS has already been claimed.',
    RewardNotYetClaimed: 'Claim the reward for that XCOPUNKS before unstaking it.',
    InsufficientRewardPool: 'The reward pool balance is too low right now. Please try again shortly.',
    NotOriginalStaker: 'That stake belongs to another wallet.',
    NotXcopunksNFT: 'That token is not an XCOPUNKS NFT.',
    StillLocked: 'That XCOPUNKS is still inside its 24-hour lock.',
    TokenAlreadyActivelyStaked: 'That XCOPUNKS is already staked in this campaign.',
    TokenNotActivelyStaked: 'That XCOPUNKS is not staked in this campaign.',
    EmergencyIsDisabled: 'The campaign is temporarily paused.',
    ReentrancyGuardReentrantCall: 'Request rejected, please retry.'
  };
  function friendly(e) {
    var raw = '';
    try { raw = JSON.stringify(e && (e.error || e.data || e.message || e) || ''); } catch (x) { raw = String(e); }
    for (var k in R_ERRORS) if (raw.indexOf(k) > -1) return R_ERRORS[k];
    return X.friendly(e);
  }

  /* ---------------- contract layer ---------------- */
  var rewardAbi = null;
  async function loadRewardAbi() {
    if (rewardAbi) return rewardAbi;
    if (C.NEW_REWARD_STAKING_ABI) { rewardAbi = C.NEW_REWARD_STAKING_ABI; return rewardAbi; }
    var r = await fetch((window.XCP_BASE || '') + C.ABI_URL);
    rewardAbi = await r.json();
    return rewardAbi;
  }
  /* Reads go through the site's existing multi-endpoint failover. */
  async function readReward(fn, args) {
    var abi = await loadRewardAbi();
    return X.withProvider(function (p) {
      return new ethers.Contract(C.NEW_REWARD_STAKING_CONTRACT, abi, p)[fn].apply(null, args || []);
    });
  }
  /* One extra retry for transient provider trouble before giving up. */
  async function readRetry(fn, args) {
    try { return await readReward(fn, args); }
    catch (e) {
      var m = String((e && (e.message || e.code)) || '');
      if (/CALL_EXCEPTION|revert/i.test(m)) throw e;
      await new Promise(function (r) { setTimeout(r, 600); });
      return readReward(fn, args);
    }
  }
  async function rewardWrite() {
    var abi = await loadRewardAbi();
    var signer = X.signer();
    if (!signer) throw new Error('NO_WALLET');
    return new ethers.Contract(C.NEW_REWARD_STAKING_CONTRACT, abi, signer);
  }
  function nftTransferContract() {
    var signer = X.signer();
    if (!signer) throw new Error('NO_WALLET');
    return new ethers.Contract(C.XCOPUNKS_NFT_CONTRACT, NFT_TRANSFER_ABI, signer);
  }

  /* ---------------- wallet ---------------- */
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
        catch (e) { closeModal(); status(friendly(e), 'err'); }
        walletBar(); refreshAll();
      });
    });
  }
  function openWalletMenu() {
    closeModal();
    var a = X.account(); if (!a) return;
    var m = document.createElement('div');
    m.id = 'walletModal'; m.className = 'wmodal';
    m.innerHTML = '<div class="wmodal-box">' +
      '<div class="wmodal-h">WALLET</div>' +
      '<div class="waddr">' + a + '</div>' +
      '<div class="wlist">' +
      '<button class="wopt" id="wCopy"><span class="wdot"></span><span>COPY ADDRESS</span></button>' +
      '<button class="wopt danger" id="wDisc"><span class="wdot"></span><span>DISCONNECT</span></button>' +
      '</div><button class="wclose" id="wClose">CLOSE</button></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    $('wClose').addEventListener('click', closeModal);
    $('wCopy').addEventListener('click', function () {
      var t = $('wCopy').querySelector('span:last-child');
      try { navigator.clipboard.writeText(a); t.textContent = 'COPIED \u2713'; }
      catch (e) { t.textContent = 'COPY FAILED'; }
    });
    $('wDisc').addEventListener('click', function () {
      X.disconnect(); closeModal(); clearUserState(); walletBar(); refreshAll();
    });
  }
  function walletBar() {
    var btn = $('connectBtn'), a = X.account();
    if (btn) btn.textContent = a ? (shortAddr(a) + ' \u25BE') : 'CONNECT WALLET';
    if (a) checkNetwork(); else { var w = $('netWarn'); if (w) w.remove(); }
  }
  async function checkNetwork() {
    var ok = true;
    try { ok = await X.networkOk(); } catch (e) { ok = true; }
    var bar = document.querySelector('.wallet-bar'), w = $('netWarn');
    if (ok) { if (w) w.remove(); return; }
    if (!w && bar) {
      w = document.createElement('div');
      w.id = 'netWarn'; w.className = 'net-warn';
      w.innerHTML = '<span>WRONG NETWORK — please switch to Robinhood Chain to continue.</span>' +
        '<button class="btn btn-yellow" id="netSwitch">SWITCH NETWORK</button>';
      bar.parentNode.insertBefore(w, bar.nextSibling);
      $('netSwitch').addEventListener('click', async function () {
        try { await X.switchNetwork(); checkNetwork(); }
        catch (e) { status(friendly(e), 'err'); }
      });
    }
  }
  /* Wipe every trace of the previous wallet before loading the next. */
  function clearUserState() {
    selected = {}; ownedIds = []; lockedElsewhere = {}; positions = {};
    if (tick1) { clearInterval(tick1); tick1 = null; }
    status('');
    var g = $('rwGrid'); if (g) g.innerHTML = '';
    var p = $('posGrid'); if (p) p.innerHTML = '';
    txt('rwEligible', '\u2014');
  }
  function refreshAll() { loadCampaign(); loadOwned(); loadPositions(); }

  /* ---------------- campaign state (contract authoritative) ---------------- */
  async function loadCampaign() {
    try {
      var vals = await Promise.all([
        readRetry('campaignStartTime', []), readRetry('campaignEndTime', []),
        readRetry('MAX_STAKED_NFTS', []), readRetry('totalStaked', []),
        readRetry('rewardPerNFT', []), readRetry('rewardTokenDecimals', []),
        readRetry('stakingEnabled', []), readRetry('unstakingEnabled', []),
        readRetry('rewardsEnabled', [])
      ]);
      campaign.start = num(vals[0]);
      campaign.end = num(vals[1]);
      campaign.cap = num(vals[2]);
      campaign.total = num(vals[3]);
      campaign.reward = vals[4];
      campaign.decimals = num(vals[5]) || 18;
      campaign.stakingOn = !!vals[6];
      campaign.unstakingOn = !!vals[7];
      campaign.rewardsOn = !!vals[8];

      txt('rewardRule', fmtToken(campaign.reward, campaign.decimals) + ' XCPN per NFT');
      txt('capStaked', group(campaign.total));
      txt('capCap', group(campaign.cap));
      var left = Math.max(0, campaign.cap - campaign.total);
      txt('capLeft', group(left) + ' SLOTS REMAINING');
      var bar = $('capBar');
      if (bar) bar.style.width = Math.min(100, (campaign.total / campaign.cap) * 100) + '%';
      txt('capNote', left === 0
        ? 'Campaign capacity reached — no further stakes are accepted.'
        : 'Live from the campaign contract.');
    } catch (e) {
      txt('capNote', friendly(e));
    }
    paintCountdown();
    setCount();
  }
  function campaignPhase() {
    if (campaign.start === null) return 'unknown';
    var now = Math.floor(Date.now() / 1000);
    if (now < campaign.start) return 'pending';
    if (now < campaign.end) return 'open';
    return 'ended';
  }
  function pad(n) { n = Math.max(0, Math.floor(n)); return (n < 10 ? '0' : '') + n; }
  function paintCountdown() {
    var cells = { d: $('cdD'), h: $('cdH'), m: $('cdM'), s: $('cdS') }, lbl = $('cdLabel');
    if (campaign.start === null) {
      if (lbl) lbl.textContent = 'READING CAMPAIGN WINDOW FROM CONTRACT...';
      return;
    }
    var now = Date.now(), target = null, label, phase = campaignPhase();
    if (phase === 'pending') { target = campaign.start * 1000; label = 'COUNTDOWN TO CAMPAIGN OPEN'; }
    else if (phase === 'open') { target = campaign.end * 1000; label = 'ENTRY WINDOW OPEN \u00b7 TIME LEFT TO ENTER'; }
    else { label = 'ENTRY WINDOW CLOSED'; }
    if (lbl) lbl.textContent = label;
    var ms = target ? Math.max(0, target - now) : 0;
    if (cells.d) {
      cells.d.textContent = pad(ms / 86400000);
      cells.h.textContent = pad((ms / 3600000) % 24);
      cells.m.textContent = pad((ms / 60000) % 60);
      cells.s.textContent = pad((ms / 1000) % 60);
    }
    if (target && ms === 0 && !paintCountdown._flip) { paintCountdown._flip = true; loadCampaign(); }
  }

  /* ---------------- owned NFTs ---------------- */
  function stakeBlockReason() {
    if (campaign.start === null) return 'READING CAMPAIGN STATUS...';
    var phase = campaignPhase();
    if (phase === 'pending') return 'CAMPAIGN HAS NOT OPENED YET';
    if (phase === 'ended') return 'ENTRY WINDOW CLOSED';
    if (campaign.stakingOn === false) return 'STAKING IS TURNED OFF';
    if (campaign.cap !== null && campaign.total >= campaign.cap) return 'CAMPAIGN FULL — 2,000 / 2,000';
    if (!X.account()) return 'CONNECT WALLET TO STAKE';
    return null;
  }
  function setCount() {
    var n = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    txt('selCount', 'SELECTED: ' + n);
    var b = $('rwStakeBtn');
    if (!b) return;
    var blocked = stakeBlockReason();
    if (blocked) { b.disabled = true; b.className = 'wl-submit'; b.textContent = blocked; return; }
    b.disabled = n === 0;
    b.className = 'wl-submit' + (n > 0 ? ' ready' : '');
    b.textContent = n > 0 ? ('STAKE ' + n + ' XCOPUNKS') : 'SELECT XCOPUNKS TO STAKE';
  }

  async function loadOwned() {
    var grid = $('rwGrid'), empty = $('rwEmpty'), load = $('rwLoading');
    if (!grid) return;
    selected = {}; setCount();
    if (!X.account()) {
      grid.innerHTML = ''; show(load, false); txt('rwEligible', '\u2014');
      if (empty) { empty.hidden = false; empty.innerHTML = 'Connect your wallet to load your XCOPUNKS.'; }
      return;
    }
    var acct = X.account();
    show(load, true); show(empty, false); grid.innerHTML = '';
    try {
      var all = await X.ownedTokenIds(acct);
      if (acct !== X.account()) return; // wallet changed mid-read — discard
      lockedElsewhere = {};
      try {
        var st7 = await X.readStaking('getUserStakedTokens', [acct]);
        st7.forEach(function (b) { lockedElsewhere[b.toString()] = 1; });
      } catch (e) { /* informational only */ }
      /* Contract check: anything already inside THIS campaign is not offered. */
      var loadH = document.querySelector('#rwLoading .gtd-load-h');
      if (loadH) loadH.innerHTML = '<span class="gtd-blip"></span>CHECKING STAKING STATUS...';
      var inCampaign = {};
      try {
        var stC = await readRetry('getUserStakedTokens', [acct]);
        stC.forEach(function (b) { inCampaign[b.toString()] = 1; });
      } catch (e) { /* positions panel reports read failures */ }
      ownedIds = all.filter(function (i) { return !inCampaign[i]; });
      show(load, false);
      var eligible = ownedIds.filter(function (i) { return !lockedElsewhere[i]; });
      txt('rwEligible', String(eligible.length));
      if (!ownedIds.length) {
        if (empty) {
          empty.hidden = false;
          empty.innerHTML = Object.keys(inCampaign).length
            ? 'All of your XCOPUNKS are already staked in this campaign. See MY 24-HOUR POSITIONS below.'
            : '<strong style="font-family:\'Press Start 2P\',monospace;font-size:12px;color:#ff7a00;display:block;margin-bottom:10px;">NO XCOPUNKS FOUND</strong>' +
              'No XCOPUNKS NFTs were found in this wallet. <a href="' + X.OPENSEA + '" target="_blank" rel="noopener">Get one on OpenSea \u2192</a>';
        }
        return;
      }
      ownedIds.forEach(function (id) { grid.appendChild(card(id)); });
      ownedIds.forEach(function (id) {
        X.tokenImage(id).then(function (src) {
          var im = document.getElementById('rimg-' + id);
          if (im && src) im.src = src;
        });
      });
    } catch (e) {
      show(load, false);
      if (empty) { empty.hidden = false; empty.textContent = friendly(e); }
    }
    setCount();
  }

  function card(id) {
    var busy = !!lockedElsewhere[id];
    var d = document.createElement('div');
    d.className = 'card';
    d.id = 'rcard-' + id;
    if (busy) { d.style.opacity = '.45'; d.style.cursor = 'not-allowed'; }
    d.innerHTML = '<img id="rimg-' + id + '" alt="XCOPUNKS #' + id + '">' +
      '<div class="card-body"><div class="card-id">XCO #' + id + '</div>' +
      '<div class="card-stat" id="rstat-' + id + '" style="color:' + (busy ? '#ff7a00' : '#b8ff00') + ';">' +
      (busy ? 'IN 7-DAY STAKING' : 'AVAILABLE') + '</div>' +
      '<div class="card-badge">' + (busy ? 'NOT ELIGIBLE' : 'SELECT') + '</div></div>';
    if (busy) return d;
    d.addEventListener('click', function () {
      if (d.getAttribute('data-busy')) return;
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

  /* ---------------- staking: push transfer, one tx per NFT ---------------- */
  async function doStake() {
    var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
    if (!ids.length) return;
    var blocked = stakeBlockReason();
    if (blocked) { status(blocked, 'err'); return; }

    var btn = $('rwStakeBtn');
    if (btn) { btn.disabled = true; btn.className = 'wl-submit'; }
    var acct = X.account(), done = 0, failed = [];
    var nft = null;
    try { nft = nftTransferContract(); }
    catch (e) { status(friendly(e), 'err'); setCount(); return; }

    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var cardEl = document.getElementById('rcard-' + id);
      var statEl = document.getElementById('rstat-' + id);
      if (cardEl) cardEl.setAttribute('data-busy', '1');
      try {
        if (statEl) { statEl.textContent = 'CONFIRM IN WALLET'; statEl.style.color = '#ffe500'; }
        status('STAKING NFT ' + (i + 1) + ' OF ' + ids.length + ' \u2014 CONFIRM TRANSACTION IN YOUR WALLET...');
        var tx = await nft['safeTransferFrom(address,address,uint256)'](acct, C.NEW_REWARD_STAKING_CONTRACT, ethers.BigNumber.from(id));
        if (statEl) statEl.textContent = 'CONFIRMING...';
        status('STAKING NFT ' + (i + 1) + ' OF ' + ids.length + ' \u2014 CONFIRMING ON ROBINHOOD CHAIN...');
        await tx.wait();
        /* Contract state, not the receipt, decides that it is staked. */
        var isSt = false;
        try { isSt = await readRetry('isStaked', [id]); } catch (e2) { isSt = false; }
        if (isSt) {
          done++;
          delete selected[id];
          if (cardEl) cardEl.remove();
        } else {
          failed.push(id);
          if (statEl) { statEl.textContent = 'NOT CONFIRMED BY CONTRACT'; statEl.style.color = '#ff2247'; }
        }
      } catch (e) {
        failed.push(id);
        if (statEl) { statEl.textContent = 'FAILED'; statEl.style.color = '#ff2247'; }
        status('NFT #' + id + ': ' + friendly(e), 'err');
        if (/ACTION_REJECTED|User denied|user rejected/i.test(JSON.stringify(e && (e.message || e)))) break;
      } finally {
        if (cardEl) cardEl.removeAttribute('data-busy');
      }
    }

    if (done && !failed.length) status('STAKE CONFIRMED \u2014 ' + done + ' XCOPUNKS STAKED', 'ok');
    else if (done && failed.length) status('STAKE CONFIRMED FOR ' + done + '. NOT STAKED: #' + failed.join(', #'), 'err');
    else if (failed.length) status('No XCOPUNKS were staked. Not staked: #' + failed.join(', #'), 'err');

    await loadCampaign();
    await loadOwned();
    await loadPositions();
  }

  /* ---------------- individual 24-hour positions ---------------- */
  async function loadPositions() {
    var grid = $('posGrid'), note = $('posNote');
    if (!grid) return;
    grid.innerHTML = '';
    if (tick1) { clearInterval(tick1); tick1 = null; }
    positions = {};
    if (!X.account()) {
      if (note) note.textContent = 'Connect your wallet to view your 24-hour campaign positions.';
      return;
    }
    var acct = X.account();
    if (note) note.textContent = 'CHECKING STAKING STATUS...';
    try {
      var ids = (await readRetry('getUserStakedTokens', [acct])).map(function (b) { return b.toString(); });
      if (acct !== X.account()) return;
      if (!ids.length) {
        if (note) note.textContent = 'You have no XCOPUNKS in the 24-hour campaign.';
        return;
      }
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var info = await readRetry('getStakeInfo', [id]);
        var rem = num(await readRetry('getRemainingLockTime', [id]));
        var canClaim = await readRetry('isEligibleForReward', [id]);
        var canUnstake = await readRetry('isEligibleForUnstake', [id]);
        var claimable = await readRetry('getClaimableReward', [id]);
        var st = {
          staker: info.staker,
          stakeTime: num(info.stakeTime),
          unlock: num(info.unlockTime),
          rewardAmount: info.rewardAmount,
          claimed: !!info.rewardClaimed,
          active: !!info.active,
          remaining: rem,
          canClaim: !!canClaim,
          canUnstake: !!canUnstake,
          claimable: claimable
        };
        positions[id] = st;
        grid.appendChild(posCard(id, st));
        X.tokenImage(id).then(function (tid) {
          return function (src) { var im = document.getElementById('pimg-' + tid); if (im && src) im.src = src; };
        }(id));
      }
      if (note) note.textContent = 'Each XCOPUNKS runs its own 24-hour period from the moment it was staked. Claim the reward first, then unstake — there is no extra wait after a confirmed claim.';
      tick1 = setInterval(tickPositions, 1000);
    } catch (e) {
      if (note) note.textContent = friendly(e);
    }
  }

  function posCard(id, st) {
    var elapsed = st.remaining <= 0;
    var claimLbl = st.claimed ? 'CLAIMED' : (st.canClaim ? 'AVAILABLE' : 'LOCKED');
    var claimCol = st.claimed ? '#00e0ff' : (st.canClaim ? '#b8ff00' : '#ff7a00');
    var unLbl = st.canUnstake ? 'AVAILABLE' : (elapsed && !st.claimed ? 'CLAIM FIRST' : 'LOCKED');
    var unCol = st.canUnstake ? '#00e0ff' : '#ff7a00';
    var el = document.createElement('div');
    el.className = 'mcard' + (elapsed ? ' unlocked' : '');
    el.innerHTML =
      '<div class="mtop"><img id="pimg-' + id + '" alt="XCOPUNKS #' + id + '"><div>' +
      '<div class="card-id">XCO #' + id + '</div>' +
      '<div class="badge-state">' + (elapsed ? 'UNLOCKED' : 'STAKED \u00b7 LOCKED') + '</div>' +
      '<div class="mdates">Staked: ' + X.utc(st.stakeTime) + '<br>Unlock: ' + X.utc(st.unlock) +
      '<br>Reward: ' + fmtToken(st.rewardAmount, campaign.decimals) + ' XCPN</div>' +
      '</div></div>' +
      '<div class="mrew">' +
      '<div><div class="l">REWARD CLAIM</div><div class="v" style="color:' + claimCol + '">' + claimLbl + '</div></div>' +
      '<div><div class="l">UNSTAKE</div><div class="v" style="color:' + unCol + '">' + unLbl + '</div></div>' +
      '</div>' +
      '<div class="mfoot"><div class="mtimer">THIS NFT\u2019S OWN 24-HOUR PERIOD</div>' +
      '<div class="cd-line" id="prem-' + id + '">' + X.dur(st.remaining) + '</div>' +
      '<div class="mact">' +
      '<button class="claim" data-cl="' + id + '"' + (st.canClaim ? '' : ' disabled') + '>' +
      (st.claimed ? 'REWARD CLAIMED' : 'CLAIM REWARD') + '</button>' +
      '<button class="unstake" data-un="' + id + '"' + (st.canUnstake ? '' : ' disabled') + '>UNSTAKE</button>' +
      '</div></div>';
    el.querySelector('[data-cl]').addEventListener('click', function () { doClaim(id); });
    el.querySelector('[data-un]').addEventListener('click', function () { doUnstake(id); });
    return el;
  }
  function tickPositions() {
    Object.keys(positions).forEach(function (id) {
      var st = positions[id];
      if (st.remaining > 0) st.remaining -= 1;
      var e = document.getElementById('prem-' + id);
      if (e) e.textContent = X.dur(st.remaining);
      /* When a lock elapses, re-read the contract instead of guessing. */
      if (st.remaining === 0 && !st.flipped) { st.flipped = true; loadPositions(); }
    });
  }

  async function doClaim(id) {
    try {
      if (campaign.rewardsOn === false) throw new Error('RewardsNotEnabled');
      var ok = await readRetry('isEligibleForReward', [id]);
      if (!ok) { status('The contract reports that XCO #' + id + ' is not eligible to claim yet.', 'err'); await loadPositions(); return; }
      var c = await rewardWrite();
      status('CONFIRM TRANSACTION IN YOUR WALLET...');
      var tx = await c.claimReward(ethers.BigNumber.from(id));
      status('CONFIRMING ON ROBINHOOD CHAIN...');
      await tx.wait();
      var info = await readRetry('getStakeInfo', [id]);
      if (info.rewardClaimed) status('REWARD CLAIMED \u2014 UNSTAKE IS NOW AVAILABLE', 'ok');
      else status('The claim transaction confirmed but the contract does not yet report it as claimed. Refreshing.', 'err');
      await loadPositions();
    } catch (e) { status(friendly(e), 'err'); }
  }

  async function doUnstake(id) {
    try {
      if (campaign.unstakingOn === false) throw new Error('UnstakingNotEnabled');
      var ok = await readRetry('isEligibleForUnstake', [id]);
      if (!ok) { status('The contract reports that XCO #' + id + ' cannot be unstaked yet.', 'err'); await loadPositions(); return; }
      var c = await rewardWrite();
      status('CONFIRM TRANSACTION IN YOUR WALLET...');
      var tx = await c.unstake(ethers.BigNumber.from(id));
      status('CONFIRMING ON ROBINHOOD CHAIN...');
      await tx.wait();
      var stillStaked = true;
      try { stillStaked = await readRetry('isStaked', [id]); } catch (e2) {}
      status(stillStaked
        ? 'The unstake transaction confirmed but the contract still reports the NFT as staked. Refreshing.'
        : 'NFT UNSTAKED', stillStaked ? 'err' : 'ok');
      await loadCampaign(); await loadOwned(); await loadPositions();
    } catch (e) { status(friendly(e), 'err'); }
  }

  /* ---------------- init ---------------- */
  document.addEventListener('DOMContentLoaded', async function () {
    paintCountdown();
    setInterval(paintCountdown, 1000);
    loadCampaign();
    var cb = $('connectBtn');
    if (cb) cb.addEventListener('click', function () { if (X.account()) openWalletMenu(); else openWalletModal(); });
    var sb = $('rwStakeBtn'); if (sb) sb.addEventListener('click', doStake);
    /* Account switch / disconnect: drop all previous-wallet state first. */
    X.onAccount(function () { clearUserState(); walletBar(); loadOwned(); loadPositions(); });
    await X.restore();
    walletBar();
    loadOwned();
    loadPositions();
    setCount();
  });
})();
