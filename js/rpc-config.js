/* XCOPUNKS — RPC configuration
 * ---------------------------------------------------------------
 * IMPORTANT (read before deploying):
 * This site is a static GitHub Pages build with no server, so anything
 * this file contains is readable by any visitor. A purely static site
 * CANNOT hide an RPC key. Two supported options:
 *
 *  A) RECOMMENDED — keep these keys but lock them down in the Alchemy
 *     dashboard: App > Security > allowlist the domain xcopunks.xyz only.
 *     The key is then useless from any other origin.
 *
 *  B) FULL SECRECY — put a tiny RPC proxy on a host that runs code
 *     (Cloudflare Worker / Vercel function), keep the keys there, and
 *     replace the list below with your single proxy URL(s).
 *     No frontend change is needed beyond this file.
 *
 * Endpoints are tried strictly in order, with automatic failover.
 */
/* Verified GROSS Mint Fee collected, in ETH (e.g. '5.6').
 * Leave null to display the on-chain measured total from direct inbound
 * transfers instead (labelled honestly as direct transfers only, because
 * Robinhood Chain does not expose contract-routed 'internal' transfers).
 * Set this to the figure you have verified and the vault will label it GROSS. */
window.XCP_GROSS_MINT_FEE_ETH = null;

window.XCP_RPC_ENDPOINTS = [
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_OkKCmrnkJyiTc19m8UyiH',
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_QcNrbhygSDmnWBTsBmj8z',
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_VPwMdlPP2uup03Grgm62K',
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_Yv_3AOQIikRxmqBslnzyw',
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_tKO2_vxlq6JMrdPkjFn-C',
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_wSwzSJO1DWbdgijX1Kobg',
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_slQNKgtP7_VXM6bPrbkob',
  'https://robinhood-mainnet.g.alchemy.com/v2/alch_iiY84SZgW9EP3kjQ5syD9'
];
