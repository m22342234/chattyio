'use strict';

/**
 * Volatile in-memory IP block list with lazy 24-hour expiry.
 * Raw IPs are stored here for connection gating; the server logs only a SHA-256
 * hash when it writes a block entry — the raw IP is never written to logs.
 * All entries evaporate on process restart (zero persistence by design).
 */

const blockedIPs = new Map(); // rawIp -> expiresAt (Unix ms)
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

function blockIP(rawIp) {
  blockedIPs.set(rawIp, Date.now() + BLOCK_DURATION_MS);
}

function isBlocked(rawIp) {
  const expiresAt = blockedIPs.get(rawIp);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    blockedIPs.delete(rawIp); // lazy eviction — no periodic sweeps needed
    return false;
  }
  return true;
}

module.exports = { blockIP, isBlocked };
