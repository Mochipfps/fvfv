/* XCOPUNKS — 24-HOUR REWARD CAMPAIGN configuration (LIVE)
 * ---------------------------------------------------------------
 * Configures ONLY the separate 24-hour reward campaign at /reward/.
 * It does not touch the live 7-day staking system (js/web3.js,
 * js/stake-app.js, assets/abi/xcopunks-staking.json).
 *
 * The deployed contract is authoritative for every campaign number:
 * cap, total staked, reward per NFT, campaign start/end, per-token lock,
 * claim and unstake eligibility. Values below are addresses and display
 * fallbacks only — the UI always prefers the contract read.
 */
window.XCP_REWARD = {
  /* Deployed 24-hour reward staking contract (Robinhood Chain). */
  NEW_REWARD_STAKING_CONTRACT: '0x529D05EC42f750d13544F4896568C18ef59a0C92',
  /* Existing, unchanged. */
  XCOPUNKS_NFT_CONTRACT: '0xfcba20492b1cd40607b13c9f61b6b6d416a08cf7',
  XCPN_TOKEN_CONTRACT:   '0xc1dba4c70d69296ede3a7e35d613374b806c9676',

  /* Authoritative ABI, as deployed. Loaded from disk at runtime. */
  ABI_URL: 'assets/abi/xcopunks-reward-24h.json',
  NEW_REWARD_STAKING_ABI: null,

  /* Display fallbacks. Used only if a contract read fails; the UI marks
     any value it could not read live rather than presenting it as live. */
  CAMPAIGN_CAP: 2000,
  CAMPAIGN_DURATION: 86400,
  LOCK_DURATION: 86400,

  /* Staking mechanism, per the deployed ABI: the contract implements
     onERC721Received and exposes NO stake() function. Entering the
     campaign is a push transfer of the NFT, one transaction per token:
       NFT.safeTransferFrom(user, NEW_REWARD_STAKING_CONTRACT, tokenId)
     Do not add an approve() + stake() flow — the contract has no stake(). */
  STAKE_MECHANISM: 'erc721-safeTransferFrom'
};
