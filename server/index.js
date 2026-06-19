'use strict';

/**
 * P2P Text Chat — Signaling & API Server
 *
 * Architecture overview:
 *  - Express serves static SEO pages and the /chat SPA shell.
 *  - Socket.io handles lobby directory, chat-request brokering, and WebRTC
 *    SDP/ICE relay.  SDP and ICE payloads are forwarded immediately and never
 *    stored — they pass through RAM as transient event arguments.
 *  - All user state lives in the `activeUsers` Map.  On process exit the Map
 *    vanishes; there is no database, no file writes, no external session store.
 *  - Text and file data travel peer-to-peer via RTCDataChannel and never
 *    touch this server.
 *
 * Requires Node >= 18 (native fetch for Turnstile validation).
 */

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const crypto   = require('crypto');

const jwt = require('jsonwebtoken');

const { socketRateLimiter } = require('./rateLimiter');
const { blockIP, isBlocked } = require('./ipBlockList');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
  cors:          { origin: false },
  pingTimeout:   30_000,
  pingInterval:  10_000,
  maxHttpBufferSize: 1e6, // 1 MB — only signaling messages pass through
});

// ─── Environment ─────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const CF_SECRET  = process.env.CF_TURNSTILE_SECRET || '1x0000000000000000000000000000000AA';
const CF_SITE    = process.env.CF_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

// ─── Volatile In-Memory State ────────────────────────────────────────────────
// Zero retention: no DB, no FS writes.  Restart = clean slate.
const activeUsers = new Map(); // socketId → userRecord

// ─── Username Validation (server-side mirror of client guardrails) ────────────
const RE_DIGIT      = /\d/;
const RE_WORD_NUM   = /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/i;
const RE_BLOCKED    = /(porn|escort|pedo|pdo|adult|sex|nsfw)/i;

function isValidUsername(name) {
  if (!name || typeof name !== 'string') return false;
  const t = name.trim();
  if (t.length < 2 || t.length > 20) return false;
  if (RE_DIGIT.test(t))    return false;
  if (RE_WORD_NUM.test(t)) return false;
  if (RE_BLOCKED.test(t))  return false;
  return true;
}

// ─── Cloudflare Turnstile Server-to-Server Validation ────────────────────────
// Cloudflare test secret always passes without a network call.
// For real secrets a 5-second AbortController timeout prevents middleware hangs.
const CF_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
]);

async function validateTurnstile(token, remoteIp) {
  // Test secret key check FIRST — bypass everything, no token needed
  if (CF_TEST_SECRETS.has(CF_SECRET)) {
    log('[Turnstile] dev/test secret — skipping validation');
    return true;
  }

  if (!token || typeof token !== 'string') return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000); // 5 s hard timeout
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ secret: CF_SECRET, response: token, remoteip: remoteIp }),
      signal:  controller.signal,
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    // Timeout or network error — fail closed
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Lobby Broadcast Helpers ──────────────────────────────────────────────────
let _lobbyTimer = null;
function broadcastLobbyUpdate() {
  clearTimeout(_lobbyTimer);
  _lobbyTimer = setTimeout(() => {
    const idleList = [...activeUsers.values()]
      .filter(u => u.status === 'idle')
      .map(({ socketId, username, age, gender, country, region }) => ({
        socketId, username, age, gender, country, region,
      }));
    io.emit('lobby-update', idleList);
  }, 100);
}

function broadcastStats() {
  const total = activeUsers.size;
  const busy  = [...activeUsers.values()].filter(u => u.status === 'busy').length;
  io.emit('stats-update', { total, idle: total - busy, busy });
}

// Unbuffered log — use for any line that must appear immediately even when
// stdout is piped to a file (stderr is synchronous/unbuffered in Node).
function log(msg) { process.stderr.write(msg + '\n'); }

// ─── Socket.io Middleware: Rate-Limit → Block-Check → Turnstile → Validate ───
io.use(async (socket, next) => {
  const rawIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  const ip    = String(rawIp).split(',')[0].trim();
  const { username, age, gender, country, region, cfToken, sessionToken, back_email } = socket.handshake.auth;

  // 1. IP block list
  if (isBlocked(ip)) {
    log(`[auth] BLOCKED ip=${ip}`);
    return next(new Error('IP_BLOCKED'));
  }

  // 2. Rate limit
  try {
    await socketRateLimiter.consume(ip);
  } catch {
    log(`[auth] RATE_LIMITED ip=${ip}`);
    return next(new Error('RATE_LIMITED'));
  }

  // 3. Honeypot
  if (typeof back_email === 'string' && back_email.trim().length > 0) {
    return next(new Error('FORBIDDEN'));
  }

  // 4a. Session JWT — skip Turnstile for reconnects after a server restart
  if (sessionToken) {
    try {
      const decoded = jwt.verify(sessionToken, JWT_SECRET);
      socket.clientIp = ip;
      socket.userData = {
        username: decoded.username,
        age:      decoded.age,
        gender:   decoded.gender,
        country:  decoded.country || '',
        region:   decoded.region  || '',
      };
      log(`[auth] JWT ok ip=${ip} user=${decoded.username}`);
      return next();
    } catch {
      // JWT expired or tampered — fall through to Turnstile
    }
  }

  // 4b. Turnstile (first connection or expired JWT)
  const valid = await validateTurnstile(cfToken, ip);
  if (!valid) {
    log(`[auth] TURNSTILE_FAILED ip=${ip}`);
    return next(new Error('TURNSTILE_FAILED'));
  }

  // 5. Input validation
  if (!isValidUsername(username)) return next(new Error('INVALID_USERNAME'));

  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 18 || ageNum > 99) return next(new Error('INVALID_AGE'));

  if (!['Male', 'Female', 'Other'].includes(gender)) return next(new Error('INVALID_GENDER'));

  socket.clientIp = ip;
  socket.userData = {
    username: username.trim(),
    age:      ageNum,
    gender,
    country:  String(country || '').substring(0, 60),
    region:   String(region  || '').substring(0, 60),
  };
  next();
});

// ─── Socket.io Connection Handler ────────────────────────────────────────────
io.on('connection', (socket) => {
  const { username, age, gender, country, region } = socket.userData;
  const ip = socket.clientIp;

  activeUsers.set(socket.id, {
    socketId:  socket.id,
    username,
    age,
    gender,
    country,
    region,
    status:    'idle',
    partnerId: null,
    ip,
    joinedAt:  Date.now(),
  });

  // Issue a session JWT so the client can reconnect after a server restart
  // without going through Turnstile again. Expires in 24h.
  const sessionJwt = jwt.sign(
    { username, age, gender, country, region },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  socket.emit('session-token', sessionJwt);

  broadcastLobbyUpdate();
  broadcastStats();

  // ── Targeted Chat Request ──────────────────────────────────────────────────
  socket.on('request-chat', ({ targetSocketId, message }) => {
    const requester = activeUsers.get(socket.id);
    const target    = activeUsers.get(targetSocketId);
    if (!requester || !target) return;
    if (requester.status !== 'idle' || target.status !== 'idle') {
      return socket.emit('request-error', { message: 'That user is no longer available.' });
    }
    requester.pendingRequestTo = targetSocketId;
    const safeMsg = (typeof message === 'string' ? message : '').slice(0, 200).trim();
    io.to(targetSocketId).emit('incoming-chat-request', {
      fromSocketId: socket.id,
      fromUsername: requester.username,
      fromGender:   requester.gender,
      fromAge:      requester.age,
      message:      safeMsg,
    });
  });

  // ── Respond to Chat Request ────────────────────────────────────────────────
  socket.on('respond-to-request', ({ fromSocketId, accepted }) => {
    const responder = activeUsers.get(socket.id);
    const requester = activeUsers.get(fromSocketId);
    if (!requester || !responder) {
      return socket.emit('request-error', { message: 'That user has left.' });
    }

    if (!accepted) {
      requester.pendingRequestTo = null;
      return io.to(fromSocketId).emit('chat-request-declined', { by: responder.username });
    }
    if (requester.status !== 'idle' || responder.status !== 'idle') {
      return socket.emit('request-error', { message: 'User is no longer available.' });
    }

    // Pair the two sockets
    requester.pendingRequestTo = null;
    requester.status    = 'busy';
    requester.partnerId = socket.id;
    responder.status    = 'busy';
    responder.partnerId = fromSocketId;

    broadcastLobbyUpdate();
    broadcastStats();

    // Requester is always the WebRTC initiator (creates offer)
    io.to(fromSocketId).emit('chat-request-accepted', {
      partnerSocketId: socket.id,
      partnerUsername: responder.username,
      partnerGender:   responder.gender,
      role:            'initiator',
    });
    socket.emit('chat-request-accepted', {
      partnerSocketId: fromSocketId,
      partnerUsername: requester.username,
      partnerGender:   requester.gender,
      role:            'receiver',
    });
  });

  // ── Random Match ───────────────────────────────────────────────────────────
  socket.on('request-random-match', () => {
    const requester = activeUsers.get(socket.id);
    if (!requester || requester.status !== 'idle') {
      return socket.emit('request-error', { message: 'You must be idle to use Random Match.' });
    }

    const candidates = [...activeUsers.values()].filter(
      u => u.status === 'idle' && u.socketId !== socket.id
    );
    if (candidates.length === 0) return socket.emit('no-users-available');

    const partner = candidates[Math.floor(Math.random() * candidates.length)];

    requester.status    = 'busy';
    requester.partnerId = partner.socketId;
    partner.status      = 'busy';
    partner.partnerId   = socket.id;

    broadcastLobbyUpdate();
    broadcastStats();

    socket.emit('random-match-found', {
      partnerSocketId: partner.socketId,
      partnerUsername: partner.username,
      partnerGender:   partner.gender,
      role:            'initiator',
    });
    io.to(partner.socketId).emit('random-match-found', {
      partnerSocketId: socket.id,
      partnerUsername: requester.username,
      partnerGender:   requester.gender,
      role:            'receiver',
    });
  });

  // ── Direct Message Relay ──────────────────────────────────────────────────
  socket.on('dm', ({ toSocketId, text }) => {
    const sender = activeUsers.get(socket.id);
    if (!sender) return;
    const safeText = (typeof text === 'string' ? text : '').slice(0, 2000).trim();
    if (!safeText) return;
    io.to(toSocketId).emit('dm', {
      fromSocketId: socket.id,
      fromUsername: sender.username,
      fromGender:   sender.gender,
      fromAge:      sender.age,
      text:         safeText,
    });
  });

  // ── WebRTC Signaling Relay (pass-through — payloads never stored) ──────────
  socket.on('webrtc-offer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('webrtc-offer', { fromSocketId: socket.id, sdp });
  });

  socket.on('webrtc-answer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('webrtc-answer', { fromSocketId: socket.id, sdp });
  });

  socket.on('webrtc-ice', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice', { fromSocketId: socket.id, candidate });
  });

  // ── Report Violator — Instant Kill Protocol ────────────────────────────────
  socket.on('report-violator', ({ offenderSocketId }) => {
    const reporter = activeUsers.get(socket.id);
    const offender = activeUsers.get(offenderSocketId);
    if (!reporter || !offender) return;

    // Store only a SHA-256 hash of the raw IP in logs — no PII persisted
    const ipHash = crypto.createHash('sha256').update(offender.ip).digest('hex');
    console.log(`[REPORT] Offender hash=${ipHash} blocked 24h`);

    // Block the raw IP for connection gating
    blockIP(offender.ip);

    // Notify and force-disconnect offender
    io.to(offenderSocketId).emit('session-terminated', {
      reason: 'You have been reported and removed from this session.',
    });
    const offenderSocket = io.sockets.sockets.get(offenderSocketId);
    if (offenderSocket) offenderSocket.disconnect(true);

    activeUsers.delete(offenderSocketId);

    // Reset reporter to idle
    reporter.status    = 'idle';
    reporter.partnerId = null;

    broadcastLobbyUpdate();
    broadcastStats();
    socket.emit('report-confirmed');
  });

  // ── Voluntary Leave ────────────────────────────────────────────────────────
  socket.on('leave-chat', () => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    const partnerId = user.partnerId;
    user.status    = 'idle';
    user.partnerId = null;

    if (partnerId) {
      const partner = activeUsers.get(partnerId);
      if (partner) {
        partner.status    = 'idle';
        partner.partnerId = null;
        io.to(partnerId).emit('partner-disconnected');
      }
    }
    broadcastLobbyUpdate();
    broadcastStats();
  });

  // ── Disconnect Cleanup ─────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    // Notify anyone waiting on a request from this user
    if (user.pendingRequestTo) {
      io.to(user.pendingRequestTo).emit('request-cancelled', { fromSocketId: socket.id });
    }

    const partnerId = user.partnerId;
    if (partnerId) {
      const partner = activeUsers.get(partnerId);
      if (partner) {
        partner.status    = 'idle';
        partner.partnerId = null;
        io.to(partnerId).emit('partner-disconnected');
      }
    }
    activeUsers.delete(socket.id);
    broadcastLobbyUpdate();
    broadcastStats();
  });
});

// ─── Express Routes ───────────────────────────────────────────────────────────

// Expose public client config — secrets never leave the server
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG=${JSON.stringify({
    cfSiteKey:         CF_SITE,
    cfAnalyticsToken:  process.env.CF_ANALYTICS_TOKEN || '',
  })};`);
});

// Health-check — lets Claude (and the user) verify the server is alive
// without needing to read hidden log files.
const IS_DEV = process.env.NODE_ENV !== 'production';
app.get('/healthz', (_req, res) => {
  res.json({
    status:  'ok',
    users:   activeUsers.size,
    idle:    [...activeUsers.values()].filter(u => u.status === 'idle').length,
    busy:    [...activeUsers.values()].filter(u => u.status === 'busy').length,
    uptime:  Math.floor(process.uptime()),
    dev:     IS_DEV,
  });
});

// Static SEO pages and client assets
// In dev: no-store so the browser always fetches the latest JS after edits.
app.use(express.static(path.join(__dirname, '..', 'client', 'public'), {
  etag:         !IS_DEV,
  lastModified: !IS_DEV,
  setHeaders: IS_DEV ? (res) => res.setHeader('Cache-Control', 'no-store') : undefined,
}));

// Chat SPA shell — served dynamically, excluded from robots.txt
app.get('/chat', (_req, res) => {
  if (IS_DEV) res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'client', 'chat.html'));
});

// SEO static pages — clean URLs without .html extension
['about', 'faq', 'safety', 'privacy', 'terms',
 'omegle-alternative', 'chatroulette-alternative', 'anonymous-chat', 'chat-with-strangers', 'chat-rooms', 'random-chat',
].forEach(page => {
  app.get(`/${page}`, (_req, res) => {
    if (IS_DEV) res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', 'client', 'public', `${page}.html`));
  });
});

// Fallback: 404 for unmatched routes
app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'client', 'public', '404.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\nP2P Text Chat server  →  http://localhost:${PORT}`);
  console.log('State backend: volatile in-memory Map only.  Zero persistence.\n');
});
