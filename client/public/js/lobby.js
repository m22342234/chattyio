'use strict';

// ─── Profile ──────────────────────────────────────────────────────────────────
const rawProfile = sessionStorage.getItem('chatProfile');
if (!rawProfile) { window.location.href = '/'; throw new Error('No profile — redirecting.'); }

let PROFILE;
try { PROFILE = JSON.parse(rawProfile); }
catch (e) { sessionStorage.removeItem('chatProfile'); window.location.href = '/'; throw e; }

// ─── URL block pattern ────────────────────────────────────────────────────────
const URL_RE = /(?:https?:\/\/|(?:^|[\s])www\.|\b(?:[a-zA-Z0-9-]+\.(?:com|net|org|xyz|io|co|me|info|biz|tv|us|uk|ca|de|fr|ru|cn|jp|au|app|dev|ai|tech|chat|live|online))\b)/i;

// ─── DOM References ───────────────────────────────────────────────────────────
const viewLobby       = document.getElementById('view-lobby');
const viewChat        = document.getElementById('view-chat');
const viewRequests    = document.getElementById('view-requests');
const modalTerminated = document.getElementById('modal-terminated');

const randomMatchBtn  = document.getElementById('random-match-btn');
const terminatedOkBtn = document.getElementById('terminated-ok-btn');
const mailboxBtnEl    = document.getElementById('mailbox-btn');
const mailboxBadgeEl  = document.getElementById('mailbox-badge');
const backToInboxBtn  = document.getElementById('back-to-lobby-btn');
const backFromChatBtn = document.getElementById('leave-chat-btn');
const reportBtnEl     = document.getElementById('report-btn');
const msgInputEl      = document.getElementById('msg-input');
const sendBtnEl       = document.getElementById('send-btn');
const partnerInfoEl   = document.getElementById('partner-info');

const userGridEl      = document.getElementById('user-grid');
const inboxListEl     = document.getElementById('requests-list');
const statsEl         = document.getElementById('stats-bar');

// ─── State ────────────────────────────────────────────────────────────────────
let socket;
let conversations = new Map(); // socketId → { username, gender, age, messages:[{self,text}], unread }
let activeConvId  = null;
let prevView      = 'lobby';
let currentUsers  = [];
let userPage      = 0;
const PAGE_SIZE   = 50;

// ─── View State Machine ───────────────────────────────────────────────────────
const ALL_VIEWS = [viewLobby, viewChat, viewRequests];

window.showView = function (name) {
  ALL_VIEWS.forEach(v => { if (v) v.classList.add('hidden'); });
  modalTerminated?.classList.add('hidden');
  switch (name) {
    case 'lobby':    viewLobby?.classList.remove('hidden');    break;
    case 'chat':     viewChat?.classList.remove('hidden');     break;
    case 'requests': viewRequests?.classList.remove('hidden'); break;
  }
};

// ─── Mailbox Badge ────────────────────────────────────────────────────────────
function updateMailboxBadge() {
  if (!mailboxBadgeEl) return;
  let n = 0;
  conversations.forEach(c => { n += c.unread; });
  mailboxBadgeEl.textContent = n > 9 ? '9+' : String(n);
  mailboxBadgeEl.classList.toggle('hidden', n === 0);
}

// ─── Socket.io ───────────────────────────────────────────────────────────────
function connectSocket() {
  if (typeof io === 'undefined') {
    if (userGridEl) userGridEl.innerHTML =
      '<p class="text-center text-red-400 py-12 text-sm">Socket.io failed to load. Please hard-refresh.</p>';
    return;
  }

  socket = io({
    forceNew: true,
    auth: {
      cfToken:    PROFILE.cfToken,
      username:   PROFILE.username,
      age:        PROFILE.age,
      gender:     PROFILE.gender,
      country:    PROFILE.country,
      region:     PROFILE.region,
      back_email: PROFILE.back_email || '',
    },
  });

  setConnStatus('connecting');
  socket.on('connect',       () => setConnStatus('connected'));
  socket.on('disconnect',    (r) => setConnStatus('error', `Disconnected: ${r}`));
  socket.on('connect_error', (err) => {
    const autoRedirect = ['TURNSTILE_FAILED', 'IP_BLOCKED', 'FORBIDDEN', 'INVALID_USERNAME', 'INVALID_AGE', 'INVALID_GENDER'];
    if (autoRedirect.includes(err.message)) {
      sessionStorage.removeItem('chatProfile');
      window.location.href = '/';
      return;
    }
    if (err.message === 'RATE_LIMITED') {
      setConnStatus('error', 'Too many requests');
      if (userGridEl) userGridEl.innerHTML =
        `<p class="text-center text-yellow-400 py-12 text-sm">Too many connection attempts.<br>
         <a href="/chat" class="underline text-indigo-400 text-xs mt-2 inline-block">Try again in 60 seconds</a></p>`;
      socket.disconnect();
      return;
    }
    setConnStatus('error', err.message);
    if (userGridEl) userGridEl.innerHTML =
      `<p class="text-center text-red-400 py-12 text-sm">Connection error — please try again.<br>
       <a href="/" class="underline text-indigo-400 text-xs mt-2 inline-block">Return to home</a></p>`;
    socket.disconnect();
  });

  socket.on('lobby-update', (users) => { currentUsers = users; renderUserList(users); });

  socket.on('stats-update', ({ total, idle, busy }) => {
    if (statsEl) statsEl.textContent = `${total} online · ${idle} available · ${busy} chatting`;
  });

  socket.on('dm', ({ fromSocketId, fromUsername, fromGender, fromAge, text }) => {
    const conv = getOrCreateConv(fromSocketId, fromUsername, fromGender, fromAge);
    conv.messages.push({ self: false, text });

    if (activeConvId === fromSocketId) {
      appendMsgBubble(text, 'partner');
    } else {
      conv.unread++;
      updateMailboxBadge();
    }
    renderInbox();
  });

  socket.on('session-terminated', ({ reason }) => {
    sessionStorage.removeItem('chatProfile');
    if (modalTerminated) {
      modalTerminated.querySelector('#terminated-reason').textContent = reason;
      modalTerminated.classList.remove('hidden');
    }
  });

  socket.on('report-confirmed', () => showToast('Report submitted.'));
}

// ─── Conversation Helpers ─────────────────────────────────────────────────────
function getOrCreateConv(socketId, username, gender, age) {
  if (!conversations.has(socketId)) {
    conversations.set(socketId, { username, gender, age: String(age), messages: [], unread: 0 });
  }
  return conversations.get(socketId);
}

// ─── Open Chat View ───────────────────────────────────────────────────────────
function openConversation(socketId, username, gender, age, from) {
  const conv = getOrCreateConv(socketId, username, gender, age);
  conv.unread = 0;
  activeConvId = socketId;
  prevView = from || 'lobby';
  updateMailboxBadge();
  renderInbox();

  if (partnerInfoEl) {
    const gc = gender === 'Female' ? 'text-pink-400' : gender === 'Male' ? 'text-blue-400' : 'text-purple-400';
    partnerInfoEl.innerHTML = `Chatting with <span class="${gc} font-semibold">${escapeHtml(username)}</span>`;
  }

  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.innerHTML = '';
    conv.messages.forEach(m => appendMsgBubble(m.text, m.self ? 'self' : 'partner'));
  }

  showView('chat');
  msgInputEl?.focus();
}

// ─── Message Rendering ────────────────────────────────────────────────────────
function appendMsgBubble(text, side) {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;
  const wrapper = document.createElement('div');
  wrapper.className = `flex ${side === 'self' ? 'justify-end' : 'justify-start'} mb-2`;
  const bubble = document.createElement('div');
  bubble.className = side === 'self'
    ? 'max-w-xs lg:max-w-md px-4 py-2 rounded-2xl rounded-br-sm bg-indigo-600 text-white text-sm break-words'
    : 'max-w-xs lg:max-w-md px-4 py-2 rounded-2xl rounded-bl-sm bg-gray-700 text-gray-100 text-sm break-words';
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ─── Send ─────────────────────────────────────────────────────────────────────
function handleSend() {
  if (!msgInputEl || !activeConvId || !socket) return;
  const text = msgInputEl.value.trim();
  if (!text) return;

  if (URL_RE.test(text)) {
    const errEl = document.getElementById('url-error');
    if (errEl) { errEl.classList.remove('hidden'); setTimeout(() => errEl.classList.add('hidden'), 4000); }
    return;
  }

  socket.emit('dm', { toSocketId: activeConvId, text });
  const conv = conversations.get(activeConvId);
  if (conv) conv.messages.push({ self: true, text });
  appendMsgBubble(text, 'self');
  msgInputEl.value = '';
}

// ─── Inbox Renderer ───────────────────────────────────────────────────────────
function renderInbox() {
  if (!inboxListEl) return;

  const convs = [...conversations.entries()].filter(([, c]) => c.messages.length > 0);

  if (convs.length === 0) {
    inboxListEl.innerHTML = `
      <div class="text-center py-16">
        <div class="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center" style="background:#1f2937;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-gray-700">
            <path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z"/>
            <path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z"/>
          </svg>
        </div>
        <p class="text-gray-600 text-sm">No messages yet</p>
      </div>`;
    return;
  }

  inboxListEl.innerHTML = '';
  convs.forEach(([socketId, conv], i) => {
    const color   = conv.gender === 'Female' ? '#ec4899' : conv.gender === 'Male' ? '#3b82f6' : '#a855f7';
    const textCls = conv.gender === 'Female' ? 'text-pink-400' : conv.gender === 'Male' ? 'text-blue-400' : 'text-purple-400';
    const symbol  = conv.gender === 'Female' ? '♀' : conv.gender === 'Male' ? '♂' : '⚧';
    const last    = conv.messages[conv.messages.length - 1];

    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 px-4 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors';
    if (i < convs.length - 1) row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

    row.innerHTML = `
      <div class="relative shrink-0">
        <div class="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold"
             style="background:${color}1a; border:1.5px solid ${color}40; color:${color};">${symbol}</div>
        ${conv.unread > 0 ? `<span class="absolute -top-1 -right-1 min-w-[1rem] h-4 rounded-full bg-red-500 text-white font-bold flex items-center justify-center px-0.5" style="font-size:10px;">${conv.unread}</span>` : ''}
      </div>
      <div class="flex-1 min-w-0">
        <p class="${textCls} font-semibold text-sm">${escapeHtml(conv.username)} <span class="text-gray-600 font-normal text-xs">· ${escapeHtml(conv.age)}</span></p>
        <p class="${conv.unread > 0 ? 'text-gray-200' : 'text-gray-500'} text-sm mt-0.5 truncate">${last.self ? `<span class="text-gray-600">You: </span>` : ''}${escapeHtml(last.text)}</p>
      </div>
      ${conv.unread > 0 ? '<span class="shrink-0 w-2 h-2 rounded-full bg-indigo-400"></span>' : ''}
    `;

    row.addEventListener('click', () => openConversation(socketId, conv.username, conv.gender, conv.age, 'requests'));
    inboxListEl.appendChild(row);
  });
}

// ─── User List Renderer ───────────────────────────────────────────────────────
function renderUserList(users) {
  if (!userGridEl) return;

  const paginationEl = document.getElementById('pagination');

  const all     = users.filter(u => u.socketId !== socket.id);
  const query   = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
  const filtered = query ? all.filter(u => u.username.toLowerCase().includes(query)) : all;

  // Sort by country then username
  const sorted = [...filtered].sort((a, b) => {
    const cc = (a.country || '').localeCompare(b.country || '');
    return cc !== 0 ? cc : (a.username || '').localeCompare(b.username || '');
  });

  if (all.length === 0) {
    userGridEl.innerHTML = `
      <div class="flex flex-col items-center justify-center py-14 px-6 text-center">
        <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style="background:rgba(79,70,229,0.12); border:1px solid rgba(79,70,229,0.2);">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-7 h-7 text-indigo-400">
            <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 00-1.032-.211 50.89 50.89 0 00-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 002.433 3.984L7.28 21.53A.75.75 0 016 21v-4.03a48.527 48.527 0 01-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979z"/>
            <path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 001.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0015.75 7.5z"/>
          </svg>
        </div>
        <p class="text-white font-semibold text-base mb-1">You're the first one here</p>
        <p class="text-gray-500 text-sm mb-6 max-w-xs leading-relaxed">The room fills up as people join. Invite someone and start chatting instantly.</p>
        <button id="share-btn"
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
          style="background:linear-gradient(135deg,#4f46e5,#7c3aed);">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
            <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.475l6.733-3.366A2.52 2.52 0 0113 4.5z"/>
          </svg>
          Invite a Friend
        </button>
      </div>`;
    document.getElementById('share-btn')?.addEventListener('click', () => {
      navigator.clipboard?.writeText('https://www.chattyio.com').then(() => {
        showToast('Link copied — share it with a friend!');
      }).catch(() => showToast('chattyio.com — share the link!'));
    });
    if (paginationEl) paginationEl.classList.add('hidden');
    return;
  }
  if (sorted.length === 0) {
    userGridEl.innerHTML = '<p class="text-center text-gray-600 py-14 text-sm">No users match your search.</p>';
    if (paginationEl) paginationEl.classList.add('hidden');
    return;
  }

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  userPage = Math.min(userPage, totalPages - 1);
  const pageUsers = sorted.slice(userPage * PAGE_SIZE, (userPage + 1) * PAGE_SIZE);

  userGridEl.innerHTML = '';
  let lastCountry = null;

  pageUsers.forEach((u, i) => {
    // Country divider whenever country changes
    if (u.country !== lastCountry) {
      lastCountry = u.country;
      const divider = document.createElement('div');
      divider.className = 'px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gray-500 border-b';
      divider.style.cssText = 'background:rgba(255,255,255,0.02); border-color:rgba(255,255,255,0.05);';
      divider.textContent = u.country || 'Unknown';
      userGridEl.appendChild(divider);
    }

    const color   = u.gender === 'Female' ? '#ec4899' : u.gender === 'Male' ? '#3b82f6' : '#a855f7';
    const textCls = u.gender === 'Female' ? 'text-pink-400' : u.gender === 'Male' ? 'text-blue-400' : 'text-purple-400';
    const symbol  = u.gender === 'Female' ? '♀' : u.gender === 'Male' ? '♂' : '⚧';

    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.03] cursor-pointer';
    if (i < pageUsers.length - 1) row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

    row.innerHTML = `
      <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
           style="background:${color}1a; border:1.5px solid ${color}40; color:${color};">${symbol}</div>
      <div class="flex-1 min-w-0">
        <p class="${textCls} font-semibold text-sm truncate">${escapeHtml(u.username)}</p>
        <p class="text-gray-600 text-xs">${escapeHtml(String(u.age))} · ${escapeHtml(u.region || u.country)}</p>
      </div>
      <span class="w-2 h-2 rounded-full bg-green-400 shrink-0" style="box-shadow:0 0 6px #4ade80;"></span>
    `;

    row.addEventListener('click', () => {
      openConversation(u.socketId, u.username, u.gender, String(u.age), 'lobby');
    });

    userGridEl.appendChild(row);
  });

  // Pagination controls
  const prevBtn  = document.getElementById('page-prev');
  const nextBtn  = document.getElementById('page-next');
  const pageInfo = document.getElementById('page-info');

  if (paginationEl) paginationEl.classList.toggle('hidden', totalPages <= 1);
  if (prevBtn)  prevBtn.disabled  = userPage <= 0;
  if (nextBtn)  nextBtn.disabled  = userPage >= totalPages - 1;
  if (pageInfo) pageInfo.textContent = `Page ${userPage + 1} of ${totalPages} · ${sorted.length} users`;
}

// ─── Button Handlers ──────────────────────────────────────────────────────────
randomMatchBtn?.addEventListener('click', () => {
  const others = currentUsers.filter(u => u.socketId !== (socket && socket.id));
  if (!others.length) { showToast('No users online right now.'); return; }
  const u = others[Math.floor(Math.random() * others.length)];
  openConversation(u.socketId, u.username, u.gender, String(u.age), 'lobby');
});

terminatedOkBtn?.addEventListener('click', () => { window.location.href = '/'; });

mailboxBtnEl?.addEventListener('click', () => { renderInbox(); showView('requests'); });

backToInboxBtn?.addEventListener('click', () => showView('lobby'));

backFromChatBtn?.addEventListener('click', () => {
  activeConvId = null;
  showView(prevView);
});

reportBtnEl?.addEventListener('click', () => {
  if (!activeConvId) return;
  if (!confirm('Report this user for violating community guidelines?')) return;
  socket.emit('report-violator', { offenderSocketId: activeConvId });
  activeConvId = null;
  showView('lobby');
});

sendBtnEl?.addEventListener('click', handleSend);
msgInputEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

document.getElementById('user-search')?.addEventListener('input', () => {
  userPage = 0;
  renderUserList(currentUsers);
});

document.getElementById('page-prev')?.addEventListener('click', () => {
  if (userPage > 0) { userPage--; renderUserList(currentUsers); userGridEl?.scrollIntoView({ behavior: 'smooth' }); }
});

document.getElementById('page-next')?.addEventListener('click', () => {
  userPage++;
  renderUserList(currentUsers);
  userGridEl?.scrollIntoView({ behavior: 'smooth' });
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setConnStatus(state, detail) {
  const dot  = document.getElementById('conn-status-dot');
  const text = document.getElementById('conn-status-text');
  if (!dot || !text) return;
  const map = {
    connecting: { dot: 'bg-yellow-400 animate-pulse', color: 'text-yellow-400', label: 'Connecting…' },
    connected:  { dot: 'bg-green-400',                color: 'text-green-400',  label: 'Connected'   },
    error:      { dot: 'bg-red-500',                  color: 'text-red-400',    label: detail || 'Error' },
  };
  const cfg = map[state] || map.error;
  dot.className  = `w-2 h-2 rounded-full ${cfg.dot}`;
  text.className = `text-xs ${cfg.color}`;
  text.textContent = cfg.label;
}

let toastTimer;
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-50 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none transition-opacity duration-300 border border-white/10';
    t.style.background = '#1f2937';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
showView('lobby');
connectSocket();
