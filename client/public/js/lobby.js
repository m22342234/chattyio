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
    setConnStatus('error', err.message);
    if (userGridEl) userGridEl.innerHTML =
      `<p class="text-center text-red-400 py-12 text-sm">Connection error: ${escapeHtml(err.message)}<br>
       <a href="/" class="underline text-indigo-400 text-xs mt-2 inline-block">Return to login</a></p>`;
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
    userGridEl.innerHTML = '<p class="text-center text-gray-600 py-14 text-sm">No users online right now. Be the first!</p>';
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
