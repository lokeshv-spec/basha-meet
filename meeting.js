/* ─── STATE ─────────────────────────────────────────────────────────────────── */
const socket = io({ transports: ['websocket', 'polling'] });
let localStream = null;
let screenStream = null;
let peers = {}; // { sid: RTCPeerConnection }
let participantInfo = {}; // { sid: { name, language } }
let myName = '', myLanguage = 'en', mySid = '';
let micOn = true, camOn = true, screenSharing = false, handRaised = false;
let chatUnread = 0, sidePanelOpen = false, currentTab = 'chat';
let meetingStartTime = null;
let timerInterval = null;
let captionsPanelOpen = true;
let bhashaActive = false;
let recognition = null;
let langPanelOpen = false;

const LANG_NAMES = {
  en: 'English', hi: 'हिन्दी', bn: 'বাংলা', te: 'తెలుగు',
  mr: 'मराठी', ta: 'தமிழ்', gu: 'ગુજરાતી', kn: 'ಕನ್ನಡ',
  ml: 'മലയാളം', pa: 'ਪੰਜਾਬੀ', or: 'ଓଡ଼ିଆ', as: 'অসমীয়া',
  ur: 'اردو', ne: 'नेपाली'
};

/* ─── PREVIEW (pre-join) ──────────────────────────────────────────────────── */
let previewMicOn = true, previewCamOn = true;

async function startPreview() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('preview-video').srcObject = stream;
    localStream = stream;
  } catch (e) {
    console.warn('Could not get preview stream:', e);
    document.getElementById('preview-off-msg').style.display = 'flex';
    document.querySelector('#preview-cam video').style.display = 'none';
    previewCamOn = false;
  }
}

function togglePreviewMic() {
  previewMicOn = !previewMicOn;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = previewMicOn);
  const btn = document.getElementById('preview-mic-btn');
  btn.textContent = previewMicOn ? '🎤 Mic On' : '🔇 Mic Off';
  btn.className = 'preview-btn ' + (previewMicOn ? 'active' : 'off');
  micOn = previewMicOn;
}

function togglePreviewCam() {
  previewCamOn = !previewCamOn;
  if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = previewCamOn);
  const video = document.querySelector('#preview-cam video');
  const offMsg = document.getElementById('preview-off-msg');
  video.style.display = previewCamOn ? 'block' : 'none';
  offMsg.style.display = previewCamOn ? 'none' : 'flex';
  const btn = document.getElementById('preview-cam-btn');
  btn.textContent = previewCamOn ? '📷 Cam On' : '📷 Cam Off';
  btn.className = 'preview-btn ' + (previewCamOn ? 'active' : 'off');
  camOn = previewCamOn;
}

/* ─── JOIN ────────────────────────────────────────────────────────────────── */
async function joinMeeting() {
  myName = document.getElementById('user-name').value.trim() || 'Anonymous';
  myLanguage = document.getElementById('user-language').value;

  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: camOn, audio: micOn });
    } catch (e) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        camOn = false;
      } catch (e2) {
        showToast('⚠️ Could not access camera/mic. Joining without media.');
        localStream = new MediaStream();
        micOn = false; camOn = false;
      }
    }
  }

  // Setup local video
  const localVideo = document.getElementById('local-video');
  localVideo.srcObject = localStream;
  document.getElementById('local-label').textContent = myName + ' (You)';
  document.getElementById('local-avatar').textContent = myName.charAt(0).toUpperCase();

  if (!micOn) {
    localStream.getAudioTracks().forEach(t => t.enabled = false);
    document.getElementById('local-mic-badge').style.display = 'flex';
  }
  if (!camOn) {
    document.getElementById('local-cam-off').style.display = 'flex';
  }

  // Switch UI
  document.getElementById('join-modal').classList.remove('active');
  document.getElementById('meeting-ui').style.display = 'block';

  // Set language display
  document.getElementById('current-lang-label').textContent = myLanguage.toUpperCase();
  document.getElementById('live-lang-select').value = myLanguage;
  document.getElementById('caption-lang-display').textContent = LANG_NAMES[myLanguage] || myLanguage;

  // Start timer
  meetingStartTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);

  // Add myself to people list
  updatePeopleList();

  // Join socket room
  socket.emit('join-meeting', { room_id: ROOM_ID, name: myName, language: myLanguage });
}

/* ─── WEBRTC ──────────────────────────────────────────────────────────────── */
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
};

async function createPeer(sid, isInitiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[sid] = pc;

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // ICE candidates
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { to: sid, candidate: e.candidate });
  };

  // Remote stream
  pc.ontrack = e => {
    const remoteStream = e.streams[0];
    const tile = document.getElementById('tile-' + sid);
    if (tile) {
      const video = tile.querySelector('video');
      if (video) video.srcObject = remoteStream;
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      removePeer(sid);
    }
  };

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: sid, offer: pc.localDescription });
  }

  return pc;
}

function removePeer(sid) {
  if (peers[sid]) { peers[sid].close(); delete peers[sid]; }
  const tile = document.getElementById('tile-' + sid);
  if (tile) tile.remove();
  delete participantInfo[sid];
  updateGridLayout();
  updatePeopleList();
}

/* ─── VIDEO TILES ─────────────────────────────────────────────────────────── */
function addParticipantTile(sid, name) {
  const grid = document.getElementById('video-grid');
  const tile = document.createElement('div');
  tile.className = 'video-tile remote-tile';
  tile.id = 'tile-' + sid;
  tile.innerHTML = `
    <video autoplay playsinline></video>
    <div class="tile-label">${escHtml(name)}</div>
    <div class="tile-off-overlay" id="cam-off-${sid}" style="display:none;">
      <div class="avatar-circle">${name.charAt(0).toUpperCase()}</div>
    </div>
    <div class="tile-badges">
      <div class="badge-mic-off" id="mic-badge-${sid}" style="display:none;">🔇</div>
      <div class="badge-hand" id="hand-badge-${sid}" style="display:none;">✋</div>
    </div>
  `;
  grid.appendChild(tile);
  updateGridLayout();
}

function updateGridLayout() {
  const grid = document.getElementById('video-grid');
  const count = grid.querySelectorAll('.video-tile').length;
  grid.className = 'video-grid count-' + Math.min(count, 6);
}

/* ─── SOCKET EVENTS ───────────────────────────────────────────────────────── */
socket.on('meeting-joined', async (data) => {
  mySid = data.sid;
  updateCount(data.participant_count);

  // Connect to all existing participants
  for (const p of data.existing_participants) {
    participantInfo[p.sid] = p;
    addParticipantTile(p.sid, p.name);
    await createPeer(p.sid, true);
  }
  updatePeopleList();
});

socket.on('participant-joined', async (data) => {
  if (data.sid === mySid) return;
  participantInfo[data.sid] = { name: data.name, language: data.language };
  addParticipantTile(data.sid, data.name);
  await createPeer(data.sid, false);
  updateCount(data.participant_count);
  updatePeopleList();
  showToast(`👋 ${data.name} joined`);
});

socket.on('participant-left', (data) => {
  removePeer(data.sid);
  if (data.participant_count !== undefined) updateCount(data.participant_count);
  showToast(`👋 ${data.name} left`);
});

socket.on('offer', async (data) => {
  if (!peers[data.from]) await createPeer(data.from, false);
  const pc = peers[data.from];
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: data.from, answer: pc.localDescription });
});

socket.on('answer', async (data) => {
  const pc = peers[data.from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
  const pc = peers[data.from];
  if (pc && data.candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e) {}
  }
});

socket.on('chat-message', (data) => {
  appendChatMessage(data);
  if (!sidePanelOpen || currentTab !== 'chat') {
    chatUnread++;
    const badge = document.getElementById('chat-badge');
    badge.style.display = 'flex';
    badge.textContent = chatUnread;
  }
});

socket.on('transcript-translated', (data) => {
  appendCaption(data.name, data.original, data.translated, data.target_lang);
});

socket.on('transcript-original', (data) => {
  // Show own transcript to self
  if (data.sid === mySid) {
    appendCaption(data.name + ' (You)', data.text, data.text, myLanguage, true);
  }
});

socket.on('media-state', (data) => {
  const micBadge = document.getElementById('mic-badge-' + data.sid);
  const camOff = document.getElementById('cam-off-' + data.sid);
  if (micBadge && data.audio !== undefined) micBadge.style.display = data.audio ? 'none' : 'flex';
  if (camOff && data.video !== undefined) {
    camOff.style.display = data.video ? 'none' : 'flex';
    const tile = document.getElementById('tile-' + data.sid);
    if (tile) tile.querySelector('video').style.display = data.video ? 'block' : 'none';
  }
});

socket.on('hand-raised', (data) => {
  const badge = document.getElementById('hand-badge-' + data.sid);
  if (badge) badge.style.display = 'flex';
  showToast(`✋ ${data.name} raised hand`);
});

socket.on('hand-lowered', (data) => {
  const badge = document.getElementById('hand-badge-' + data.sid);
  if (badge) badge.style.display = 'none';
});

socket.on('screen-share-started', (data) => showToast('🖥️ A participant is sharing screen'));
socket.on('screen-share-stopped', (data) => showToast('🖥️ Screen share ended'));
socket.on('error', (data) => showToast('⚠️ ' + data.message));

/* ─── CONTROLS ────────────────────────────────────────────────────────────── */
function toggleMic() {
  micOn = !micOn;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  const btn = document.getElementById('mic-btn');
  btn.textContent = micOn ? '🎤' : '🔇';
  btn.classList.toggle('off', !micOn);
  document.getElementById('local-mic-badge').style.display = micOn ? 'none' : 'flex';
  socket.emit('media-state', { room_id: ROOM_ID, audio: micOn });
  if (!micOn && bhashaActive) stopBhasha();
}

function toggleCam() {
  camOn = !camOn;
  if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  const btn = document.getElementById('cam-btn');
  btn.textContent = camOn ? '📷' : '📷';
  btn.classList.toggle('off', !camOn);
  document.getElementById('local-cam-off').style.display = camOn ? 'none' : 'flex';
  document.getElementById('local-video').style.display = camOn ? 'block' : 'none';
  socket.emit('media-state', { room_id: ROOM_ID, video: camOn });
}

async function toggleScreen() {
  const btn = document.getElementById('screen-btn');
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const videoTrack = screenStream.getVideoTracks()[0];
      // Replace video track in all peers
      Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });
      document.getElementById('local-video').srcObject = screenStream;
      screenSharing = true;
      btn.classList.add('active');
      btn.textContent = '🛑';
      socket.emit('screen-share-started', { room_id: ROOM_ID });
      videoTrack.onended = stopScreen;
    } catch (e) { showToast('⚠️ Screen share cancelled'); }
  } else {
    stopScreen();
  }
}

function stopScreen() {
  if (!screenSharing) return;
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  // Restore cam track
  const camTrack = localStream && localStream.getVideoTracks()[0];
  if (camTrack) {
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(camTrack);
    });
    document.getElementById('local-video').srcObject = localStream;
  }
  screenSharing = false;
  const btn = document.getElementById('screen-btn');
  btn.classList.remove('active');
  btn.textContent = '🖥️';
  socket.emit('screen-share-stopped', { room_id: ROOM_ID });
}

function toggleHand() {
  handRaised = !handRaised;
  const btn = document.getElementById('hand-btn');
  btn.classList.toggle('raised', handRaised);
  document.getElementById('local-hand-badge').style.display = handRaised ? 'flex' : 'none';
  socket.emit(handRaised ? 'raise-hand' : 'lower-hand', { room_id: ROOM_ID });
  showToast(handRaised ? '✋ Hand raised' : 'Hand lowered');
}

function endCall() {
  socket.emit('leave-meeting', { room_id: ROOM_ID });
  stopBhasha();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  clearInterval(timerInterval);
  window.location.href = '/';
}

/* ─── BHASHA BRIDGE ───────────────────────────────────────────────────────── */
function toggleBhashaBridge() {
  if (bhashaActive) stopBhasha(); else startBhasha();
}

function startBhasha() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('⚠️ Speech recognition not supported in this browser. Use Chrome.');
    return;
  }
  if (!micOn) {
    showToast('⚠️ Please unmute your mic first for Bhasha Bridge to work.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-IN'; // English with Indian accent

  recognition.onresult = (event) => {
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
    }
    if (final.trim()) {
      socket.emit('transcript', {
        room_id: ROOM_ID,
        text: final.trim(),
        detected_lang: 'en'
      });
    }
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') return;
    console.warn('Speech recognition error:', e.error);
    if (bhashaActive && e.error !== 'aborted') {
      setTimeout(() => { if (bhashaActive) recognition.start(); }, 1000);
    }
  };

  recognition.onend = () => {
    if (bhashaActive) recognition.start(); // Auto-restart
  };

  recognition.start();
  bhashaActive = true;
  updateBhashaUI();
  showToast('🌐 Bhasha Bridge active — speak in English!');
}

function stopBhasha() {
  bhashaActive = false;
  if (recognition) { recognition.abort(); recognition = null; }
  updateBhashaUI();
}

function updateBhashaUI() {
  const toggleBtn = document.getElementById('bhasha-toggle-btn');
  const captionBtn = document.getElementById('caption-btn');
  if (bhashaActive) {
    toggleBtn.textContent = '● LIVE';
    toggleBtn.classList.remove('inactive');
    captionBtn.classList.add('active');
    document.getElementById('caption-status-text').textContent = '● Bhasha Bridge LIVE';
  } else {
    toggleBtn.textContent = '○ START';
    toggleBtn.classList.add('inactive');
    captionBtn.classList.remove('active');
    document.getElementById('caption-status-text').textContent = '○ Bhasha Bridge Off';
  }
}

function appendCaption(speaker, original, translated, lang, isSelf = false) {
  const body = document.getElementById('captions-body');
  const empty = body.querySelector('.captions-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'caption-entry';
  const showOriginal = original !== translated;
  entry.innerHTML = `
    <div class="caption-speaker">🌐 ${escHtml(speaker)}</div>
    ${showOriginal ? `<div class="caption-text-original">EN: ${escHtml(original)}</div>` : ''}
    <div class="caption-text-translated lang-${lang}">${escHtml(translated)}</div>
  `;
  body.appendChild(entry);
  body.scrollTop = body.scrollHeight;

  // Trim old captions
  const entries = body.querySelectorAll('.caption-entry');
  if (entries.length > 50) entries[0].remove();
}

function clearCaptions() {
  const body = document.getElementById('captions-body');
  body.innerHTML = '<div class="captions-empty">Captions cleared. New captions will appear here.</div>';
}

function toggleCaptionsPanel() {
  captionsPanelOpen = !captionsPanelOpen;
  const panel = document.getElementById('captions-panel');
  panel.style.display = captionsPanelOpen ? 'flex' : 'none';
}

/* ─── LANGUAGE UPDATE ─────────────────────────────────────────────────────── */
function updateLanguage() {
  myLanguage = document.getElementById('live-lang-select').value;
  document.getElementById('current-lang-label').textContent = myLanguage.toUpperCase();
  document.getElementById('caption-lang-display').textContent = LANG_NAMES[myLanguage] || myLanguage;
  socket.emit('update-language', { room_id: ROOM_ID, language: myLanguage });
  showToast(`🌐 Language changed to ${LANG_NAMES[myLanguage] || myLanguage}`);
  updatePeopleList();
}

function toggleLangPanel() {
  langPanelOpen = !langPanelOpen;
  document.getElementById('lang-panel').style.display = langPanelOpen ? 'block' : 'none';
}

/* ─── CHAT ────────────────────────────────────────────────────────────────── */
function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat-message', { room_id: ROOM_ID, message: msg });
  input.value = '';
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

function appendChatMessage(data) {
  const container = document.getElementById('chat-messages');
  const isSelf = data.sid === mySid;
  const time = new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isSelf ? ' self' : '');
  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-name">${escHtml(data.name)}${isSelf ? ' (You)' : ''}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    <div class="chat-msg-text">${escHtml(data.message)}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/* ─── SIDE PANEL ──────────────────────────────────────────────────────────── */
function toggleChat() {
  if (sidePanelOpen && currentTab === 'chat') { closeSidePanel(); return; }
  openSidePanel(); showTab('chat');
  chatUnread = 0;
  document.getElementById('chat-badge').style.display = 'none';
}

function toggleParticipants() {
  if (sidePanelOpen && currentTab === 'people') { closeSidePanel(); return; }
  openSidePanel(); showTab('people');
}

function openSidePanel() {
  sidePanelOpen = true;
  document.getElementById('side-panel').style.display = 'flex';
}

function closeSidePanel() {
  sidePanelOpen = false;
  document.getElementById('side-panel').style.display = 'none';
}

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('content-' + tab).classList.add('active');
}

function updatePeopleList() {
  const list = document.getElementById('people-list');
  list.innerHTML = '';
  // Add self
  const selfDiv = document.createElement('div');
  selfDiv.className = 'person-item';
  selfDiv.innerHTML = `
    <div class="person-avatar">${myName.charAt(0).toUpperCase()}</div>
    <div class="person-info">
      <div class="person-name">${escHtml(myName)} <span class="person-you">You</span></div>
      <div class="person-lang">🌐 ${LANG_NAMES[myLanguage] || myLanguage}</div>
    </div>
  `;
  list.appendChild(selfDiv);
  // Add others
  for (const [sid, info] of Object.entries(participantInfo)) {
    const div = document.createElement('div');
    div.className = 'person-item';
    div.innerHTML = `
      <div class="person-avatar">${(info.name || '?').charAt(0).toUpperCase()}</div>
      <div class="person-info">
        <div class="person-name">${escHtml(info.name || 'Unknown')}</div>
        <div class="person-lang">🌐 ${LANG_NAMES[info.language] || info.language || 'EN'}</div>
      </div>
    `;
    list.appendChild(div);
  }
}

/* ─── UTILS ───────────────────────────────────────────────────────────────── */
function updateCount(n) {
  document.getElementById('participant-count').textContent = `👥 ${n}`;
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('meeting-timer').textContent = `${m}:${s}`;
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function copyMeetingLink() {
  const link = window.location.href;
  navigator.clipboard.writeText(link).then(() => showToast('🔗 Meeting link copied!'));
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (document.getElementById('join-modal').classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'd') toggleMic();
  if (e.key === 'e') toggleCam();
  if (e.key === 's') toggleScreen();
  if (e.key === 'c') toggleChat();
  if (e.key === 'b') toggleBhashaBridge();
  if (e.key === 'Escape') { closeSidePanel(); if (langPanelOpen) toggleLangPanel(); }
});

/* ─── INIT ────────────────────────────────────────────────────────────────── */
startPreview();
