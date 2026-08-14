/* XCOPUNKS — live blockchain layer (Step 3)
 * Real contracts, real ownership, real transactions. No demo data.
 * Requires: ethers v5 UMD + js/rpc-config.js loaded first.
 */
(function () {
  var B = (window.XCP_BASE || '');
  var NFT_ADDR = '0xfcba20492b1cd40607b13c9f61b6b6d416a08cf7';
  var STAKING_ADDR = '0x465F3Ce3aEf55D8DB81E82DbaDb023A7CAf1D942';
  var MINT_FEE_WALLET = '0xb5a966ecfe664e8959Fc6FBeCDbe18e6BDc6ab82';
  var CREATOR_FEE_WALLET = '0x66A22fc0B0Bd2A6Bc8ae27C826A6cA7D7eb2C89C';
  var OPENSEA = 'https://opensea.io/collection/xcopunks/overview';

  var NFT_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function setApprovalForAll(address operator, bool approved)',
    'function safeTransferFrom(address from, address to, uint256 tokenId)'
  ];
  var ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
  ];

  var eps = (window.XCP_RPC_ENDPOINTS || []).slice();
  var provCache = [], rpcIndex = 0, chainIdHex = null, stakingAbi = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function prov(i) {
    if (!provCache[i]) provCache[i] = new ethers.providers.StaticJsonRpcProvider(eps[i]);
    return provCache[i];
  }
  /* Try every endpoint in priority order; rotate on recoverable failure. */
  async function withProvider(fn) {
    var lastErr = null;
    for (var i = 0; i < eps.length; i++) {
      var idx = (rpcIndex + i) % eps.length;
      try {
        var out = await fn(prov(idx));
        rpcIndex = idx;
        return out;
      } catch (e) {
        lastErr = e;
        var m = String((e && (e.message || e.code)) || '');
        // a contract revert is NOT an endpoint problem — surface it immediately
        if (/CALL_EXCEPTION|revert|INVALID_ARGUMENT/i.test(m)) throw e;
        await sleep(120 * (i + 1));
      }
    }
    throw lastErr || new Error('RPC_ALL_FAILED');
  }
  async function loadAbi() {
    if (stakingAbi) return stakingAbi;
    var r = await fetch(B + 'assets/abi/xcopunks-staking.json');
    stakingAbi = await r.json();
    return stakingAbi;
  }
  async function readStaking(fn, args) {
    var abi = await loadAbi();
    return withProvider(function (p) {
      return new ethers.Contract(STAKING_ADDR, abi, p)[fn].apply(null, args || []);
    });
  }
  async function readNft(fn, args) {
    return withProvider(function (p) {
      return new ethers.Contract(NFT_ADDR, NFT_ABI, p)[fn].apply(null, args || []);
    });
  }
  function getChainId() {
    if (chainIdHex) return Promise.resolve(chainIdHex);
    return withProvider(function (p) { return p.getNetwork(); }).then(function (n) {
      chainIdHex = '0x' + n.chainId.toString(16);
      return chainIdHex;
    });
  }

  /* ---------------- wallet ---------------- */
  var injected = null, signer = null, account = null;
  var listeners = [];
  function onAccount(cb) { listeners.push(cb); }
  function emit() { listeners.forEach(function (cb) { try { cb(account); } catch (e) {} }); }

  /* Collect every injected EVM provider (EIP-6963 + legacy multi-provider). */
  var discovered = [];   // {provider, name, rdns, icon}
  function addDiscovered(p, name, rdns, icon) {
    for (var i = 0; i < discovered.length; i++) if (discovered[i].provider === p) return;
    discovered.push({ provider: p, name: name || 'Injected Wallet', rdns: rdns || '', icon: icon || '' });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('eip6963:announceProvider', function (e) {
      var d = e && e.detail;
      if (d && d.provider && d.info) addDiscovered(d.provider, d.info.name, d.info.rdns, d.info.icon);
    });
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {}
  }
  function legacyName(p) {
    if (p.isMetaMask && !p.isBraveWallet) return 'MetaMask';
    if (p.isCoinbaseWallet || p.isCoinbaseBrowser) return 'Coinbase Wallet';
    if (p.isBraveWallet) return 'Brave Wallet';
    if (p.isRabby) return 'Rabby';
    if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
    if (p.isOkxWallet || p.isOKExWallet) return 'OKX Wallet';
    if (p.isPhantom) return 'Phantom';
    return 'Browser Wallet';
  }
  /* Wallet options the user can actually use in THIS browser. No fake entries. */
  function walletOptions() {
    var out = discovered.slice();
    var eth = window.ethereum;
    var legacy = [];
    if (eth) {
      if (eth.providers && eth.providers.length) legacy = eth.providers.slice();
      else legacy = [eth];
    }
    legacy.forEach(function (p) {
      var dup = out.some(function (o) { return o.provider === p; });
      var named = legacyName(p);
      var sameName = out.some(function (o) { return o.name === named; });
      if (!dup && !sameName) out.push({ provider: p, name: named, rdns: '', icon: '' });
    });
    return out;
  }
  function hasWallet() { return walletOptions().length > 0; }

  function bindProviderEvents(eth) {
    if (!eth || !eth.on || eth.__xcpBound) return;
    eth.__xcpBound = true;
    eth.on('accountsChanged', function (a) {
      if (injected !== eth) return;
      if (a && a.length) {
        account = ethers.utils.getAddress(a[0]);
        signer = new ethers.providers.Web3Provider(eth, 'any').getSigner();
      } else { account = null; signer = null; injected = null; try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
      emit();
    });
    eth.on('chainChanged', function () { if (injected === eth) emit(); });
  }

  var SESSION_KEY = 'xcp_wallet_session';

  /* Connect to a specific chosen provider. Account access only — no signature. */
  async function connectWith(opt) {
    if (!opt || !opt.provider) throw new Error('NO_WALLET');
    var eth = opt.provider;
    var accts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accts || !accts.length) throw new Error('NO_ACCOUNT');
    injected = eth;
    var web3 = new ethers.providers.Web3Provider(eth, 'any');
    signer = web3.getSigner();
    account = ethers.utils.getAddress(accts[0]);
    bindProviderEvents(eth);
    try { localStorage.setItem(SESSION_KEY, opt.name || '1'); } catch (e) {}
    emit();
    return account;
  }
  /* Is the wallet on the chain the RPC serves? */
  async function networkOk() {
    if (!injected) return false;
    var want = await getChainId();
    var have = await injected.request({ method: 'eth_chainId' });
    return String(have).toLowerCase() === String(want).toLowerCase();
  }
  async function switchNetwork() {
    if (!injected) throw new Error('NO_WALLET');
    var want = await getChainId();
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
    emit();
  }
  function disconnect() {
    try {
      if (injected && injected.disconnect) injected.disconnect();
      if (injected && injected.close) injected.close();
    } catch (e) {}
    injected = null; signer = null; account = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    emit();
  }
  /* Silent restore only if a session was previously established here. */
  async function restore() {
    var had = null;
    try { had = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!had) return null;
    var list = walletOptions();
    for (var i = 0; i < list.length; i++) {
      try {
        var a = await list[i].provider.request({ method: 'eth_accounts' });
        if (a && a.length) {
          injected = list[i].provider;
          signer = new ethers.providers.Web3Provider(injected, 'any').getSigner();
          account = ethers.utils.getAddress(a[0]);
          bindProviderEvents(injected);
          emit();
          return account;
        }
      } catch (e) {}
    }
    return null;
  }

  async function stakingWrite() {
    var abi = await loadAbi();
    if (!signer) throw new Error('NO_WALLET');
    return new ethers.Contract(STAKING_ADDR, abi, signer);
  }
  function nftWrite() {
    if (!signer) throw new Error('NO_WALLET');
    return new ethers.Contract(NFT_ADDR, NFT_ABI, signer);
  }

  /* ---------------- owned NFT discovery ---------------- */
  /* Owned token discovery via Alchemy reads only (never the wallet extension).
     Enumerable path first; Alchemy NFT API as fallback for non-enumerable contracts. */
  async function ownedTokenIds(addr) {
    var bal = null;
    try { bal = (await readNft('balanceOf', [addr])).toNumber(); }
    catch (e) { bal = null; }
    if (bal === 0) return [];
    if (bal !== null) {
      try {
        var ids = [];
        for (var i = 0; i < bal; i++) {
          var id = await readNft('tokenOfOwnerByIndex', [addr, i]);
          ids.push(id.toString());
        }
        return ids;
      } catch (e) { /* not enumerable — fall through */ }
    }
    return alchemyOwned(addr);
  }
  async function alchemyOwned(addr) {
    for (var i = 0; i < eps.length; i++) {
      var base = eps[(rpcIndex + i) % eps.length].replace('/v2/', '/nft/v3/');
      try {
        var url = base + '/getNFTsForOwner?owner=' + addr + '&contractAddresses[]=' + NFT_ADDR + '&withMetadata=false&pageSize=100';
        var r = await fetch(url);
        if (!r.ok) continue;
        var j = await r.json();
        var out = (j.ownedNfts || []).map(function (n) {
          return ethers.BigNumber.from(n.tokenId).toString();
        });
        return out;
      } catch (e) {}
    }
    throw new Error('RPC_ALL_FAILED');
  }

  /* ---------------- metadata / image ---------------- */
  var imgCache = {};
  function ipfs(u) {
    if (!u) return '';
    return String(u).replace(/^ipfs:\/\/(ipfs\/)?/, 'https://ipfs.io/ipfs/');
  }
  async function tokenImage(id) {
    if (imgCache[id] !== undefined) return imgCache[id];
    imgCache[id] = '';
    try {
      var uri = ipfs(await readNft('tokenURI', [id]));
      if (!uri) return '';
      if (uri.indexOf('data:application/json') === 0) {
        var j0 = JSON.parse(decodeURIComponent(escape(atob(uri.split(',')[1]))));
        imgCache[id] = ipfs(j0.image || '');
      } else {
        var r = await fetch(uri);
        var j = await r.json();
        imgCache[id] = ipfs(j.image || j.image_url || '');
      }
    } catch (e) {}
    return imgCache[id];
  }

  /* ---------------- formatting / errors ---------------- */
  function fmtEth(bn, dp) {
    try {
      var s = ethers.utils.formatEther(bn);
      var n = parseFloat(s);
      if (n === 0) return '0';
      return n.toFixed(dp == null ? 6 : dp).replace(/0+$/, '').replace(/\.$/, '');
    } catch (e) { return '0'; }
  }
  function fmtUnits(bn, dec, dp) {
    try {
      var n = parseFloat(ethers.utils.formatUnits(bn, dec == null ? 18 : dec));
      if (n === 0) return '0';
      return n.toFixed(dp == null ? 4 : dp).replace(/0+$/, '').replace(/\.$/, '');
    } catch (e) { return '0'; }
  }
  function pct(bn, num, den) {
    return bn.mul(num).div(den);
  }
  function dur(sec) {
    sec = Number(sec) || 0;
    if (sec <= 0) return 'UNLOCKED';
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600),
        m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d) + 'd ' + p(h) + 'h ' + p(m) + 'm ' + p(s) + 's';
  }
  function utc(ts) {
    ts = Number(ts) * 1000;
    if (!ts) return '—';
    var d = new Date(ts), M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' UTC';
  }
  var ERRORS = {
    AlreadyStaked: 'That XCOPUNKS is already staked.',
    ETHRewardsDisabled: 'ETH rewards are currently turned off.',
    ETHTransferFailed: 'The ETH transfer could not complete.',
    EnforcedPause: 'Staking is paused right now.',
    EnforcedPauseLocal: 'Staking is paused right now.',
    GloballyDisabled: 'Staking is temporarily unavailable.',
    InsufficientBalance: 'The reward pool balance is too low right now.',
    NFTNotHeldByContract: 'That XCOPUNKS is not held by the staking contract.',
    NoActiveStakes: 'You have no active stakes.',
    NotOwnerOfStake: 'That stake belongs to another wallet.',
    NotStaked: 'That XCOPUNKS is not staked.',
    NotTokenOwner: 'Your wallet does not own that XCOPUNKS.',
    NotXCOPunksNFT: 'That token is not an XCOPUNKS NFT.',
    NothingToClaim: 'There is nothing to claim yet.',
    StakingIsDisabled: 'Staking is currently disabled.',
    StillLocked: 'That XCOPUNKS is still inside its 7-day lock.',
    UnstakingIsDisabled: 'Unstaking is currently disabled.',
    XCPNRewardsDisabled: '$XCPN rewards are currently turned off.',
    XCPNTokenNotSet: 'The $XCPN token is not configured yet.',
    ZeroAmount: 'Nothing to process.',
    ReentrancyGuardReentrantCall: 'Request rejected, please retry.'
  };
  function friendly(e) {
    var raw = JSON.stringify(e && (e.error || e.data || e.message || e) || '');
    if (/ACTION_REJECTED|User denied|user rejected/i.test(raw)) return 'Transaction cancelled in your wallet.';
    if (/insufficient funds/i.test(raw)) return 'Not enough gas in your wallet to send this transaction.';
    if (/WRONG_NETWORK/.test(raw)) return 'Switch your wallet to the Robinhood Chain network.';
    if (/NO_WALLET/.test(raw)) return 'No EVM wallet detected in this browser.';
    if (/RPC_ALL_FAILED|timeout|429|SERVER_ERROR|NETWORK_ERROR/i.test(raw)) return 'Network is busy. Please try again in a moment.';
    for (var k in ERRORS) if (raw.indexOf(k) > -1) return ERRORS[k];
    return 'Transaction failed. Please try again.';
  }

  window.XCP = {
    NFT_ADDR: NFT_ADDR, STAKING_ADDR: STAKING_ADDR, OPENSEA: OPENSEA,
    MINT_FEE_WALLET: MINT_FEE_WALLET, CREATOR_FEE_WALLET: CREATOR_FEE_WALLET,
    ERC20_ABI: ERC20_ABI,
    endpoints: function () { return eps; },
    endpointAt: function (i) { return eps[(rpcIndex + i) % eps.length]; },
    withProvider: withProvider, readStaking: readStaking, readNft: readNft,
    stakingWrite: stakingWrite, nftWrite: nftWrite,
    connect: connectWith, connectWith: connectWith, walletOptions: walletOptions,
    disconnect: disconnect, networkOk: networkOk, switchNetwork: switchNetwork,
    restore: restore, hasWallet: hasWallet, onAccount: onAccount,
    account: function () { return account; }, signer: function () { return signer; },
    ownedTokenIds: ownedTokenIds, tokenImage: tokenImage,
    fmtEth: fmtEth, fmtUnits: fmtUnits, pct: pct, dur: dur, utc: utc, friendly: friendly
  };
})();
