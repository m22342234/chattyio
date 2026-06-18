/**
 * Chat UI module — runs inside the active chat workspace.
 *
 * Responsibilities:
 *  - Render own and partner messages in a chat bubble layout
 *  - Enforce the strict URL / link block on outgoing messages
 *  - Enforce 5 MB file size cap before calling sendFileOverChannel()
 *  - Render received file messages as download links
 *  - Handle "Report Violator" button
 *  - Handle "Leave Chat" button
 *
 * Depends on: webrtc.js (window.dataChannel, window.sendFileOverChannel)
 * Exposes:    window.initChatUI(opts), window.teardownChatUI()
 */

'use strict';

// ─── Strict URL / Link Detection Pattern ────────────────────────────────────
// Catches: http://, https://, www., and naked TLDs (.com .net .org .xyz etc.)
const URL_RE = /(?:https?:\/\/|(?:^|[\s])www\.|\b(?:[a-zA-Z0-9-]+\.(?:com|net|org|xyz|io|co|me|info|biz|tv|us|uk|ca|de|fr|ru|cn|jp|au|app|dev|ai|tech|chat|live|online))\b)/i;

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── DOM References (populated by initChatUI) ────────────────────────────────
let messagesEl, msgInputEl, sendBtnEl, fileInputEl, fileBtnEl,
    urlErrorEl, reportBtnEl, leaveBtnEl, partnerInfoEl, _socket,
    partnerSocketId;

// ─── Public Init ─────────────────────────────────────────────────────────────
/**
 * Wire up all chat-workspace event listeners.
 * @param {{ socket, partnerSocketId, partnerUsername, partnerGender }} opts
 */
window.initChatUI = function (opts) {
  _socket         = opts.socket;
  partnerSocketId = opts.partnerSocketId;

  messagesEl    = document.getElementById('chat-messages');
  msgInputEl    = document.getElementById('msg-input');
  sendBtnEl     = document.getElementById('send-btn');
  fileInputEl   = document.getElementById('file-input');
  fileBtnEl     = document.getElementById('file-btn');
  urlErrorEl    = document.getElementById('url-error');
  reportBtnEl   = document.getElementById('report-btn');
  leaveBtnEl    = document.getElementById('leave-chat-btn');
  partnerInfoEl = document.getElementById('partner-info');

  if (partnerInfoEl) {
    const genderColor = opts.partnerGender === 'Female'
      ? 'text-pink-400'
      : opts.partnerGender === 'Male'
        ? 'text-blue-400'
        : 'text-purple-400';
    partnerInfoEl.innerHTML =
      `Chatting with <span class="${genderColor} font-semibold">${escapeHtml(opts.partnerUsername)}</span>`;
  }

  clearMessages();

  // ── Wire WebRTC callbacks ──────────────────────────────────────────────────
  window.onIncomingMessage = handleIncomingMessage;

  window.onDataChannelClose = () => {
    appendSystemMsg('Connection to partner closed.');
  };

  // ── Send text message ──────────────────────────────────────────────────────
  sendBtnEl.addEventListener('click', handleSend);
  msgInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // ── File sharing ───────────────────────────────────────────────────────────
  fileInputEl.addEventListener('change', handleFileSelect);
  fileBtnEl.addEventListener('click', () => fileInputEl.click());

  // ── Report Violator ────────────────────────────────────────────────────────
  reportBtnEl.addEventListener('click', handleReport);

  // ── Leave Chat ─────────────────────────────────────────────────────────────
  leaveBtnEl.addEventListener('click', handleLeave);
};

window.teardownChatUI = function () {
  window.onIncomingMessage = null;
  clearMessages();
};

// ─── Handlers ────────────────────────────────────────────────────────────────
function handleSend() {
  const text = msgInputEl.value.trim();
  if (!text) return;

  // Strict URL filter — block before any send
  if (URL_RE.test(text)) {
    showUrlError();
    return;
  }

  const dc = window.dataChannel;
  if (!dc || dc.readyState !== 'open') {
    appendSystemMsg('Connection not ready. Please wait.');
    return;
  }

  hideUrlError();
  dc.send(JSON.stringify({ type: 'text', content: text }));
  appendMessage(text, 'self');
  msgInputEl.value = '';
}

async function handleFileSelect() {
  const file = fileInputEl.files[0];
  if (!file) return;

  // Strict 5 MB size guard
  if (file.size > MAX_FILE_BYTES) {
    alert(`File "${file.name}" exceeds the 5 MB limit. Transfer aborted.`);
    fileInputEl.value = '';
    return;
  }

  const dc = window.dataChannel;
  if (!dc || dc.readyState !== 'open') {
    alert('Data channel is not open yet. Please wait for the connection to establish.');
    fileInputEl.value = '';
    return;
  }

  appendSystemMsg(`Sending file: ${file.name} (${formatBytes(file.size)})…`);
  await window.sendFileOverChannel(file);
  appendSystemMsg(`File sent: ${file.name}`);
  fileInputEl.value = '';
}

function handleReport() {
  if (!confirm('Report this user for violating community guidelines and end the session?')) return;
  _socket.emit('report-violator', { offenderSocketId: partnerSocketId });
  window.closePeerConnection();
  window.showView?.('lobby');
}

function handleLeave() {
  window.closePeerConnection();
  _socket.emit('leave-chat');
  window.showView?.('lobby');
}

// ─── Incoming Message Router ──────────────────────────────────────────────────
function handleIncomingMessage(msg) {
  if (msg.type === 'text') {
    appendMessage(msg.content, 'partner');
  } else if (msg.type === 'file') {
    appendFileMessage(msg);
  }
}

// ─── Message Rendering ────────────────────────────────────────────────────────
function appendMessage(text, side) {
  const wrapper = document.createElement('div');
  wrapper.className = `flex ${side === 'self' ? 'justify-end' : 'justify-start'} mb-2`;

  const bubble = document.createElement('div');
  bubble.className = side === 'self'
    ? 'max-w-xs lg:max-w-md px-4 py-2 rounded-2xl rounded-br-sm bg-indigo-600 text-white text-sm break-words'
    : 'max-w-xs lg:max-w-md px-4 py-2 rounded-2xl rounded-bl-sm bg-gray-700 text-gray-100 text-sm break-words';
  bubble.textContent = text;

  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function appendFileMessage(msg) {
  const url = URL.createObjectURL(msg.blob);
  const wrapper = document.createElement('div');
  wrapper.className = 'flex justify-start mb-2';

  const bubble = document.createElement('div');
  bubble.className = 'max-w-xs px-4 py-2 rounded-2xl rounded-bl-sm bg-gray-700 text-gray-100 text-sm';

  const link = document.createElement('a');
  link.href     = url;
  link.download = msg.name;
  link.className = 'text-indigo-300 underline hover:text-indigo-200';
  link.textContent = `📎 ${msg.name} (${formatBytes(msg.size)})`;

  bubble.appendChild(link);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function appendSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'text-center text-xs text-gray-500 my-2 select-none';
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function clearMessages() {
  if (messagesEl) messagesEl.innerHTML = '';
}

function scrollToBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ─── URL Error Helpers ────────────────────────────────────────────────────────
function showUrlError() {
  if (urlErrorEl) {
    urlErrorEl.textContent = 'Links and URLs are not permitted in this chat.';
    urlErrorEl.classList.remove('hidden');
    setTimeout(hideUrlError, 4000);
  }
}

function hideUrlError() {
  if (urlErrorEl) urlErrorEl.classList.add('hidden');
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(n) {
  if (n < 1024)       return `${n} B`;
  if (n < 1024 ** 2)  return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
