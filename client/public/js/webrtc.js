/**
 * WebRTC module — text-only P2P Data Channel setup.
 *
 * Deliberately omits ALL video/audio code:
 *  - No getUserMedia / getDisplayMedia calls
 *  - No addTrack / addTransceiver calls
 *  - No RTCRtpSender / RTCRtpReceiver handling
 *  - No <video> or <audio> elements referenced here
 *
 * Data flow:
 *  - Initiator: createDataChannel → createOffer → setLocalDescription
 *              → relay offer via Socket.io → receive answer → ICE exchange
 *  - Receiver:  receive offer → setRemoteDescription → createAnswer
 *              → setLocalDescription → relay answer → ICE exchange
 *              → ondatachannel fires → channel ready
 *
 * File transfer protocol over the data channel:
 *  TX: JSON{ type:'file-meta', name, size, fileType, totalChunks }
 *      ArrayBuffer chunk × totalChunks   (16 KB each)
 *      JSON{ type:'file-end' }
 *  RX: Detect string vs ArrayBuffer; re-assemble chunks into a Blob.
 *
 * Exports (via window globals for vanilla-JS inter-file access):
 *  window.peerConnection  — current RTCPeerConnection instance
 *  window.dataChannel     — current RTCDataChannel instance
 *  window.setupPeerConnection(partnerSocketId, role, socket)
 *  window.closePeerConnection()
 */

'use strict';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Add TURN credentials here for NAT traversal in production:
  // { urls: 'turn:your-turn-server.com', username: '…', credential: '…' }
];

const CHUNK_SIZE = 16_384; // 16 KB — safe across all browser implementations

window.peerConnection = null;
window.dataChannel    = null;

// ─── Receiving-Side File State ────────────────────────────────────────────────
let incomingFile = null; // { name, size, fileType, totalChunks, chunks: [] }

// ─── Core Setup ───────────────────────────────────────────────────────────────
/**
 * Initialise a new RTCPeerConnection and either create a data channel (initiator)
 * or wait for one (receiver).  SDP and ICE messages are relayed via the provided
 * Socket.io socket; no media tracks are ever added.
 *
 * @param {string} partnerSocketId  Socket ID of the remote peer
 * @param {'initiator'|'receiver'} role
 * @param {import('socket.io-client').Socket} socket
 */
window.setupPeerConnection = async function (partnerSocketId, role, socket) {
  window.closePeerConnection(); // tear down any existing session first

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  window.peerConnection = pc;

  // ── ICE candidate relay ────────────────────────────────────────────────────
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('webrtc-ice', { targetSocketId: partnerSocketId, candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      window.onDataChannelClose?.();
    }
  };

  // ── Data channel wiring ────────────────────────────────────────────────────
  function wireDataChannel(dc) {
    window.dataChannel = dc;
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      window.onDataChannelOpen?.();
    };

    dc.onclose = () => {
      window.onDataChannelClose?.();
    };

    dc.onerror = (err) => {
      console.error('[WebRTC] DataChannel error:', err);
    };

    dc.onmessage = (evt) => {
      if (typeof evt.data === 'string') {
        handleStringMessage(evt.data);
      } else if (evt.data instanceof ArrayBuffer) {
        handleBinaryChunk(evt.data);
      }
    };
  }

  // ── Role-specific setup ────────────────────────────────────────────────────
  if (role === 'initiator') {
    const dc = pc.createDataChannel('chat', { ordered: true });
    wireDataChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { targetSocketId: partnerSocketId, sdp: pc.localDescription });

  } else {
    // Receiver: data channel arrives via ondatachannel event
    pc.ondatachannel = ({ channel }) => wireDataChannel(channel);
  }

  // ── Incoming SDP / ICE relay handlers (registered once per session) ────────
  socket.once('webrtc-offer', async ({ sdp }) => {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { targetSocketId: partnerSocketId, sdp: pc.localDescription });
  });

  socket.once('webrtc-answer', async ({ sdp }) => {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on('webrtc-ice', async ({ candidate }) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] ICE candidate error (ignorable):', err.message);
    }
  });
};

// ─── Teardown ─────────────────────────────────────────────────────────────────
window.closePeerConnection = function () {
  if (window.dataChannel) {
    try { window.dataChannel.close(); } catch {}
    window.dataChannel = null;
  }
  if (window.peerConnection) {
    try { window.peerConnection.close(); } catch {}
    window.peerConnection = null;
  }
  incomingFile = null;
};

// ─── Outgoing File Transfer ───────────────────────────────────────────────────
/**
 * Send a File object over the open RTCDataChannel in 16 KB chunks.
 * Blocks on bufferedAmount when the channel is back-pressured.
 * Caller must verify size < 5 MB before calling this function.
 */
window.sendFileOverChannel = async function (file) {
  const dc = window.dataChannel;
  if (!dc || dc.readyState !== 'open') return;

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  dc.send(JSON.stringify({
    type:        'file-meta',
    name:        file.name,
    size:        file.size,
    fileType:    file.type || 'application/octet-stream',
    totalChunks,
  }));

  const buffer = await file.arrayBuffer();

  for (let i = 0; i < totalChunks; i++) {
    // Back-pressure: pause if the send buffer is full
    while (dc.bufferedAmount > 256 * 1024) {
      await new Promise(r => setTimeout(r, 30));
    }
    const start = i * CHUNK_SIZE;
    dc.send(buffer.slice(start, start + CHUNK_SIZE));
  }

  dc.send(JSON.stringify({ type: 'file-end' }));
};

// ─── Incoming Message Parsing ─────────────────────────────────────────────────
function handleStringMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.type) {
    case 'text':
      window.onIncomingMessage?.({ type: 'text', content: msg.content });
      break;

    case 'file-meta':
      incomingFile = {
        name:        msg.name,
        size:        msg.size,
        fileType:    msg.fileType,
        totalChunks: msg.totalChunks,
        chunks:      [],
      };
      break;

    case 'file-end':
      if (incomingFile && incomingFile.chunks.length > 0) {
        const blob = new Blob(incomingFile.chunks, { type: incomingFile.fileType });
        window.onIncomingMessage?.({
          type:     'file',
          name:     incomingFile.name,
          size:     incomingFile.size,
          fileType: incomingFile.fileType,
          blob,
        });
        incomingFile = null;
      }
      break;

    default:
      break;
  }
}

function handleBinaryChunk(buffer) {
  if (incomingFile) {
    incomingFile.chunks.push(buffer);
  }
}
