'use strict';
/* =========================================================================
   TALK TODAY SPEAKING LAB v3.0 — RUNTIME ENGINE (ZERO INNERHTML / XSS-SAFE)
   ========================================================================= */
const TTRL_RICH_MEDIA = window.TTRL_RICH_MEDIA || {
  cdnPrimary: '', cdnFallback: '', cdnPrimaryV2: '', cdnFallbackV2: '',
  lessons: {}, jigsaws: {}, titleMap: {}, passageAudio: {}
};
const SPE_CFG = window.SPE_PUBLIC_CONFIG || {
  appName: 'Talk Today Speaking Lab',
  version: '3.0.0-lab',
  appsScriptWebAppUrl: '',
  emailLinkerUrl: ''
};

const $ = id => document.getElementById(id);
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null && text !== '') e.textContent = String(text);
  if (cls) e.className = cls;
  return e;
}
function clearEl(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = String(msg || '');
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3400);
}

/* =========================================================================
   HIDDEN APPS SCRIPT BRIDGE RPC CLIENT (SUPPORTS MULTI-ARG & AUDIO CALLS)
   ========================================================================= */
const bridgeState = {
  token: 'spe_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
  ready: false,
  iframe: null,
  win: null,
  readyWaiters: [],
  pending: new Map(),
  seq: 0
};

function setConnPill(mode, label) {
  const pill = $('connPill');
  const txt = $('connText');
  if (!pill || !txt) return;
  pill.className = 'conn-pill ' + (mode || '');
  txt.textContent = label || '';
}

function ensureBridgeReady() {
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    setConnPill('ready', '🔒 Direct Lab Ready');
    return Promise.resolve();
  }
  if (bridgeState.ready && bridgeState.win) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    bridgeState.readyWaiters.push({ resolve, reject });
    if (!bridgeState.iframe) mountBridgeIframe();
  });
}

function mountBridgeIframe() {
  const holder = $('gasBridgeHolder');
  if (!holder || !SPE_CFG.appsScriptWebAppUrl) return;
  clearEl(holder);
  bridgeState.ready = false;
  bridgeState.win = null;
  setConnPill('busy', 'Connecting Lab…');
  const ifr = document.createElement('iframe');
  const sep = SPE_CFG.appsScriptWebAppUrl.includes('?') ? '&' : '?';
  ifr.src = SPE_CFG.appsScriptWebAppUrl + sep + 'page=bridge&origin=' +
    encodeURIComponent(window.location.origin) + '&token=' + encodeURIComponent(bridgeState.token);
  ifr.tabIndex = -1;
  ifr.setAttribute('aria-hidden', 'true');
  ifr.style.position = 'fixed';
  ifr.style.width = '1px';
  ifr.style.height = '1px';
  ifr.style.opacity = '0';
  ifr.style.pointerEvents = 'none';
  ifr.style.border = '0';
  holder.appendChild(ifr);
  bridgeState.iframe = ifr;

  setTimeout(() => {
    if (!bridgeState.ready && bridgeState.readyWaiters.length) {
      setConnPill('err', 'Retrying Bridge…');
      bridgeState.iframe = null;
      bridgeState.win = null;
      mountBridgeIframe();
    }
  }, 15000);
}

window.addEventListener('message', ev => {
  const d = ev && ev.data;
  if (!d || d.token !== bridgeState.token) return;
  if (d.type === 'SPE_BRIDGE_READY') {
    bridgeState.win = ev.source;
    bridgeState.ready = true;
    setConnPill('ready', '🎙️ Mic & AI Ready');
    const waiters = bridgeState.readyWaiters.splice(0);
    waiters.forEach(w => w.resolve());
    return;
  }
  if (d.type === 'SPE_GAS_RESULT') {
    if (bridgeState.win && ev.source !== bridgeState.win) return;
    const item = bridgeState.pending.get(d.id);
    if (!item) return;
    bridgeState.pending.delete(d.id);
    clearTimeout(item.timer);
    if (bridgeState.pending.size === 0) setConnPill('ready', '🎙️ Mic & AI Ready');
    if (d.ok) item.resolve(d.result);
    else item.reject(new Error(d.error || 'Server error'));
  }
});

const LONG_AUDIO_RPCS = new Set([
  'gradeSpeakingMissionTask', 'studentUploadResponse', 'studentSubmitAttempt',
  'jigsawUploadVoiceClue', 'jigsawPlayVoiceClue', 'jigsawGenerateAiDraft',
  'teacherPlayLabAudio', 'teacherPlayAudio'
]);

async function rpc(fnName, ...args) {
  const timeoutMs = LONG_AUDIO_RPCS.has(fnName) ? 150000 : 45000;

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const t = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('Request timed out. Please try again.')); }
      }, timeoutMs);
      google.script.run
        .withSuccessHandler(res => { if (!settled) { settled = true; clearTimeout(t); resolve(res); } })
        .withFailureHandler(err => { if (!settled) { settled = true; clearTimeout(t); reject(new Error((err && err.message) || String(err))); } })
        [fnName](...args);
    });
  }

  await ensureBridgeReady();
  return new Promise((resolve, reject) => {
    const id = 'c_' + (++bridgeState.seq);
    if (fnName !== 'studentBeacon' && fnName !== 'teacherLivePoll' && fnName !== 'studentBreakoutPoll') {
      setConnPill('busy', LONG_AUDIO_RPCS.has(fnName) ? 'AI Coach Analyzing…' : 'Syncing…');
    }
    const timer = setTimeout(() => {
      bridgeState.pending.delete(id);
      setConnPill('ready', '🎙️ Mic & AI Ready');
      reject(new Error('Server request timed out. Please check your connection and try again.'));
    }, timeoutMs);

    bridgeState.pending.set(id, { resolve, reject, timer });
    bridgeState.win.postMessage({
      type: 'SPE_GAS_CALL',
      token: bridgeState.token,
      id,
      fnName,
      args
    }, '*');
  });
}

/* =========================================================================
   TOP-LEVEL HTTPS BROWSER MICROPHONE STUDIO (WEBAUDIO + MEDIARECORDER)
   ========================================================================= */
function pickSupportedAudioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) {
      return candidates[i];
    }
  }
  return '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const s = String(reader.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(new Error('Could not read audio recording.'));
    reader.readAsDataURL(blob);
  });
}

function initEqualizerBars(containerId, count = 12) {
  const box = $(containerId);
  if (!box) return [];
  clearEl(box);
  const bars = [];
  for (let i = 0; i < count; i++) {
    const b = el('div', '', 'mic-bar');
    box.appendChild(b);
    bars.push(b);
  }
  return bars;
}

class VoiceRecorderController {
  constructor(barsContainerId) {
    this.barsContainerId = barsContainerId;
    this.bars = [];
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.rafId = 0;
    this.mediaRecorder = null;
    this.chunks = [];
    this.recording = false;
    this.startedAt = 0;
    this.clockTimer = null;
    this.autoStopTimer = null;
    this.lastBlob = null;
    this.lastUrl = '';
    this.lastMime = 'audio/webm';
    this.lastDurationSec = 0;
  }

  ensureBars() {
    const box = $(this.barsContainerId);
    if (box && (!this.bars.length || box.childElementCount === 0)) {
      this.bars = initEqualizerBars(this.barsContainerId, 14);
    }
  }

  resetPreviewUrl() {
    if (this.lastUrl) {
      try { URL.revokeObjectURL(this.lastUrl); } catch (e) {}
      this.lastUrl = '';
    }
    this.lastBlob = null;
    this.lastDurationSec = 0;
  }

  async start(opts = {}) {
    await this.cleanupStream();
    this.resetPreviewUrl();
    this.ensureBars();
    if (typeof speech !== 'undefined' && speech.active) speech.stop();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Browser microphone access is unavailable. Please use Chrome, Safari, or Edge over HTTPS.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    this.stream = stream;

    // Live 14-bar WebAudio equalizer
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
        const src = this.audioCtx.createMediaStreamSource(stream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 64;
        src.connect(this.analyser);
        const freq = new Uint8Array(this.analyser.frequencyBinCount);
        const animate = () => {
          if (!this.recording || !this.analyser) return;
          this.analyser.getByteFrequencyData(freq);
          for (let i = 0; i < this.bars.length; i++) {
            const v = freq[i % freq.length] || 0;
            const h = Math.max(5, Math.min(28, Math.round((v / 255) * 28)));
            this.bars[i].style.height = h + 'px';
          }
          this.rafId = requestAnimationFrame(animate);
        };
        this.rafId = requestAnimationFrame(animate);
      }
    } catch (e) {}

    const mime = pickSupportedAudioMime();
    this.chunks = [];
    this.mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    this.lastMime = this.mediaRecorder.mimeType || mime || 'audio/webm';

    this.mediaRecorder.ondataavailable = ev => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    };

    this.startedAt = Date.now();
    this.recording = true;
    this.mediaRecorder.start(250);

    if (typeof opts.onTick === 'function') {
      opts.onTick(0);
      this.clockTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - this.startedAt) / 1000);
        opts.onTick(sec);
      }, 250);
    }

    if (opts.maxSeconds && opts.maxSeconds > 0) {
      this.autoStopTimer = setTimeout(() => {
        if (this.recording) {
          this.stop().then(res => {
            if (typeof opts.onAutoStop === 'function') opts.onAutoStop(res);
          }).catch(() => {});
        }
      }, opts.maxSeconds * 1000);
    }
  }

  stop() {
    return new Promise(resolve => {
      clearInterval(this.clockTimer);
      clearTimeout(this.autoStopTimer);
      cancelAnimationFrame(this.rafId);
      this.bars.forEach(b => { b.style.height = '6px'; });

      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        this.recording = false;
        this.cleanupStream().then(() => resolve(null));
        return;
      }

      const durSec = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
      this.mediaRecorder.onstop = async () => {
        this.recording = false;
        const blob = new Blob(this.chunks, { type: this.lastMime || 'audio/webm' });
        this.lastBlob = blob;
        this.lastDurationSec = durSec;
        this.lastUrl = URL.createObjectURL(blob);
        await this.cleanupStream();
        resolve({ blob, url: this.lastUrl, mimeType: this.lastMime, durationSeconds: durSec });
      };
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        this.recording = false;
        this.cleanupStream().then(() => resolve(null));
      }
    });
  }

  async cleanupStream() {
    cancelAnimationFrame(this.rafId);
    clearInterval(this.clockTimer);
    clearTimeout(this.autoStopTimer);
    if (this.stream) {
      try { this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      this.stream = null;
    }
    if (this.audioCtx) {
      try { await this.audioCtx.close(); } catch (e) {}
      this.audioCtx = null;
      this.analyser = null;
    }
  }
}

const missionRec = new VoiceRecorderController('mRecBars');
const plMicRec = new VoiceRecorderController('plMicBars');
const plTaskRec = new VoiceRecorderController('plTaskBars');
const jigsawVoiceRec = new VoiceRecorderController('jVcBars');
let activeAudioPlayer = null;

function stopAllRecordersAndAudio() {
  [missionRec, plMicRec, plTaskRec, jigsawVoiceRec].forEach(r => {
    if (r.recording) r.stop().catch(() => {});
    else r.cleanupStream().catch(() => {});
  });
  if (activeAudioPlayer) {
    try { activeAudioPlayer.pause(); } catch (e) {}
    activeAudioPlayer = null;
  }
  const prev = $('mPreviewAudio');
  if (prev) { try { prev.pause(); } catch (e) {} }
}

function speakShortText(text) {
  if (!text || !('speechSynthesis' in window)) return;
  if (typeof speech !== 'undefined' && speech.active) speech.stop();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  const v = typeof pickBestBrowserVoice === 'function' ? pickBestBrowserVoice() : null;
  if (v) u.voice = v;
  u.lang = (v && v.lang) || 'en-US';
  u.rate = Number(settings.rate) || 1.0;
  window.speechSynthesis.speak(u);
}

/* =========================================================================
   GLOBAL APPLICATION STATE, SKILLS META & COMFORT SETTINGS
   ========================================================================= */
const state = {
  portalContext: null,
  code: '',
  activeView: 'loginView',
  lastDashboardData: null,
  lessons: [],
  filter: 'ALL',
  catFilter: 'ALL',
  bookSeriesFilter: 'ALL',
  bookUnitFilter: 'ALL',
  bookDrawerOpen: false,
  searchQuery: '',
  lesson: null,
  tasks: [],
  qIdx: 0,
  busy: false,
  justOpenedLesson: false,
  pendingOtp: null
};

const clientPresence = {
  stage: 'LOBBY',
  lessonId: '',
  lessonTitle: '',
  lessonCefr: '',
  qIndex: 0,
  qTotal: 4,
  qId: '',
  qPrompt: '',
  skill: ''
};

function sendStudentBeacon(patch) {
  if (!state.portalContext || !state.portalContext.code || state.portalContext.code === 'OWNER-PREVIEW') return;
  if (patch && typeof patch === 'object') Object.assign(clientPresence, patch);
  rpc('studentBeacon', {
    code: state.portalContext.code,
    email: state.portalContext.email,
    session: state.portalContext.session,
    stage: clientPresence.stage,
    lessonId: clientPresence.lessonId,
    lessonTitle: clientPresence.lessonTitle,
    lessonCefr: clientPresence.lessonCefr,
    qIndex: clientPresence.qIndex,
    qTotal: clientPresence.qTotal,
    qId: clientPresence.qId,
    qPrompt: clientPresence.qPrompt,
    skill: clientPresence.skill
  }).catch(() => {});
}

const SKILL_META = {
  literal:    { label: 'Key Details & Retell', icon: '🗣️', tip: 'Retell who, where, and what happened in complete sentences.' },
  inference:  { label: 'Why & How Thinking',  icon: '💡', tip: 'Use "because" or "so" to explain reasons and feelings clearly.' },
  vocabulary: { label: 'Vocab in Action',     icon: '🔤', tip: 'Use the target unit/story words naturally inside your own sentence.' },
  evidence:   { label: 'Story Proof & Opinion', icon: '📍', tip: 'Connect a specific story detail to your own opinion or experience.' }
};

function showView(viewId) {
  if (state.activeView && state.activeView !== viewId) {
    if (typeof pauseAllStoryVideos === 'function') pauseAllStoryVideos();
    stopAllRecordersAndAudio();
  }
  state.activeView = viewId;
  ['loginView', 'loadingView', 'dashboardView', 'exerciseView', 'placementView', 'summaryView', 'teacherView', 'jigsawStudioView', 'jigsawView'].forEach(id => {
    const node = $(id);
    if (node) node.classList.toggle('hidden', id !== viewId);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Comfort Settings ---------- */
const SETTINGS_KEY = 'ttsl_settings_v3';
function safeParse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
const settings = Object.assign({ theme: 'dark', font: 'serif', size: '19', lh: '1.85', rate: '1', focus: false }, safeParse(localStorage.getItem(SETTINGS_KEY)));

function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.font = settings.font;
  document.documentElement.style.setProperty('--read-size', settings.size + 'px');
  document.documentElement.style.setProperty('--read-lh', settings.lh);
  document.querySelectorAll('.seg').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', String(settings[seg.dataset.set]) === b.dataset.v);
    });
  });
  const rateLabel = Number(settings.rate).toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1') + '×';
  if ($('speedBtn')) $('speedBtn').textContent = rateLabel;
  if ($('jSpeedBtn')) $('jSpeedBtn').textContent = rateLabel;
  if ($('focusBtn')) $('focusBtn').classList.toggle('on', !!settings.focus);
  if ($('passage')) $('passage').classList.toggle('focus', !!settings.focus);
  if ($('jFocusBtn')) $('jFocusBtn').classList.toggle('on', !!settings.focus);
  if ($('jPartPassage')) $('jPartPassage').classList.toggle('focus', !!settings.focus);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[seg.dataset.set] = b.dataset.v;
    applySettings();
    if (seg.dataset.set === 'rate' && typeof speech !== 'undefined' && speech.active) speech.applyLiveRate();
  });
});

function openDrawer(open) {
  $('drawer').classList.toggle('open', open);
  $('scrim').classList.toggle('hidden', !open);
}
$('settingsBtn').addEventListener('click', () => openDrawer(true));
$('textBtn').addEventListener('click', () => openDrawer(true));
$('closeDrawerBtn').addEventListener('click', () => openDrawer(false));
$('scrim').addEventListener('click', () => openDrawer(false));
$('focusBtn').addEventListener('click', () => { settings.focus = !settings.focus; applySettings(); });

function cycleListeningSpeed() {
  const r = ['0.8', '1', '1.2'];
  const curIdx = r.indexOf(String(settings.rate));
  settings.rate = r[(curIdx + 1) % r.length];
  applySettings();
  if (typeof speech !== 'undefined' && speech.active) speech.applyLiveRate();
}
$('speedBtn').addEventListener('click', cycleListeningSpeed);
if ($('jSpeedBtn')) $('jSpeedBtn').addEventListener('click', cycleListeningSpeed);

/* ---------- 4-Stage Login Progress Bar ---------- */
let progTimer = null;
const progStages = [
  '🔄 Step 1/4: Verifying Student ID & Registered Guardian Email...',
  '🔄 Step 2/4: Locating Enrolled Class Cohort & Teacher...',
  '🔄 Step 3/4: Loading Speaking Level, Vocab Missions & AI Coach...',
  '🔄 Step 4/4: Unlocking Talk Today Speaking Lab...'
];
function startProgress() {
  $('portalProgBox').style.display = 'block';
  $('progBarFill').style.width = '12%';
  $('progStageLabel').textContent = progStages[0];
  let step = 0;
  clearInterval(progTimer);
  progTimer = setInterval(() => {
    step = (step + 1) % 4;
    $('progBarFill').style.width = ((step + 1) * 23) + '%';
    $('progStageLabel').textContent = progStages[step];
  }, 450);
}
function stopProgress(done) {
  clearInterval(progTimer);
  if (done) {
    $('progBarFill').style.width = '100%';
    $('progStageLabel').textContent = '✅ Speaking Lab unlocked!';
    setTimeout(() => { $('portalProgBox').style.display = 'none'; }, 380);
  } else {
    $('portalProgBox').style.display = 'none';
  }
}

/* =========================================================================
   STUDENT PORTAL AUTHENTICATION (WITH OTP + OWNER SHORTCUT + SIBLINGS)
   ========================================================================= */
function completeStudentLogin(res, rawCode, rawEmail) {
  const isOwner = String(rawCode || '').trim().toLowerCase() === 'jamalmorelli' ||
                  String(rawEmail || '').trim().toLowerCase() === 'jamalmorelli' ||
                  (res.student && res.student.code === 'OWNER-PREVIEW');
  const effEmail = isOwner ? (rawEmail || 'jamalmorelli') : rawEmail;

  state.portalContext = {
    code: (res.student && res.student.code) || rawCode,
    email: effEmail,
    session: res.session || '',
    actor: res.actor || 'STUDENT',
    student: res.student || {},
    siblings: res.siblings || []
  };
  state.code = {
    code: state.portalContext.code,
    email: state.portalContext.email,
    session: state.portalContext.session
  };

  try {
    sessionStorage.setItem('ttsl_portal_auth', JSON.stringify(state.portalContext));
  } catch (e) {}

  $('otpVerifyBox').classList.add('hidden');
  $('portalForm').classList.remove('hidden');
  renderDashboard(res.appData);
  showView('dashboardView');
}

$('portalForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (state.busy) return;
  const code = $('studentCode').value.trim();
  const email = $('parentEmail').value.trim();
  $('loginErr').textContent = '';

  if (!code && !email) {
    $('loginErr').textContent = 'Please enter your student code.';
    return;
  }

  state.busy = true;
  $('loginSubmitBtn').disabled = true;
  startProgress();

  try {
    const res = await rpc('portalOpen', { code, email, lang: 'en' });
    if (res && res.status === 'NEED_EMAIL_CODE') {
      stopProgress(false);
      state.pendingOtp = { code, email };
      const reqRes = await rpc('portalRequestCode', { code, email, lang: 'en' });
      $('portalForm').classList.add('hidden');
      $('otpVerifyBox').classList.remove('hidden');
      $('otpInfoMsg').textContent = (reqRes && reqRes.maskedEmail)
        ? ('📧 We sent a 6-digit verification code to ' + reqRes.maskedEmail + '. Enter it below:')
        : '📧 Enter the 6-digit verification code sent to your registered email:';
      return;
    }
    if (!res || !res.ok) {
      stopProgress(false);
      $('loginErr').textContent = (res && res.error) || 'Credentials not found. Please verify your student code and registered email.';
      return;
    }
    stopProgress(true);
    completeStudentLogin(res, code, email);
  } catch (err) {
    stopProgress(false);
    $('loginErr').textContent = err.message || 'Server connection failed.';
  } finally {
    state.busy = false;
    $('loginSubmitBtn').disabled = false;
  }
});

$('verifyOtpBtn').addEventListener('click', async () => {
  if (!state.pendingOtp || state.busy) return;
  const otp = $('otpCodeInput').value.trim();
  if (!otp) { $('loginErr').textContent = 'Please enter the 6-digit code.'; return; }
  state.busy = true;
  $('verifyOtpBtn').disabled = true;
  $('loginErr').textContent = '';
  try {
    const res = await rpc('portalVerifyCode', {
      code: state.pendingOtp.code,
      email: state.pendingOtp.email,
      otp,
      lang: 'en'
    });
    if (!res || !res.ok) {
      $('loginErr').textContent = (res && res.error) || 'Invalid or expired code.';
      return;
    }
    completeStudentLogin(res, state.pendingOtp.code, state.pendingOtp.email);
  } catch (err) {
    $('loginErr').textContent = err.message || 'Verification failed.';
  } finally {
    state.busy = false;
    $('verifyOtpBtn').disabled = false;
  }
});

$('resendOtpBtn').addEventListener('click', async () => {
  if (!state.pendingOtp || state.busy) return;
  try {
    await rpc('portalRequestCode', { code: state.pendingOtp.code, email: state.pendingOtp.email, lang: 'en' });
    showToast('Verification code resent!');
  } catch (err) {
    $('loginErr').textContent = err.message;
  }
});

$('cancelOtpBtn').addEventListener('click', () => {
  state.pendingOtp = null;
  $('otpVerifyBox').classList.add('hidden');
  $('portalForm').classList.remove('hidden');
  $('loginErr').textContent = '';
});

/* Sibling Switcher */
function renderSiblings(siblings, currentCode) {
  const bar = $('siblingBar');
  const box = $('siblingButtons');
  clearEl(box);
  const others = (siblings || []).filter(s => String(s.id || s.code) !== String(currentCode));
  if (!others.length) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  others.forEach(s => {
    const sid = s.id || s.code;
    const btn = el('button', '🔄 ' + s.name + ' (#' + sid + ')', 'sibling-btn');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      $('studentCode').value = sid;
      if (state.portalContext && state.portalContext.email) {
        $('parentEmail').value = state.portalContext.email;
      }
      $('portalForm').dispatchEvent(new Event('submit'));
    });
    box.appendChild(btn);
  });
}

/* Support Ticket Form */
$('showSupportFormLink').addEventListener('click', e => {
  e.preventDefault();
  $('portalForm').classList.add('hidden');
  $('portalSupportLink').classList.add('hidden');
  $('portalSupportForm').classList.remove('hidden');
});
$('cancelSupportBtn').addEventListener('click', () => {
  $('portalSupportForm').classList.add('hidden');
  $('portalForm').classList.remove('hidden');
  $('portalSupportLink').classList.remove('hidden');
});
$('portalSupportForm').addEventListener('submit', async e => {
  e.preventDefault();
  const c = $('supCode').value.trim();
  const n = $('supName').value.trim();
  const em = $('supEmail').value.trim();
  $('supBtn').disabled = true;
  $('supBtn').textContent = 'Sending...';
  $('supMsg').textContent = '';
  try {
    await rpc('submitSupportTicket', c, n, em);
    $('supMsg').style.color = '#10b981';
    $('supMsg').textContent = 'Ticket sent to administration desk!';
    setTimeout(() => {
      $('portalSupportForm').classList.add('hidden');
      $('portalForm').classList.remove('hidden');
      $('portalSupportLink').classList.remove('hidden');
      $('supBtn').disabled = false;
      $('supBtn').textContent = 'Send to Administration';
    }, 1800);
  } catch (ex) {
    $('supBtn').disabled = false;
    $('supBtn').textContent = 'Send to Administration';
    $('supMsg').style.color = 'var(--bad)';
    $('supMsg').textContent = ex.message;
  }
});

/* Sign Out */
$('logoutBtn').addEventListener('click', () => {
  if (typeof speech !== 'undefined') speech.stop();
  stopAllRecordersAndAudio();
  if (typeof stopTeacherPolling === 'function') stopTeacherPolling();
  if (typeof jStudio !== 'undefined' && jStudio.livePollTimer) { clearInterval(jStudio.livePollTimer); jStudio.livePollTimer = null; }
  if (typeof jStudent !== 'undefined' && jStudent.pollTimer) { clearInterval(jStudent.pollTimer); jStudent.pollTimer = null; }
  if (typeof brState !== 'undefined' && brState.pollTimer) { clearInterval(brState.pollTimer); brState.pollTimer = null; }

  if (state.portalContext && state.portalContext.code && state.portalContext.code !== 'OWNER-PREVIEW') {
    rpc('studentBeacon', {
      code: state.portalContext.code,
      email: state.portalContext.email,
      session: state.portalContext.session,
      stage: 'OFFLINE'
    }).catch(() => {});
  }
  state.portalContext = null;
  state.code = '';
  if (typeof teacherState !== 'undefined') {
    teacherState.session = '';
    teacherState.lastData = null;
  }
  try {
    sessionStorage.removeItem('ttsl_portal_auth');
    sessionStorage.removeItem('ttsl_teacher_auth');
  } catch (e) {}
  ['ptsChip', 'streakChip', 'lvlChip', 'logoutBtn'].forEach(id => $(id).classList.add('hidden'));
  $('subBrand').textContent = 'Student Portal & AI Speaking Coach';
  showView('loginView');
});

/* =========================================================================
   GAMIFIED DASHBOARD, ACHIEVEMENTS MODAL & COURSEBOOK COMPANION
   ========================================================================= */
function renderDashboard(data) {
  if (!data) return;
  state.lastDashboardData = data;
  const st = data.student || {};
  const game = data.game || {};
  const stats = data.stats || {};
  const lvl = data.levelInfo || {};
  const pace = data.speakingPace || {};
  const pl = data.placement || {};

  // Top Header Chips
  const pts = Number(game.points || 0);
  const streak = Number(game.streak || stats.streak || 0);
  const homeCefr = lvl.homeCefr || st.cefr || 'A1';
  $('ptsVal').textContent = String(pts);
  $('streakVal').textContent = String(streak);
  $('lvlVal').textContent = homeCefr;
  ['ptsChip', 'streakChip', 'lvlChip', 'logoutBtn'].forEach(id => $(id).classList.remove('hidden'));
  $('subBrand').textContent = 'Student Portal & AI Speaking Coach';

  // Siblings
  if (state.portalContext) renderSiblings(state.portalContext.siblings, state.portalContext.code);

  // Student Banner
  $('dashStudentName').textContent = st.name || st.firstName || 'Student';
  $('dashStudentCode').textContent = '#' + (st.id || (state.portalContext && state.portalContext.code) || '');
  $('dashClassChip').textContent = '📚 ' + (st.className || 'Speaking Cohort');
  $('dashTeacherChip').textContent = '👩‍🏫 ' + (st.teacher || 'Talk Today');
  $('dashLevelChip').textContent = '🎯 Level: ' + homeCefr;
  $('dashAgeChip').textContent = '👥 ' + (st.ageBand ? String(st.ageBand).toUpperCase() : 'STUDENT');

  // Mastery Unlock Notice
  if (lvl.nextCefr) {
    const unlockedNext = Array.isArray(lvl.unlockedLevels) && lvl.unlockedLevels.includes(lvl.nextCefr);
    $('unlockNotice').textContent = unlockedNext
      ? ('🚀 Unlocked ' + lvl.nextCefr + '!')
      : ((lvl.masteredAtHome || 0) + '/' + (lvl.unlockTarget || 3) + ' mastered to unlock ' + lvl.nextCefr);
  } else {
    $('unlockNotice').textContent = '🌟 All CEFR levels unlocked';
  }

  // Daily Speaking Goal
  const doneToday = Number(game.todayAnswers || 0);
  const goalToday = Number(game.dailyGoal || 4);
  $('goalFraction').textContent = doneToday + ' / ' + goalToday;
  $('goalFill').style.width = Math.min(100, Math.round((doneToday / Math.max(1, goalToday)) * 100)) + '%';
  $('goalStatusText').textContent = game.dailyGoalMet
    ? '🎉 Daily speaking goal met! Keep building your fluency!'
    : (Math.max(0, goalToday - doneToday) + ' more spoken response(s) to hit today’s goal');

  // Speaker Rank
  if (game.rank) {
    const rk = game.rank;
    $('rankVal').textContent = (rk.icon || '🌱') + ' ' + (rk.title || 'New Voice');
    const progPct = (rk.nextMin && rk.nextMin > rk.min)
      ? Math.min(100, Math.max(4, Math.round(((pts - rk.min) / (rk.nextMin - rk.min)) * 100)))
      : 100;
    $('rankFill').style.width = progPct + '%';
    $('rankNextText').textContent = rk.nextTitle
      ? (rk.toNext + ' KP to ' + rk.nextTitle)
      : '🏆 Top Speaker Rank achieved!';
  }

  // Class Weekly Standings Leaderboard
  const lbBox = $('leaderboardBox');
  clearEl(lbBox);
  const lbRows = Array.isArray(game.leaderboard) ? game.leaderboard : [];
  if (lbRows.length) {
    lbRows.forEach(row => {
      const r = el('div', '', 'leaderboard-row' + (row.isMe ? ' me' : ''));
      const medal = row.rank === 1 ? '🥇 ' : row.rank === 2 ? '🥈 ' : row.rank === 3 ? '🥉 ' : ('#' + row.rank + ' ');
      r.appendChild(el('span', medal + row.displayName));
      r.appendChild(el('span', (row.points || 0) + ' KP'));
      lbBox.appendChild(r);
    });
  } else {
    lbBox.appendChild(el('div', 'Be the first in your class to earn Speaking KP this week!', 'muted'));
  }

  // Achievements Tile
  const badgesList = Array.isArray(game.badges) ? game.badges : [];
  const earnedCount = Number(game.earnedBadgeCount || 0);
  $('badgesCountVal').textContent = earnedCount + ' / ' + (badgesList.length || 12);
  const latestEarned = badgesList.filter(b => b.earned).slice(-1)[0];
  $('badgeRecentText').textContent = latestEarned
    ? ('Unlocked: ' + latestEarned.icon + ' ' + latestEarned.name + ' · Tap for all')
    : 'Tap to inspect all 12 Speaking Achievements';

  // Spoken Pace
  $('paceVal').textContent = pace.avgWpm ? (pace.avgWpm + ' WPM') : '-- WPM';
  $('paceSubText').textContent = pace.band || 'Record a speaking task to measure WPM';

  // Official 2-Task Speaking Placement Card & Safe History
  const assignedPack = (pl.profile && pl.profile.assignedPack) || (data.profile && data.profile.assignedPack) || 'INT';
  $('placementPackBadge').textContent = 'Pack: ' + assignedPack + ((pl.profile && pl.profile.packLockedByTeacher) ? ' 🔒' : '');
  const hist = Array.isArray(pl.history) ? pl.history : [];
  const histBtn = $('togglePlacementHistBtn');
  const histBox = $('placementHistoryBox');
  clearEl(histBox);
  if (hist.length > 0) {
    histBtn.classList.remove('hidden');
    histBtn.textContent = '📋 Past Checks (' + hist.length + ')';
    hist.forEach(h => {
      const row = el('div', '', 'placement-hist-row');
      const dStr = h.submittedAt ? new Date(h.submittedAt).toLocaleDateString() : 'Submitted';
      row.appendChild(el('strong', '🎙️ Official Check (' + (h.level || assignedPack) + ') · ' + dStr));
      row.appendChild(el('span', h.statusLabel || 'Submitted for teacher review', 'badge done'));
      histBox.appendChild(row);
    });
  } else {
    histBtn.classList.add('hidden');
    histBox.classList.add('hidden');
  }

  // Progress Stats & Vocab Activated
  $('statCompleted').textContent = String(stats.completedLessons || 0);
  $('statAccuracy').textContent = (stats.masteryPct || 0) + '%';
  $('statAnswers').textContent = String(stats.totalRecordings || 0);
  $('statStreak').textContent = streak + 'd';
  $('statVocabChip').textContent = '🔤 ' + (stats.vocabActivated || 0) + ' Target Words Activated';

  // Owner Banner
  $('ownerBanner').classList.toggle('hidden', !data.ownerPreview);

  // Breakout Room & Live Jigsaws
  if (typeof renderStudentBreakoutBanner === 'function') {
    renderStudentBreakoutBanner(data.breakoutRoom || null);
  }
  if (typeof renderStudentJigsawSection === 'function') {
    renderStudentJigsawSection(data.jigsaws || []);
  }

  // Speaking Skills Profile
  renderSkills(data.skills);

  // Speaking Missions Library
  state.lessons = data.lessons || [];
  renderLevelTabs(lvl.unlockedLevels || [homeCefr]);
  filterAndRenderLessons();

  sendStudentBeacon({
    stage: 'LOBBY', lessonId: '', lessonTitle: '', lessonCefr: '', qIndex: 0, qId: '', qPrompt: '', skill: ''
  });
}

$('togglePlacementHistBtn').addEventListener('click', () => {
  $('placementHistoryBox').classList.toggle('hidden');
});

/* Badges Modal */
$('badgesTile').addEventListener('click', () => {
  const badges = (state.lastDashboardData && state.lastDashboardData.game && state.lastDashboardData.game.badges) || [];
  const grid = $('badgesModalGrid');
  clearEl(grid);
  badges.forEach(b => {
    const card = el('div', '', 'badge-card' + (b.earned ? ' earned' : ''));
    card.appendChild(el('div', b.icon || '🏅', 'b-ico'));
    card.appendChild(el('div', (b.earned ? '✓ ' : '🔒 ') + b.name, 'b-name'));
    card.appendChild(el('div', b.desc || '', 'b-desc'));
    grid.appendChild(card);
  });
  $('badgesModal').classList.remove('hidden');
});
$('closeBadgesModalBtn').addEventListener('click', () => $('badgesModal').classList.add('hidden'));
$('badgesModal').addEventListener('click', e => {
  if (e.target === $('badgesModal')) $('badgesModal').classList.add('hidden');
});

function renderSkills(skillsObj) {
  const box = $('skillsList');
  clearEl(box);
  const items = (skillsObj && Array.isArray(skillsObj.items)) ? skillsObj.items : [];
  items.forEach(row => {
    const meta = SKILL_META[row.key] || { label: row.label || row.key, icon: '🎙️' };
    const r = el('div', '', 'skillRow');
    r.appendChild(el('span', meta.icon + ' ' + (row.label || meta.label)));
    const bar = el('div', '', 'bar');
    const fill = el('i');
    const pctVal = Number.isFinite(row.accuracyPct) ? row.accuracyPct : 0;
    fill.style.width = pctVal + '%';
    bar.appendChild(fill);
    r.appendChild(bar);
    r.appendChild(el('span', row.attempts > 0 ? (pctVal + '%') : '--'));
    box.appendChild(r);
  });

  const tipBox = $('skillTipBox');
  if (skillsObj && skillsObj.coachTip) {
    tipBox.classList.remove('hidden');
    tipBox.textContent = '💡 AI Speaking Coach Focus (' + (skillsObj.focusSkill || 'Fluency') + '): ' + skillsObj.coachTip;
  } else {
    tipBox.classList.add('hidden');
  }
}

/* ---------- 8 Categories & Talk Today Coursebook Explorer ---------- */
const CATEGORY_DEFS = [
  { key: 'ALL',     label: '✨ All Missions',       shortTag: '🎙️ Mission' },
  { key: 'books',   label: '📚 Talk Today Books',   shortTag: '📚 Coursebook', special: true },
  { key: 'science', label: '🔬 Science & Space',    shortTag: '🔬 Science' },
  { key: 'nature',  label: '🌍 Nature & Animals',   shortTag: '🌍 Nature' },
  { key: 'culture', label: '🏛️ History & Culture',  shortTag: '🏛️ Culture' },
  { key: 'tech',    label: '💻 Tech & Daily Life',  shortTag: '💻 Tech & Life' },
  { key: 'sports',  label: '⚽ Sports & Hobbies',   shortTag: '⚽ Sports' },
  { key: 'stories', label: '📖 Stories & Mysteries', shortTag: '📖 Story' }
];

const BOOK_SERIES_DEFS = [
  { key: 'ALL',                  label: 'All Coursebooks' },
  { key: 'Super Minds',          label: '📘 Super Minds' },
  { key: 'Shining Lights',       label: '✨ Shining Lights' },
  { key: 'Gateway to the World', label: '🌍 Gateway to the World' },
  { key: 'Wider World',          label: '🧭 Wider World' },
  { key: 'Our World & Look',     label: '📸 Our World & Look' },
  { key: 'Interchange & Voices', label: '💬 Interchange & Voices' }
];

function getLessonCatalogMeta(lesson) {
  const m = (lesson && lesson.id && TTRL_RICH_MEDIA.lessons[lesson.id]) || null;
  if (m) return m;
  const hay = (String((lesson && lesson.topic) || '') + ' ' + String((lesson && lesson.title) || '')).toLowerCase();
  if (/super minds|shining lights|gateway|wider world|our world|interchange|coursebook/.test(hay)) return { cat: 'books' };
  if (/science|space|astronomy|solar|physics|biology|marine|ocean|experiment/.test(hay)) return { cat: 'science' };
  if (/nature|animal|forest|beach|bird|stork|wildlife|weather/.test(hay)) return { cat: 'nature' };
  if (/culture|history|heritage|morocco|medina|food|community/.test(hay)) return { cat: 'culture' };
  if (/sport|football|cycling|athletics|hobby/.test(hay)) return { cat: 'sports' };
  if (/tech|media|digital|robot|drone|money|shopping|routine/.test(hay)) return { cat: 'tech' };
  return { cat: 'stories' };
}

function lessonMatchesCat(lesson, catKey) {
  if (!catKey || catKey === 'ALL') return true;
  const meta = getLessonCatalogMeta(lesson);
  return meta.cat === catKey || meta.subCat === catKey;
}

function renderLevelTabs(unlockedLevels) {
  const tabs = $('levelTabs');
  clearEl(tabs);
  const allCefrs = ['ALL', 'PRE-A1', 'A1', 'A2', 'B1', 'B2', 'C1'];
  const unlockedSet = new Set(unlockedLevels || []);
  if (allCefrs.indexOf(state.filter) < 0) state.filter = 'ALL';

  allCefrs.forEach(lvl => {
    const isLocked = lvl !== 'ALL' && !unlockedSet.has(lvl);
    const label = lvl === 'ALL' ? 'All Levels' : (isLocked ? ('🔒 ' + lvl) : lvl);
    const pill = el('button', label, 'pill' + (state.filter === lvl ? ' on' : ''));
    pill.type = 'button';
    pill.addEventListener('click', () => {
      state.filter = lvl;
      renderLevelTabs(unlockedLevels);
      filterAndRenderLessons();
    });
    tabs.appendChild(pill);
  });
  renderCategoryAndBookControls();
}

function renderCategoryAndBookControls() {
  const catBox = $('categoryTabs');
  if (!catBox) return;
  clearEl(catBox);

  const levelScoped = state.lessons.filter(l => state.filter === 'ALL' || l.cefr === state.filter);

  CATEGORY_DEFS.forEach(def => {
    const cnt = levelScoped.filter(l => lessonMatchesCat(l, def.key)).length;
    const cls = 'cat-pill' + (def.special ? ' books-special' : '') + (state.catFilter === def.key ? ' on' : '');
    const btn = el('button', '', cls);
    btn.type = 'button';
    btn.dataset.cat = def.key;
    btn.appendChild(el('span', def.label));
    btn.appendChild(el('span', String(cnt), 'cat-count'));
    btn.addEventListener('click', () => {
      state.catFilter = def.key;
      if (def.key === 'books') state.bookDrawerOpen = true;
      else {
        state.bookSeriesFilter = 'ALL';
        state.bookUnitFilter = 'ALL';
      }
      renderCategoryAndBookControls();
      filterAndRenderLessons();
    });
    catBox.appendChild(btn);
  });

  const explorerBox = $('bookExplorerBar');
  const toggleBtn = $('toggleBookExplorerBtn');
  const showExplorer = state.catFilter === 'books' || state.bookDrawerOpen || state.bookSeriesFilter !== 'ALL' || state.bookUnitFilter !== 'ALL';
  if (explorerBox) explorerBox.classList.toggle('hidden', !showExplorer);
  if (toggleBtn) toggleBtn.classList.toggle('on', showExplorer);

  const seriesBox = $('bookSeriesPills');
  if (seriesBox) {
    clearEl(seriesBox);
    const bookLessons = levelScoped.filter(l => lessonMatchesCat(l, 'books'));
    BOOK_SERIES_DEFS.forEach(sDef => {
      const sCount = sDef.key === 'ALL'
        ? bookLessons.length
        : bookLessons.filter(l => getLessonCatalogMeta(l).bookSeries === sDef.key).length;
      const b = el('button', sDef.label + ' (' + sCount + ')', 'book-series-pill' + (state.bookSeriesFilter === sDef.key ? ' on' : ''));
      b.type = 'button';
      b.addEventListener('click', () => {
        state.bookSeriesFilter = sDef.key;
        state.bookUnitFilter = 'ALL';
        if (sDef.key !== 'ALL' && state.catFilter !== 'books') state.catFilter = 'books';
        renderCategoryAndBookControls();
        filterAndRenderLessons();
      });
      seriesBox.appendChild(b);
    });

    const unitSel = $('bookUnitSelect');
    if (unitSel) {
      clearEl(unitSel);
      const allOpt = el('option', state.bookSeriesFilter === 'ALL'
        ? ('All Coursebook Units (' + bookLessons.length + ' missions)')
        : ('All ' + state.bookSeriesFilter + ' Units'));
      allOpt.value = 'ALL';
      unitSel.appendChild(allOpt);

      const seenUnits = new Set();
      bookLessons
        .filter(l => state.bookSeriesFilter === 'ALL' || getLessonCatalogMeta(l).bookSeries === state.bookSeriesFilter)
        .forEach(l => {
          const m = getLessonCatalogMeta(l);
          if (!m.bookTitle || !m.unitCode) return;
          const uKey = m.bookTitle + '||' + m.unitCode;
          if (seenUnits.has(uKey)) return;
          seenUnits.add(uKey);
          const opt = el('option', m.bookTitle + ' · ' + m.unitCode + ': ' + m.unitTitle + ' [' + l.cefr + ']');
          opt.value = uKey;
          unitSel.appendChild(opt);
        });
      unitSel.value = seenUnits.has(state.bookUnitFilter) ? state.bookUnitFilter : 'ALL';
      if (unitSel.value === 'ALL') state.bookUnitFilter = 'ALL';
    }
  }
}

(function bindCatalogControlsOnce() {
  $('lessonSearchInput').addEventListener('input', e => {
    state.searchQuery = e.target.value.trim();
    filterAndRenderLessons();
  });
  $('toggleBookExplorerBtn').addEventListener('click', () => {
    if (state.catFilter === 'books') {
      state.catFilter = 'ALL';
      state.bookSeriesFilter = 'ALL';
      state.bookUnitFilter = 'ALL';
      state.bookDrawerOpen = false;
    } else {
      state.bookDrawerOpen = !state.bookDrawerOpen;
      if (state.bookDrawerOpen) state.catFilter = 'books';
    }
    renderCategoryAndBookControls();
    filterAndRenderLessons();
  });
  $('bookUnitSelect').addEventListener('change', e => {
    state.bookUnitFilter = e.target.value || 'ALL';
    if (state.bookUnitFilter !== 'ALL') state.catFilter = 'books';
    renderCategoryAndBookControls();
    filterAndRenderLessons();
  });
  $('resetBookFilterBtn').addEventListener('click', () => {
    state.catFilter = 'ALL';
    state.bookSeriesFilter = 'ALL';
    state.bookUnitFilter = 'ALL';
    state.bookDrawerOpen = false;
    state.searchQuery = '';
    $('lessonSearchInput').value = '';
    renderCategoryAndBookControls();
    filterAndRenderLessons();
  });
})();

function filterAndRenderLessons() {
  const grid = $('lessonsGrid');
  clearEl(grid);
  const q = String(state.searchQuery || '').toLowerCase();

  const filtered = state.lessons.filter(l => {
    if (state.filter === 'ALL' && l.locked) return false; // Keep default view focused on unlocked levels; clicking a locked CEFR tab reveals preview!
    if (state.filter !== 'ALL' && l.cefr !== state.filter) return false;
    if (!lessonMatchesCat(l, state.catFilter)) return false;
    const meta = getLessonCatalogMeta(l);
    if (state.bookSeriesFilter !== 'ALL' && meta.bookSeries !== state.bookSeriesFilter) return false;
    if (state.bookUnitFilter !== 'ALL' && (meta.bookTitle + '||' + meta.unitCode) !== state.bookUnitFilter) return false;
    if (q) {
      const vocabStr = Array.isArray(meta.unitWords) ? meta.unitWords.join(' ') : '';
      const hay = [
        l.title, l.topic, l.objective || '', l.cefr,
        meta.bookSeries || '', meta.bookTitle || '', meta.unitCode || '', meta.unitTitle || '', vocabStr
      ].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });

  $('lessonsCountSummary').textContent = filtered.length + ' of ' + state.lessons.length + ' missions';

  if (!filtered.length) {
    const emptyBox = el('div', 'No speaking missions match this filter yet — try selecting "All Levels" or resetting the search filter.', 'muted');
    emptyBox.style.padding = '18px 4px';
    grid.appendChild(emptyBox);
    return;
  }

  filtered.forEach(lesson => {
    const card = el('div', '', 'card' + (lesson.locked ? ' locked-card' : ''));
    const meta = getLessonCatalogMeta(lesson);
    const onCardOpen = () => {
      if (lesson.locked) {
        showToast('Master 3 missions at your current level to unlock ' + lesson.cefr + '!');
        return;
      }
      openExercise(lesson.id);
    };

    if (typeof buildStoryCardCover === 'function') {
      const coverEl = buildStoryCardCover({ lessonId: lesson.id, title: lesson.title, topic: lesson.topic }, 'card-cover-wrap', onCardOpen);
      if (coverEl) card.appendChild(coverEl);
    }

    const topRow = el('div', '', 'meta');
    topRow.appendChild(el('span', lesson.cefr, 'lvl'));
    const catDef = CATEGORY_DEFS.find(d => d.key === (meta.cat || 'stories')) || CATEGORY_DEFS[7];
    topRow.appendChild(el('span', catDef.shortTag, 'card-cat-tag'));
    const wc = lesson.wordCount || lesson.words || 80;
    topRow.appendChild(el('span', '4 Speaking Tasks · ' + wc + 'w'));
    card.appendChild(topRow);

    card.appendChild(el('h3', lesson.title));

    if (meta.bookTitle && meta.unitCode) {
      card.appendChild(el('div', '📘 ' + meta.bookTitle + ' · ' + meta.unitCode + ': ' + meta.unitTitle, 'card-book-ribbon'));
    } else if (lesson.topic) {
      const topicSub = el('div', lesson.topic, 'muted');
      topicSub.style.fontSize = '12px';
      topicSub.style.fontWeight = '700';
      topicSub.style.marginBottom = '4px';
      card.appendChild(topicSub);
    }

    const previewWords = Array.isArray(meta.unitWords) ? meta.unitWords : [];
    if (previewWords.length) {
      const vRow = el('div', '', 'card-vocab-preview');
      vRow.appendChild(el('span', '🎯 Speak Words:', 'card-vocab-label'));
      previewWords.slice(0, 5).forEach(w => vRow.appendChild(el('span', w, 'card-vocab-chip')));
      if (previewWords.length > 5) vRow.appendChild(el('span', '+' + (previewWords.length - 5), 'card-vocab-chip'));
      card.appendChild(vRow);
    }

    const bottomRow = el('div', '', 'state');
    let badgeText = lesson.locked ? '🔒 Locked' : '🎙️ Ready';
    let badgeClass = 'new';
    if (lesson.mastered) {
      badgeText = '🌟 Mastered (' + (lesson.score || 100) + '%)' + (lesson.bestWpm ? (' · ' + lesson.bestWpm + ' WPM') : '');
      badgeClass = 'done';
    } else if (lesson.doneCount > 0) {
      badgeText = lesson.doneCount + '/' + (lesson.questionCount || 4) + ' Recorded' + (lesson.score ? (' · ' + lesson.score + '%') : '');
      badgeClass = 'prog';
    }
    bottomRow.appendChild(el('span', badgeText, 'badge ' + badgeClass));

    const openBtn = el('button', lesson.locked ? '🔒 Locked' : '🎙️ Speak →', 'btn' + (lesson.locked ? ' ghost' : ''));
    openBtn.type = 'button';
    openBtn.style.padding = '6px 12px';
    openBtn.style.fontSize = '13px';
    openBtn.addEventListener('click', onCardOpen);
    bottomRow.appendChild(openBtn);

    card.appendChild(bottomRow);
    grid.appendChild(card);
  });
}

/* =========================================================================
   GUIDED SPEAKING MISSION ENGINE & AI SPEAKING COACH
   ========================================================================= */
async function openExercise(lessonId) {
  showView('loadingView');
  $('loadingText').textContent = 'Opening Speaking Mission & AI Coach...';
  try {
    const res = await rpc('openSpeakingLesson', state.code, lessonId);
    if (!res || !res.ok || !res.lesson) throw new Error((res && res.error) || 'Could not load speaking mission.');
    const lsn = res.lesson;
    state.lesson = lsn;
    state.tasks = lsn.tasks || [];
    state.qIdx = 0;
    state.justOpenedLesson = true;

    const firstTodo = state.tasks.findIndex(t => !t.previous);
    const initIdx = firstTodo >= 0 ? firstTodo : 0;
    const initT = state.tasks[initIdx] || state.tasks[0];

    Object.assign(clientPresence, {
      stage: 'READING',
      lessonId: lsn.id,
      lessonTitle: lsn.title,
      lessonCefr: lsn.cefr,
      qIndex: initIdx + 1,
      qTotal: state.tasks.length || 4,
      qId: initT ? initT.promptId : '',
      qPrompt: initT ? initT.promptText : '',
      skill: initT ? initT.skill : ''
    });

    $('exTitle').textContent = lsn.title;
    $('exObjective').textContent = lsn.objective ? ('🎯 Speaking Goal: ' + lsn.objective) : '';
    $('exCefr').textContent = lsn.cefr;
    $('exTopic').textContent = lsn.topic;
    const wc = lsn.wordCount || 80;
    $('wordInfo').textContent = wc + ' words · 4 Speaking Tasks';

    renderPassage(lsn.passage, lsn.glossary || []);
    bindPassageSentenceSeek($('passage'), '#passage .sent', 'listenBtn', 'exVoiceBar', lsn.passage, lsn.id);
    renderStoryMediaShowcase($('exMediaShowcase'), resolveStoryMedia({
      lessonId: lsn.id, title: lsn.title, topic: lsn.topic, passage: lsn.passage
    }));
    renderVoiceBarUI($('exVoiceBar'), resolvePassageAudio(lsn.passage, lsn.id), '#passage .sent', 'listenBtn');
    renderUnitVocabBanner($('exUnitVocabBanner'), lsn);
    renderVocab(lsn.glossary || []);

    renderSpeakingTask(initIdx);
    state.justOpenedLesson = false;
    showView('exerciseView');
    sendStudentBeacon(null);
  } catch (err) {
    showView('dashboardView');
    showToast('Could not open mission: ' + err.message);
  }
}

$('backToDashBtn').addEventListener('click', () => {
  if (typeof speech !== 'undefined') speech.stop();
  stopAllRecordersAndAudio();
  showView('dashboardView');
  refreshDashboard();
});

function renderPassageInto(container, passageText, glossary) {
  clearEl(container);
  const glossMap = {};
  (glossary || []).forEach(g => { if (g && g.word) glossMap[g.word.toLowerCase()] = g.definition; });

  const paragraphs = String(passageText || '').split(/\n+/).filter(Boolean);
  let globalSentIdx = 0;

  paragraphs.forEach(par => {
    const pEl = el('p');
    const sentences = par.match(/[^.!?]+(?:[.!?]+["”’')\]]*|$)\s*/g) || [par];

    sentences.forEach(s => {
      const sTrim = s.trim();
      if (!sTrim) return;
      const sSpan = el('span', '', 'sent');
      sSpan.dataset.sentIdx = String(globalSentIdx++);

      const matchGlossHeadword = rawToken => {
        const cHyph = rawToken.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        const cPlain = rawToken.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!cPlain) return '';
        if (glossMap[cHyph]) return cHyph;
        if (glossMap[cPlain]) return cPlain;
        if (cPlain.endsWith('es') && glossMap[cPlain.slice(0, -2)]) return cPlain.slice(0, -2);
        if (cPlain.endsWith('s') && glossMap[cPlain.slice(0, -1)]) return cPlain.slice(0, -1);
        if (cPlain.endsWith('ies') && glossMap[cPlain.slice(0, -3) + 'y']) return cPlain.slice(0, -3) + 'y';
        if (cPlain.endsWith('ed') && glossMap[cPlain.slice(0, -2)]) return cPlain.slice(0, -2);
        if (cPlain.endsWith('ed') && glossMap[cPlain.slice(0, -1)]) return cPlain.slice(0, -1);
        if (cPlain.endsWith('ing') && glossMap[cPlain.slice(0, -3)]) return cPlain.slice(0, -3);
        if (cPlain.endsWith('ing') && glossMap[cPlain.slice(0, -3) + 'e']) return cPlain.slice(0, -3) + 'e';
        return '';
      };

      const words = sTrim.split(/(\s+|[.,!?;:"()]+)/);
      words.forEach(w => {
        const head = matchGlossHeadword(w);
        if (head) {
          const gSpan = el('span', w, 'gloss');
          gSpan.dataset.glossWord = head;
          gSpan.title = glossMap[head];
          gSpan.addEventListener('click', e => {
            e.stopPropagation();
            showTooltip(e.target, head, glossMap[head]);
          });
          sSpan.appendChild(gSpan);
        } else {
          sSpan.appendChild(document.createTextNode(w));
        }
      });
      pEl.appendChild(sSpan);
      pEl.appendChild(document.createTextNode(' '));
    });
    container.appendChild(pEl);
  });
}

function renderPassage(passageText, glossary) {
  renderPassageInto($('passage'), passageText, glossary);
}

let activePop = null;
function showTooltip(target, word, def) {
  if (activePop) activePop.remove();
  const pop = el('div', '', 'pop');
  pop.appendChild(el('b', word));
  pop.appendChild(el('div', def));
  document.body.appendChild(pop);
  const rect = target.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - 300, Math.max(10, rect.left + window.scrollX - 40)) + 'px';
  pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  activePop = pop;
  setTimeout(() => {
    window.addEventListener('click', function closePop() {
      pop.remove();
      window.removeEventListener('click', closePop);
    });
  }, 10);
}

function renderVocab(glossary) {
  const box = $('vocab');
  clearEl(box);
  (glossary || []).forEach(g => {
    const d = el('div');
    d.appendChild(el('b', g.word));
    d.appendChild(el('span', g.definition));
    box.appendChild(d);
  });
}

function resetMissionMicUI(task) {
  missionRec.cleanupStream().catch(() => {});
  missionRec.resetPreviewUrl();
  missionRec.ensureBars();
  const studio = $('missionMicBox');
  studio.classList.remove('recording');
  const minS = (task && task.minSeconds) || 8;
  const maxS = (task && task.maxSeconds) || 45;
  $('mRecStatus').textContent = 'Ready to speak (aim for ' + minS + '–' + maxS + 's)';
  $('mRecTimer').textContent = '0:00';
  $('mRecStartBtn').classList.remove('hidden');
  $('mRecStartBtn').disabled = false;
  $('mRecStopBtn').classList.add('hidden');
  $('mRecPlayBtn').classList.add('hidden');
  $('mRecRetryBtn').classList.add('hidden');
  $('mRecSubmitBtn').classList.add('hidden');
  $('mRecSubmitBtn').disabled = false;
  $('mRecSubmitBtn').textContent = '✨ Submit to AI Coach →';
  const prev = $('mPreviewAudio');
  prev.classList.add('hidden');
  prev.removeAttribute('src');
}

function renderTargetWordChips(targetWords, hitWords) {
  const wrap = $('targetWordsWrap');
  const row = $('targetWordsRow');
  clearEl(row);
  const words = Array.isArray(targetWords) ? targetWords.filter(Boolean) : [];
  if (!words.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const hitSet = new Set((hitWords || []).map(w => String(w).toLowerCase()));
  words.forEach(w => {
    const isHit = hitSet.has(String(w).toLowerCase());
    const chip = el('span', (isHit ? '✓ ' : '• ') + w, 'target-chip' + (isHit ? ' hit' : ''));
    row.appendChild(chip);
  });
}

function renderCoachFeedbackCard(resultObj, task) {
  const fbBox = $('feedback');
  clearEl(fbBox);
  if (!resultObj) return;

  const passed = !!resultObj.passed;
  const card = el('div', '', 'coach-card ' + (passed ? 'good' : 'retry'));

  // Header & Metrics Row
  const top = el('div', '', 'state');
  top.appendChild(el('strong', passed
    ? ('🌟 AI Speaking Coach: Great Response!' + (resultObj.pointsAwarded ? (' (+' + resultObj.pointsAwarded + ' KP)') : ''))
    : '🎙️ AI Speaking Coach: Let’s Polish This!'));
  top.appendChild(el('span', (resultObj.scorePct || 0) + '% Score', 'badge ' + (passed ? 'done' : 'prog')));
  card.appendChild(top);

  const metrics = el('div', '', 'coach-metrics');
  metrics.appendChild(el('span', '⚡ Pace: ' + (resultObj.wpm || 0) + ' WPM', 'coach-metric'));
  metrics.appendChild(el('span', '📝 Words Spoken: ' + (resultObj.wordCount || 0), 'coach-metric'));
  const hitArr = resultObj.targetWordsHit || [];
  const totTarget = (task && task.targetWords && task.targetWords.length) || 0;
  if (totTarget > 0) {
    metrics.appendChild(el('span', '🎯 Target Vocab: ' + hitArr.length + '/' + totTarget, 'coach-metric'));
  }
  card.appendChild(metrics);

  // Whisper Transcript
  const trBox = el('div', '', 'coach-transcript');
  trBox.appendChild(el('strong', '🗣️ What We Heard You Say: '));
  trBox.appendChild(el('span', resultObj.transcript ? ('“' + resultObj.transcript + '”') : '(Very quiet audio — try speaking closer to your microphone!)'));
  card.appendChild(trBox);

  // Praise & Coach Tip
  if (resultObj.praise || resultObj.coachSummary) {
    card.appendChild(el('div', '✅ ' + (resultObj.praise || resultObj.coachSummary)));
  }
  if (resultObj.coachTip) {
    card.appendChild(el('div', '💡 Next-Level Tip: ' + resultObj.coachTip, 'muted'));
  }

  // Polished Natural Rephrase
  if (resultObj.naturalRephrase) {
    const rep = el('div', '', 'coach-rephrase');
    const repHead = el('div', '', 'state');
    repHead.style.marginBottom = '4px';
    repHead.appendChild(el('strong', '✨ Polished Native-Like Way to Say It'));
    const hearRepBtn = el('button', '🔊 Hear It', 'iconBtn');
    hearRepBtn.type = 'button';
    hearRepBtn.style.fontSize = '11.5px';
    hearRepBtn.style.padding = '3px 9px';
    hearRepBtn.addEventListener('click', () => speakShortText(resultObj.naturalRephrase));
    repHead.appendChild(hearRepBtn);
    rep.appendChild(repHead);
    rep.appendChild(el('div', '“' + resultObj.naturalRephrase + '”'));
    card.appendChild(rep);
  }

  // Model Spoken Answer
  const modelAns = resultObj.modelAnswer || (task && task.modelAnswer) || '';
  if (modelAns) {
    const modWrap = el('div', '', 'state');
    modWrap.style.paddingTop = '4px';
    const hearModBtn = el('button', '🔊 Hear Example Answer', 'iconBtn');
    hearModBtn.type = 'button';
    hearModBtn.style.fontSize = '12px';
    hearModBtn.addEventListener('click', () => speakShortText(modelAns));
    modWrap.appendChild(el('span', '📖 Example: “' + modelAns + '”', 'muted'));
    modWrap.appendChild(hearModBtn);
    card.appendChild(modWrap);
  }

  fbBox.appendChild(card);

  const evText = resultObj.evidence || (task && task.evidence) || '';
  if (evText) highlightEvidence(evText);
}

function renderSpeakingTask(idx) {
  state.qIdx = idx;
  const task = state.tasks[idx];
  if (!task) return;
  $('lessonErr').textContent = '';

  //Clickable Task Dots (1..4)
  const dotsBox = $('dots');
  clearEl(dotsBox);
  state.tasks.forEach((item, i) => {
    const dot = el('div', '', 'dot');
    dot.style.cursor = 'pointer';
    if (i === idx) dot.classList.add('cur');
    if (item.previous) dot.classList.add(item.previous.passed ? 'ok' : 'no');
    dot.title = 'Task ' + (i + 1);
    dot.addEventListener('click', () => renderSpeakingTask(i));
    dotsBox.appendChild(dot);
  });

  const meta = SKILL_META[task.skill] || { label: task.skillLabel || 'Speaking Task', icon: '🎙️' };
  $('skillTag').textContent = 'Task ' + (idx + 1) + '/4 · ' + meta.icon + ' ' + (task.skillLabel || meta.label);
  $('qText').textContent = task.promptText;

  // Sentence Starter Frame
  if (task.starterFrame) {
    $('starterFrameBox').classList.remove('hidden');
    $('starterFrameText').textContent = '“' + task.starterFrame + '”';
  } else {
    $('starterFrameBox').classList.add('hidden');
  }

  clearEvidenceHighlights();
  resetMissionMicUI(task);

  if (task.previous) {
    renderTargetWordChips(task.targetWords, task.previous.targetWordsHit || []);
    renderCoachFeedbackCard(Object.assign({}, task.previous, {
      praise: task.previous.praise || task.previous.coachSummary,
      modelAnswer: task.modelAnswer,
      evidence: task.evidence
    }), task);
    $('missionMicBox').classList.add('hidden');
    $('tryAgainTaskBtn').classList.remove('hidden');
    $('nextQBtn').classList.remove('hidden');
    $('nextQBtn').textContent = idx < state.tasks.length - 1 ? 'Next Speaking Task →' : '🏁 Finish Speaking Mission →';
    if (!state.justOpenedLesson) {
      sendStudentBeacon({
        stage: 'REVIEWING', qIndex: idx + 1, qTotal: state.tasks.length || 4,
        qId: task.promptId, qPrompt: task.promptText, skill: task.skill
      });
    }
  } else {
    renderTargetWordChips(task.targetWords, []);
    clearEl($('feedback'));
    $('missionMicBox').classList.remove('hidden');
    $('tryAgainTaskBtn').classList.add('hidden');
    $('nextQBtn').classList.add('hidden');
    if (!state.justOpenedLesson) {
      sendStudentBeacon({
        stage: 'QUESTION', qIndex: idx + 1, qTotal: state.tasks.length || 4,
        qId: task.promptId, qPrompt: task.promptText, skill: task.skill
      });
    }
  }
}

$('hearPromptBtn').addEventListener('click', () => {
  const t = state.tasks[state.qIdx];
  if (t) speakShortText(t.promptText);
});
$('hearStarterBtn').addEventListener('click', () => {
  const t = state.tasks[state.qIdx];
  if (t && t.starterFrame) speakShortText(t.starterFrame.replace(/\.{2,}/g, ' '));
});
$('tryAgainTaskBtn').addEventListener('click', () => {
  const t = state.tasks[state.qIdx];
  $('missionMicBox').classList.remove('hidden');
  $('tryAgainTaskBtn').classList.add('hidden');
  resetMissionMicUI(t);
});

$('mRecStartBtn').addEventListener('click', async () => {
  if (state.busy) return;
  const task = state.tasks[state.qIdx];
  if (!task) return;
  $('lessonErr').textContent = '';
  try {
    const maxS = (task.maxSeconds || 45) + 15;
    await missionRec.start({
      maxSeconds: maxS,
      onTick: sec => {
        $('mRecTimer').textContent = formatAudioClock(sec);
      },
      onAutoStop: rec => {
        if (rec) onMissionRecordingCaptured(rec);
      }
    });
    $('missionMicBox').classList.add('recording');
    $('mRecStatus').textContent = '🔴 Recording live… Speak clearly in full sentences!';
    $('mRecStartBtn').classList.add('hidden');
    $('mRecStopBtn').classList.remove('hidden');
    $('mRecPlayBtn').classList.add('hidden');
    $('mRecRetryBtn').classList.add('hidden');
    $('mRecSubmitBtn').classList.add('hidden');
    sendStudentBeacon({ stage: 'RECORDING', qIndex: state.qIdx + 1, qId: task.promptId, qPrompt: task.promptText, skill: task.skill });
  } catch (err) {
    $('lessonErr').textContent = err.message || 'Please allow microphone access in your browser address bar.';
  }
});

function onMissionRecordingCaptured(rec) {
  $('missionMicBox').classList.remove('recording');
  $('mRecStatus').textContent = '✅ Captured ' + rec.durationSeconds + 's — Listen back or Submit to AI Coach!';
  $('mRecStopBtn').classList.add('hidden');
  $('mRecPlayBtn').classList.remove('hidden');
  $('mRecRetryBtn').classList.remove('hidden');
  $('mRecSubmitBtn').classList.remove('hidden');
  const prev = $('mPreviewAudio');
  prev.src = rec.url;
  prev.classList.remove('hidden');
}

$('mRecStopBtn').addEventListener('click', async () => {
  const rec = await missionRec.stop();
  if (rec) onMissionRecordingCaptured(rec);
});

$('mRecPlayBtn').addEventListener('click', () => {
  const prev = $('mPreviewAudio');
  if (prev && prev.src) {
    prev.currentTime = 0;
    prev.play().catch(() => {});
  }
});

$('mRecRetryBtn').addEventListener('click', () => {
  const task = state.tasks[state.qIdx];
  resetMissionMicUI(task);
});

$('mRecSubmitBtn').addEventListener('click', async () => {
  if (state.busy || !missionRec.lastBlob) return;
  const task = state.tasks[state.qIdx];
  if (!task) return;
  state.busy = true;
  $('lessonErr').textContent = '';
  $('mRecSubmitBtn').disabled = true;
  $('mRecSubmitBtn').textContent = '⏳ Transcribing & Coaching…';
  $('mRecStatus').textContent = '🤖 Whisper & AI Speaking Coach are analyzing your voice…';

  try {
    const b64 = await blobToBase64(missionRec.lastBlob);
    const res = await rpc('gradeSpeakingMissionTask', {
      auth: state.code,
      lessonId: state.lesson.id,
      promptId: task.promptId,
      base64Audio: b64,
      mimeType: missionRec.lastMime,
      durationSeconds: missionRec.lastDurationSec
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not analyze recording.');

    task.previous = {
      promptId: task.promptId,
      taskNum: task.taskNum,
      transcript: res.transcript,
      wordCount: res.wordCount,
      wpm: res.wpm,
      scorePct: res.scorePct,
      passed: res.passed,
      targetWordsHit: res.targetWordsHit || [],
      praise: res.praise,
      coachSummary: res.praise,
      coachTip: res.coachTip,
      naturalRephrase: res.naturalRephrase,
      pointsAwarded: res.pointsAwarded
    };
    if (res.modelAnswer) task.modelAnswer = res.modelAnswer;
    if (res.evidence) task.evidence = res.evidence;

    state.justOpenedLesson = true;
    renderSpeakingTask(state.qIdx);
    state.justOpenedLesson = false;
    sendStudentBeacon({ stage: 'REVIEWING', qIndex: state.qIdx + 1, qId: task.promptId });
    if (res.pointsAwarded > 0) showToast('✨ +' + res.pointsAwarded + ' Speaking KP earned!');
  } catch (err) {
    $('lessonErr').textContent = err.message || 'Could not submit speaking response.';
    $('mRecSubmitBtn').disabled = false;
    $('mRecSubmitBtn').textContent = '✨ Submit to AI Coach →';
    $('mRecStatus').textContent = 'Ready to submit — click Submit to AI Coach to retry.';
  } finally {
    state.busy = false;
  }
});

$('nextQBtn').addEventListener('click', () => {
  if (state.qIdx < state.tasks.length - 1) {
    renderSpeakingTask(state.qIdx + 1);
  } else {
    finishLesson();
  }
});

function highlightEvidence(evidenceSentence) {
  clearEvidenceHighlights();
  if (!evidenceSentence) return;
  const sents = document.querySelectorAll('#passage .sent');
  const normEv = evidenceSentence.replace(/[“”"]/g, '').toLowerCase().trim();
  for (const s of sents) {
    const normText = s.textContent.replace(/[“”"]/g, '').toLowerCase().trim();
    if (normText.includes(normEv.slice(0, 36)) || normEv.includes(normText.slice(0, 36))) {
      s.classList.add('evidence');
      s.scrollIntoView({ behavior: 'smooth', block: 'center' });
      break;
    }
  }
}
function clearEvidenceHighlights() {
  document.querySelectorAll('#passage .sent.evidence').forEach(s => s.classList.remove('evidence'));
}

function finishLesson() {
  if (typeof speech !== 'undefined') speech.stop();
  stopAllRecordersAndAudio();
  const recorded = state.tasks.filter(t => !!t.previous);
  const passedCount = recorded.filter(t => t.previous && t.previous.passed).length;
  const avgPct = recorded.length
    ? Math.round(recorded.reduce((s, t) => s + (t.previous.scorePct || 0), 0) / state.tasks.length)
    : 0;
  const avgWpm = recorded.length
    ? Math.round(recorded.reduce((s, t) => s + (t.previous.wpm || 0), 0) / recorded.length)
    : 0;
  const totalVocabHits = recorded.reduce((s, t) => s + ((t.previous.targetWordsHit && t.previous.targetWordsHit.length) || 0), 0);

  $('sumPercent').textContent = avgPct + '%';
  $('sumTitle').textContent = passedCount >= 3 ? '🌟 Mission Mastered!' : '🎙️ Great Speaking Practice!';
  $('sumSubtitle').textContent = 'You passed ' + passedCount + ' of ' + state.tasks.length + ' speaking tasks in “' + (state.lesson ? state.lesson.title : '') + '”.';
  $('sumStatsLine').textContent = '⚡ Average Pace: ' + avgWpm + ' WPM · 🎯 ' + totalVocabHits + ' Target Words Activated';
  sendStudentBeacon({ stage: 'SUMMARY' });
  showView('summaryView');
}

$('sumReviewBtn').addEventListener('click', () => {
  renderSpeakingTask(0);
  showView('exerciseView');
});
$('sumDashBtn').addEventListener('click', () => {
  showView('dashboardView');
  refreshDashboard();
});

async function refreshDashboard() {
  try {
    const data = await rpc('listSpeakingLessons', state.code);
    renderDashboard(data);
  } catch (e) {}
}

/* =========================================================================
   OFFICIAL 2-TASK SPEAKING PLACEMENT & BIWEEKLY CHECK (SCORE-SECRET WIZARD)
   ========================================================================= */
const plState = {
  attemptId: '',
  level: 'INT',
  tasks: [],
  taskIdx: 0,
  prepTimer: null,
  phase: 'READY'
};

function setPlacementStepUI(stepNum) {
  [1, 2, 3, 4, 5].forEach(n => {
    const pill = $('plStep' + n + 'Pill');
    if (!pill) return;
    pill.className = 'pl-step' + (n === stepNum ? ' on' : (n < stepNum ? ' done' : ''));
  });
  $('plPaneReady').classList.toggle('hidden', stepNum !== 1);
  $('plPaneMic').classList.toggle('hidden', stepNum !== 2);
  $('plPaneTask').classList.toggle('hidden', stepNum !== 3 && stepNum !== 4);
  $('plPaneDone').classList.toggle('hidden', stepNum !== 5);
}

$('openPlacementBtn').addEventListener('click', () => {
  if (!state.portalContext) return;
  clearInterval(plState.prepTimer);
  stopAllRecordersAndAudio();
  const prof = (state.lastDashboardData && state.lastDashboardData.profile) || {};
  plState.level = prof.assignedPack || 'INT';
  $('plPackChip').textContent = 'Pack: ' + plState.level;
  $('plStudentBadge').textContent = (prof.fullName || 'Student') + ' (#' + (prof.studentId || state.portalContext.code) + ') · ' + (prof.className || '');
  $('plErrBox').textContent = '';
  setPlacementStepUI(1);
  showView('placementView');
  sendStudentBeacon({ stage: 'PLACEMENT_CHECK', lessonTitle: 'Official 2-Task Speaking Check' });
});

$('backFromPlacementBtn').addEventListener('click', () => {
  clearInterval(plState.prepTimer);
  stopAllRecordersAndAudio();
  showView('dashboardView');
  refreshDashboard();
});

$('plStartBtn').addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  $('plStartBtn').disabled = true;
  $('plErrBox').textContent = '';
  try {
    const res = await rpc('studentStartAttempt', {
      auth: state.code,
      userAgent: navigator.userAgent
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not start official check.');
    plState.attemptId = res.attemptId;
    plState.level = res.level || plState.level;
    plState.tasks = res.tasks || [];
    plState.taskIdx = 0;
    $('plPackChip').textContent = 'Pack: ' + plState.level;

    plMicRec.ensureBars();
    $('plMicStatus').textContent = 'Click Record 5s Test below';
    $('plMicTimer').textContent = '0:05';
    $('plMicRecordBtn').classList.remove('hidden');
    $('plMicPlayBtn').classList.add('hidden');
    $('plMicRetryBtn').classList.add('hidden');
    $('plMicConfirmBtn').classList.add('hidden');
    setPlacementStepUI(2);
  } catch (err) {
    $('plErrBox').textContent = err.message || 'Could not start official check.';
  } finally {
    state.busy = false;
    $('plStartBtn').disabled = false;
  }
});

$('plMicRecordBtn').addEventListener('click', async () => {
  $('plErrBox').textContent = '';
  try {
    $('plMicRecordBtn').classList.add('hidden');
    $('plMicStatus').textContent = '🔴 Speak now for 5 seconds…';
    $('plMicStudio').classList.add('recording');
    await plMicRec.start({
      maxSeconds: 5,
      onTick: sec => { $('plMicTimer').textContent = '0:0' + Math.max(0, 5 - sec); },
      onAutoStop: rec => {
        $('plMicStudio').classList.remove('recording');
        if (rec) {
          $('plMicStatus').textContent = '✅ 5s sample captured — play back to confirm!';
          $('plMicPlayBtn').classList.remove('hidden');
          $('plMicRetryBtn').classList.remove('hidden');
          $('plMicConfirmBtn').classList.remove('hidden');
        }
      }
    });
  } catch (err) {
    $('plMicStudio').classList.remove('recording');
    $('plMicRecordBtn').classList.remove('hidden');
    $('plErrBox').textContent = err.message || 'Microphone permission denied.';
  }
});

$('plMicPlayBtn').addEventListener('click', () => {
  if (plMicRec.lastUrl) {
    if (activeAudioPlayer) { try { activeAudioPlayer.pause(); } catch (e) {} }
    activeAudioPlayer = new Audio(plMicRec.lastUrl);
    activeAudioPlayer.play().catch(() => {});
  }
});

$('plMicRetryBtn').addEventListener('click', () => {
  plMicRec.resetPreviewUrl();
  $('plMicRecordBtn').classList.remove('hidden');
  $('plMicPlayBtn').classList.add('hidden');
  $('plMicRetryBtn').classList.add('hidden');
  $('plMicConfirmBtn').classList.add('hidden');
  $('plMicTimer').textContent = '0:05';
  $('plMicStatus').textContent = 'Click Record 5s Test below';
});

$('plMicConfirmBtn').addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  $('plMicConfirmBtn').disabled = true;
  try {
    await rpc('studentConfirmMic', { auth: state.code, attemptId: plState.attemptId, passed: true });
    beginPlacementTask(0);
  } catch (err) {
    $('plErrBox').textContent = err.message;
  } finally {
    state.busy = false;
    $('plMicConfirmBtn').disabled = false;
  }
});

function formatMmSs(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

function beginPlacementTask(tIdx) {
  clearInterval(plState.prepTimer);
  plState.taskIdx = tIdx;
  const t = plState.tasks[tIdx];
  if (!t) return;
  setPlacementStepUI(tIdx === 0 ? 3 : 4);
  plTaskRec.ensureBars();
  $('plTaskStudio').classList.remove('recording');
  $('plTaskBadge').textContent = 'OFFICIAL SPEAKING TASK ' + (t.taskNumber || (tIdx + 1)) + ' OF ' + plState.tasks.length;
  const prettyType = String(t.taskType || ('Task ' + (tIdx + 1))).replace(/_/g, ' ');
  $('plTaskTitle').textContent = 'Task ' + (t.taskNumber || (tIdx + 1)) + ' — ' + prettyType.charAt(0).toUpperCase() + prettyType.slice(1);
  $('plTaskPrompt').textContent = t.promptText || t.prompt || '';
  $('plUploadBox').textContent = '';
  $('plStartRecNowBtn').classList.remove('hidden');
  $('plStartRecNowBtn').disabled = false;
  $('plFinishRecBtn').classList.add('hidden');

  let prepLeft = Number(t.preparationSeconds || t.prepSeconds || 15);
  $('plTaskPhaseLabel').textContent = '🧠 THINK & PREPARE (' + prepLeft + 's)';
  $('plTaskTimer').textContent = formatMmSs(prepLeft);

  plState.prepTimer = setInterval(() => {
    prepLeft--;
    $('plTaskTimer').textContent = formatMmSs(Math.max(0, prepLeft));
    if (prepLeft <= 0) {
      clearInterval(plState.prepTimer);
      startPlacementTaskRecording();
    }
  }, 1000);
}

$('plHearPromptBtn').addEventListener('click', () => {
  const t = plState.tasks[plState.taskIdx];
  if (t) speakShortText(t.ttsText || t.promptText || t.prompt || '');
});

$('plStartRecNowBtn').addEventListener('click', () => {
  clearInterval(plState.prepTimer);
  startPlacementTaskRecording();
});

async function startPlacementTaskRecording() {
  if (plTaskRec.recording) return;
  const t = plState.tasks[plState.taskIdx];
  if (!t) return;
  const maxSec = Number(t.maximumRecordingSeconds || t.recordSeconds || 60);
  $('plErrBox').textContent = '';
  try {
    $('plStartRecNowBtn').classList.add('hidden');
    $('plFinishRecBtn').classList.remove('hidden');
    $('plFinishRecBtn').disabled = false;
    $('plTaskStudio').classList.add('recording');
    $('plTaskPhaseLabel').textContent = '🔴 RECORDING NOW — SPEAK IN FULL SENTENCES';
    $('plTaskTimer').textContent = formatMmSs(maxSec);

    await plTaskRec.start({
      maxSeconds: maxSec,
      onTick: sec => {
        $('plTaskTimer').textContent = formatMmSs(Math.max(0, maxSec - sec));
      },
      onAutoStop: rec => {
        if (rec) uploadPlacementTaskRecording(rec);
      }
    });
  } catch (err) {
    $('plTaskStudio').classList.remove('recording');
    $('plStartRecNowBtn').classList.remove('hidden');
    $('plFinishRecBtn').classList.add('hidden');
    $('plErrBox').textContent = err.message || 'Microphone error.';
  }
}

$('plFinishRecBtn').addEventListener('click', async () => {
  $('plFinishRecBtn').disabled = true;
  const rec = await plTaskRec.stop();
  if (rec) await uploadPlacementTaskRecording(rec);
});

async function uploadPlacementTaskRecording(rec) {
  const t = plState.tasks[plState.taskIdx];
  $('plTaskStudio').classList.remove('recording');
  $('plFinishRecBtn').classList.add('hidden');
  $('plTaskPhaseLabel').textContent = '☁️ SECURELY UPLOADING YOUR RECORDING…';
  $('plUploadBox').textContent = '⏳ Saving Task ' + (plState.taskIdx + 1) + ' audio to your teacher’s folder…';
  state.busy = true;
  try {
    const b64 = await blobToBase64(rec.blob);
    const upRes = await rpc('studentUploadResponse', {
      auth: state.code,
      attemptId: plState.attemptId,
      taskNumber: t.taskNumber || (plState.taskIdx + 1),
      promptId: t.promptId,
      base64Audio: b64,
      mimeType: rec.mimeType,
      duration: rec.durationSeconds
    });
    if (!upRes || !upRes.ok) throw new Error((upRes && upRes.error) || 'Upload failed.');

    if (plState.taskIdx + 1 < plState.tasks.length) {
      beginPlacementTask(plState.taskIdx + 1);
    } else {
      $('plUploadBox').textContent = '⏳ Finalizing your official check for your teacher…';
      const finRes = await rpc('studentSubmitAttempt', {
        auth: state.code,
        attemptId: plState.attemptId
      });
      if (!finRes || !finRes.ok) throw new Error((finRes && finRes.error) || 'Could not finalize submission.');
      setPlacementStepUI(5);
    }
  } catch (err) {
    $('plErrBox').textContent = err.message || 'Could not upload recording. Click Start Recording Now to retry.';
    $('plStartRecNowBtn').classList.remove('hidden');
    $('plUploadBox').textContent = '';
  } finally {
    state.busy = false;
  }
}

$('plReturnDashBtn').addEventListener('click', () => {
  showView('dashboardView');
  refreshDashboard();
});

function fnv1aPassage(text) {
  const norm = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function normMediaTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mediaUrlPrimary(relPath) {
  const p = String(relPath || '');
  const base = p.indexOf('v2/') === 0 ? TTRL_RICH_MEDIA.cdnPrimaryV2 : TTRL_RICH_MEDIA.cdnPrimary;
  return base + '/' + p;
}
function mediaUrlFallback(relPath) {
  const p = String(relPath || '');
  const base = p.indexOf('v2/') === 0 ? TTRL_RICH_MEDIA.cdnFallbackV2 : TTRL_RICH_MEDIA.cdnFallback;
  return base + '/' + p;
}

function attachResilientImg(imgEl, relPath, altText) {
  imgEl.alt = altText || 'Story illustration';
  imgEl.decoding = 'async';
  let triedFallback = false;
  imgEl.addEventListener('error', () => {
    if (!triedFallback) {
      triedFallback = true;
      imgEl.src = mediaUrlFallback(relPath);
    }
  });
  imgEl.src = mediaUrlPrimary(relPath);
}

const TOPIC_FALLBACK_LESSONS = [
  { re: /space|planet|star|astronaut|orbit|moon/, id: 'TTRL26-045' },
  { re: /solar|energy|electricity|mirror|desert/, id: 'TTRL26-047' },
  { re: /octopus|jellyfish|deep-sea|coral|marine/, id: 'TTRL26-044' },
  { re: /robot|drone|sensor|code|gadget/, id: 'TTRL26-064' },
  { re: /cat|kitten|pet|dog|frog|ball/, id: 'TTRL26-021' },
  { re: /monkey|forest|cedar|azrou|tree|fungi/, id: 'TTRL26-037' },
  { re: /beach|sea|ocean|wave|asilah/, id: 'TTRL26-039' },
  { re: /rain|weather|storm|snow|mountain/, id: 'TTRL26-026' },
  { re: /football|soccer|match|sport|athletics/, id: 'TTRL26-031' },
  { re: /science|volcano|river|water|lab|filter/, id: 'TTRL26-035' },
  { re: /medina|market|spice|fes|craft|qarawiyyin/, id: 'TTRL26-034' },
  { re: /tea|tagine|msemen|food|picnic|fruit|kitchen/, id: 'TTRL26-028' },
  { re: /train|station|travel|bus|bike|bicycle/, id: 'TTRL26-006' },
  { re: /phone|tech|podcast|music|laptop|digital/, id: 'TTRL26-013' },
  { re: /garden|eco|plant|environment/, id: 'TTRL26-005' }
];

function resolveStoryMedia(opts) {
  const o = opts || {};
  if (o.lessonId && TTRL_RICH_MEDIA.lessons[o.lessonId]) {
    return TTRL_RICH_MEDIA.lessons[o.lessonId];
  }
  if (o.jigsawId && TTRL_RICH_MEDIA.jigsaws[o.jigsawId]) {
    return TTRL_RICH_MEDIA.jigsaws[o.jigsawId];
  }
  const nt = normMediaTitle(o.title);
  if (nt) {
    const direct = TTRL_RICH_MEDIA.titleMap[nt];
    if (direct) {
      return direct.kind === 'jigsaw' ? TTRL_RICH_MEDIA.jigsaws[direct.id] : TTRL_RICH_MEDIA.lessons[direct.id];
    }
    const keys = Object.keys(TTRL_RICH_MEDIA.titleMap);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.length >= 6 && (nt.includes(k) || k.includes(nt))) {
        const hit = TTRL_RICH_MEDIA.titleMap[k];
        return hit.kind === 'jigsaw' ? TTRL_RICH_MEDIA.jigsaws[hit.id] : TTRL_RICH_MEDIA.lessons[hit.id];
      }
    }
  }
  const hay = (String(o.title || '') + ' ' + String(o.topic || '') + ' ' + String(o.passage || '').slice(0, 200)).toLowerCase();
  for (let i = 0; i < TOPIC_FALLBACK_LESSONS.length; i++) {
    if (TOPIC_FALLBACK_LESSONS[i].re.test(hay)) {
      const fb = TTRL_RICH_MEDIA.lessons[TOPIC_FALLBACK_LESSONS[i].id];
      if (fb) return { img: fb.img, imgCap: o.title || fb.imgCap };
    }
  }
  const def = TTRL_RICH_MEDIA.lessons['TTRL26-001'];
  return def ? { img: def.img, imgCap: o.title || def.imgCap } : null;
}

function resolvePassageAudio(passageText, lessonId) {
  if (lessonId && TTRL_RICH_MEDIA.lessons[lessonId] && TTRL_RICH_MEDIA.lessons[lessonId].audio) {
    const lm = TTRL_RICH_MEDIA.lessons[lessonId];
    const pk = fnv1aPassage(passageText);
    if (TTRL_RICH_MEDIA.passageAudio[pk]) return TTRL_RICH_MEDIA.passageAudio[pk];
    return lm;
  }
  const pk = fnv1aPassage(passageText);
  return TTRL_RICH_MEDIA.passageAudio[pk] || null;
}

function renderUnitVocabBanner(bannerEl, lessonObj) {
  if (!bannerEl) return;
  clearEl(bannerEl);
  if (!lessonObj) {
    bannerEl.classList.add('hidden');
    return;
  }
  const meta = (lessonObj.id && TTRL_RICH_MEDIA.lessons[lessonObj.id]) || {};
  const glossary = Array.isArray(lessonObj.glossary) ? lessonObj.glossary : [];
  if (!glossary.length && (!meta.unitWords || !meta.unitWords.length)) {
    bannerEl.classList.add('hidden');
    return;
  }

  bannerEl.classList.remove('hidden');
  const defLookup = {};
  glossary.forEach(g => {
    if (g && g.word) defLookup[String(g.word).toLowerCase()] = g.definition || '';
  });

  if (meta.bookTitle && meta.unitCode) {
    bannerEl.appendChild(el('div', '📚 TALK TODAY COURSEBOOK COMPANION · ' + meta.bookTitle + ' · ' + meta.unitCode + ': ' + meta.unitTitle, 'unit-vocab-eyebrow'));
    bannerEl.appendChild(el('div', '🎯 Unit Vocabulary Mission — Tap any target unit word below to highlight it in the passage & view its meaning:', 'unit-vocab-sub'));
  } else {
    bannerEl.appendChild(el('div', '🔤 INTERACTIVE STORY VOCABULARY', 'unit-vocab-eyebrow'));
    bannerEl.appendChild(el('div', 'Tap any word chip below to spotlight it inside the story passage:', 'unit-vocab-sub'));
  }

  const chipsWrap = el('div', '', 'unit-vocab-chips');
  const wordList = (meta.unitWords && meta.unitWords.length)
    ? meta.unitWords
    : glossary.map(g => g.word).filter(Boolean);

  wordList.forEach(w => {
    const key = String(w).toLowerCase();
    const btn = el('button', '✨ ' + w, 'unit-vocab-btn');
    btn.type = 'button';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      chipsWrap.querySelectorAll('.unit-vocab-btn').forEach(b => b.classList.toggle('active', b === btn));
      const passageEl = $('passage');
      if (!passageEl) return;
      passageEl.querySelectorAll('.gloss.gloss-pulse').forEach(g => g.classList.remove('gloss-pulse'));
      const matches = Array.from(passageEl.querySelectorAll('.gloss')).filter(g => {
        const gw = (g.dataset.glossWord || g.textContent || '').toLowerCase();
        return gw === key || gw === key.replace(/[^a-z0-9]/g, '');
      });
      const defText = defLookup[key] || (matches[0] && matches[0].title) || ('Target vocabulary word from ' + (meta.bookTitle || 'this mission') + '.');
      if (matches.length) {
        matches.forEach(m => m.classList.add('gloss-pulse'));
        matches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        showTooltip(matches[0], w, defText);
      } else {
        showTooltip(btn, w, defText);
      }
    });
    chipsWrap.appendChild(btn);
  });

  bannerEl.appendChild(chipsWrap);
}

function buildStoryCardCover(meta, wrapCls, onOpen) {
  const media = resolveStoryMedia(meta);
  if (!media || !media.img) return null;
  const wrap = el('div', '', wrapCls || 'card-cover-wrap');
  const img = el('img', '', 'card-cover-img');
  attachResilientImg(img, media.img, meta.title || 'Story cover');
  wrap.appendChild(img);

  const badges = el('div', '', 'card-media-badges');
  if (media.voice && media.emotion) {
    const shortVoice = String(media.voice).split('·')[0].trim();
    badges.appendChild(el('span', '🎙️ ' + shortVoice + ' · ' + media.emotion, 'media-mini-pill'));
  } else if (media.parts && media.parts.A) {
    badges.appendChild(el('span', '🎭 Multi-Voice HQ Cast', 'media-mini-pill'));
  }
  if (media.video) badges.appendChild(el('span', '🎬 Video', 'media-mini-pill vid-pill'));
  if (media.meme) badges.appendChild(el('span', '😂 Meme', 'media-mini-pill meme-pill'));
  wrap.appendChild(badges);

  if (typeof onOpen === 'function') {
    wrap.addEventListener('click', onOpen);
  }
  return wrap;
}

function pauseAllStoryVideos() {
  document.querySelectorAll('video.story-video-el').forEach(v => {
    try { v.pause(); } catch (e) {}
  });
}

function renderStoryMediaShowcase(box, media) {
  if (!box) return;
  pauseAllStoryVideos();
  clearEl(box);
  if (!media || !media.img) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');

  const bar = el('div', '', 'story-showcase-bar');
  const tabsWrap = el('div', '', 'story-media-tabs');
  const toggleBtn = el('button', '▾ Hide Media', 'story-media-toggle');
  toggleBtn.type = 'button';

  const bodyWrap = el('div');
  const stage = el('div', '', 'story-stage');
  const caption = el('div', media.imgCap || '', 'story-caption');

  const availableTabs = [{ key: 'scene', label: '🖼️ Story Scene' }];
  if (media.video) availableTabs.push({ key: 'video', label: '🎬 Watch Clip' });
  if (media.meme) availableTabs.push({ key: 'meme', label: '😂 Story Meme' });

  function selectTab(tabKey) {
    pauseAllStoryVideos();
    clearEl(stage);
    stage.className = 'story-stage';
    tabsWrap.querySelectorAll('.story-media-tab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === tabKey);
    });

    if (tabKey === 'video' && media.video) {
      const vid = document.createElement('video');
      vid.className = 'story-video-el';
      vid.controls = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      vid.loop = true;
      vid.poster = mediaUrlPrimary(media.img);
      let triedFallback = false;
      vid.addEventListener('error', () => {
        if (!triedFallback) {
          triedFallback = true;
          vid.src = mediaUrlFallback(media.video);
          vid.load();
        }
      });
      vid.src = mediaUrlPrimary(media.video);
      stage.appendChild(vid);
      caption.textContent = media.videoCap || media.imgCap || '';
      vid.play().catch(() => {});
    } else if (tabKey === 'meme' && media.meme) {
      stage.classList.add('story-meme-stage');
      const mImg = el('img', '', 'story-meme-img');
      attachResilientImg(mImg, media.meme, 'Story classroom meme');
      stage.appendChild(mImg);
      caption.textContent = media.memeCap || '😂 Story Meme';
    } else {
      const sImg = el('img', '', 'story-scene-img');
      attachResilientImg(sImg, media.img, media.imgCap || 'Story scene');
      stage.appendChild(sImg);
      caption.textContent = media.imgCap || '';
    }
  }

  availableTabs.forEach(t => {
    const b = el('button', t.label, 'story-media-tab' + (t.key === 'scene' ? ' on' : ''));
    b.type = 'button';
    b.dataset.tab = t.key;
    b.addEventListener('click', () => {
      if (bodyWrap.classList.contains('hidden')) {
        bodyWrap.classList.remove('hidden');
        toggleBtn.textContent = '▾ Hide Media';
      }
      selectTab(t.key);
    });
    tabsWrap.appendChild(b);
  });

  toggleBtn.addEventListener('click', () => {
    const hideNow = !bodyWrap.classList.contains('hidden');
    if (hideNow) pauseAllStoryVideos();
    bodyWrap.classList.toggle('hidden', hideNow);
    toggleBtn.textContent = hideNow ? '▸ Show Media' : '▾ Hide Media';
  });

  bar.appendChild(tabsWrap);
  bar.appendChild(toggleBtn);
  bodyWrap.appendChild(stage);
  bodyWrap.appendChild(caption);

  box.appendChild(bar);
  box.appendChild(bodyWrap);
  selectTab('scene');
}

function formatAudioClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

function renderVoiceBarUI(barEl, audioMeta, sentSelector, btnId) {
  if (!barEl) return;
  clearEl(barEl);
  barEl.classList.remove('hidden', 'playing');

  const btn = $(btnId);
  if (btn) {
    const idleLbl = audioMeta ? '🎙️ Listen (HQ)' : '🔊 Listen';
    btn.dataset.idleLabel = idleLbl;
    if (!speech.active || speech.btnId !== btnId) btn.textContent = idleLbl;
  }

  const eq = el('span', '', 'eq-bars');
  for (let i = 0; i < 4; i++) eq.appendChild(el('i'));

  const persona = el('div', '', 'voice-persona-chip');
  persona.appendChild(eq);
  if (audioMeta) {
    persona.appendChild(el('span', '🎭 ' + audioMeta.voice + ' '));
    persona.appendChild(el('span', audioMeta.emotion + ' · HQ Neural', 'voice-emotion-tag'));
  } else {
    persona.appendChild(el('span', '🔊 Expressive Reader '));
    persona.appendChild(el('span', 'Live Voice', 'voice-emotion-tag'));
  }
  barEl.appendChild(persona);

  if (audioMeta) {
    const scrubWrap = el('div', '', 'voice-scrubber-wrap');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1000';
    slider.value = '0';
    slider.className = 'voice-scrubber';
    slider.setAttribute('aria-label', 'Audio narration progress');

    const timeEl = el('span', '0:00 / ' + formatAudioClock(audioMeta.dur || 0), 'voice-time');

    slider.addEventListener('input', () => {
      const frac = Number(slider.value) / 1000;
      if (speech.active && speech.mode === 'NEURAL' && speech.btnId === btnId && speech.audioEl.duration) {
        speech.audioEl.currentTime = frac * speech.audioEl.duration;
        speech.syncHighlightNow();
      } else {
        const targetSec = frac * (audioMeta.dur || 0);
        speech.start(sentSelector, btnId, { audioMeta, voiceBarId: barEl.id, startSec: targetSec });
      }
    });

    scrubWrap.appendChild(slider);
    scrubWrap.appendChild(timeEl);
    barEl.appendChild(scrubWrap);
    barEl.appendChild(el('div', '💡 Tip: Double-click any sentence below (or click while listening) to jump straight to that line!', 'voice-hint'));

    barEl._slider = slider;
    barEl._timeEl = timeEl;
    barEl._dur = audioMeta.dur || 0;
  }
}

function bindPassageSentenceSeek(containerEl, sentSelector, btnId, voiceBarId, passageText, lessonId) {
  if (!containerEl) return;
  const audioMeta = resolvePassageAudio(passageText, lessonId);
  if (!audioMeta || !Array.isArray(audioMeta.timings)) return;

  containerEl.querySelectorAll('.sent').forEach(span => {
    span.classList.add('clickable-sent');
    const idx = Number(span.dataset.sentIdx);
    const jumpToSentence = () => {
      const pair = audioMeta.timings[idx];
      if (!pair) return;
      const targetSec = Math.max(0, Number(pair[0]) || 0);
      if (speech.active && speech.mode === 'NEURAL' && speech.btnId === btnId) {
        speech.audioEl.currentTime = targetSec;
        speech.syncHighlightNow();
      } else {
        speech.start(sentSelector, btnId, { audioMeta, voiceBarId, startSec: targetSec });
      }
    };
    span.addEventListener('click', e => {
      if (e.target && e.target.closest('.gloss')) return;
      if (speech.active && speech.btnId === btnId) jumpToSentence();
    });
    span.addEventListener('dblclick', e => {
      if (e.target && e.target.closest('.gloss')) return;
      jumpToSentence();
    });
  });
}

function pickBestBrowserVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const en = voices.filter(v => /^en[-_]/i.test(v.lang || ''));
  if (!en.length) return null;
  const score = v => {
    const n = (v.name || '').toLowerCase();
    let s = 0;
    if (/natural|neural|online|premium|enhanced/.test(n)) s += 50;
    if (/ava|samantha|allison|aria|jenny|guy|coral|daniel|karen|moira|serena/.test(n)) s += 25;
    if (/en-us|en-gb/i.test(v.lang || '')) s += 10;
    return s;
  };
  return en.slice().sort((a, b) => score(b) - score(a))[0] || en[0];
}
if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = () => { pickBestBrowserVoice(); };
}

const speech = {
  active: false,
  mode: 'NEURAL',
  sents: [],
  idx: 0,
  btnId: 'listenBtn',
  voiceBarId: '',
  audioMeta: null,
  audioEl: new Audio(),
  rafId: 0,
  triedFallbackUrl: false,

  applyLiveRate() {
    const r = Number(settings.rate) || 1.0;
    if (this.mode === 'NEURAL' && this.audioEl) {
      this.audioEl.playbackRate = r;
      this.audioEl.preservesPitch = true;
      this.audioEl.webkitPreservesPitch = true;
    } else if (this.active && this.mode === 'WEB_SPEECH') {
      const keepIdx = this.idx;
      const keepSel = this.lastSelector;
      const keepBtn = this.btnId;
      this.stop();
      this.startWebSpeech(keepSel, keepBtn, keepIdx);
    }
  },

  start(selector, btnId, opts) {
    this.stop();
    pauseAllStoryVideos();
    const o = opts || {};
    const sel = selector || '#passage .sent';
    this.lastSelector = sel;
    this.btnId = btnId || 'listenBtn';
    this.voiceBarId = o.voiceBarId || (this.btnId === 'listenBtn' ? 'exVoiceBar' : (this.btnId === 'jListenBtn' ? 'jVoiceBar' : ''));
    this.sents = Array.from(document.querySelectorAll(sel));
    if (!this.sents.length) return;

    let meta = o.audioMeta || null;
    if (!meta) {
      if (o.passage) {
        meta = resolvePassageAudio(o.passage, o.lessonId || '');
      } else if (this.btnId === 'listenBtn' && state.lesson) {
        meta = resolvePassageAudio(state.lesson.passage, state.lesson.id);
      } else if (this.btnId === 'jListenBtn' && jStudent.data && jStudent.data.myPart) {
        meta = resolvePassageAudio(jStudent.data.myPart.passage, '');
      }
    }

    if (meta && meta.audio) {
      this.startNeural(meta, Number(o.startSec) || 0);
    } else {
      this.startWebSpeech(sel, this.btnId, 0);
    }
  },

  startNeural(meta, startSec) {
    this.mode = 'NEURAL';
    this.audioMeta = meta;
    this.active = true;
    this.idx = -1;
    this.triedFallbackUrl = false;

    const btn = $(this.btnId);
    if (btn) { btn.textContent = '⏹ Stop'; btn.classList.add('on'); }
    const bar = this.voiceBarId ? $(this.voiceBarId) : null;
    if (bar) bar.classList.add('playing');
    if (state.activeView === 'exerciseView') sendStudentBeacon({ stage: 'LISTENING' });

    const a = this.audioEl;
    a.pause();
    a.onended = () => { this.stop(); };
    a.onerror = () => {
      if (!this.active) return;
      if (!this.triedFallbackUrl) {
        this.triedFallbackUrl = true;
        a.src = mediaUrlFallback(meta.audio);
        a.playbackRate = Number(settings.rate) || 1.0;
        a.play().catch(() => this.startWebSpeech(this.lastSelector, this.btnId, 0));
      } else {
        this.startWebSpeech(this.lastSelector, this.btnId, 0);
      }
    };
    a.ontimeupdate = () => { this.syncHighlightNow(); };

    const targetUrl = mediaUrlPrimary(meta.audio);
    if (a.dataset.relPath !== meta.audio) {
      a.src = targetUrl;
      a.dataset.relPath = meta.audio;
    }
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
    a.playbackRate = Number(settings.rate) || 1.0;

    const applySeekAndPlay = () => {
      if (startSec > 0 && a.duration && startSec < a.duration) {
        a.currentTime = startSec;
      } else {
        a.currentTime = startSec > 0 ? startSec : 0;
      }
      a.playbackRate = Number(settings.rate) || 1.0;
      a.play().then(() => {
        this.loopRaf();
      }).catch(() => {
        if (this.active && !this.triedFallbackUrl) {
          this.triedFallbackUrl = true;
          a.src = mediaUrlFallback(meta.audio);
          a.play().then(() => this.loopRaf()).catch(() => this.startWebSpeech(this.lastSelector, this.btnId, 0));
        }
      });
    };

    if (a.readyState >= 1) {
      applySeekAndPlay();
    } else {
      a.addEventListener('loadedmetadata', function onMeta() {
        a.removeEventListener('loadedmetadata', onMeta);
        applySeekAndPlay();
      });
      a.load();
    }
  },

  loopRaf() {
    cancelAnimationFrame(this.rafId);
    if (!this.active || this.mode !== 'NEURAL') return;
    this.syncHighlightNow();
    this.rafId = requestAnimationFrame(() => this.loopRaf());
  },

  syncHighlightNow() {
    if (!this.active || this.mode !== 'NEURAL' || !this.audioMeta) return;
    const t = this.audioEl.currentTime || 0;
    const dur = this.audioEl.duration || this.audioMeta.dur || 1;
    const bar = this.voiceBarId ? $(this.voiceBarId) : null;
    if (bar && bar._slider && document.activeElement !== bar._slider) {
      bar._slider.value = String(Math.min(1000, Math.round((t / dur) * 1000)));
    }
    if (bar && bar._timeEl) {
      bar._timeEl.textContent = formatAudioClock(t) + ' / ' + formatAudioClock(dur);
    }

    const timings = this.audioMeta.timings || [];
    let matchIdx = -1;
    for (let i = 0; i < timings.length; i++) {
      if (t >= timings[i][0] - 0.04 && t <= timings[i][1] + 0.08) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx < 0 && timings.length) {
      for (let i = timings.length - 1; i >= 0; i--) {
        if (t >= timings[i][0]) { matchIdx = i; break; }
      }
    }
    if (matchIdx >= 0 && matchIdx < this.sents.length && matchIdx !== this.idx) {
      this.idx = matchIdx;
      document.querySelectorAll('.sent.reading').forEach(s => s.classList.remove('reading'));
      const cur = this.sents[matchIdx];
      if (cur) {
        cur.classList.add('reading');
        cur.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  },

  startWebSpeech(selector, btnId, startIdx) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    this.mode = 'WEB_SPEECH';
    this.sents = Array.from(document.querySelectorAll(selector || '#passage .sent'));
    this.idx = startIdx || 0;
    this.btnId = btnId || 'listenBtn';
    this.active = true;
    const btn = $(this.btnId);
    if (btn) { btn.textContent = '⏹ Stop'; btn.classList.add('on'); }
    const bar = this.voiceBarId ? $(this.voiceBarId) : null;
    if (bar) bar.classList.add('playing');
    if (state.activeView === 'exerciseView') sendStudentBeacon({ stage: 'LISTENING' });
    this.speakNextWeb();
  },

  speakNextWeb() {
    if (!this.active || this.mode !== 'WEB_SPEECH' || this.idx >= this.sents.length) { this.stop(); return; }
    document.querySelectorAll('.sent.reading').forEach(s => s.classList.remove('reading'));
    const cur = this.sents[this.idx];
    cur.classList.add('reading');
    cur.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const u = new SpeechSynthesisUtterance(cur.textContent);
    const bestVoice = pickBestBrowserVoice();
    if (bestVoice) u.voice = bestVoice;
    u.lang = (bestVoice && bestVoice.lang) || 'en-US';
    u.rate = Number(settings.rate) || 1.0;
    u.onend = () => { this.idx++; this.speakNextWeb(); };
    u.onerror = () => { this.stop(); };
    window.speechSynthesis.speak(u);
  },

  stop() {
    const wasActive = this.active;
    this.active = false;
    cancelAnimationFrame(this.rafId);
    try {
      this.audioEl.onended = null;
      this.audioEl.onerror = null;
      this.audioEl.ontimeupdate = null;
      this.audioEl.pause();
    } catch (e) {}
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    document.querySelectorAll('.sent.reading').forEach(s => s.classList.remove('reading'));
    document.querySelectorAll('.neural-voice-bar.playing').forEach(b => b.classList.remove('playing'));
    ['listenBtn', 'jListenBtn', 'jAssembledListen_A', 'jAssembledListen_B', 'jAssembledListen_C', 'jAssembledListen_D'].forEach(id => {
      const b = $(id);
      if (b) {
        b.textContent = b.dataset.idleLabel || '🎙️ Listen (HQ)';
        b.classList.remove('on');
      }
    });
    if (wasActive && state.activeView === 'exerciseView' && clientPresence.stage === 'LISTENING') {
      sendStudentBeacon({ stage: 'READING' });
    }
  }
};
$('listenBtn').addEventListener('click', () => {
  if (speech.active && speech.btnId === 'listenBtn') speech.stop();
  else speech.start('#passage .sent', 'listenBtn', {
    passage: (state.lesson && state.lesson.passage) || '',
    lessonId: (state.lesson && state.lesson.id) || '',
    voiceBarId: 'exVoiceBar'
  });
});

// Student 10-second live heartbeat while active in the Reading Lab
setInterval(() => {
  if (state.portalContext && state.portalContext.code && state.portalContext.code !== 'OWNER-PREVIEW' &&
      state.activeView !== 'loginView' && state.activeView !== 'teacherView' &&
      document.visibilityState === 'visible') {
    sendStudentBeacon(null);
  }
}, 10000);

// Student 12-second live Breakout Room & Group Jigsaw sync while waiting on Dashboard
setInterval(() => {
  if (state.portalContext && state.portalContext.code && state.portalContext.code !== 'OWNER-PREVIEW' &&
      state.activeView === 'dashboardView' && !state.busy &&
      document.visibilityState === 'visible') {
    rpc('studentBreakoutPoll', state.code).then(res => {
      if (res && res.ok && state.activeView === 'dashboardView') {
        if (typeof renderStudentBreakoutBanner === 'function') renderStudentBreakoutBanner(res.breakoutRoom || null);
        if (typeof renderStudentJigsawSection === 'function') renderStudentJigsawSection(res.jigsaws || []);
      }
    }).catch(() => {});
  }
}, 12000);

/* =========================================================================
   SOCRATIVE LIVE TEACHER CLASSROOM RADAR + LAB AUDIO + PLACEMENT INSPECTOR
   ========================================================================= */
const DEFAULT_TEACHER_NAMES = [
  'ADNANE', 'BETTY', 'DOUAE', 'LAMYAE', 'MERIAM', 'MOUNYA',
  'NORA', 'SAMI', 'SIMO', 'SOUHIR', 'YASSINE', 'ZINEB'
];

const teacherState = {
  loginMode: 'student',
  session: '',
  role: 'TEACHER',
  teacher: '',
  displayName: '',
  teacherFilter: 'ALL',
  classFilter: 'ALL',
  lessonFilter: 'AUTO',
  statusFilter: 'ALL',
  hideNames: false,
  hideAnswers: false,
  paused: false,
  showPlacementQueue: false,
  selectedPlacementId: '',
  selectedStudentCode: '',
  lastData: null,
  pollTimer: null,
  pollBusy: false
};

function populateTeacherSelectOptions(list) {
  const sel = $('teacherNameSelect');
  if (!sel) return;
  const prev = sel.value;
  clearEl(sel);
  const ph = el('option', 'Select your Teacher profile...');
  ph.value = '';
  sel.appendChild(ph);

  const items = (list && list.length)
    ? list
    : DEFAULT_TEACHER_NAMES.map(n => ({ key: n, label: n }));
  items.forEach(t => {
    const o = el('option', '👩‍🏫 ' + t.label);
    o.value = t.key;
    sel.appendChild(o);
  });

  const dirOpt = el('option', '👑 Director / Admin (All Classes)');
  dirOpt.value = 'DIRECTOR';
  sel.appendChild(dirOpt);
  if (prev) sel.value = prev;
}

function setLoginMode(mode) {
  teacherState.loginMode = mode === 'teacher' ? 'teacher' : 'student';
  const isT = teacherState.loginMode === 'teacher';
  $('roleStudentBtn').classList.toggle('on', !isT);
  $('roleTeacherBtn').classList.toggle('on', isT);
  $('portalStudentWrap').classList.toggle('hidden', isT);
  $('portalForm').classList.toggle('hidden', isT);
  $('otpVerifyBox').classList.add('hidden');
  $('portalSupportLink').classList.toggle('hidden', isT);
  $('portalSupportForm').classList.add('hidden');
  $('portalTeacherHead').classList.toggle('hidden', !isT);
  $('teacherLoginForm').classList.toggle('hidden', !isT);
  $('loginErr').textContent = '';
  $('subBrand').textContent = isT ? 'Class Teacher Live Speaking Radar' : 'Student Portal & AI Speaking Coach';
}

$('roleStudentBtn').addEventListener('click', () => setLoginMode('student'));
$('roleTeacherBtn').addEventListener('click', () => setLoginMode('teacher'));

$('teacherLoginForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (state.busy) return;
  const teacher = $('teacherNameSelect').value.trim();
  const email = $('teacherEmailInput').value.trim();
  $('loginErr').textContent = '';

  if (!teacher && !email) {
    $('loginErr').textContent = 'Please select your Teacher profile and enter your registered teacher email.';
    return;
  }

  state.busy = true;
  $('teacherSubmitBtn').disabled = true;
  $('portalProgBox').style.display = 'block';
  $('progBarFill').style.width = '35%';
  $('progStageLabel').textContent = '🔐 Verifying Talk Today teacher credentials & cohort lock...';

  try {
    const res = await rpc('teacherOpen', { teacher, email });
    if (!res || !res.ok) {
      $('portalProgBox').style.display = 'none';
      $('loginErr').textContent = (res && res.error) || 'Access denied. Only the assigned teacher of the class can sign in.';
      return;
    }

    $('progBarFill').style.width = '100%';
    $('progStageLabel').textContent = '✅ Live Speaking Radar unlocked!';
    setTimeout(() => { $('portalProgBox').style.display = 'none'; }, 350);

    teacherState.session = res.session;
    teacherState.role = res.role || 'TEACHER';
    teacherState.teacher = res.teacher || teacher;
    teacherState.displayName = res.displayName || teacher;
    teacherState.teacherFilter = (res.data && res.data.effectiveTeacher) || (teacherState.role === 'TEACHER' ? teacherState.teacher : 'ALL');
    teacherState.classFilter = 'ALL';
    teacherState.lessonFilter = 'AUTO';
    teacherState.statusFilter = 'ALL';
    teacherState.paused = false;

    try {
      sessionStorage.setItem('ttsl_teacher_auth', JSON.stringify({
        session: teacherState.session,
        role: teacherState.role,
        teacher: teacherState.teacher,
        displayName: teacherState.displayName
      }));
    } catch (ex) {}

    ['ptsChip', 'streakChip', 'lvlChip'].forEach(id => $(id).classList.add('hidden'));
    $('logoutBtn').classList.remove('hidden');
    $('subBrand').textContent = 'Live Speaking Radar · ' + teacherState.displayName;

    renderTeacherRadar(res.data);
    showView('teacherView');
    startTeacherPolling();
  } catch (err) {
    $('portalProgBox').style.display = 'none';
    $('loginErr').textContent = err.message || 'Could not connect to Teacher Live Radar.';
  } finally {
    state.busy = false;
    $('teacherSubmitBtn').disabled = false;
  }
});

function startTeacherPolling() {
  stopTeacherPolling();
  teacherState.pollTimer = setInterval(() => {
    if (state.activeView === 'teacherView' && teacherState.session && !teacherState.paused && document.visibilityState === 'visible') {
      pollTeacherNow(false);
    }
  }, 5000);
}
function stopTeacherPolling() {
  if (teacherState.pollTimer) {
    clearInterval(teacherState.pollTimer);
    teacherState.pollTimer = null;
  }
}

async function pollTeacherNow(manual) {
  if (!teacherState.session || teacherState.pollBusy) return;
  teacherState.pollBusy = true;
  if (manual) $('tRefreshBtn').textContent = '⏳ Syncing';
  try {
    const res = await rpc('teacherLivePoll', {
      session: teacherState.session,
      teacherFilter: teacherState.role === 'DIRECTOR' ? teacherState.teacherFilter : teacherState.teacher,
      classFilter: teacherState.classFilter,
      lessonFilter: teacherState.lessonFilter
    });
    if (!res || !res.ok) {
      if (res && res.expired) {
        stopTeacherPolling();
        teacherState.session = '';
        try { sessionStorage.removeItem('ttsl_teacher_auth'); } catch (e) {}
        $('logoutBtn').classList.add('hidden');
        setLoginMode('teacher');
        $('loginErr').textContent = res.error || 'Teacher session expired. Please sign in again.';
        showView('loginView');
      }
      return;
    }
    renderTeacherRadar(res.data);
  } catch (err) {
  } finally {
    teacherState.pollBusy = false;
    if (manual) $('tRefreshBtn').textContent = '🔄 Refresh';
  }
}

function formatAgo(sec) {
  if (sec === null || sec === undefined) return 'offline';
  if (sec < 5) return 'just now';
  if (sec < 60) return sec + 's ago';
  const m = Math.floor(sec / 60);
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ago';
}
function formatDuration(sec) {
  if (sec === null || sec === undefined || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? (m + 'm ' + (s < 10 ? '0' : '') + s + 's') : (s + 's');
}

async function playRemoteAudioDataUrl(btn, fetchFn, idleText) {
  const orig = idleText || btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Loading Audio…';
  try {
    const res = await fetchFn();
    if (!res || !res.ok || !res.dataUrl) throw new Error((res && res.error) || 'Audio recording unavailable.');
    if (activeAudioPlayer) { try { activeAudioPlayer.pause(); } catch (e) {} }
    const player = new Audio(res.dataUrl);
    activeAudioPlayer = player;
    btn.textContent = '⏹ Playing…';
    btn.disabled = false;
    player.onended = () => { btn.textContent = orig; };
    player.onerror = () => { btn.textContent = orig; showToast('Could not play audio clip.'); };
    await player.play();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = orig;
    showToast(err.message || 'Audio playback failed.');
  }
}

function renderTeacherRadar(data) {
  if (!data) return;
  teacherState.lastData = data;

  const isDir = teacherState.role === 'DIRECTOR';
  $('tHeaderName').textContent = isDir
    ? ('👑 Director Speaking Radar' + (data.effectiveTeacher && data.effectiveTeacher !== 'ALL' ? (' · ' + data.effectiveTeacher) : ''))
    : ('👩‍🏫 ' + teacherState.displayName + ' — Live Speaking Classroom');
  $('tScopeChip').textContent = isDir
    ? (data.effectiveTeacher === 'ALL' ? 'All Talk Today Classes' : ('Teacher: ' + data.effectiveTeacher))
    : ('🔒 ' + teacherState.teacher + ' Classes Only');

  $('tLiveBadge').classList.toggle('paused', teacherState.paused);
  $('tLiveBadgeText').textContent = teacherState.paused ? 'PAUSED' : 'LIVE · 5s';
  $('tPauseBtn').textContent = teacherState.paused ? '▶ Resume Live' : '⏸ Pause';
  $('tHideNamesBtn').classList.toggle('on', teacherState.hideNames);
  $('tHideNamesBtn').textContent = teacherState.hideNames ? '👁 Show Names' : '🙈 Hide Names';
  $('tHideAnswersBtn').classList.toggle('on', teacherState.hideAnswers);
  $('tHideAnswersBtn').textContent = teacherState.hideAnswers ? '🔓 Show Scores' : '🔒 Hide Scores';

  const onlineNow = (data.summary && data.summary.onlineCount) || 0;
  $('tOpenBreakoutBtn').textContent = data.activeBreakoutRoomsCount > 0
    ? ('🚪 Breakout Rooms (' + data.activeBreakoutRoomsCount + ' Active)')
    : (onlineNow > 0 ? ('🚪 Breakout Rooms (' + onlineNow + ' Online)') : '🚪 Breakout Rooms & Groups');
  $('tOpenJigsawBtn').textContent = data.activeJigsawsCount > 0
    ? ('🧩 Speaking Jigsaw (' + data.activeJigsawsCount + ' Live)')
    : '🧩 Create / Manage Jigsaw';

  const plQueue = Array.isArray(data.placementQueue) ? data.placementQueue : [];
  $('tTogglePlacementBtn').textContent = '🎧 Placement Queue (' + plQueue.length + ')';
  $('tTogglePlacementBtn').classList.toggle('on', teacherState.showPlacementQueue);

  const syncTime = new Date(data.polledAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('tLastSyncText').textContent = 'Synced at ' + syncTime + ' · Click any student row to listen to their recordings & inspect Whisper transcripts.';

  // Teacher Dropdown
  const tSel = $('tTeacherSelect');
  if (isDir) {
    tSel.classList.remove('hidden');
    clearEl(tSel);
    const allOpt = el('option', '👑 All Teachers');
    allOpt.value = 'ALL';
    tSel.appendChild(allOpt);
    (data.availableTeachers || []).forEach(t => {
      const o = el('option', '👩‍🏫 ' + t.label);
      o.value = t.key;
      tSel.appendChild(o);
    });
    tSel.value = data.effectiveTeacher || 'ALL';
  } else {
    tSel.classList.add('hidden');
  }

  // Class Cohort Dropdown
  const cSel = $('tClassSelect');
  clearEl(cSel);
  const totalEnrolledAll = (data.classes || []).reduce((acc, c) => acc + (c.studentCount || 0), 0);
  const totalLiveAll = (data.classes || []).reduce((acc, c) => acc + (c.liveCount || 0), 0);
  const allClassOpt = el('option', '📚 All My Classes (' + totalEnrolledAll + ' students' + (totalLiveAll ? ' · 🟢 ' + totalLiveAll + ' live' : '') + ')');
  allClassOpt.value = 'ALL';
  cSel.appendChild(allClassOpt);
  (data.classes || []).forEach(c => {
    const liveTag = c.liveCount > 0 ? (' · 🟢 ' + c.liveCount + ' live') : (c.idleCount > 0 ? (' · 🟡 ' + c.idleCount + ' idle') : '');
    const daysTag = c.days ? (' [' + c.days + ']') : '';
    const o = el('option', c.className + daysTag + ' (' + c.studentCount + ')' + liveTag);
    o.value = c.className;
    cSel.appendChild(o);
  });
  teacherState.classFilter = data.activeClassFilter || 'ALL';
  cSel.value = teacherState.classFilter;

  // Class Pack Pin Dropdown (visible when a specific class is selected)
  const pPackSel = $('tPinPackSelect');
  if (teacherState.classFilter && teacherState.classFilter !== 'ALL') {
    pPackSel.classList.remove('hidden');
    pPackSel.value = data.pinnedPack || '';
  } else {
    pPackSel.classList.add('hidden');
  }

  // Mission Focus Dropdown
  const lSel = $('tLessonSelect');
  clearEl(lSel);
  const autoOpt = el('option', '⚡ Auto-Follow Student’s Active Mission');
  autoOpt.value = 'AUTO';
  lSel.appendChild(autoOpt);
  (data.availableLessons || []).forEach(l => {
    const o = el('option', '📌 [' + l.cefr + '] ' + l.title);
    o.value = l.id;
    lSel.appendChild(o);
  });
  teacherState.lessonFilter = data.activeLessonFilter || 'AUTO';
  lSel.value = teacherState.lessonFilter;

  // Summary Tiles
  const sum = data.summary || {};
  $('tTileOnline').textContent = (sum.onlineCount || 0) + ' / ' + (sum.enrolledCount || 0);
  $('tTileOnlineSub').textContent = '🟢 ' + (sum.liveCount || 0) + ' active now · 🟡 ' + (sum.idleCount || 0) + ' idle';
  $('tTileReading').textContent = String(sum.readingNowCount || 0);
  $('tTileAnswering').textContent = String(sum.answeringNowCount || 0);
  $('tTileAccuracy').textContent = sum.classAccuracyToday !== null && sum.classAccuracyToday !== undefined
    ? (sum.classAccuracyToday + '%')
    : '--';
  $('tTileAccuracySub').textContent = '🎯 ' + (sum.goalMetTodayCount || 0) + ' met daily goal · ' + (sum.todayAnswersTotal || 0) + ' recordings today';

  // Status Filter Pills
  const pillsBox = $('tStatusPills');
  clearEl(pillsBox);
  [
    { key: 'ALL',    label: 'All (' + (sum.enrolledCount || 0) + ')' },
    { key: 'ONLINE', label: '🟢 Online (' + (sum.onlineCount || 0) + ')' },
    { key: 'HELP',   label: '⚠️ Needs Coaching (' + (sum.needsHelpCount || 0) + ')' }
  ].forEach(fd => {
    const p = el('button', fd.label, 'pill' + (teacherState.statusFilter === fd.key ? ' on' : ''));
    p.type = 'button';
    p.addEventListener('click', () => {
      teacherState.statusFilter = fd.key;
      renderTeacherRadar(teacherState.lastData);
    });
    pillsBox.appendChild(p);
  });

  // Trouble-Spot Banner
  const troubleBanner = $('tTroubleBanner');
  if (data.troubleSpot && !teacherState.hideAnswers) {
    const meta = SKILL_META[data.troubleSpot.skill] || { label: data.troubleSpot.skill, icon: '💡', tip: '' };
    troubleBanner.classList.remove('hidden');
    $('tTroubleText').textContent = '⚠️ Live Speaking Coaching Alert: Students need extra support on ' + meta.icon + ' ' + meta.label + ' today. Tip: ' + meta.tip;
    $('tTroubleMetric').textContent = data.troubleSpot.percent + '% (' + data.troubleSpot.correct + '/' + data.troubleSpot.attempted + ')';
  } else {
    troubleBanner.classList.add('hidden');
  }

  // Pinned Mission Breakdown
  const pinBox = $('tPinnedBox');
  if (data.pinnedLesson) {
    pinBox.classList.remove('hidden');
    $('tPinnedTitle').textContent = '📌 Pinned Speaking Mission: [' + data.pinnedLesson.cefr + '] ' + data.pinnedLesson.title;
    const pinGrid = $('tPinnedGrid');
    clearEl(pinGrid);
    (data.pinnedLesson.questions || []).forEach(pq => {
      const qCard = el('div', '', 't-qhead-card');
      const sMeta = SKILL_META[pq.skill] || { label: pq.skill, icon: '🎙️' };
      const top = el('div', '', 'state');
      top.appendChild(el('span', 'T' + pq.qNum + ' · ' + sMeta.icon + ' ' + sMeta.label));
      const pctText = teacherState.hideAnswers
        ? (pq.attemptedCount + ' recorded')
        : (pq.percentCorrect !== null ? (pq.percentCorrect + '% (' + pq.correctCount + '/' + pq.attemptedCount + ')') : '0 recorded');
      top.appendChild(el('span', pctText, 'lvl'));
      qCard.appendChild(top);
      qCard.appendChild(el('div', pq.prompt, 'muted'));
      pinGrid.appendChild(qCard);
    });
  } else {
    pinBox.classList.add('hidden');
  }

  // Placement Queue Drawer
  renderTeacherPlacementQueue(plQueue);

  // Socrative Student Speaking Matrix
  const tbody = $('tMatrixBody');
  clearEl(tbody);
  const allStudents = data.students || [];
  const visibleStudents = allStudents.filter(st => {
    if (teacherState.statusFilter === 'ONLINE') return st.presenceStatus === 'LIVE' || st.presenceStatus === 'IDLE';
    if (teacherState.statusFilter === 'HELP') return !!st.needsHelp;
    return true;
  });

  if (!visibleStudents.length) {
    const tr = el('tr');
    const td = el('td', teacherState.statusFilter === 'ONLINE'
      ? 'No students in this cohort are active right now. As soon as a student opens a mission or records audio, their row lights up live.'
      : 'No students match the current filter.', 'muted');
    td.colSpan = 7;
    td.style.textAlign = 'center';
    td.style.padding = '32px 16px';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    visibleStudents.forEach((st, rowIdx) => {
      const tr = el('tr', '', 'soc-row' +
        (st.presenceStatus === 'OFFLINE' ? ' offline' : '') +
        (teacherState.selectedStudentCode === st.code ? ' selected' : ''));

      tr.addEventListener('click', () => {
        teacherState.selectedStudentCode = (teacherState.selectedStudentCode === st.code) ? '' : st.code;
        renderTeacherRadar(teacherState.lastData);
      });

      const tdName = el('td');
      const nameWrap = el('div');
      nameWrap.style.display = 'flex';
      nameWrap.style.alignItems = 'center';
      nameWrap.style.gap = '9px';
      const dot = el('span', '', 'pres-dot ' + st.presenceStatus);
      nameWrap.appendChild(dot);

      const nameCol = el('div');
      const shownName = teacherState.hideNames ? ('Student ' + (rowIdx + 1)) : st.fullName;
      const shownCode = teacherState.hideNames ? '' : (' #' + st.code);
      const bName = el('div', shownName + shownCode);
      bName.style.fontWeight = '800';
      const subMeta = el('div', st.className + ' · ' + (st.presenceStatus === 'OFFLINE' ? 'offline' : formatAgo(st.lastSeenSecAgo)), 'muted');
      subMeta.style.fontSize = '11.5px';
      nameCol.appendChild(bName);
      nameCol.appendChild(subMeta);
      nameWrap.appendChild(nameCol);
      tdName.appendChild(nameWrap);
      tr.appendChild(tdName);

      const tdWhere = el('td');
      const wTop = el('div', '', 'soc-where-title');
      wTop.appendChild(el('span', (st.whereIcon || '🎙️') + ' ' + (st.whereTitle || 'Lobby')));
      if (st.elapsedSec && st.presenceStatus !== 'OFFLINE') {
        wTop.appendChild(el('span', '⏱ ' + formatDuration(st.elapsedSec), 'lvl'));
      }
      if (st.needsHelp && !teacherState.hideAnswers) {
        wTop.appendChild(el('span', '⚠️ ' + (st.helpReason || 'Needs coaching'), 'help-chip'));
      }
      const wSub = el('div', st.whereSub || '', 'soc-where-sub');
      tdWhere.appendChild(wTop);
      tdWhere.appendChild(wSub);
      tr.appendChild(tdWhere);

      (st.cells || []).slice(0, 4).forEach(cell => {
        const tdQ = el('td', '', 'qcol');
        let cellCls = 'soc-cell';
        let label = '—';
        if (cell.state === 'WORKING') {
          cellCls += ' WORKING';
          label = '🎙️ T' + cell.qNum;
        } else if (cell.state === 'CORRECT' || cell.state === 'WRONG') {
          if (teacherState.hideAnswers) {
            cellCls += ' HIDDEN_ANS';
            label = '🎙️ Done';
          } else if (cell.state === 'CORRECT') {
            cellCls += ' CORRECT';
            label = '✓ ' + (cell.letter || ((cell.scorePct || 0) + '%'));
          } else {
            cellCls += ' WRONG';
            label = '↻ ' + (cell.letter || ((cell.scorePct || 0) + '%'));
          }
          if (cell.activeNow) cellCls += ' active-ring';
        }
        const badge = el('span', label, cellCls);
        if (cell.prompt) badge.title = 'Task ' + cell.qNum + ': ' + cell.prompt;
        tdQ.appendChild(badge);
        tr.appendChild(tdQ);
      });

      const tdScore = el('td');
      const scTop = el('div');
      scTop.style.fontWeight = '800';
      if (st.activeLesson && st.activeLesson.answered > 0) {
        scTop.textContent = teacherState.hideAnswers
          ? (st.activeLesson.answered + '/' + st.activeLesson.total + ' recorded')
          : (st.activeLesson.correct + '/' + st.activeLesson.total + ' passed');
      } else {
        scTop.textContent = '--';
      }
      const scSub = el('div', '', 'muted');
      scSub.style.fontSize = '11.5px';
      const pacePart = st.wpm ? ('⚡ ' + st.wpm + ' WPM') : 'no WPM yet';
      const goalPart = st.todayGoalMet ? ' · 🎯 Goal met' : (' · ' + (st.todayAnswers || 0) + '/' + (st.todayGoal || 4) + ' today');
      scSub.textContent = pacePart + goalPart;
      tdScore.appendChild(scTop);
      tdScore.appendChild(scSub);
      tr.appendChild(tdScore);

      tbody.appendChild(tr);
    });
  }

  renderStudentInspector(allStudents);
}

function renderStudentInspector(allStudents) {
  const box = $('tInspectorBox');
  clearEl(box);
  if (!teacherState.selectedStudentCode) {
    box.classList.add('hidden');
    return;
  }
  const st = (allStudents || []).find(s => s.code === teacherState.selectedStudentCode);
  if (!st) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');

  const head = el('div', '', 't-bar-top');
  const titleWrap = el('div');
  const shownName = teacherState.hideNames ? 'Selected Student' : (st.fullName + ' (#' + st.code + ')');
  const hTitle = el('h2', '🔎 Live Speaking Inspector: ' + shownName);
  hTitle.style.margin = '0 0 4px';
  const hSub = el('div', st.className + ' · Home Level ' + st.homeCefr +
    (st.wpm ? (' · Avg Spoken Pace ' + st.wpm + ' WPM') : '') +
    ' · ' + (st.knowledgePoints || 0) + ' KP', 'muted');
  hSub.style.fontSize = '13px';
  titleWrap.appendChild(hTitle);
  titleWrap.appendChild(hSub);

  const headRight = el('div', '', 't-controls');
  if (st.latestAttempt && st.latestAttempt.attemptId) {
    const revBtn = el('button', '🎧 Open Official Placement (' + st.latestAttempt.level + ')', 'iconBtn');
    revBtn.type = 'button';
    revBtn.addEventListener('click', () => {
      teacherState.showPlacementQueue = true;
      $('tPlacementBox').classList.remove('hidden');
      inspectPlacementAttempt(st.latestAttempt.attemptId);
    });
    headRight.appendChild(revBtn);
  }
  const closeBtn = el('button', '✕ Close Inspector', 'iconBtn');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => {
    teacherState.selectedStudentCode = '';
    box.classList.add('hidden');
  });
  headRight.appendChild(closeBtn);
  head.appendChild(titleWrap);
  head.appendChild(headRight);
  box.appendChild(head);

  if (!st.activeLesson) {
    const emptyP = el('p', 'This student has not started a Speaking Mission yet.', 'muted');
    emptyP.style.marginTop = '12px';
    box.appendChild(emptyP);
    return;
  }

  const passageBox = el('div', '', 'tip');
  passageBox.style.marginTop = '14px';
  const pHead = el('div', '📖 Active Mission: [' + st.activeLesson.cefr + '] ' + st.activeLesson.title + ' (' + st.activeLesson.topic + ')');
  pHead.style.fontWeight = '800';
  pHead.style.marginBottom = '4px';
  passageBox.appendChild(pHead);
  passageBox.appendChild(el('div', st.activeLesson.passageExcerpt || '', 'muted'));
  box.appendChild(passageBox);

  const qGrid = el('div', '', 'inspector-qlist');
  (st.cells || []).slice(0, 4).forEach(cell => {
    const card = el('div', '', 'inspector-qitem');
    if (cell.activeNow || cell.state === 'WORKING') card.style.borderColor = 'var(--accent)';
    const sMeta = SKILL_META[cell.skill] || { label: cell.skill || 'Speaking Task', icon: '🎙️' };
    const top = el('div', '', 'state');
    top.style.marginBottom = '6px';
    top.appendChild(el('span', 'Task ' + cell.qNum + ' · ' + sMeta.icon + ' ' + sMeta.label));

    let stText = 'Not recorded';
    if (cell.state === 'WORKING') stText = '🎙️ Recording Now';
    else if (cell.state === 'CORRECT' || cell.state === 'WRONG') {
      stText = teacherState.hideAnswers
        ? '✔ Recorded'
        : ((cell.scorePct || 0) + '%' + (cell.wpm ? (' · ' + cell.wpm + ' WPM') : ''));
    }
    top.appendChild(el('span', stText, 'lvl'));
    card.appendChild(top);
    card.appendChild(el('div', cell.prompt || '', 'muted'));

    if (!teacherState.hideAnswers && cell.transcript) {
      const trDiv = el('div', '🗣️ “' + cell.transcript + '”', 'coach-transcript');
      trDiv.style.marginTop = '8px';
      card.appendChild(trDiv);
    }
    if (!teacherState.hideAnswers && cell.coachTip) {
      const tipDiv = el('div', '💡 Coach Tip: ' + cell.coachTip, 'muted');
      tipDiv.style.fontSize = '12px';
      tipDiv.style.marginTop = '4px';
      card.appendChild(tipDiv);
    }
    if (cell.audioFileId) {
      const playBtn = el('button', '▶ Play Student Recording' + (cell.duration ? (' (' + cell.duration + 's)') : ''), 'iconBtn');
      playBtn.type = 'button';
      playBtn.style.marginTop = '8px';
      playBtn.style.fontSize = '12px';
      playBtn.addEventListener('click', () => {
        playRemoteAudioDataUrl(playBtn, () => rpc('teacherPlayLabAudio', {
          session: teacherState.session,
          fileId: cell.audioFileId,
          studentCode: st.code
        }));
      });
      card.appendChild(playBtn);
    }
    qGrid.appendChild(card);
  });
  box.appendChild(qGrid);
}

/* Official Placement Queue & 5D Rubric Inspector */
function renderTeacherPlacementQueue(queue) {
  const wrap = $('tPlacementBox');
  wrap.classList.toggle('hidden', !teacherState.showPlacementQueue);
  if (!teacherState.showPlacementQueue) return;

  const listBox = $('tPlacementList');
  clearEl(listBox);
  if (!queue.length) {
    const empty = el('div', 'No Official 2-Task Speaking Placement submissions in this scope yet.', 'muted');
    empty.style.padding = '14px';
    listBox.appendChild(empty);
    return;
  }

  const tbl = el('table', '', 'soc-table');
  const thead = el('thead');
  const hr = el('tr');
  ['Student', 'Class', 'Pack', 'Submitted', 'AI / Review Status', 'Action'].forEach(h => hr.appendChild(el('th', h)));
  thead.appendChild(hr);
  tbl.appendChild(thead);

  const tb = el('tbody');
  queue.slice(0, 25).forEach(item => {
    const tr = el('tr', '', 'soc-row' + (teacherState.selectedPlacementId === item.attemptId ? ' selected' : ''));
    const shownName = teacherState.hideNames ? 'Student' : (item.fullName + ' (#' + item.studentId + ')');
    tr.appendChild(el('td', shownName));
    tr.appendChild(el('td', item.className || ''));
    tr.appendChild(el('td', item.level || 'INT'));
    tr.appendChild(el('td', item.submittedAt ? new Date(item.submittedAt).toLocaleString() : 'In progress'));
    const bandTxt = teacherState.hideAnswers
      ? (item.status || 'SUBMITTED')
      : ((item.finalBand ? ('Band: ' + item.finalBand + ' · ') : '') + (item.discrepancyStatus || item.status || ''));
    tr.appendChild(el('td', bandTxt));

    const actTd = el('td');
    const btn = el('button', '🎧 Review Audio & Rubric', 'iconBtn');
    btn.type = 'button';
    btn.style.fontSize = '12px';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      inspectPlacementAttempt(item.attemptId);
    });
    actTd.appendChild(btn);
    tr.appendChild(actTd);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  listBox.appendChild(tbl);
}

async function inspectPlacementAttempt(attemptId) {
  teacherState.selectedPlacementId = attemptId;
  const box = $('tPlacementDetailBox');
  box.classList.remove('hidden');
  clearEl(box);
  box.appendChild(el('div', '⏳ Loading official recordings, Whisper transcripts & 5D rubric…', 'muted'));

  try {
    const res = await rpc('teacherGetAttempt', { session: teacherState.session, attemptId });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not load attempt.');
    clearEl(box);
    const att = res.attempt || {};

    const top = el('div', '', 'state');
    top.appendChild(el('h3', '🎧 Official Check: ' + (att.fullName || '') + ' (#' + (att.studentId || '') + ') · Pack ' + (att.level || 'INT')));
    const closeBtn = el('button', '✕ Close', 'iconBtn');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => {
      teacherState.selectedPlacementId = '';
      box.classList.add('hidden');
    });
    top.appendChild(closeBtn);
    box.appendChild(top);

    // 5D AI Rubric Grid (Staff Only!)
    const scoreRows = Array.isArray(res.scores) ? res.scores : [];
    const avgOf = key => {
      const vals = scoreRows.map(s => Number(s[key])).filter(n => !isNaN(n));
      return vals.length ? (Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10) : '--';
    };
    const recBand = (scoreRows[0] && scoreRows[0].recommendedBand) || att.finalBand || '--';
    const rGrid = el('div', '', 'rubric-grid');
    [
      { l: 'AI Band', v: recBand },
      { l: 'Avg Total (/20)', v: avgOf('total') },
      { l: 'Task Comp.', v: avgOf('taskCompletion') },
      { l: 'Intelligibility', v: avgOf('intelligibility') },
      { l: 'Fluency', v: avgOf('fluency') },
      { l: 'Grammar', v: avgOf('grammarControl') },
      { l: 'Vocabulary', v: avgOf('vocabularyRange') }
    ].forEach(m => {
      const c = el('div', '', 'rubric-cell');
      c.appendChild(el('div', String(m.v), 'rv'));
      c.appendChild(el('div', m.l, 'rl'));
      rGrid.appendChild(c);
    });
    box.appendChild(rGrid);

    // Task 1 & Task 2 Audio + Transcripts
    const tasksWrap = el('div', '', 'inspector-qlist');
    (res.responses || []).forEach(r => {
      const tNum = r.taskNumber || r.taskSlot || 1;
      const card = el('div', '', 'inspector-qitem');
      card.appendChild(el('strong', 'Task ' + tNum + ': ' + (r.promptId || '')));
      if (r.transcript) {
        const tr = el('div', '🗣️ “' + r.transcript + '”', 'coach-transcript');
        tr.style.marginTop = '6px';
        card.appendChild(tr);
      }
      if (r.audioFileId) {
        const pBtn = el('button', '▶ Play Task ' + tNum + ' Audio (' + (r.duration || 0) + 's)', 'iconBtn');
        pBtn.type = 'button';
        pBtn.style.marginTop = '8px';
        pBtn.addEventListener('click', () => {
          playRemoteAudioDataUrl(pBtn, () => rpc('teacherPlayAudio', {
            session: teacherState.session,
            attemptId,
            fileId: r.audioFileId
          }));
        });
        card.appendChild(pBtn);
      }
      tasksWrap.appendChild(card);
    });
    box.appendChild(tasksWrap);

    // Teacher Final Band Confirmation Form
    const revRow = el('div', '', 't-controls');
    revRow.style.marginTop = '14px';
    revRow.appendChild(el('strong', 'Teacher Final Band:'));
    const bandSel = el('select', '', 't-select');
    ['PRE-A1', 'A1', 'A2', 'B1', 'B2', 'C1', 'BEG', 'INT', 'ADV'].forEach(b => {
      const o = el('option', b);
      o.value = b;
      bandSel.appendChild(o);
    });
    bandSel.value = att.finalBand || recBand || att.level || 'INT';
    if (!bandSel.value) bandSel.value = 'INT';
    const notesIn = el('input', '', 'j-input');
    notesIn.placeholder = 'Optional teacher coaching note (staff-only)...';
    notesIn.style.flex = '1';
    notesIn.value = att.reviewerNotes || '';
    const saveBtn = el('button', '💾 Confirm Band Review', 'btn');
    saveBtn.type = 'button';
    saveBtn.style.padding = '8px 14px';
    saveBtn.style.fontSize = '13px';
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const sr = await rpc('teacherSaveReview', {
          session: teacherState.session,
          attemptId,
          finalBand: bandSel.value,
          notes: notesIn.value.trim(),
          recordingUnusable: false,
          requestRetest: false
        });
        if (!sr || !sr.ok) throw new Error((sr && sr.error) || 'Could not save review.');
        showToast('✅ Official band review saved!');
        pollTeacherNow(true);
      } catch (e) {
        showToast(e.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Confirm Band Review';
      }
    });
    revRow.appendChild(bandSel);
    revRow.appendChild(notesIn);
    revRow.appendChild(saveBtn);
    box.appendChild(revRow);
  } catch (err) {
    clearEl(box);
    box.appendChild(el('div', err.message || 'Could not load attempt.', 'err'));
  }
}

$('tTogglePlacementBtn').addEventListener('click', () => {
  teacherState.showPlacementQueue = !teacherState.showPlacementQueue;
  renderTeacherRadar(teacherState.lastData);
});
$('tClosePlacementBoxBtn').addEventListener('click', () => {
  teacherState.showPlacementQueue = false;
  $('tPlacementBox').classList.add('hidden');
  $('tTogglePlacementBtn').classList.remove('on');
});
$('tPinPackSelect').addEventListener('change', async e => {
  if (!teacherState.classFilter || teacherState.classFilter === 'ALL') return;
  const pack = e.target.value || 'AUTO';
  try {
    const res = await rpc('teacherPinClassPack', {
      session: teacherState.session,
      className: teacherState.classFilter,
      pack
    });
    if (res && res.ok) showToast(pack !== 'AUTO' ? ('📌 Pinned Pack ' + pack + ' for ' + teacherState.classFilter) : '⚡ Restored Auto-Detect Pack');
  } catch (err) {
    showToast(err.message);
  }
});

$('tTeacherSelect').addEventListener('change', e => {
  teacherState.teacherFilter = e.target.value || 'ALL';
  teacherState.classFilter = 'ALL';
  teacherState.selectedStudentCode = '';
  pollTeacherNow(true);
});
$('tClassSelect').addEventListener('change', e => {
  teacherState.classFilter = e.target.value || 'ALL';
  teacherState.selectedStudentCode = '';
  pollTeacherNow(true);
});
$('tLessonSelect').addEventListener('change', e => {
  teacherState.lessonFilter = e.target.value || 'AUTO';
  pollTeacherNow(true);
});
$('tUnpinLessonBtn').addEventListener('click', () => {
  teacherState.lessonFilter = 'AUTO';
  $('tLessonSelect').value = 'AUTO';
  pollTeacherNow(true);
});
$('tHideNamesBtn').addEventListener('click', () => {
  teacherState.hideNames = !teacherState.hideNames;
  renderTeacherRadar(teacherState.lastData);
});
$('tHideAnswersBtn').addEventListener('click', () => {
  teacherState.hideAnswers = !teacherState.hideAnswers;
  renderTeacherRadar(teacherState.lastData);
});
$('tPauseBtn').addEventListener('click', () => {
  teacherState.paused = !teacherState.paused;
  renderTeacherRadar(teacherState.lastData);
  if (!teacherState.paused) pollTeacherNow(true);
});
$('tRefreshBtn').addEventListener('click', () => pollTeacherNow(true));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.activeView === 'teacherView' && teacherState.session && !teacherState.paused) {
      pollTeacherNow(false);
    } else if (state.portalContext && state.portalContext.code && state.portalContext.code !== 'OWNER-PREVIEW' && state.activeView !== 'loginView') {
      sendStudentBeacon(null);
    }
  }
});

/* =========================================================================
   COOPERATIVE JIGSAW READING ENGINE — STUDIO, LIVE BOARD & STUDENT WORKSPACE
   ========================================================================= */
const JIGSAW_PART_KEYS = ['A', 'B', 'C', 'D'];
const JIGSAW_PHASE_DEFS = [
  { key: 'AUTO', label: '⚡ Auto-Flow' },
  { key: 'EXPERT', label: '1️⃣ Expert Read' },
  { key: 'HUDDLE', label: '2️⃣ Expert Huddle' },
  { key: 'SHARE', label: '3️⃣ Team Share' },
  { key: 'SYNTHESIS', label: '4️⃣ Synthesis Quiz' },
  { key: 'REVEAL', label: '🏁 Reveal All' }
];

function makeBlankPart(idx) {
  const pk = JIGSAW_PART_KEYS[idx] || 'A';
  return {
    partKey: pk,
    title: 'Part ' + pk + ' — Expert Clue ' + (idx + 1),
    passage: '',
    glossary: [],
    speakingPrompt: 'Explain the key events, people, and details from Part ' + pk + ' in your own words.',
    fallbackClue: '',
    expertQuestions: [{
      id: 'E' + pk + '1',
      text: 'What is the most important detail in Part ' + pk + '?',
      options: ['', '', '', ''],
      correctIndex: 0,
      explanation: 'Check your Part ' + pk + ' passage carefully.'
    }]
  };
}

function makeBlankDraft() {
  return {
    title: '',
    cefr: 'A2',
    topic: 'Cooperative Speaking',
    partCount: 3,
    pacingMode: 'AUTO',
    collabMode: 'ORAL',
    parts: [makeBlankPart(0), makeBlankPart(1), makeBlankPart(2), makeBlankPart(3)],
    synthesisQuestions: ['literal', 'inference', 'vocabulary', 'evidence'].map((sk, idx) => ({
      id: 'S' + (idx + 1),
      skill: sk,
      text: '',
      options: ['', '', '', ''],
      correctIndex: 0,
      explanation: ''
    }))
  };
}

const jStudio = {
  returnView: 'teacherView',
  activeTab: 'CREATE', // 'CREATE' | 'LIST' | 'LIVE'
  role: 'TEACHER',
  teacher: '',
  availableTeachers: [],
  classes: [],
  templates: [],
  lessons: [],
  jigsaws: [],
  editingId: '',
  activePartIdx: 0,
  draft: makeBlankDraft(),
  liveJigsawId: '',
  liveData: null,
  livePollTimer: null,
  liveBusy: false,
  timerClock: null
};

const jStudent = {
  jigsawId: '',
  step: 1,
  synthIdx: 0,
  previewPart: '',
  data: null,
  pollTimer: null
};

function jigsawEditorCreds(extra) {
  const payload = Object.assign({}, extra || {});
  if (teacherState.session) payload.teacherSession = teacherState.session;
  if (state.code) payload.portalAuth = state.code;
  return payload;
}

function stopJigsawPolling() {
  if (jStudio.livePollTimer) { clearInterval(jStudio.livePollTimer); jStudio.livePollTimer = null; }
  if (jStudio.timerClock) { clearInterval(jStudio.timerClock); jStudio.timerClock = null; }
  if (jStudent.pollTimer) { clearInterval(jStudent.pollTimer); jStudent.pollTimer = null; }
  if (typeof brState !== 'undefined' && brState.pollTimer) { clearInterval(brState.pollTimer); brState.pollTimer = null; }
}

function formatTimerClock(sec) {
  if (sec === null || sec === undefined) return '';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (rem < 10 ? '0' : '') + rem;
}

async function openJigsawStudio(fromView, initialTab) {
  jStudio.returnView = fromView || (teacherState.session ? 'teacherView' : 'dashboardView');
  if (fromView === 'teacherView' && typeof brState !== 'undefined') {
    brState.teacherFilter = teacherState.teacherFilter || (teacherState.role === 'TEACHER' ? teacherState.teacher : 'ALL');
    brState.classFilter = teacherState.classFilter || 'ALL';
  }
  showView('loadingView');
  $('loadingText').textContent = initialTab === 'BREAKOUT'
    ? 'Loading Live Logged-In Students & Breakout Rooms...'
    : 'Opening Cooperative Speaking Jigsaw Studio...';
  try {
    const res = await rpc('jigsawEditorInit', jigsawEditorCreds());
    if (!res || !res.ok) {
      showView(jStudio.returnView);
      alert((res && res.error) || 'Could not open Jigsaw Studio.');
      return;
    }
    jStudio.role = res.role || 'TEACHER';
    jStudio.teacher = res.teacher || '';
    jStudio.availableTeachers = res.availableTeachers || [];
    jStudio.classes = res.classes || [];
    jStudio.templates = res.templates || [];
    jStudio.lessons = res.lessons || [];
    jStudio.jigsaws = res.jigsaws || [];

    $('jStudioRoleChip').textContent = jStudio.role === 'DIRECTOR'
      ? '👑 Admin / Director Studio'
      : ('👩‍🏫 ' + jStudio.teacher + ' Classes');

    populateJigsawStudioControls();
    if (!jStudio.draft.title && jStudio.templates.length) {
      loadDraftIntoCreator(jStudio.templates[0], '');
    } else {
      syncCreatorInputsFromDraft();
    }
    renderSavedJigsawsList();

    const defaultTab = initialTab || (jStudio.jigsaws.some(j => j.status === 'LIVE') ? 'LIVE' : 'CREATE');
    if (defaultTab === 'LIVE' && !jStudio.liveJigsawId) {
      const firstLive = jStudio.jigsaws.find(j => j.status === 'LIVE') || jStudio.jigsaws[0];
      if (firstLive) jStudio.liveJigsawId = firstLive.jigsawId;
    }
    if (defaultTab === 'BREAKOUT') {
      switchJigsawStudioTab('BREAKOUT');
    } else {
      switchJigsawStudioTab(defaultTab === 'LIVE' && jStudio.liveJigsawId ? 'LIVE' : (defaultTab === 'LIST' ? 'LIST' : 'CREATE'));
    }
    showView('jigsawStudioView');
  } catch (err) {
    showView(jStudio.returnView);
    alert('Failed to load Jigsaw Studio: ' + err.message);
  }
}

function switchJigsawStudioTab(tab) {
  jStudio.activeTab = tab;
  if ($('jTabBreakoutBtn')) $('jTabBreakoutBtn').classList.toggle('on', tab === 'BREAKOUT');
  $('jTabCreateBtn').classList.toggle('on', tab === 'CREATE');
  $('jTabListBtn').classList.toggle('on', tab === 'LIST');
  $('jTabLiveBtn').classList.toggle('on', tab === 'LIVE');
  if ($('jPaneBreakout')) $('jPaneBreakout').classList.toggle('hidden', tab !== 'BREAKOUT');
  $('jPaneCreate').classList.toggle('hidden', tab !== 'CREATE');
  $('jPaneList').classList.toggle('hidden', tab !== 'LIST');
  $('jPaneLive').classList.toggle('hidden', tab !== 'LIVE');

  if (tab === 'BREAKOUT') {
    if (jStudio.livePollTimer) { clearInterval(jStudio.livePollTimer); jStudio.livePollTimer = null; }
    if (typeof pollBreakoutWorkspace === 'function') {
      pollBreakoutWorkspace(true);
      startBreakoutPolling();
    }
  } else {
    if (typeof brState !== 'undefined' && brState.pollTimer) {
      clearInterval(brState.pollTimer);
      brState.pollTimer = null;
    }
  }

  if (tab === 'LIVE') {
    populateLiveJigsawDropdown();
    if (jStudio.liveJigsawId) {
      pollLiveJigsawBoard(true);
      startJigsawLivePolling();
    } else {
      clearEl($('jTeamsGrid'));
      $('jTeamsGrid').appendChild(el('div', 'No Jigsaw session yet! Click "🚪 Breakout Rooms & Assign" or "✨ Create / Edit Jigsaw" to launch one in seconds.', 'muted'));
    }
  } else if (tab !== 'BREAKOUT') {
    if (jStudio.livePollTimer) { clearInterval(jStudio.livePollTimer); jStudio.livePollTimer = null; }
  }
}

function populateJigsawStudioControls() {
  // 1. Templates dropdown
  const tplSel = $('jTplSelect');
  clearEl(tplSel);
  jStudio.templates.forEach((t, idx) => {
    const o = el('option', '[' + t.cefr + ' · ' + t.partCount + ' Parts] ' + t.title + ' (' + t.topic + ')');
    o.value = String(idx);
    tplSel.appendChild(o);
  });

  // 2. Convertible Lessons dropdown
  const lesSel = $('jConvLessonSelect');
  clearEl(lesSel);
  jStudio.lessons.forEach(l => {
    const o = el('option', '[' + l.cefr + '] ' + l.title + ' (' + l.topic + ')');
    o.value = l.id;
    lesSel.appendChild(o);
  });

  // 3. Target Teacher & Target Class dropdowns
  const tWrap = $('jTargetTeacherWrap');
  const tSel = $('jTargetTeacherSelect');
  clearEl(tSel);
  if (jStudio.role === 'DIRECTOR') {
    tWrap.classList.remove('hidden');
    const allT = el('option', '👑 All Teachers');
    allT.value = 'ALL';
    tSel.appendChild(allT);
    jStudio.availableTeachers.forEach(t => {
      const o = el('option', '👩‍🏫 ' + t.label);
      o.value = t.key;
      tSel.appendChild(o);
    });
    if (teacherState.teacherFilter && teacherState.teacherFilter !== 'ALL') {
      tSel.value = teacherState.teacherFilter;
    }
  } else {
    tWrap.classList.add('hidden');
    const ownOpt = el('option', jStudio.teacher);
    ownOpt.value = jStudio.teacher;
    tSel.appendChild(ownOpt);
  }
  refreshCreatorClassOptions();
}

function refreshCreatorClassOptions(preferredClass) {
  const chosenT = jStudio.role === 'DIRECTOR' ? ($('jTargetTeacherSelect').value || 'ALL') : jStudio.teacher;
  const cSel = $('jTargetClassSelect');
  const prev = preferredClass !== undefined ? preferredClass : cSel.value;
  clearEl(cSel);

  const filteredClasses = jStudio.classes.filter(c => chosenT === 'ALL' || c.teacher === chosenT);
  const allOpt = el('option', chosenT === 'ALL' ? '📚 All Enrolled Classes' : ('📚 All ' + chosenT + ' Classes'));
  allOpt.value = 'ALL';
  cSel.appendChild(allOpt);

  filteredClasses.forEach(c => {
    const o = el('option', c.className + ' (' + c.count + ' students · ' + c.cefr + ')');
    o.value = c.className;
    cSel.appendChild(o);
  });

  if (prev && Array.from(cSel.options).some(o => o.value === prev)) {
    cSel.value = prev;
  } else if (teacherState.classFilter && teacherState.classFilter !== 'ALL' && Array.from(cSel.options).some(o => o.value === teacherState.classFilter)) {
    cSel.value = teacherState.classFilter;
  } else if (filteredClasses.length === 1) {
    cSel.value = filteredClasses[0].className;
  }
}

function loadDraftIntoCreator(src, editingId, targetTeacher, targetClass) {
  jStudio.editingId = editingId || '';
  const cloned = JSON.parse(JSON.stringify(src || makeBlankDraft()));
  const pCount = Math.min(4, Math.max(2, Number(cloned.partCount) || 3));
  const fullParts = [0, 1, 2, 3].map(idx => {
    const existing = (cloned.parts || [])[idx];
    if (!existing) return makeBlankPart(idx);
    const eq0 = (existing.expertQuestions && existing.expertQuestions[0]) || makeBlankPart(idx).expertQuestions[0];
    return {
      partKey: JIGSAW_PART_KEYS[idx],
      title: existing.title || ('Part ' + JIGSAW_PART_KEYS[idx]),
      passage: existing.passage || '',
      glossary: Array.isArray(existing.glossary) ? existing.glossary : [],
      speakingPrompt: existing.speakingPrompt || '',
      fallbackClue: existing.fallbackClue || '',
      expertQuestions: [{
        id: 'E' + JIGSAW_PART_KEYS[idx] + '1',
        text: eq0.text || '',
        options: [0, 1, 2, 3].map(i => (eq0.options && eq0.options[i]) || ''),
        correctIndex: Number.isInteger(Number(eq0.correctIndex)) ? Number(eq0.correctIndex) : 0,
        explanation: eq0.explanation || ''
      }]
    };
  });
  const defSkills = ['literal', 'inference', 'vocabulary', 'evidence'];
  const fullSynth = [0, 1, 2, 3].map(idx => {
    const sq = (cloned.synthesisQuestions || [])[idx] || {};
    return {
      id: 'S' + (idx + 1),
      skill: sq.skill || defSkills[idx],
      text: sq.text || '',
      options: [0, 1, 2, 3].map(i => (sq.options && sq.options[i]) || ''),
      correctIndex: Number.isInteger(Number(sq.correctIndex)) ? Number(sq.correctIndex) : 0,
      explanation: sq.explanation || ''
    };
  });

  jStudio.draft = {
    title: cloned.title || '',
    cefr: cloned.cefr || 'A2',
    topic: cloned.topic || 'Cooperative Speaking',
    partCount: pCount,
    pacingMode: cloned.pacingMode || 'AUTO',
    collabMode: cloned.collabMode || 'ORAL',
    parts: fullParts,
    synthesisQuestions: fullSynth
  };
  jStudio.activePartIdx = 0;

  if (targetTeacher && jStudio.role === 'DIRECTOR') {
    $('jTargetTeacherSelect').value = targetTeacher;
    refreshCreatorClassOptions(targetClass || 'ALL');
  } else if (targetClass) {
    refreshCreatorClassOptions(targetClass);
  }
  syncCreatorInputsFromDraft();
}

function syncCreatorInputsFromDraft() {
  const d = jStudio.draft;
  $('jEditingBadge').textContent = jStudio.editingId
    ? ('✏️ Editing Existing Jigsaw (' + jStudio.editingId + ')')
    : '✨ Creating New Jigsaw Session';
  $('jTitleInput').value = d.title || '';
  $('jTopicInput').value = d.topic || '';
  $('jCefrSelect').value = d.cefr || 'A2';
  $('jPartCountSelect').value = String(d.partCount || 3);
  $('jPacingSelect').value = d.pacingMode || 'AUTO';
  $('jCollabSelect').value = d.collabMode || 'ORAL';
  $('jSaveMsg').textContent = '';

  renderPartEditorTabs();
  renderActivePartEditor();
  renderSynthesisEditor();
}

function renderPartEditorTabs() {
  const box = $('jPartTabs');
  clearEl(box);
  const count = Number(jStudio.draft.partCount) || 3;
  if (jStudio.activePartIdx >= count) jStudio.activePartIdx = 0;
  for (let i = 0; i < count; i++) {
    const pk = JIGSAW_PART_KEYS[i];
    const p = jStudio.draft.parts[i];
    const words = String(p.passage || '').trim().split(/\s+/).filter(Boolean).length;
    const btn = el('button', '🧩 Part ' + pk + ' (' + words + ' words)', 'part-tab' + (jStudio.activePartIdx === i ? ' on' : ''));
    btn.type = 'button';
    btn.addEventListener('click', () => {
      jStudio.activePartIdx = i;
      renderPartEditorTabs();
      renderActivePartEditor();
    });
    box.appendChild(btn);
  }
}

function renderActivePartEditor() {
  const box = $('jActivePartEditor');
  clearEl(box);
  const idx = jStudio.activePartIdx;
  const pk = JIGSAW_PART_KEYS[idx];
  const part = jStudio.draft.parts[idx];
  const eq = part.expertQuestions[0];

  const topGrid = el('div', '', 'j-form-grid');
  const fTitle = el('div', '', 'j-field');
  fTitle.appendChild(el('label', 'Part ' + pk + ' Role / Section Title'));
  const inpTitle = el('input', '', 'j-input');
  inpTitle.type = 'text';
  inpTitle.value = part.title || '';
  inpTitle.addEventListener('input', e => { part.title = e.target.value; });
  fTitle.appendChild(inpTitle);

  const fPrompt = el('div', '', 'j-field');
  fPrompt.appendChild(el('label', 'Home Team Speaking Prompt (for Part ' + pk + ' Expert)'));
  const inpPrompt = el('input', '', 'j-input');
  inpPrompt.type = 'text';
  inpPrompt.value = part.speakingPrompt || '';
  inpPrompt.addEventListener('input', e => { part.speakingPrompt = e.target.value; });
  fPrompt.appendChild(inpPrompt);
  topGrid.appendChild(fTitle);
  topGrid.appendChild(fPrompt);
  box.appendChild(topGrid);

  const fPass = el('div', '', 'j-field');
  fPass.style.marginBottom = '12px';
  const passLbl = el('label', 'Part ' + pk + ' Secret Reading Passage');
  fPass.appendChild(passLbl);
  const taPass = el('textarea', '', 'j-textarea');
  taPass.style.minHeight = '135px';
  taPass.placeholder = 'Write or paste the reading passage that ONLY Part ' + pk + ' experts will read...';
  taPass.value = part.passage || '';
  taPass.addEventListener('input', e => {
    part.passage = e.target.value;
    renderPartEditorTabs();
  });
  fPass.appendChild(taPass);
  box.appendChild(fPass);

  const midGrid = el('div', '', 'j-form-grid');
  const fGloss = el('div', '', 'j-field');
  fGloss.appendChild(el('label', 'Part ' + pk + ' Glossary (one per line: word | definition)'));
  const taGloss = el('textarea', '', 'j-textarea');
  taGloss.style.minHeight = '80px';
  taGloss.placeholder = 'courtyard | an open area inside walls\ntannery | workshop where leather is dyed';
  taGloss.value = (part.glossary || []).join('\n');
  taGloss.addEventListener('input', e => {
    part.glossary = e.target.value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  });
  fGloss.appendChild(taGloss);

  const fRescue = el('div', '', 'j-field');
  fRescue.appendChild(el('label', 'Missing-Member Rescue Clue (1–2 sentence backup clue)'));
  const taRescue = el('textarea', '', 'j-textarea');
  taRescue.style.minHeight = '80px';
  taRescue.placeholder = 'Backup summary shown ONLY if the teacher unlocks Missing-Part Clues for an incomplete team...';
  taRescue.value = part.fallbackClue || '';
  taRescue.addEventListener('input', e => { part.fallbackClue = e.target.value; });
  fRescue.appendChild(taRescue);
  midGrid.appendChild(fGloss);
  midGrid.appendChild(fRescue);
  box.appendChild(midGrid);

  // Expert Check MCQ card
  const eqCard = el('div', '', 'synth-edit-card');
  eqCard.appendChild(el('div', '✅ Part ' + pk + ' Expert Mastery Check Question (Student must pass before joining Home Team)', 'eyebrow'));
  const eqPrompt = el('input', '', 'j-input');
  eqPrompt.type = 'text';
  eqPrompt.placeholder = 'Expert Check question on Part ' + pk + '...';
  eqPrompt.value = eq.text || '';
  eqPrompt.addEventListener('input', e => { eq.text = e.target.value; });
  eqCard.appendChild(eqPrompt);

  const optGrid = el('div', '', 'j-form-grid');
  optGrid.style.marginBottom = '4px';
  ['A', 'B', 'C', 'D'].forEach((letter, oIdx) => {
    const fO = el('div', '', 'j-field');
    fO.appendChild(el('label', 'Option ' + letter));
    const inpO = el('input', '', 'j-input');
    inpO.type = 'text';
    inpO.value = eq.options[oIdx] || '';
    inpO.addEventListener('input', e => { eq.options[oIdx] = e.target.value; });
    fO.appendChild(inpO);
    optGrid.appendChild(fO);
  });
  eqCard.appendChild(optGrid);

  const keyGrid = el('div', '', 'j-form-grid');
  keyGrid.style.marginBottom = '0';
  const fKey = el('div', '', 'j-field');
  fKey.appendChild(el('label', 'Correct Option'));
  const selKey = el('select', '', 'j-input');
  ['A', 'B', 'C', 'D'].forEach((letter, oIdx) => {
    const o = el('option', 'Correct Answer: ' + letter);
    o.value = String(oIdx);
    selKey.appendChild(o);
  });
  selKey.value = String(eq.correctIndex || 0);
  selKey.addEventListener('change', e => { eq.correctIndex = Number(e.target.value); });
  fKey.appendChild(selKey);

  const fExp = el('div', '', 'j-field');
  fExp.style.gridColumn = 'span 2';
  fExp.appendChild(el('label', 'Feedback Explanation'));
  const inpExp = el('input', '', 'j-input');
  inpExp.type = 'text';
  inpExp.value = eq.explanation || '';
  inpExp.addEventListener('input', e => { eq.explanation = e.target.value; });
  fExp.appendChild(inpExp);
  keyGrid.appendChild(fKey);
  keyGrid.appendChild(fExp);
  eqCard.appendChild(keyGrid);
  box.appendChild(eqCard);
}

function renderSynthesisEditor() {
  const grid = $('jSynthEditorGrid');
  clearEl(grid);
  jStudio.draft.synthesisQuestions.forEach((sq, idx) => {
    const card = el('div', '', 'synth-edit-card');
    const head = el('div', '', 'state');
    head.appendChild(el('span', 'Synthesis S' + (idx + 1), 'eyebrow'));
    const skSel = el('select', '', 't-select');
    skSel.style.padding = '4px 8px';
    skSel.style.fontSize = '12px';
    ['literal', 'inference', 'vocabulary', 'evidence'].forEach(sk => {
      const m = SKILL_META[sk];
      const o = el('option', m.icon + ' ' + m.label);
      o.value = sk;
      skSel.appendChild(o);
    });
    skSel.value = sq.skill || 'literal';
    skSel.addEventListener('change', e => { sq.skill = e.target.value; });
    head.appendChild(skSel);
    card.appendChild(head);

    const inpQ = el('input', '', 'j-input');
    inpQ.type = 'text';
    inpQ.placeholder = 'Synthesis Question S' + (idx + 1) + ' combining multiple parts...';
    inpQ.value = sq.text || '';
    inpQ.addEventListener('input', e => { sq.text = e.target.value; });
    card.appendChild(inpQ);

    ['A', 'B', 'C', 'D'].forEach((letter, oIdx) => {
      const inpO = el('input', '', 'j-input');
      inpO.type = 'text';
      inpO.placeholder = 'Choice ' + letter;
      inpO.value = sq.options[oIdx] || '';
      inpO.addEventListener('input', e => { sq.options[oIdx] = e.target.value; });
      card.appendChild(inpO);
    });

    const bot = el('div', '', 'j-form-grid');
    bot.style.marginBottom = '0';
    const selK = el('select', '', 'j-input');
    ['A', 'B', 'C', 'D'].forEach((letter, oIdx) => {
      const o = el('option', 'Key: ' + letter);
      o.value = String(oIdx);
      selK.appendChild(o);
    });
    selK.value = String(sq.correctIndex || 0);
    selK.addEventListener('change', e => { sq.correctIndex = Number(e.target.value); });
    const inpEx = el('input', '', 'j-input');
    inpEx.type = 'text';
    inpEx.placeholder = 'Explanation after grading...';
    inpEx.value = sq.explanation || '';
    inpEx.addEventListener('input', e => { sq.explanation = e.target.value; });
    bot.appendChild(selK);
    bot.appendChild(inpEx);
    card.appendChild(bot);
    grid.appendChild(card);
  });
}

function collectDraftFromInputs() {
  jStudio.draft.title = $('jTitleInput').value.trim();
  jStudio.draft.topic = $('jTopicInput').value.trim() || 'Cooperative Speaking';
  jStudio.draft.cefr = $('jCefrSelect').value || 'A2';
  jStudio.draft.partCount = Number($('jPartCountSelect').value) || 3;
  jStudio.draft.pacingMode = $('jPacingSelect').value || 'AUTO';
  jStudio.draft.collabMode = $('jCollabSelect').value || 'ORAL';
  return {
    title: jStudio.draft.title,
    topic: jStudio.draft.topic,
    cefr: jStudio.draft.cefr,
    partCount: jStudio.draft.partCount,
    pacingMode: jStudio.draft.pacingMode,
    collabMode: jStudio.draft.collabMode,
    parts: jStudio.draft.parts.slice(0, jStudio.draft.partCount),
    synthesisQuestions: jStudio.draft.synthesisQuestions.slice(0, 4)
  };
}

async function saveJigsawSession(desiredStatus) {
  const msg = $('jSaveMsg');
  msg.style.color = 'var(--bad)';
  msg.textContent = '';
  const draft = collectDraftFromInputs();
  const targetTeacher = jStudio.role === 'DIRECTOR' ? ($('jTargetTeacherSelect').value || 'ALL') : jStudio.teacher;
  const targetClass = $('jTargetClassSelect').value || 'ALL';

  $('jSaveDraftBtn').disabled = true;
  $('jLaunchLiveBtn').disabled = true;
  msg.style.color = 'var(--accent)';
  msg.textContent = desiredStatus === 'LIVE' ? '🚀 Saving & assigning Home Teams...' : '💾 Saving draft...';

  try {
    const res = await rpc('jigsawSave', jigsawEditorCreds({
      jigsawId: jStudio.editingId,
      targetTeacher,
      targetClass,
      status: desiredStatus,
      autoAssign: true,
      draft
    }));
    if (!res || !res.ok) {
      msg.style.color = 'var(--bad)';
      msg.textContent = (res && res.error) || 'Could not save Jigsaw session.';
      return;
    }
    jStudio.editingId = res.jigsawId;
    const refreshed = await rpc('jigsawEditorInit', jigsawEditorCreds());
    if (refreshed && refreshed.ok) {
      jStudio.jigsaws = refreshed.jigsaws || [];
      renderSavedJigsawsList();
    }
    if (desiredStatus === 'LIVE') {
      jStudio.liveJigsawId = res.jigsawId;
      switchJigsawStudioTab('LIVE');
    } else {
      msg.style.color = 'var(--good)';
      msg.textContent = '✅ Saved as Draft (' + res.jigsawId + ').';
    }
  } catch (err) {
    msg.style.color = 'var(--bad)';
    msg.textContent = err.message || 'Save failed.';
  } finally {
    $('jSaveDraftBtn').disabled = false;
    $('jLaunchLiveBtn').disabled = false;
  }
}

function renderSavedJigsawsList() {
  const grid = $('jSavedListGrid');
  clearEl(grid);
  if (!jStudio.jigsaws.length) {
    grid.appendChild(el('div', 'No Jigsaw sessions saved yet. Use the Create tab to launch one in 1 click!', 'muted'));
    return;
  }
  jStudio.jigsaws.forEach(j => {
    const card = el('div', '', 'jigsaw-card');
    const coverEl = buildStoryCardCover({ jigsawId: j.jigsawId, title: j.title, topic: j.topic }, 'jigsaw-cover-wrap', () => {
      jStudio.liveJigsawId = j.jigsawId;
      switchJigsawStudioTab('LIVE');
    });
    if (coverEl) card.appendChild(coverEl);
    const top = el('div', '', 'state');
    top.appendChild(el('span', '[' + j.cefr + '] ' + j.partCount + ' Parts', 'lvl'));
    const stCls = j.status === 'LIVE' ? 'done' : (j.status === 'PAUSED' ? 'prog' : 'new');
    top.appendChild(el('span', (j.status === 'LIVE' ? '🟢 LIVE' : j.status), 'badge ' + stCls));
    card.appendChild(top);

    card.appendChild(el('h3', j.title));
    const clsLbl = j.className === 'ALL' ? 'All Classes' : (j.className === 'BREAKOUT_GROUPS' ? '🚪 Breakout Groups' : j.className);
    card.appendChild(el('div', '📚 ' + clsLbl + ' · 👥 ' + j.assignedCount + ' assigned · 🏁 ' + j.completedCount + ' finished', 'muted'));

    const actions = el('div', '', 't-controls');
    actions.style.marginTop = 'auto';

    const liveBtn = el('button', '📡 Live Board', 'btn');
    liveBtn.type = 'button';
    liveBtn.style.padding = '6px 12px';
    liveBtn.style.fontSize = '12.5px';
    liveBtn.addEventListener('click', () => {
      jStudio.liveJigsawId = j.jigsawId;
      switchJigsawStudioTab('LIVE');
    });
    actions.appendChild(liveBtn);

    const editBtn = el('button', '✏️ Edit', 'iconBtn');
    editBtn.type = 'button';
    editBtn.style.fontSize = '12.5px';
    editBtn.addEventListener('click', () => {
      loadDraftIntoCreator(j, j.jigsawId, j.teacher, j.className);
      switchJigsawStudioTab('CREATE');
    });
    actions.appendChild(editBtn);

    const toggleSt = j.status === 'LIVE' ? 'PAUSED' : 'LIVE';
    const stBtn = el('button', j.status === 'LIVE' ? '⏸ Pause' : '🚀 Go Live', 'iconBtn');
    stBtn.type = 'button';
    stBtn.style.fontSize = '12.5px';
    stBtn.addEventListener('click', async () => {
      await rpc('jigsawControlAction', jigsawEditorCreds({ jigsawId: j.jigsawId, action: 'SET_STATUS', status: toggleSt }));
      const ref = await rpc('jigsawEditorInit', jigsawEditorCreds());
      if (ref && ref.ok) { jStudio.jigsaws = ref.jigsaws || []; renderSavedJigsawsList(); }
    });
    actions.appendChild(stBtn);

    if (state.portalContext && state.portalContext.code === 'OWNER-PREVIEW') {
      const prevBtn = el('button', '👁 Preview', 'iconBtn');
      prevBtn.type = 'button';
      prevBtn.style.fontSize = '12.5px';
      prevBtn.addEventListener('click', () => openStudentJigsaw(j.jigsawId));
      actions.appendChild(prevBtn);
    }

    const archBtn = el('button', '🗑', 'iconBtn');
    archBtn.type = 'button';
    archBtn.title = 'Archive Jigsaw';
    archBtn.style.fontSize = '12.5px';
    archBtn.addEventListener('click', async () => {
      if (!confirm('Archive "' + j.title + '"?')) return;
      await rpc('jigsawControlAction', jigsawEditorCreds({ jigsawId: j.jigsawId, action: 'SET_STATUS', status: 'ARCHIVED' }));
      const ref = await rpc('jigsawEditorInit', jigsawEditorCreds());
      if (ref && ref.ok) { jStudio.jigsaws = ref.jigsaws || []; renderSavedJigsawsList(); }
    });
    actions.appendChild(archBtn);

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

function populateLiveJigsawDropdown() {
  const sel = $('jLiveSelect');
  clearEl(sel);
  if (!jStudio.jigsaws.length) {
    const o = el('option', 'No Jigsaw sessions created yet');
    o.value = '';
    sel.appendChild(o);
    return;
  }
  jStudio.jigsaws.forEach(j => {
    const scopeShort = j.className === 'ALL' ? 'All' : (j.className === 'BREAKOUT_GROUPS' ? 'Breakout Groups' : j.className);
    const o = el('option', (j.status === 'LIVE' ? '🟢 ' : '📝 ') + '[' + j.cefr + '] ' + j.title + ' (' + scopeShort + ')');
    o.value = j.jigsawId;
    sel.appendChild(o);
  });
  if (!jStudio.liveJigsawId || !jStudio.jigsaws.some(j => j.jigsawId === jStudio.liveJigsawId)) {
    jStudio.liveJigsawId = jStudio.jigsaws[0].jigsawId;
  }
  sel.value = jStudio.liveJigsawId;
}

function startJigsawLivePolling() {
  if (jStudio.livePollTimer) clearInterval(jStudio.livePollTimer);
  jStudio.livePollTimer = setInterval(() => {
    if (state.activeView === 'jigsawStudioView' && jStudio.activeTab === 'LIVE' && jStudio.liveJigsawId && document.visibilityState === 'visible') {
      pollLiveJigsawBoard(false);
    }
  }, 5000);
}

async function pollLiveJigsawBoard(manual) {
  if (!jStudio.liveJigsawId || jStudio.liveBusy) return;
  jStudio.liveBusy = true;
  if (manual) $('jLiveRefreshBtn').textContent = '⏳ Syncing';
  try {
    const res = await rpc('jigsawTeacherLive', jigsawEditorCreds({ jigsawId: jStudio.liveJigsawId }));
    if (res && res.ok) renderLiveJigsawBoard(res);
  } catch (e) {} finally {
    jStudio.liveBusy = false;
    if (manual) $('jLiveRefreshBtn').textContent = '🔄 Refresh';
  }
}

async function runLiveJigsawAction(actionPayload) {
  if (!jStudio.liveJigsawId) return;
  try {
    const res = await rpc('jigsawControlAction', jigsawEditorCreds(Object.assign({ jigsawId: jStudio.liveJigsawId }, actionPayload)));
    if (res && res.ok) renderLiveJigsawBoard(res);
  } catch (err) {
    alert(err.message || 'Control action failed.');
  }
}

function renderLiveJigsawBoard(data) {
  jStudio.liveData = data;
  const j = data.jigsaw;
  const sum = data.summary || {};

  $('jLiveStatusPill').classList.toggle('paused', j.status !== 'LIVE');
  $('jLiveStatusText').textContent = j.status === 'LIVE' ? 'LIVE · 5s' : j.status;

  if (jStudio.timerClock) clearInterval(jStudio.timerClock);
  if (j.timerRemainingSec !== null && j.timerRemainingSec > 0) {
    let rem = j.timerRemainingSec;
    $('jLiveTimerChip').textContent = '⏱ ' + formatTimerClock(rem);
    jStudio.timerClock = setInterval(() => {
      rem = Math.max(0, rem - 1);
      $('jLiveTimerChip').textContent = rem > 0 ? ('⏱ ' + formatTimerClock(rem)) : '⏰ Time is up!';
    }, 1000);
  } else {
    $('jLiveTimerChip').textContent = '⏱ No timer';
  }

  $('jToggleRescueBtn').classList.toggle('on', !!j.missingCluesOpen);
  $('jToggleRescueBtn').textContent = j.missingCluesOpen ? '🆘 Rescue Clues: ON' : '🆘 Missing-Part Clues';
  $('jToggleCollabBtn').textContent = j.collabMode === 'CLUE_BOARD' ? '💬 Clue-Board Mode' : '🗣️ Oral Speaking Mode';

  // Phase bar
  const pBar = $('jPhaseBar');
  clearEl(pBar);
  JIGSAW_PHASE_DEFS.forEach(pd => {
    const b = el('button', pd.label, 'phase-btn' + (j.currentPhase === pd.key ? ' on' : ''));
    b.type = 'button';
    b.addEventListener('click', () => runLiveJigsawAction({ action: 'SET_PHASE', phase: pd.key }));
    pBar.appendChild(b);
  });

  // Summary tiles
  $('jTileOnline').textContent = (sum.onlineCount || 0) + ' / ' + (sum.cohortCount || 0);
  $('jTileExperts').textContent = String(sum.expertsReadyCount || 0);
  $('jTileClues').textContent = String(sum.notesSubmittedCount || 0);
  $('jTileSynthAcc').textContent = sum.classSynthesisAccuracy !== null && sum.classSynthesisAccuracy !== undefined
    ? (sum.classSynthesisAccuracy + '%')
    : '--';
  $('jTileSynthSub').textContent = '🏁 ' + (sum.synthCompletedCount || 0) + ' finished Synthesis Quiz';

  // Home Team / Breakout Room Cards
  const teamLabelByNum = {};
  (data.teams || []).forEach(tm => {
    if (tm && tm.teamNumber) teamLabelByNum[tm.teamNumber] = tm.roomName || ('Home Team ' + tm.teamNumber);
  });
  const tGrid = $('jTeamsGrid');
  clearEl(tGrid);
  if (!data.teams || !data.teams.length) {
    tGrid.appendChild(el('div', 'No students assigned to teams yet. Use "🚪 Breakout Rooms & Assign" or click "🎲 Assign All Roster"!', 'muted'));
  } else {
    data.teams.forEach(team => {
      const hasGap = team.missingParts && team.missingParts.length > 0;
      const card = el('div', '', 'team-card' + (hasGap ? ' warn' : ''));
      const head = el('div', '', 'state');
      const rTitle = team.roomName || ('Home Team ' + team.teamNumber);
      head.appendChild(el('strong', '🚪 ' + rTitle + ' (' + team.onlineMembers + '/' + team.memberCount + ' online)'));
      head.appendChild(el('span', team.teamAccuracy !== null ? (team.teamAccuracy + '%') : 'In Progress', 'lvl'));
      card.appendChild(head);

      if (hasGap) {
        card.appendChild(el('div', '⚠️ Missing Part ' + team.missingParts.join(', ') + ' — click Balance Online or Missing-Part Clues', 'help-chip'));
      }

      team.members.forEach((m, mIdx) => {
        const row = el('div', '', 'team-member-row');
        const left = el('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '7px';
        left.appendChild(el('span', '', 'pres-dot ' + m.presenceStatus));
        const shown = teacherState.hideNames ? ('Member ' + (mIdx + 1)) : m.fullName;
        left.appendChild(el('span', shown));
        row.appendChild(left);

        const right = el('span', 'Part ' + m.partKey + (m.expertDone ? ' ✅' : ' 📖'), 'part-badge');
        row.appendChild(right);
        card.appendChild(row);
      });
      tGrid.appendChild(card);
    });
  }

  // Socrative Synthesis Matrix + Manual Team/Part Reassignment
  const tbody = $('jLiveMatrixBody');
  clearEl(tbody);
  const validParts = JIGSAW_PART_KEYS.slice(0, j.partCount || 3);
  const maxTeams = Math.max(6, (data.teams ? data.teams.length : 0) + 2);

  (data.students || []).forEach((st, idx) => {
    const tr = el('tr', '', 'soc-row' + (st.presenceStatus === 'OFFLINE' ? ' offline' : ''));
    const tdName = el('td');
    const nw = el('div');
    nw.style.display = 'flex';
    nw.style.alignItems = 'center';
    nw.style.gap = '8px';
    nw.appendChild(el('span', '', 'pres-dot ' + st.presenceStatus));
    const shownName = teacherState.hideNames ? ('Student ' + (idx + 1)) : (st.fullName + ' #' + st.code);
    nw.appendChild(el('strong', shownName));
    tdName.appendChild(nw);
    tr.appendChild(tdName);

    // Inline Team # & Part A..D selectors
    const tdAssign = el('td');
    const aWrap = el('div', '', 't-controls');
    const selTeam = el('select', '', 't-select');
    selTeam.style.padding = '4px 8px';
    selTeam.style.fontSize = '12px';
    const unOpt = el('option', 'Unassigned');
    unOpt.value = '0';
    selTeam.appendChild(unOpt);
    for (let tn = 1; tn <= maxTeams; tn++) {
      const o = el('option', teamLabelByNum[tn] || ('Team ' + tn));
      o.value = String(tn);
      selTeam.appendChild(o);
    }
    selTeam.value = String(st.teamNumber || 0);

    const selPart = el('select', '', 't-select');
    selPart.style.padding = '4px 8px';
    selPart.style.fontSize = '12px';
    validParts.forEach(pk => {
      const o = el('option', 'Part ' + pk);
      o.value = pk;
      selPart.appendChild(o);
    });
    selPart.value = st.partKey || 'A';

    const onReassign = () => {
      const tVal = Number(selTeam.value) || 1;
      const pVal = selPart.value || 'A';
      runLiveJigsawAction({ action: 'ASSIGN_STUDENT', studentCode: st.code, teamNumber: tVal, partKey: pVal });
    };
    selTeam.addEventListener('change', onReassign);
    selPart.addEventListener('change', onReassign);
    aWrap.appendChild(selTeam);
    aWrap.appendChild(selPart);
    tdAssign.appendChild(aWrap);
    tr.appendChild(tdAssign);

    const tdStage = el('td');
    tdStage.appendChild(el('div', st.stageLabel, 'soc-where-title'));
    if (st.expertNote && !teacherState.hideAnswers) {
      tdStage.appendChild(el('div', '💬 "' + st.expertNote + '"', 'soc-where-sub'));
    }
    tr.appendChild(tdStage);

    (st.cells || []).slice(0, 4).forEach(cell => {
      const tdQ = el('td', '', 'qcol');
      let cls = 'soc-cell';
      let lbl = '—';
      if (cell.state === 'WORKING') { cls += ' WORKING'; lbl = '✍️ S' + cell.qNum; }
      else if (cell.state === 'CORRECT' || cell.state === 'WRONG') {
        if (teacherState.hideAnswers) { cls += ' HIDDEN_ANS'; lbl = '✔'; }
        else if (cell.state === 'CORRECT') { cls += ' CORRECT'; lbl = '✓ ' + cell.letter; }
        else { cls += ' WRONG'; lbl = '✗ ' + cell.letter; }
      }
      tdQ.appendChild(el('span', lbl, cls));
      tr.appendChild(tdQ);
    });

    tbody.appendChild(tr);
  });
}

/* =========================================================================
   STUDENT 4-STEP COOPERATIVE JIGSAW WORKSPACE
   ========================================================================= */
function renderStudentJigsawSection(jigsaws) {
  const sec = $('jigsawDashSection');
  const grid = $('jigsawDashGrid');
  if (!sec || !grid) return;
  clearEl(grid);
  const list = Array.isArray(jigsaws) ? jigsaws : [];
  if (!list.length) {
    sec.classList.add('hidden');
    return;
  }
  sec.classList.remove('hidden');

  list.forEach(j => {
    const card = el('div', '', 'jigsaw-card');
    const coverEl = buildStoryCardCover({ jigsawId: j.jigsawId, title: j.title, topic: j.topic }, 'jigsaw-cover-wrap', () => openStudentJigsaw(j.jigsawId));
    if (coverEl) card.appendChild(coverEl);
    const top = el('div', '', 'state');
    top.appendChild(el('span', '[' + j.cefr + '] ' + j.partCount + ' Parts · ' + j.topic, 'lvl'));

    let stBadge = '🧩 Ready to Join';
    let stCls = 'new';
    if (j.synthesisAnswered >= 4) {
      stBadge = '🏁 ' + j.synthesisCorrect + '/4 Complete';
      stCls = 'done';
    } else if (j.expertDone) {
      stBadge = '✅ Expert Ready · Team ' + (j.teamNumber || 1);
      stCls = 'prog';
    } else if (j.partKey) {
      stBadge = '📖 Team ' + j.teamNumber + ' · Part ' + j.partKey;
      stCls = 'prog';
    }
    top.appendChild(el('span', stBadge, 'badge ' + stCls));
    card.appendChild(top);

    card.appendChild(el('h3', j.title));
    const desc = j.partKey
      ? ('Assigned Role: Home Team ' + j.teamNumber + ' · Expert Part ' + j.partKey)
      : 'Cooperative Information-Gap Reading: get your secret Expert Part & solve with your Home Team!';
    card.appendChild(el('div', desc, 'muted'));

    const bot = el('div', '', 'state');
    bot.appendChild(el('span', j.collabMode === 'CLUE_BOARD' ? '💬 Live Clue-Board' : '🗣️ Classroom Speaking', 'faint'));
    const btn = el('button', '🧩 Open Jigsaw →', 'btn');
    btn.type = 'button';
    btn.style.padding = '7px 14px';
    btn.style.fontSize = '13px';
    btn.addEventListener('click', () => openStudentJigsaw(j.jigsawId));
    bot.appendChild(btn);
    card.appendChild(bot);
    grid.appendChild(card);
  });
}

function scratchpadKey(jigsawId) {
  const sid = (state.portalContext && state.portalContext.code) || 'anon';
  return 'ttrl_jigsaw_notes_' + sid + '_' + jigsawId;
}

async function openStudentJigsaw(jigsawId, partOverride, keepStep) {
  speech.stop();
  if (!keepStep) {
    showView('loadingView');
    $('loadingText').textContent = 'Opening your Home Team & Secret Expert Part...';
  }
  try {
    const res = await rpc('jigsawStudentOpen', state.code, jigsawId, partOverride || jStudent.previewPart || '');
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not open Speaking Jigsaw.');
    jStudent.jigsawId = jigsawId;
    jStudent.data = res;
    jStudent.previewPart = res.myPart.partKey;

    if (!keepStep) {
      if (res.synthesisSummary.answered >= 4) jStudent.step = 4;
      else if (res.synthesisSummary.answered > 0) jStudent.step = 3;
      else if (res.assignment.expertDone) jStudent.step = 2;
      else jStudent.step = 1;

      const firstUnans = res.synthesisQuestions.findIndex(q => !q.answered);
      jStudent.synthIdx = firstUnans >= 0 ? firstUnans : 0;
    }

    renderStudentJigsawWorkspace();
    showView('jigsawView');
    startStudentJigsawPolling();
  } catch (err) {
    showView('dashboardView');
    alert(err.message || 'Could not open Speaking Jigsaw.');
  }
}

function startStudentJigsawPolling() {
  if (jStudent.pollTimer) clearInterval(jStudent.pollTimer);
  jStudent.pollTimer = setInterval(async () => {
    if (state.activeView !== 'jigsawView' || !jStudent.jigsawId || document.visibilityState !== 'visible') return;
    try {
      const res = await rpc('jigsawStudentOpen', state.code, jStudent.jigsawId, jStudent.previewPart || '');
      if (res && res.ok) {
        jStudent.data = res;
        updateStudentJigsawLiveHeader();
        if (jStudent.step === 2) renderStudentTeamExchange();
        if (jStudent.step === 3) renderStudentSynthesisStep();
        if (res.fullStoryUnlocked && !$('jStepBtn4').dataset.unlocked) renderStudentJigsawWorkspace();
      }
    } catch (e) {}
  }, 8000);
}

function updateStudentJigsawLiveHeader() {
  const d = jStudent.data;
  if (!d) return;
  $('jViewCefr').textContent = d.jigsaw.cefr;
  $('jViewTitle').textContent = d.jigsaw.title;
  $('jViewTeamChip').textContent = '🚪 ' + (d.assignment.roomName || ('Home Team ' + d.assignment.teamNumber));
  $('jViewPartChip').textContent = '🧩 Expert Part ' + d.myPart.partKey;

  const phMap = {
    AUTO: '⚡ Self-Paced Cooperative Flow',
    EXPERT: '1️⃣ Teacher Phase: Read Expert Part',
    HUDDLE: '2️⃣ Teacher Phase: Expert Huddle',
    SHARE: '3️⃣ Teacher Phase: Home Team Exchange',
    SYNTHESIS: '4️⃣ Teacher Phase: Synthesis Quiz Unlocked',
    REVEAL: '🏁 Full Story Revealed!'
  };
  $('jViewPhaseChip').textContent = phMap[d.jigsaw.currentPhase] || '⚡ Cooperative Flow';

  const tChip = $('jViewTimerChip');
  if (d.jigsaw.timerRemainingSec !== null && d.jigsaw.timerRemainingSec > 0) {
    tChip.classList.remove('hidden');
    tChip.textContent = '⏱ ' + formatTimerClock(d.jigsaw.timerRemainingSec);
  } else {
    tChip.classList.add('hidden');
  }
}

function renderStudentJigsawWorkspace() {
  const d = jStudent.data;
  if (!d) return;
  updateStudentJigsawLiveHeader();

  // Admin / Owner Preview Part Switcher (lets Admin test Part A, Part B, Part C, Part D seamlessly!)
  const prevBar = $('jOwnerPartPreviewBar');
  clearEl(prevBar);
  if (d.ownerPreview) {
    prevBar.classList.remove('hidden');
    prevBar.appendChild(el('span', '👑 Preview Role:', 'muted'));
    JIGSAW_PART_KEYS.slice(0, d.jigsaw.partCount).forEach(pk => {
      const b = el('button', 'Part ' + pk, 'pill' + (d.myPart.partKey === pk ? ' on' : ''));
      b.type = 'button';
      b.addEventListener('click', () => openStudentJigsaw(d.jigsaw.jigsawId, pk, true));
      prevBar.appendChild(b);
    });
  } else {
    prevBar.classList.add('hidden');
  }

  // Step 1 Content: Secret Expert Passage + Vocabulary + Expert Check MCQ
  $('jPartEyebrow').textContent = 'YOUR SECRET READING PIECE · PART ' + d.myPart.partKey + ' OF ' + d.jigsaw.partCount;
  $('jPartTitle').textContent = d.myPart.title;
  $('jPartWordInfo').textContent = d.myPart.words + ' words';
  renderPassageInto($('jPartPassage'), d.myPart.passage, d.myPart.glossary || []);
  $('jPartPassage').classList.toggle('focus', !!settings.focus);
  bindPassageSentenceSeek($('jPartPassage'), '#jPartPassage .sent', 'jListenBtn', 'jVoiceBar', d.myPart.passage, '');
  renderStoryMediaShowcase($('jMediaShowcase'), resolveStoryMedia({
    jigsawId: d.jigsaw.jigsawId,
    title: d.jigsaw.title,
    topic: d.jigsaw.topic,
    passage: d.myPart.passage
  }));
  renderVoiceBarUI($('jVoiceBar'), resolvePassageAudio(d.myPart.passage, ''), '#jPartPassage .sent', 'jListenBtn');

  const vBox = $('jPartVocab');
  clearEl(vBox);
  (d.myPart.glossary || []).forEach(g => {
    const item = el('div');
    item.appendChild(el('b', g.word));
    item.appendChild(el('span', g.definition));
    vBox.appendChild(item);
  });

  renderStudentExpertQuestions();
  renderStudentTeamExchange();
  renderStudentSynthesisStep();
  renderStudentAssembledStory();
  setStudentJigsawStep(jStudent.step);
}

function setStudentJigsawStep(stepNum) {
  const d = jStudent.data;
  if (!d) return;
  if (stepNum === 4 && !d.fullStoryUnlocked) {
    alert('Complete all 4 Whole-Story Synthesis Quiz questions first to unlock the complete assembled story!');
    return;
  }
  speech.stop();
  pauseAllStoryVideos();
  jStudent.step = stepNum;

  const btns = [null, $('jStepBtn1'), $('jStepBtn2'), $('jStepBtn3'), $('jStepBtn4')];
  btns[1].className = 'j-step-btn' + (stepNum === 1 ? ' on' : (d.assignment.expertDone ? ' done' : ''));
  btns[2].className = 'j-step-btn' + (stepNum === 2 ? ' on' : '');
  btns[3].className = 'j-step-btn' + (stepNum === 3 ? ' on' : (d.synthesisSummary.answered >= 4 ? ' done' : ''));
  btns[4].className = 'j-step-btn' + (stepNum === 4 ? ' on' : (d.fullStoryUnlocked ? ' done' : ''));
  btns[4].textContent = d.fullStoryUnlocked ? '4️⃣ Full Story 🔓' : '4️⃣ Full Story 🔒';
  btns[4].dataset.unlocked = d.fullStoryUnlocked ? '1' : '';

  $('jStep1Pane').classList.toggle('hidden', stepNum !== 1);
  $('jStep2Pane').classList.toggle('hidden', stepNum !== 2);
  $('jStep3Pane').classList.toggle('hidden', stepNum !== 3);
  $('jStep4Pane').classList.toggle('hidden', stepNum !== 4);

  if (stepNum === 3) renderStudentSynthesisStep();
  if (stepNum === 4) renderStudentAssembledStory();
}

function renderStudentExpertQuestions() {
  const d = jStudent.data;
  const box = $('jExpertQuestionsBox');
  clearEl(box);
  const letters = ['A', 'B', 'C', 'D'];

  (d.myPart.expertQuestions || []).forEach(eq => {
    const qWrap = el('div');
    qWrap.style.display = 'flex';
    qWrap.style.flexDirection = 'column';
    qWrap.style.gap = '9px';
    const qP = el('p', eq.text, 'qText');
    qP.style.fontSize = '17.5px';
    qWrap.appendChild(qP);

    const fbHolder = el('div');
    (eq.options || []).forEach((optText, oIdx) => {
      const btn = el('button', '', 'opt');
      btn.type = 'button';
      btn.appendChild(el('span', letters[oIdx], 'k'));
      btn.appendChild(el('span', optText));
      if (eq.passed) {
        btn.disabled = true;
        if (oIdx === eq.correctIndex) btn.classList.add('right');
      } else {
        btn.addEventListener('click', async () => {
          if (state.busy) return;
          state.busy = true;
          try {
            const res = await rpc('jigsawSubmitExpertCheck', state.code, d.jigsaw.jigsawId, eq.id, oIdx);
            clearEl(fbHolder);
            const fb = el('div', '', 'fb ' + (res.correct ? 'good' : 'bad'));
            fb.appendChild(el('strong', res.correct
              ? ('✨ Expert Check Passed!' + (res.pointsAdded ? (' +' + res.pointsAdded + ' KP') : ''))
              : '🔎 Re-read Your Expert Passage & Try Again!'));
            fb.appendChild(el('p', res.explanation || '', 'muted'));
            fbHolder.appendChild(fb);
            if (res.correct) {
              eq.passed = true;
              eq.correctIndex = res.correctIndex;
              d.assignment.expertDone = !!res.expertDone;
              renderStudentExpertQuestions();
            } else {
              btn.classList.add('wrong');
            }
          } catch (err) {
            alert(err.message || 'Could not check answer.');
          } finally {
            state.busy = false;
          }
        });
      }
      qWrap.appendChild(btn);
    });

    if (eq.passed && eq.explanation) {
      const fb = el('div', '', 'fb good');
      fb.appendChild(el('strong', '✅ Expert Check Mastered'));
      fb.appendChild(el('p', eq.explanation, 'muted'));
      fbHolder.appendChild(fb);
    }
    qWrap.appendChild(fbHolder);
    box.appendChild(qWrap);
  });

  $('jStep1NextWrap').classList.toggle('hidden', !d.assignment.expertDone);
}

function renderStudentTeamExchange() {
  const d = jStudent.data;
  if (!d) return;
  $('jSpeakingPromptBox').textContent = '🗣️ Speaking Prompt (Part ' + d.myPart.partKey + '): ' + d.myPart.speakingPrompt;
  $('jMyClueLabel').textContent = d.jigsaw.collabMode === 'CLUE_BOARD'
    ? 'Your Shared Clue Summary (Visible Live on Your Home Team Board)'
    : 'Your Speaking Notes (Prepare What You Will Tell Your Team Out Loud)';

  if (document.activeElement !== $('jMyClueInput')) {
    $('jMyClueInput').value = d.assignment.expertNote || '';
  }
  jigsawVoiceRec.ensureBars();
  if (!jigsawVoiceRec.recording && !jigsawVoiceRec.lastBlob) {
    $('jVcStatus').textContent = d.assignment.voiceFileId
      ? ('✅ Voice Clue Shared (' + (d.assignment.voiceDuration || 0) + 's) — Record again anytime to update!')
      : '🎙️ Record Spoken Clue for Teammates (15–45s)';
  }

  try {
    const savedScratch = localStorage.getItem(scratchpadKey(d.jigsaw.jigsawId));
    if (savedScratch !== null && document.activeElement !== $('jScratchpadInput')) {
      $('jScratchpadInput').value = savedScratch;
    }
  } catch (e) {}

  const grid = $('jTeamSlotsGrid');
  clearEl(grid);
  (d.teamPartSlots || []).forEach(slot => {
    const card = el('div', '', 'clue-slot' + (slot.isMine ? ' mine' : ''));
    const top = el('div', '', 'state');
    top.appendChild(el('span', '🧩 Part ' + slot.partKey + (slot.isMine ? ' (YOUR PART)' : ''), 'part-badge'));
    const holderText = slot.holders && slot.holders.length
      ? slot.holders.map(h => h.name + (h.expertDone ? ' ✅' : ' 📖')).join(', ')
      : 'Waiting for classmate';
    top.appendChild(el('span', holderText, 'muted'));
    card.appendChild(top);
    card.appendChild(el('strong', slot.title));

    // Render Recorded Spoken Voice Clues from Teammates (or Self)
    if (Array.isArray(slot.voiceClues) && slot.voiceClues.length) {
      slot.voiceClues.forEach(vc => {
        const vRow = el('div', '', 'tip');
        vRow.style.marginTop = '6px';
        const vHead = el('div', '', 'state');
        vHead.appendChild(el('strong', '🎙️ ' + (vc.speaker || 'Teammate') + '’s Spoken Clue'));
        const playBtn = el('button', '🔊 Play Voice Clue' + (vc.duration ? (' (' + vc.duration + 's)') : ''), 'iconBtn');
        playBtn.type = 'button';
        playBtn.style.fontSize = '12px';
        playBtn.style.padding = '4px 10px';
        playBtn.addEventListener('click', () => {
          playRemoteAudioDataUrl(playBtn, () => rpc('jigsawPlayVoiceClue', {
            auth: state.code,
            teacherSession: teacherState.session,
            jigsawId: d.jigsaw.jigsawId,
            fileId: vc.fileId
          }));
        });
        vHead.appendChild(playBtn);
        vRow.appendChild(vHead);
        if (vc.transcript) {
          const trSpan = el('div', '“' + vc.transcript + '”', 'muted');
          trSpan.style.marginTop = '4px';
          trSpan.style.fontSize = '12.5px';
          vRow.appendChild(trSpan);
        }
        card.appendChild(vRow);
      });
    }

    if (slot.isMine) {
      card.appendChild(el('div', 'You are the Expert for this part! Record a spoken voice clue above or explain your key facts live to your Home Team.', 'muted'));
    } else if (slot.sharedClues && slot.sharedClues.length) {
      slot.sharedClues.forEach(c => {
        const tip = el('div', '💬 Teammate Clue: "' + c + '"', 'tip');
        tip.style.marginTop = '4px';
        card.appendChild(tip);
      });
    } else if (slot.teacherRescueClue) {
      const rescue = el('div', '🆘 Teacher Rescue Clue: ' + slot.teacherRescueClue, 'tip');
      rescue.style.marginTop = '4px';
      card.appendChild(rescue);
    } else if (!slot.voiceClues || !slot.voiceClues.length) {
      const msg = d.jigsaw.collabMode === 'CLUE_BOARD'
        ? 'Waiting for your Part ' + slot.partKey + ' teammate to share their voice/written clue.'
        : '🗣️ Ask your Part ' + slot.partKey + ' teammate: "' + slot.speakingPrompt + '"';
      card.appendChild(el('div', msg, 'muted'));
    }
    grid.appendChild(card);
  });
}

function renderStudentSynthesisStep() {
  const d = jStudent.data;
  if (!d) return;

  // Populate left-hand reference (detective scratchpad + teammate clues + own expert passage)
  let notesSummary = '';
  try { notesSummary = localStorage.getItem(scratchpadKey(d.jigsaw.jigsawId)) || ''; } catch (e) {}
  const sharedLines = (d.teamPartSlots || [])
    .filter(s => !s.isMine && ((s.sharedClues && s.sharedClues.length) || s.teacherRescueClue))
    .map(s => 'Part ' + s.partKey + ': ' + (s.sharedClues.join(' / ') || s.teacherRescueClue));
  const combinedRef = [
    notesSummary ? ('🕵️ My Detective Notes:\n' + notesSummary) : '',
    sharedLines.length ? ('💬 Team Clues:\n' + sharedLines.join('\n')) : ''
  ].filter(Boolean).join('\n\n');
  $('jStep3NotesRef').textContent = combinedRef || '💡 Tip: Use Step 2 (Home Team Exchange) to jot down clues from your teammates’ parts!';
  $('jStep3PartSummary').textContent = '📖 My Expert Passage (' + d.myPart.title + ')';
  renderPassageInto($('jStep3PartRef'), d.myPart.passage, d.myPart.glossary || []);

  // Lockstep phase notice
  const lockBar = $('jSynthLockNotice');
  const lockedByTeacher = !d.ownerPreview && d.jigsaw.pacingMode === 'LOCKSTEP' &&
    d.jigsaw.currentPhase !== 'SYNTHESIS' && d.jigsaw.currentPhase !== 'REVEAL';
  if (lockedByTeacher) {
    lockBar.classList.remove('hidden');
    lockBar.textContent = '🔒 Hold on! Your teacher has locked the class in the "' + d.jigsaw.currentPhase + '" phase while teams finish sharing clues. As soon as your teacher clicks "4️⃣ Synthesis Quiz", you can submit answers here!';
  } else {
    lockBar.classList.add('hidden');
  }

  const qs = d.synthesisQuestions || [];
  if (!qs.length) return;
  if (jStudent.synthIdx >= qs.length) jStudent.synthIdx = 0;
  const sq = qs[jStudent.synthIdx];

  const dots = $('jSynthDots');
  clearEl(dots);
  qs.forEach((item, i) => {
    const dot = el('div', '', 'dot' + (i === jStudent.synthIdx ? ' cur' : '') + (item.answered ? (item.correct ? ' ok' : ' no') : ''));
    dot.style.cursor = 'pointer';
    dot.addEventListener('click', () => { jStudent.synthIdx = i; renderStudentSynthesisStep(); });
    dots.appendChild(dot);
  });

  const meta = SKILL_META[sq.skill] || { label: sq.skill, icon: '💡' };
  $('jSynthSkillTag').textContent = 'S' + (jStudent.synthIdx + 1) + '/4 · ' + meta.icon + ' ' + meta.label;
  $('jSynthQText').textContent = sq.text;
  $('jSynthErr').textContent = '';

  const optBox = $('jSynthOptions');
  clearEl(optBox);
  const letters = ['A', 'B', 'C', 'D'];
  (sq.options || []).forEach((optText, oIdx) => {
    const btn = el('button', '', 'opt');
    btn.type = 'button';
    btn.appendChild(el('span', letters[oIdx], 'k'));
    btn.appendChild(el('span', optText));

    if (sq.answered) {
      btn.disabled = true;
      if (oIdx === sq.correctIndex) btn.classList.add('right');
      if (oIdx === sq.selectedIndex && !sq.correct) btn.classList.add('wrong');
    } else if (lockedByTeacher) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => submitStudentSynthesis(jStudent.synthIdx, oIdx));
    }
    optBox.appendChild(btn);
  });

  const fbBox = $('jSynthFeedback');
  clearEl(fbBox);
  if (sq.answered) {
    const fb = el('div', '', 'fb ' + (sq.correct ? 'good' : 'bad'));
    fb.appendChild(el('strong', sq.correct ? '✨ Correct! (+10 KP)' : '❌ Not quite right.'));
    if (sq.explanation) fb.appendChild(el('p', sq.explanation, 'muted'));
    fbBox.appendChild(fb);
  }

  $('jPrevSynthBtn').disabled = jStudent.synthIdx === 0;
  const allDone = qs.every(q => q.answered);
  if (allDone) {
    $('jNextSynthBtn').textContent = '🎉 View Complete Assembled Story →';
  } else {
    $('jNextSynthBtn').textContent = jStudent.synthIdx < qs.length - 1 ? 'Next Question →' : 'First Unanswered Question →';
  }
}

async function submitStudentSynthesis(qIdx, selectedIndex) {
  if (state.busy) return;
  const d = jStudent.data;
  const sq = d.synthesisQuestions[qIdx];
  state.busy = true;
  $('jSynthErr').textContent = '';
  try {
    const res = await rpc('jigsawSubmitSynthesisAnswer', state.code, d.jigsaw.jigsawId, sq.id, selectedIndex);
    sq.answered = true;
    sq.selectedIndex = res.selectedIndex;
    sq.correctIndex = res.correctIndex;
    sq.correct = res.correct;
    sq.explanation = res.explanation;

    const ansCount = d.synthesisQuestions.filter(q => q.answered).length;
    const corrCount = d.synthesisQuestions.filter(q => q.correct).length;
    d.synthesisSummary.answered = ansCount;
    d.synthesisSummary.correct = corrCount;
    d.synthesisSummary.percent = ansCount === 4 ? Math.round((corrCount / 4) * 100) : null;

    if (res.assembledParts) {
      d.assembledParts = res.assembledParts;
      d.fullStoryUnlocked = true;
    }
    renderStudentSynthesisStep();
  } catch (err) {
    $('jSynthErr').textContent = err.message || 'Could not grade Synthesis answer.';
  } finally {
    state.busy = false;
  }
}

function renderStudentAssembledStory() {
  const d = jStudent.data;
  if (!d || !d.fullStoryUnlocked || !d.assembledParts) return;
  const pct = d.synthesisSummary.percent !== null
    ? d.synthesisSummary.percent
    : Math.round((d.synthesisSummary.correct / 4) * 100);
  $('jCompleteScore').textContent = pct + '%';
  $('jCompleteSub').textContent = 'Synthesis Quiz: ' + d.synthesisSummary.correct + ' of 4 correct. Read all ' + d.assembledParts.length + ' parts together below!';

  renderStoryMediaShowcase($('jStep4MediaShowcase'), resolveStoryMedia({
    jigsawId: d.jigsaw.jigsawId,
    title: d.jigsaw.title,
    topic: d.jigsaw.topic,
    passage: (d.assembledParts[0] && d.assembledParts[0].passage) || ''
  }));
  const box = $('jAssembledStoryBox');
  clearEl(box);
  d.assembledParts.forEach(part => {
    const wrap = el('div', '', 'assembled-part');
    const partDomId = 'jAssembledPart_' + part.partKey;
    const partBtnId = 'jAssembledListen_' + part.partKey;
    const pAudio = resolvePassageAudio(part.passage, '');
    const head = el('div', '', 'state');
    head.style.marginBottom = '8px';
    head.style.flexWrap = 'wrap';
    head.style.gap = '8px';
    head.appendChild(el('strong', '🧩 ' + part.title));
    const rightSide = el('div', '', 't-controls');
    if (part.partKey === d.myPart.partKey) rightSide.appendChild(el('span', 'Your Expert Part', 'badge done'));
    const listenLabel = pAudio ? ('🎙️ ' + pAudio.voice + ' · ' + pAudio.emotion) : '🔊 Listen';
    const pListenBtn = el('button', listenLabel, 'tool');
    pListenBtn.type = 'button';
    pListenBtn.id = partBtnId;
    pListenBtn.dataset.idleLabel = listenLabel;
    pListenBtn.style.padding = '4px 10px';
    pListenBtn.style.fontSize = '12px';
    pListenBtn.addEventListener('click', () => {
      if (speech.active && speech.btnId === partBtnId) speech.stop();
      else speech.start('#' + partDomId + ' .sent', partBtnId, { passage: part.passage });
    });
    rightSide.appendChild(pListenBtn);
    head.appendChild(rightSide);
    wrap.appendChild(head);
    const pBody = el('div', '', 'passage');
    pBody.id = partDomId;
    pBody.style.maxHeight = 'none';
    renderPassageInto(pBody, part.passage, part.glossary || []);
    wrap.appendChild(pBody);
    box.appendChild(wrap);
  });
}

// =========================================================================
// JIGSAW STUDIO & STUDENT WORKSPACE EVENT LISTENERS
// =========================================================================
$('tOpenBreakoutBtn').addEventListener('click', () => openJigsawStudio('teacherView', 'BREAKOUT'));
$('ownerOpenBreakoutBtn').addEventListener('click', () => openJigsawStudio('dashboardView', 'BREAKOUT'));
$('tOpenJigsawBtn').addEventListener('click', () => openJigsawStudio('teacherView'));
$('ownerOpenJigsawBtn').addEventListener('click', () => openJigsawStudio('dashboardView'));
$('jStudioBackBtn').addEventListener('click', () => {
  if (jStudio.livePollTimer) { clearInterval(jStudio.livePollTimer); jStudio.livePollTimer = null; }
  if (typeof brState !== 'undefined' && brState.pollTimer) { clearInterval(brState.pollTimer); brState.pollTimer = null; }
  showView(jStudio.returnView);
  if (jStudio.returnView === 'teacherView') pollTeacherNow(true);
  else if (jStudio.returnView === 'dashboardView') refreshDashboard();
});

$('jTabBreakoutBtn').addEventListener('click', () => switchJigsawStudioTab('BREAKOUT'));
$('jTabCreateBtn').addEventListener('click', () => switchJigsawStudioTab('CREATE'));
$('jTabListBtn').addEventListener('click', () => switchJigsawStudioTab('LIST'));
$('jTabLiveBtn').addEventListener('click', () => switchJigsawStudioTab('LIVE'));
$('jNewBlankBtn').addEventListener('click', () => {
  loadDraftIntoCreator(makeBlankDraft(), '');
  switchJigsawStudioTab('CREATE');
});

$('jLoadTplBtn').addEventListener('click', () => {
  const idx = Number($('jTplSelect').value) || 0;
  const tpl = jStudio.templates[idx];
  if (tpl) loadDraftIntoCreator(tpl, '');
});

$('jConvLessonBtn').addEventListener('click', async () => {
  const lessonId = $('jConvLessonSelect').value;
  if (!lessonId) return;
  const partCount = Number($('jPartCountSelect').value) || 3;
  $('jConvLessonBtn').disabled = true;
  $('jConvLessonBtn').textContent = '⏳ Converting...';
  try {
    const res = await rpc('jigsawConvertLessonDraft', jigsawEditorCreds({ lessonId, partCount }));
    if (res && res.ok && res.draft) loadDraftIntoCreator(res.draft, jStudio.editingId);
    else alert((res && res.error) || 'Could not convert lesson.');
  } catch (err) {
    alert(err.message);
  } finally {
    $('jConvLessonBtn').disabled = false;
    $('jConvLessonBtn').textContent = '🔄 Convert to Jigsaw';
  }
});

$('jSmartSplitBtn').addEventListener('click', async () => {
  const rawText = $('jRawPasteInput').value.trim();
  const title = $('jTitleInput').value.trim() || 'Custom Speaking Jigsaw';
  const cefr = $('jCefrSelect').value || 'A2';
  const topic = $('jTopicInput').value.trim() || 'Cooperative Story';
  const partCount = Number($('jPartCountSelect').value) || 3;
  $('jSmartSplitBtn').disabled = true;
  try {
    const res = await rpc('jigsawSmartSplitDraft', jigsawEditorCreds({ title, cefr, topic, rawText, partCount }));
    if (res && res.ok && res.draft) {
      loadDraftIntoCreator(res.draft, jStudio.editingId);
      $('jSplitDetails').open = false;
    } else {
      alert((res && res.error) || 'Please paste at least 100 characters of text.');
    }
  } catch (err) {
    alert(err.message);
  } finally {
    $('jSmartSplitBtn').disabled = false;
  }
});

$('jAiGenBtn').addEventListener('click', async () => {
  const topic = $('jAiTopicInput').value.trim() || $('jTopicInput').value.trim() || 'A teamwork mystery in Fes';
  const cefr = $('jCefrSelect').value || 'A2';
  const partCount = Number($('jPartCountSelect').value) || 3;
  $('jAiGenBtn').disabled = true;
  $('jAiGenBtn').textContent = '⏳ Generating...';
  try {
    const res = await rpc('jigsawGenerateAiDraft', jigsawEditorCreds({ topic, cefr, partCount }));
    if (res && res.ok && res.draft) loadDraftIntoCreator(res.draft, jStudio.editingId);
    else alert((res && res.error) || 'AI draft unavailable.');
  } catch (err) {
    alert(err.message);
  } finally {
    $('jAiGenBtn').disabled = false;
    $('jAiGenBtn').textContent = '🤖 Generate AI Draft';
  }
});

$('jTargetTeacherSelect').addEventListener('change', () => refreshCreatorClassOptions());
$('jPartCountSelect').addEventListener('change', e => {
  jStudio.draft.partCount = Number(e.target.value) || 3;
  renderPartEditorTabs();
  renderActivePartEditor();
});
$('jResetNewBtn').addEventListener('click', () => loadDraftIntoCreator(makeBlankDraft(), ''));
$('jSaveDraftBtn').addEventListener('click', () => saveJigsawSession('DRAFT'));
$('jLaunchLiveBtn').addEventListener('click', () => saveJigsawSession('LIVE'));

// Live Board Controls
$('jLiveSelect').addEventListener('change', e => {
  jStudio.liveJigsawId = e.target.value;
  pollLiveJigsawBoard(true);
});
$('jLiveRefreshBtn').addEventListener('click', () => pollLiveJigsawBoard(true));
$('jLiveEditBtn').addEventListener('click', () => {
  if (jStudio.liveData && jStudio.liveData.jigsaw) {
    const j = jStudio.liveData.jigsaw;
    loadDraftIntoCreator(j, j.jigsawId, j.teacher, j.className);
    switchJigsawStudioTab('CREATE');
  }
});
$('jTimer5Btn').addEventListener('click', () => runLiveJigsawAction({ action: 'SET_TIMER', minutes: 5 }));
$('jTimer10Btn').addEventListener('click', () => runLiveJigsawAction({ action: 'SET_TIMER', minutes: 10 }));
$('jTimerClearBtn').addEventListener('click', () => runLiveJigsawAction({ action: 'SET_TIMER', minutes: 0 }));
$('jRebalanceOnlineBtn').addEventListener('click', () => runLiveJigsawAction({ action: 'REBALANCE_ONLINE' }));
$('jAutoAssignAllBtn').addEventListener('click', () => runLiveJigsawAction({ action: 'AUTO_ASSIGN_ALL' }));
$('jToggleRescueBtn').addEventListener('click', () => runLiveJigsawAction({ action: 'TOGGLE_MISSING_CLUES' }));
$('jToggleCollabBtn').addEventListener('click', () => {
  const cur = (jStudio.liveData && jStudio.liveData.jigsaw && jStudio.liveData.jigsaw.collabMode) || 'ORAL';
  runLiveJigsawAction({ action: 'SET_COLLAB', collabMode: cur === 'ORAL' ? 'CLUE_BOARD' : 'ORAL' });
});

// Student Jigsaw Workspace Controls
$('jStudentBackBtn').addEventListener('click', () => {
  speech.stop();
  if (jStudent.pollTimer) { clearInterval(jStudent.pollTimer); jStudent.pollTimer = null; }
  showView('dashboardView');
  refreshDashboard();
});
$('jStepBtn1').addEventListener('click', () => setStudentJigsawStep(1));
$('jStepBtn2').addEventListener('click', () => setStudentJigsawStep(2));
$('jStepBtn3').addEventListener('click', () => setStudentJigsawStep(3));
$('jStepBtn4').addEventListener('click', () => setStudentJigsawStep(4));
$('jGoStep2Btn').addEventListener('click', () => setStudentJigsawStep(2));
$('jGoStep3Btn').addEventListener('click', () => setStudentJigsawStep(3));
$('jListenBtn').addEventListener('click', () => {
  if (speech.active && speech.btnId === 'jListenBtn') speech.stop();
  else speech.start('#jPartPassage .sent', 'jListenBtn', {
    passage: (jStudent.data && jStudent.data.myPart && jStudent.data.myPart.passage) || '',
    voiceBarId: 'jVoiceBar'
  });
});
$('jFocusBtn').addEventListener('click', () => { settings.focus = !settings.focus; applySettings(); });
$('jTextSettingsBtn').addEventListener('click', () => openDrawer(true));

$('jSaveClueBtn').addEventListener('click', async () => {
  if (!jStudent.data) return;
  const note = $('jMyClueInput').value.trim();
  $('jSaveClueBtn').disabled = true;
  try {
    const res = await rpc('jigsawSaveExpertNote', state.code, jStudent.data.jigsaw.jigsawId, note);
    if (res && res.ok) {
      jStudent.data.assignment.expertNote = res.note;
      $('jClueSavedMsg').textContent = '✅ Saved! Ready to share with your Home Team.';
      const fresh = await rpc('jigsawStudentOpen', state.code, jStudent.data.jigsaw.jigsawId, jStudent.previewPart || '');
      if (fresh && fresh.ok) { jStudent.data = fresh; renderStudentTeamExchange(); }
    }
  } catch (err) {
    $('jClueSavedMsg').textContent = err.message;
  } finally {
    $('jSaveClueBtn').disabled = false;
  }
});

$('jScratchpadInput').addEventListener('input', e => {
  if (!jStudent.jigsawId) return;
  try { localStorage.setItem(scratchpadKey(jStudent.jigsawId), e.target.value); } catch (ex) {}
});

$('jRefreshTeamBtn').addEventListener('click', () => {
  if (jStudent.jigsawId) openStudentJigsaw(jStudent.jigsawId, jStudent.previewPart, true);
});

$('jPrevSynthBtn').addEventListener('click', () => {
  if (jStudent.synthIdx > 0) { jStudent.synthIdx--; renderStudentSynthesisStep(); }
});
$('jNextSynthBtn').addEventListener('click', () => {
  const qs = (jStudent.data && jStudent.data.synthesisQuestions) || [];
  if (qs.every(q => q.answered)) {
    setStudentJigsawStep(4);
    return;
  }
  if (jStudent.synthIdx < qs.length - 1) {
    jStudent.synthIdx++;
  } else {
    const firstUn = qs.findIndex(q => !q.answered);
    if (firstUn >= 0) jStudent.synthIdx = firstUn;
  }
  renderStudentSynthesisStep();
});
$('jReviewSynthBtn').addEventListener('click', () => setStudentJigsawStep(3));
$('jFinishToDashBtn').addEventListener('click', () => {
  if (jStudent.pollTimer) { clearInterval(jStudent.pollTimer); jStudent.pollTimer = null; }
  showView('dashboardView');
  refreshDashboard();
});

/* =========================================================================
   LIVE LOGGED-IN BREAKOUT ROOMS & INTUITIVE GROUP JIGSAW ASSIGNMENT
   ========================================================================= */
const brState = {
  teacherFilter: 'ALL',
  classFilter: 'ALL',
  poolMode: 'ONLINE',
  viewMode: 'HOME',
  selectedPickerVal: '',
  rooms: [],
  dirty: false,
  wsData: null,
  pollTimer: null,
  pollBusy: false,
  dragStudentCode: '',
  lastAssignedJigsawId: ''
};

function startBreakoutPolling() {
  if (brState.pollTimer) clearInterval(brState.pollTimer);
  brState.pollTimer = setInterval(() => {
    if (state.activeView === 'jigsawStudioView' && jStudio.activeTab === 'BREAKOUT' && document.visibilityState === 'visible') {
      pollBreakoutWorkspace(false, false);
    }
  }, 5000);
}

function showBreakoutStatus(message, isWarn, showLiveBtn) {
  const banner = $('brStatusBanner');
  if (!banner) return;
  if (!message) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  banner.style.background = isWarn ? 'var(--badBg)' : 'var(--goodBg)';
  banner.style.borderColor = isWarn ? 'var(--bad)' : 'var(--good)';
  $('brStatusText').textContent = message;
  $('brOpenLiveAfterAssignBtn').classList.toggle('hidden', !showLiveBtn);
}

function getSelectedBreakoutJigsawMeta() {
  const ws = brState.wsData || { savedJigsaws: [], templates: [] };
  const val = $('brJigsawPicker') ? $('brJigsawPicker').value : brState.selectedPickerVal;
  if (val && val.indexOf('EXISTING:') === 0) {
    const jid = val.slice('EXISTING:'.length);
    const found = (ws.savedJigsaws || []).find(j => j.jigsawId === jid);
    if (found) {
      return {
        sourceType: 'EXISTING',
        jigsawId: found.jigsawId,
        templateIndex: 0,
        title: found.title,
        cefr: found.cefr,
        partCount: Math.min(4, Math.max(2, Number(found.partCount) || 3)),
        collabMode: found.collabMode || 'CLUE_BOARD',
        pacingMode: found.pacingMode || 'AUTO',
        partTitles: found.partTitles || []
      };
    }
  }
  const tIdx = val && val.indexOf('TEMPLATE:') === 0 ? (Number(val.slice('TEMPLATE:'.length)) || 0) : 0;
  const tpl = (ws.templates || [])[tIdx] || (ws.templates || [])[0] || {
    templateIndex: 0,
    title: 'Cooperative Speaking Jigsaw',
    cefr: 'A2',
    partCount: 3,
    partTitles: [
      { partKey: 'A', title: 'Part A' },
      { partKey: 'B', title: 'Part B' },
      { partKey: 'C', title: 'Part C' }
    ]
  };
  return {
    sourceType: 'TEMPLATE',
    jigsawId: '',
    templateIndex: Number(tpl.templateIndex) || 0,
    title: tpl.title,
    cefr: tpl.cefr,
    partCount: Math.min(4, Math.max(2, Number(tpl.partCount) || 3)),
    collabMode: 'CLUE_BOARD',
    pacingMode: 'AUTO',
    partTitles: tpl.partTitles || []
  };
}

async function pollBreakoutWorkspace(manual, forceReloadRooms) {
  if (brState.pollBusy) return;
  brState.pollBusy = true;
  if (manual && $('brRefreshBtn')) $('brRefreshBtn').textContent = '⏳ Syncing';
  try {
    const res = await rpc('breakoutWorkspacePoll', jigsawEditorCreds({
      teacherFilter: brState.teacherFilter,
      classFilter: brState.classFilter
    }));
    if (res && res.ok) {
      applyBreakoutWorkspaceData(res, !!forceReloadRooms);
    }
  } catch (e) {} finally {
    brState.pollBusy = false;
    if (manual && $('brRefreshBtn')) $('brRefreshBtn').textContent = '🔄 Sync Live';
  }
}

function applyBreakoutWorkspaceData(res, forceReloadRooms) {
  brState.wsData = res;
  brState.teacherFilter = res.effectiveTeacher || 'ALL';
  brState.classFilter = res.activeClassFilter || 'ALL';

  const liveByCode = {};
  (res.students || []).forEach(st => { liveByCode[st.code] = st; });

  if (!brState.dirty || forceReloadRooms) {
    const prevSelectedById = {};
    brState.rooms.forEach(r => {
      const k = r.roomId || ('NUM_' + r.roomNumber);
      prevSelectedById[k] = r.selected !== false;
    });
    brState.rooms = (res.rooms || []).map((rm, idx) => {
      const k = rm.roomId || ('NUM_' + (rm.roomNumber || (idx + 1)));
      return {
        roomId: rm.roomId || '',
        roomNumber: idx + 1,
        roomName: rm.roomName || ('Breakout Room ' + (idx + 1)),
        selected: prevSelectedById[k] !== undefined ? prevSelectedById[k] : true,
        activeJigsawId: rm.activeJigsawId || '',
        activeJigsawTitle: rm.activeJigsawTitle || '',
        activeJigsawCefr: rm.activeJigsawCefr || '',
        members: (rm.members || []).map(m => {
          const live = liveByCode[m.code];
          return {
            code: m.code,
            fullName: live ? live.fullName : m.fullName,
            className: live ? live.className : m.className,
            homeCefr: live ? live.homeCefr : m.homeCefr,
            presenceStatus: live ? live.presenceStatus : (m.presenceStatus || 'OFFLINE'),
            isOnline: live ? live.isOnline : !!m.isOnline,
            kp: live ? live.kp : (m.kp || 0),
            accuracy: live ? live.accuracy : m.accuracy,
            partKey: m.partKey || 'A',
            expertDone: !!m.expertDone
          };
        })
      };
    });
    brState.dirty = false;
  } else {
    // Preserve unsaved teacher room/part edits while refreshing live green dots!
    brState.rooms.forEach((rm, idx) => {
      rm.roomNumber = idx + 1;
      rm.members.forEach(m => {
        const live = liveByCode[m.code];
        if (live) {
          m.presenceStatus = live.presenceStatus;
          m.isOnline = live.isOnline;
          m.kp = live.kp;
          m.accuracy = live.accuracy;
        }
      });
    });
  }

  populateBreakoutScopeAndPicker(res);
  renderBreakoutWorkspace();
}

function populateBreakoutScopeAndPicker(res) {
  // 1. Director Teacher Scope Dropdown
  const tSel = $('brTeacherSelect');
  if (res.role === 'DIRECTOR') {
    tSel.classList.remove('hidden');
    clearEl(tSel);
    const allT = el('option', '👑 All Teachers');
    allT.value = 'ALL';
    tSel.appendChild(allT);
    (res.availableTeachers || []).forEach(t => {
      const o = el('option', '👩‍🏫 ' + t.label);
      o.value = t.key;
      tSel.appendChild(o);
    });
    tSel.value = res.effectiveTeacher || 'ALL';
  } else {
    tSel.classList.add('hidden');
  }

  // 2. Class Cohort Dropdown (with live online count per class)
  const cSel = $('brClassSelect');
  clearEl(cSel);
  const sum = res.summary || {};
  const totalEnrolled = (res.classes || []).reduce((acc, c) => acc + (c.count || 0), 0);
  const totalOnline = (res.classes || []).reduce((acc, c) => acc + (c.onlineCount || 0), 0);
  const allC = el('option', '📚 All Classes (' + totalEnrolled + ' enrolled' + (totalOnline > 0 ? (' · 🟢 ' + totalOnline + ' online') : '') + ')');
  allC.value = 'ALL';
  cSel.appendChild(allC);
  (res.classes || []).forEach(c => {
    const tag = c.onlineCount > 0 ? (' · 🟢 ' + c.onlineCount + ' online') : '';
    const o = el('option', c.className + ' (' + c.count + ' · ' + c.cefr + ')' + tag);
    o.value = c.className;
    cSel.appendChild(o);
  });
  cSel.value = res.activeClassFilter || 'ALL';

  // 3. Speaking Jigsaw Picker (Saved/Live Jigsaws + Instant Ready Templates)
  const picker = $('brJigsawPicker');
  const prevVal = brState.selectedPickerVal || picker.value;
  clearEl(picker);

  if (res.savedJigsaws && res.savedJigsaws.length) {
    const grpSaved = el('optgroup');
    grpSaved.label = '📡 Your Saved & Live Jigsaws';
    res.savedJigsaws.forEach(j => {
      const o = el('option', (j.status === 'LIVE' ? '🟢 ' : '📝 ') + '[' + j.cefr + ' · ' + j.partCount + ' Parts] ' + j.title);
      o.value = 'EXISTING:' + j.jigsawId;
      grpSaved.appendChild(o);
    });
    picker.appendChild(grpSaved);
  }

  const grpTpl = el('optgroup');
  grpTpl.label = '📚 Instant Ready-to-Launch Jigsaw Templates';
  (res.templates || []).forEach(t => {
    const o = el('option', '⚡ [' + t.cefr + ' · ' + t.partCount + ' Parts] ' + t.title + ' (' + t.topic + ')');
    o.value = 'TEMPLATE:' + t.templateIndex;
    grpTpl.appendChild(o);
  });
  picker.appendChild(grpTpl);

  const allValues = Array.from(picker.querySelectorAll('option')).map(o => o.value);
  if (prevVal && allValues.indexOf(prevVal) >= 0) {
    picker.value = prevVal;
  } else {
    const liveSaved = (res.savedJigsaws || []).find(j => j.status === 'LIVE');
    picker.value = liveSaved ? ('EXISTING:' + liveSaved.jigsawId) : (allValues[0] || '');
  }
  brState.selectedPickerVal = picker.value;

  // Keep summary pills updated
  $('brOnlineSummaryText').textContent = '🟢 ' + (sum.onlineCount || 0) + ' Logged In Now · ' + (sum.cohortCount || 0) + ' Enrolled';
  $('brFilterOnlineBtn').textContent = '🟢 Logged In Now (' + (sum.onlineCount || 0) + ')';
  $('brFilterAllBtn').textContent = '📚 Include Offline Roster (' + (sum.cohortCount || 0) + ')';
}

function renderBreakoutPartLegend() {
  const box = $('brPartLegend');
  clearEl(box);
  const meta = getSelectedBreakoutJigsawMeta();
  const lead = el('span', '🧩 Expert Parts (' + meta.partCount + '):', 'muted');
  lead.style.fontSize = '12.5px';
  lead.style.fontWeight = '700';
  box.appendChild(lead);

  const validKeys = JIGSAW_PART_KEYS.slice(0, meta.partCount);
  validKeys.forEach((pk, idx) => {
    const pt = (meta.partTitles || [])[idx];
    const titleTxt = pt && pt.title ? pt.title : ('Part ' + pk);
    const chip = el('span', '', 'br-legend-chip');
    chip.appendChild(el('b', 'Part ' + pk));
    chip.appendChild(el('span', '· ' + titleTxt));
    box.appendChild(chip);
  });
}

function renumberAndNormalizeRooms() {
  const meta = getSelectedBreakoutJigsawMeta();
  const validKeys = JIGSAW_PART_KEYS.slice(0, meta.partCount);
  brState.rooms.forEach((rm, idx) => {
    rm.roomNumber = idx + 1;
    if (!rm.roomName || /^Breakout Room \d+$/.test(rm.roomName)) {
      if (!rm.roomName) rm.roomName = 'Breakout Room ' + (idx + 1);
    }
    rm.members.forEach((m, mIdx) => {
      if (validKeys.indexOf(m.partKey) < 0) {
        m.partKey = validKeys[mIdx % validKeys.length];
      }
    });
  });
}

function firstUncoveredPartForRoom(room) {
  const meta = getSelectedBreakoutJigsawMeta();
  const validKeys = JIGSAW_PART_KEYS.slice(0, meta.partCount);
  const counts = {};
  validKeys.forEach(k => { counts[k] = 0; });
  (room.members || []).forEach(m => {
    if (counts[m.partKey] !== undefined) counts[m.partKey]++;
  });
  let bestKey = validKeys[0];
  let bestCount = Infinity;
  validKeys.forEach(k => {
    if (counts[k] < bestCount) {
      bestCount = counts[k];
      bestKey = k;
    }
  });
  return bestKey;
}

function moveStudentToBreakoutRoom(studentCode, targetRoomIdx) {
  const ws = brState.wsData;
  if (!ws || !studentCode) return;
  const stObj = (ws.students || []).find(s => s.code === studentCode);
  let extracted = null;

  // Remove from any current room first
  brState.rooms.forEach(rm => {
    const foundIdx = rm.members.findIndex(m => m.code === studentCode);
    if (foundIdx >= 0) {
      extracted = rm.members.splice(foundIdx, 1)[0];
    }
  });

  // targetRoomIdx < 0 means return to Unassigned Lobby
  if (targetRoomIdx < 0) {
    brState.dirty = true;
    renderBreakoutWorkspace();
    return;
  }

  // targetRoomIdx >= brState.rooms.length creates a brand-new room!
  if (targetRoomIdx >= brState.rooms.length) {
    const nextNum = brState.rooms.length + 1;
    brState.rooms.push({
      roomId: '',
      roomNumber: nextNum,
      roomName: 'Breakout Room ' + nextNum,
      selected: true,
      activeJigsawId: '',
      activeJigsawTitle: '',
      activeJigsawCefr: '',
      members: []
    });
    targetRoomIdx = brState.rooms.length - 1;
  }

  const destRoom = brState.rooms[targetRoomIdx];
  const assignedPart = firstUncoveredPartForRoom(destRoom);
  const memberRecord = extracted
    ? Object.assign({}, extracted, { partKey: assignedPart })
    : {
        code: stObj ? stObj.code : studentCode,
        fullName: stObj ? stObj.fullName : ('Student #' + studentCode),
        className: stObj ? stObj.className : '',
        homeCefr: stObj ? stObj.homeCefr : 'A2',
        presenceStatus: stObj ? stObj.presenceStatus : 'OFFLINE',
        isOnline: !!(stObj && stObj.isOnline),
        kp: stObj ? stObj.kp : 0,
        accuracy: stObj ? stObj.accuracy : null,
        partKey: assignedPart,
        expertDone: false
      };

  destRoom.members.push(memberRecord);
  brState.dirty = true;
  renderBreakoutWorkspace();
}

function autoBuildBreakoutRooms() {
  const ws = brState.wsData;
  if (!ws) return;
  const allStudents = ws.students || [];
  const pool = brState.poolMode === 'ONLINE'
    ? allStudents.filter(s => s.isOnline)
    : allStudents.slice();

  if (!pool.length) {
    if (brState.poolMode === 'ONLINE' && allStudents.length > 0) {
      showBreakoutStatus('⚠️ 0 students are logged in right now. Have students sign in first, or click "📚 Include Offline Roster" above to pre-build groups!', true, false);
    } else {
      showBreakoutStatus('⚠️ No students found in this class cohort.', true, false);
    }
    return;
  }

  const sizeMode = $('brSizeSelect').value || 'SIZE_3';
  const strategy = $('brStrategySelect').value || 'BALANCED';
  let numRooms = 1;
  if (sizeMode.indexOf('ROOMS_') === 0) {
    const reqR = Number(sizeMode.slice('ROOMS_'.length)) || 2;
    numRooms = Math.min(reqR, Math.max(1, pool.length));
  } else {
    const targetPerRoom = sizeMode === 'SIZE_2' ? 2 : (sizeMode === 'SIZE_4' ? 4 : 3);
    if (pool.length <= targetPerRoom) {
      numRooms = 1;
    } else if (targetPerRoom === 2) {
      numRooms = Math.max(1, Math.floor(pool.length / 2));
    } else {
      numRooms = Math.max(1, Math.round(pool.length / targetPerRoom));
    }
  }

  const cefrRank = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  let ordered = pool.slice();
  if (strategy === 'SHUFFLE') {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = ordered[i];
      ordered[i] = ordered[j];
      ordered[j] = tmp;
    }
  } else if (strategy === 'BALANCED') {
    ordered.sort((a, b) => {
      const scoreA = (a.kp || 0) * 1000 + (a.accuracy !== null && a.accuracy !== undefined ? a.accuracy : 50);
      const scoreB = (b.kp || 0) * 1000 + (b.accuracy !== null && b.accuracy !== undefined ? b.accuracy : 50);
      return scoreB - scoreA;
    });
  } else if (strategy === 'LEVEL') {
    ordered.sort((a, b) => {
      const rDiff = (cefrRank[a.homeCefr] || 2) - (cefrRank[b.homeCefr] || 2);
      if (rDiff !== 0) return rDiff;
      return (b.kp || 0) - (a.kp || 0);
    });
  }

  const buckets = [];
  for (let r = 0; r < numRooms; r++) buckets.push([]);

  if (strategy === 'LEVEL') {
    // Chunk contiguous same-level students into rooms
    const baseSize = Math.floor(ordered.length / numRooms);
    const rem = ordered.length % numRooms;
    let cursor = 0;
    for (let r = 0; r < numRooms; r++) {
      const take = baseSize + (r < rem ? 1 : 0);
      buckets[r] = ordered.slice(cursor, cursor + take);
      cursor += take;
    }
  } else if (strategy === 'BALANCED') {
    // Serpentine snake-draft so every room mixes stronger & developing readers evenly
    ordered.forEach((st, idx) => {
      const cycle = Math.floor(idx / numRooms);
      const pos = idx % numRooms;
      const rIdx = (cycle % 2 === 0) ? pos : (numRooms - 1 - pos);
      buckets[rIdx].push(st);
    });
  } else {
    ordered.forEach((st, idx) => {
      buckets[idx % numRooms].push(st);
    });
  }

  const meta = getSelectedBreakoutJigsawMeta();
  const validKeys = JIGSAW_PART_KEYS.slice(0, meta.partCount);

  brState.rooms = buckets.map((list, idx) => ({
    roomId: (brState.rooms[idx] && brState.rooms[idx].roomId) || '',
    roomNumber: idx + 1,
    roomName: (brState.rooms[idx] && brState.rooms[idx].roomName) || ('Breakout Room ' + (idx + 1)),
    selected: true,
    activeJigsawId: '',
    activeJigsawTitle: '',
    activeJigsawCefr: '',
    members: list.map((st, mIdx) => ({
      code: st.code,
      fullName: st.fullName,
      className: st.className,
      homeCefr: st.homeCefr,
      presenceStatus: st.presenceStatus,
      isOnline: st.isOnline,
      kp: st.kp || 0,
      accuracy: st.accuracy,
      partKey: validKeys[mIdx % validKeys.length],
      expertDone: false
    }))
  }));

  brState.dirty = true;
  brState.viewMode = 'HOME';
  renderBreakoutWorkspace();
  showBreakoutStatus(
    '⚡ Created ' + numRooms + ' Breakout Room(s) from ' + pool.length + ' ' +
    (brState.poolMode === 'ONLINE' ? 'logged-in' : 'enrolled') +
    ' student(s)! Tweak rooms/parts if desired, then click "🚀 Assign Jigsaw to Selected Rooms →" (or "💾 Broadcast Rooms").',
    false,
    false
  );
}

function addEmptyBreakoutRoom() {
  const nextNum = brState.rooms.length + 1;
  brState.rooms.push({
    roomId: '',
    roomNumber: nextNum,
    roomName: 'Breakout Room ' + nextNum,
    selected: true,
    activeJigsawId: '',
    activeJigsawTitle: '',
    activeJigsawCefr: '',
    members: []
  });
  brState.dirty = true;
  brState.viewMode = 'HOME';
  renderBreakoutWorkspace();
}

function placeLatecomers() {
  const ws = brState.wsData;
  if (!ws) return;
  if (!brState.rooms.length) {
    autoBuildBreakoutRooms();
    return;
  }
  const placedCodes = {};
  brState.rooms.forEach(r => r.members.forEach(m => { placedCodes[m.code] = true; }));
  const lateOnline = (ws.students || []).filter(s => s.isOnline && !placedCodes[s.code]);
  if (!lateOnline.length) {
    showBreakoutStatus('✅ Every logged-in student is already placed in a Breakout Room!', false, false);
    return;
  }
  lateOnline.forEach(st => {
    let smallestIdx = 0;
    for (let i = 1; i < brState.rooms.length; i++) {
      if (brState.rooms[i].members.length < brState.rooms[smallestIdx].members.length) {
        smallestIdx = i;
      }
    }
    const targetRoom = brState.rooms[smallestIdx];
    const pk = firstUncoveredPartForRoom(targetRoom);
    targetRoom.members.push({
      code: st.code,
      fullName: st.fullName,
      className: st.className,
      homeCefr: st.homeCefr,
      presenceStatus: st.presenceStatus,
      isOnline: st.isOnline,
      kp: st.kp || 0,
      accuracy: st.accuracy,
      partKey: pk,
      expertDone: false
    });
  });
  brState.dirty = true;
  renderBreakoutWorkspace();
  showBreakoutStatus('⚡ Placed ' + lateOnline.length + ' newly logged-in student(s) into the smallest Breakout Rooms! Click "🚀 Assign Jigsaw to Selected Rooms →" or "💾 Broadcast Rooms" to sync.', false, false);
}

function autoDealRoomParts(room) {
  const meta = getSelectedBreakoutJigsawMeta();
  const validKeys = JIGSAW_PART_KEYS.slice(0, meta.partCount);
  room.members.forEach((m, idx) => {
    m.partKey = validKeys[idx % validKeys.length];
  });
}

function autoDealAllRoomsParts() {
  if (!brState.rooms.length) return;
  brState.rooms.forEach(rm => autoDealRoomParts(rm));
  brState.dirty = true;
  renderBreakoutWorkspace();
  showBreakoutStatus('🔀 Dealt Expert Parts A–' + JIGSAW_PART_KEYS[getSelectedBreakoutJigsawMeta().partCount - 1] + ' evenly across every Breakout Room!', false, false);
}

function serializeBrRooms() {
  return brState.rooms.map((rm, idx) => ({
    roomId: rm.roomId || '',
    roomNumber: idx + 1,
    roomName: (rm.roomName || ('Breakout Room ' + (idx + 1))).trim(),
    activeJigsawId: rm.activeJigsawId || '',
    members: (rm.members || []).map(m => ({
      code: m.code,
      fullName: m.fullName,
      className: m.className,
      homeCefr: m.homeCefr,
      partKey: m.partKey || 'A'
    }))
  }));
}

async function saveBreakoutRoomsNow() {
  if (!brState.rooms.length) {
    showBreakoutStatus('⚠️ Create at least one Breakout Room first (click "⚡ Create Breakout Rooms").', true, false);
    return;
  }
  $('brSaveRoomsBtn').disabled = true;
  $('brSaveRoomsBtn').textContent = '⏳ Broadcasting...';
  try {
    const res = await rpc('breakoutSaveRooms', jigsawEditorCreds({
      teacherFilter: brState.teacherFilter,
      classFilter: brState.classFilter,
      rooms: serializeBrRooms()
    }));
    if (!res || !res.ok) {
      showBreakoutStatus((res && res.error) || 'Could not broadcast Breakout Rooms.', true, false);
      return;
    }
    brState.dirty = false;
    applyBreakoutWorkspaceData(res, true);
    showBreakoutStatus('✅ Broadcasted ' + brState.rooms.length + ' Breakout Room(s) live! Students now see their Breakout Room & teammates on their Dashboard.', false, !!brState.lastAssignedJigsawId);
  } catch (err) {
    showBreakoutStatus(err.message || 'Broadcast failed.', true, false);
  } finally {
    $('brSaveRoomsBtn').disabled = false;
    $('brSaveRoomsBtn').textContent = '💾 Broadcast Rooms';
  }
}

async function clearAllBreakoutRoomsNow() {
  if (!brState.rooms.length && !(brState.wsData && brState.wsData.rooms && brState.wsData.rooms.length)) {
    return;
  }
  $('brClearRoomsBtn').disabled = true;
  try {
    const res = await rpc('breakoutClearRooms', jigsawEditorCreds({
      teacherFilter: brState.teacherFilter,
      classFilter: brState.classFilter
    }));
    if (res && res.ok) {
      brState.rooms = [];
      brState.dirty = false;
      applyBreakoutWorkspaceData(res, true);
      showBreakoutStatus('🧹 Closed all Breakout Rooms for this class scope.', false, false);
    }
  } catch (err) {
    showBreakoutStatus(err.message || 'Could not close Breakout Rooms.', true, false);
  } finally {
    $('brClearRoomsBtn').disabled = false;
  }
}

async function assignJigsawToBreakoutRooms(explicitRoomNumbers) {
  if (!brState.rooms.length) {
    showBreakoutStatus('⚠️ Click "⚡ Create Breakout Rooms" first to group logged-in students!', true, false);
    return;
  }
  renumberAndNormalizeRooms();
  const targetNums = Array.isArray(explicitRoomNumbers) && explicitRoomNumbers.length
    ? explicitRoomNumbers
    : brState.rooms.filter(r => r.selected !== false).map(r => r.roomNumber);

  if (!targetNums.length) {
    showBreakoutStatus('⚠️ Select at least one Breakout Room checkbox (☑) to receive this Speaking Jigsaw.', true, false);
    return;
  }

  const targetedMemberCount = brState.rooms
    .filter(r => targetNums.indexOf(r.roomNumber) >= 0)
    .reduce((acc, r) => acc + r.members.length, 0);

  if (targetedMemberCount === 0) {
    showBreakoutStatus('⚠️ The selected Breakout Room(s) have 0 students! Drag or add logged-in students into the room first.', true, false);
    return;
  }

  const meta = getSelectedBreakoutJigsawMeta();
  const jigsawSource = meta.sourceType === 'EXISTING'
    ? { type: 'EXISTING', jigsawId: meta.jigsawId }
    : { type: 'TEMPLATE', templateIndex: meta.templateIndex };

  $('brAssignSelectedBtn').disabled = true;
  $('brAssignSelectedBtn').textContent = '⏳ Assigning Jigsaw...';
  try {
    const res = await rpc('breakoutAssignJigsaw', jigsawEditorCreds({
      teacherFilter: brState.teacherFilter,
      classFilter: brState.classFilter,
      rooms: serializeBrRooms(),
      targetRoomNumbers: targetNums,
      jigsawSource,
      collabMode: $('brCollabSelect').value || 'CLUE_BOARD',
      pacingMode: $('brPacingSelect').value || 'AUTO',
      exclusiveToGroups: true
    }));
    if (!res || !res.ok) {
      showBreakoutStatus((res && res.error) || 'Could not assign Speaking Jigsaw.', true, false);
      return;
    }

    brState.dirty = false;
    brState.lastAssignedJigsawId = res.jigsawId;
    jStudio.liveJigsawId = res.jigsawId;
    brState.selectedPickerVal = 'EXISTING:' + res.jigsawId;

    if (res.workspace && res.workspace.ok) {
      applyBreakoutWorkspaceData(res.workspace, true);
    } else {
      await pollBreakoutWorkspace(false, true);
    }

    // Refresh Saved & Live Jigsaws list for seamless tab switching
    rpc('jigsawEditorInit', jigsawEditorCreds()).then(ed => {
      if (ed && ed.ok) {
        jStudio.jigsaws = ed.jigsaws || [];
        renderSavedJigsawsList();
      }
    }).catch(() => {});

    showBreakoutStatus(
      '🎉 Assigned "' + res.jigsawTitle + '" to ' + res.targetedRoomsCount + ' Breakout Room(s) (' + res.assignedCount + ' students)! Every group member now has their assigned Part A–' + JIGSAW_PART_KEYS[(res.partCount || 3) - 1] + ' live on their Dashboard.',
      false,
      true
    );
  } catch (err) {
    showBreakoutStatus(err.message || 'Assignment failed.', true, false);
  } finally {
    $('brAssignSelectedBtn').disabled = false;
    $('brAssignSelectedBtn').textContent = '🚀 Assign Jigsaw to Selected Rooms →';
  }
}

function renderBreakoutWorkspace() {
  const ws = brState.wsData;
  if (!ws) return;

  renumberAndNormalizeRooms();
  renderBreakoutPartLegend();

  $('brFilterOnlineBtn').classList.toggle('on', brState.poolMode === 'ONLINE');
  $('brFilterAllBtn').classList.toggle('on', brState.poolMode === 'ALL');
  $('brViewHomeBtn').classList.toggle('on', brState.viewMode === 'HOME');
  $('brViewHuddleBtn').classList.toggle('on', brState.viewMode === 'HUDDLE');
  $('brRoomsGrid').classList.toggle('hidden', brState.viewMode !== 'HOME');
  $('brHuddleGrid').classList.toggle('hidden', brState.viewMode !== 'HUDDLE');

  const selectedCount = brState.rooms.filter(r => r.selected !== false).length;
  $('brAssignSelectedBtn').textContent = selectedCount > 0 && selectedCount < brState.rooms.length
    ? ('🚀 Assign Jigsaw to ' + selectedCount + ' Selected Room(s) →')
    : '🚀 Assign Jigsaw to Selected Rooms →';

  // Determine which students are already placed in rooms
  const placedCodes = {};
  brState.rooms.forEach(rm => {
    rm.members.forEach(m => { placedCodes[m.code] = true; });
  });

  const allStudents = ws.students || [];
  const visiblePool = (brState.poolMode === 'ONLINE'
    ? allStudents.filter(s => s.isOnline)
    : allStudents
  ).filter(s => !placedCodes[s.code]);

  const hiddenOfflineCount = brState.poolMode === 'ONLINE'
    ? allStudents.filter(s => !s.isOnline && !placedCodes[s.code]).length
    : 0;

  $('brLobbyTitle').textContent = brState.poolMode === 'ONLINE'
    ? ('🛋️ Logged-In Unassigned Lobby (' + visiblePool.length + ' waiting' + (hiddenOfflineCount > 0 ? (' · ' + hiddenOfflineCount + ' offline hidden') : '') + ')')
    : ('🛋️ Unassigned Class Roster (' + visiblePool.length + ' unplaced)');

  const lobbyList = $('brLobbyList');
  clearEl(lobbyList);
  if (!visiblePool.length) {
    const emptyMsg = brState.rooms.length > 0
      ? (brState.poolMode === 'ONLINE'
          ? '✅ Every logged-in student is placed in a Breakout Room!'
          : '✅ Every student in this cohort is placed in a Breakout Room!')
      : (brState.poolMode === 'ONLINE'
          ? '0 students are logged in right now. Have students sign in on their devices (they will appear here live within 5 seconds!), or click "📚 Include Offline Roster" above to pre-build groups.'
          : 'No students found in this cohort.');
    lobbyList.appendChild(el('div', emptyMsg, 'muted'));
  } else {
    visiblePool.forEach((st, idx) => {
      const chip = el('div', '', 'br-student-chip');
      chip.draggable = true;
      chip.dataset.studentCode = st.code;
      chip.addEventListener('dragstart', e => {
        brState.dragStudentCode = st.code;
        if (e.dataTransfer) e.dataTransfer.setData('text/plain', st.code);
      });

      chip.appendChild(el('span', '', 'pres-dot ' + st.presenceStatus));
      const shownName = teacherState.hideNames ? ('Student ' + (idx + 1)) : st.fullName;
      chip.appendChild(el('strong', shownName));
      chip.appendChild(el('span', st.homeCefr, 'lvl'));

      const addSel = el('select', '', 't-select');
      addSel.style.padding = '3px 7px';
      addSel.style.fontSize = '11.5px';
      addSel.setAttribute('aria-label', 'Add ' + shownName + ' to Breakout Room');
      const ph = el('option', '+ Room ▾');
      ph.value = '';
      addSel.appendChild(ph);
      brState.rooms.forEach((rm, rIdx) => {
        const o = el('option', '→ ' + rm.roomName);
        o.value = String(rIdx);
        addSel.appendChild(o);
      });
      const newOpt = el('option', '➕ New Breakout Room');
      newOpt.value = String(brState.rooms.length);
      addSel.appendChild(newOpt);
      addSel.addEventListener('change', e => {
        if (e.target.value === '') return;
        moveStudentToBreakoutRoom(st.code, Number(e.target.value));
      });
      chip.appendChild(addSel);
      lobbyList.appendChild(chip);
    });
  }

  // Render Home Breakout Room Cards
  const meta = getSelectedBreakoutJigsawMeta();
  const validKeys = JIGSAW_PART_KEYS.slice(0, meta.partCount);
  const partTitleByKey = {};
  validKeys.forEach((pk, idx) => {
    const pt = (meta.partTitles || [])[idx];
    partTitleByKey[pk] = pt && pt.title ? pt.title : ('Part ' + pk);
  });

  const roomsGrid = $('brRoomsGrid');
  clearEl(roomsGrid);

  if (!brState.rooms.length) {
    const emptyPanel = el('div', '', 'panel');
    emptyPanel.style.gridColumn = '1 / -1';
    emptyPanel.style.textAlign = 'center';
    emptyPanel.appendChild(el('h3', '🚪 Ready to Form Breakout Rooms'));
    emptyPanel.appendChild(el('p', 'Choose room size (Pairs, Trios, Quads, or N Rooms) and click "⚡ Create Breakout Rooms" above — or click "➕ Add Room" and drag logged-in students in!', 'muted'));
    roomsGrid.appendChild(emptyPanel);
  } else {
    brState.rooms.forEach((room, rIdx) => {
      const card = el('div', '', 'br-room-card' + (room.selected !== false ? ' selected' : ''));
      card.dataset.roomNumber = String(room.roomNumber);

      card.addEventListener('dragover', e => {
        e.preventDefault();
        card.classList.add('drop-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-over'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('drop-over');
        const code = brState.dragStudentCode || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
        if (code) moveStudentToBreakoutRoom(code, rIdx);
        brState.dragStudentCode = '';
      });

      // Header: Checkbox + Editable Room Name + Delete Room Button
      const head = el('div', '', 'state');
      const chk = el('input');
      chk.type = 'checkbox';
      chk.checked = room.selected !== false;
      chk.title = 'Include this room when clicking Assign Jigsaw to Selected Rooms';
      chk.style.width = '17px';
      chk.style.height = '17px';
      chk.style.cursor = 'pointer';
      chk.addEventListener('change', e => {
        room.selected = e.target.checked;
        renderBreakoutWorkspace();
      });
      head.appendChild(chk);

      const nameInp = el('input', '', 'br-room-name-inp');
      nameInp.type = 'text';
      nameInp.value = room.roomName;
      nameInp.setAttribute('aria-label', 'Breakout Room ' + room.roomNumber + ' Name');
      nameInp.addEventListener('input', e => {
        room.roomName = e.target.value;
        brState.dirty = true;
      });
      head.appendChild(nameInp);

      const delBtn = el('button', '✕', 'iconBtn');
      delBtn.type = 'button';
      delBtn.title = 'Remove this Breakout Room (returns members to Lobby)';
      delBtn.style.padding = '4px 8px';
      delBtn.style.fontSize = '12px';
      delBtn.addEventListener('click', () => {
        brState.rooms.splice(rIdx, 1);
        brState.dirty = true;
        renderBreakoutWorkspace();
      });
      head.appendChild(delBtn);
      card.appendChild(head);

      // Sub-header: Online count + Expert Part A..D Coverage Check + Active Jigsaw Chip
      const subRow = el('div', '', 't-controls');
      const onlineInRoom = room.members.filter(m => m.isOnline).length;
      subRow.appendChild(el('span', '👥 ' + room.members.length + ' · 🟢 ' + onlineInRoom + ' online', 'chip'));

      const covered = {};
      room.members.forEach(m => { covered[m.partKey] = true; });
      const missingParts = validKeys.filter(pk => !covered[pk]);

      if (room.members.length === 0) {
        subRow.appendChild(el('span', '🛋️ Drag students here', 'badge new'));
      } else if (missingParts.length === 0) {
        subRow.appendChild(el('span', '✅ All ' + validKeys.length + ' Parts Covered', 'badge done'));
      } else {
        subRow.appendChild(el('span', '⚠️ Missing Part ' + missingParts.join(', '), 'badge prog'));
      }
      card.appendChild(subRow);

      if (room.activeJigsawTitle) {
        const activeInfo = el('div', '🧩 Live Assigned: [' + (room.activeJigsawCefr || 'A2') + '] ' + room.activeJigsawTitle, 'help-chip');
        activeInfo.style.background = 'var(--goodBg)';
        activeInfo.style.borderColor = 'var(--good)';
        activeInfo.style.color = 'var(--good)';
        card.appendChild(activeInfo);
      }

      // Member Rows with Clickable Part A / B / C / [D] Role Pills + Move Selector
      const memBox = el('div');
      memBox.style.display = 'flex';
      memBox.style.flexDirection = 'column';
      memBox.style.gap = '8px';

      if (!room.members.length) {
        memBox.appendChild(el('div', 'Drop logged-in students from the Lobby above or use "+ Room ▾" on any student chip.', 'muted'));
      } else {
        room.members.forEach((mem, mIdx) => {
          const mRow = el('div', '', 'br-member-row');
          mRow.draggable = true;
          mRow.dataset.studentCode = mem.code;
          mRow.addEventListener('dragstart', e => {
            brState.dragStudentCode = mem.code;
            if (e.dataTransfer) e.dataTransfer.setData('text/plain', mem.code);
          });

          const topLine = el('div', '', 'state');
          const idWrap = el('div');
          idWrap.style.display = 'flex';
          idWrap.style.alignItems = 'center';
          idWrap.style.gap = '7px';
          idWrap.appendChild(el('span', '', 'pres-dot ' + (mem.presenceStatus || 'OFFLINE')));
          const shown = teacherState.hideNames ? ('Member ' + (mIdx + 1)) : mem.fullName;
          idWrap.appendChild(el('strong', shown));
          idWrap.appendChild(el('span', mem.homeCefr || 'A2', 'lvl'));
          topLine.appendChild(idWrap);

          const moveSel = el('select', '', 't-select');
          moveSel.style.padding = '2px 6px';
          moveSel.style.fontSize = '11.5px';
          moveSel.setAttribute('aria-label', 'Move ' + shown);
          const curOpt = el('option', 'Move ▾');
          curOpt.value = '';
          moveSel.appendChild(curOpt);
          const lobOpt = el('option', '↩ Return to Lobby');
          lobOpt.value = '-1';
          moveSel.appendChild(lobOpt);
          brState.rooms.forEach((otherRm, oIdx) => {
            if (oIdx === rIdx) return;
            const o = el('option', '→ ' + otherRm.roomName);
            o.value = String(oIdx);
            moveSel.appendChild(o);
          });
          moveSel.addEventListener('change', e => {
            if (e.target.value === '') return;
            moveStudentToBreakoutRoom(mem.code, Number(e.target.value));
          });
          topLine.appendChild(moveSel);
          mRow.appendChild(topLine);

          const roleLine = el('div', '', 'state');
          const roleLbl = el('span', 'Assign Reading Part:', 'muted');
          roleLbl.style.fontSize = '11.5px';
          roleLbl.style.fontWeight = '700';
          roleLine.appendChild(roleLbl);

          const pillsWrap = el('div', '', 'br-part-pills');
          validKeys.forEach(pk => {
            const pBtn = el('button', 'Part ' + pk, 'br-part-pill' + (mem.partKey === pk ? ' on' : ''));
            pBtn.type = 'button';
            pBtn.title = 'Assign Part ' + pk + ': ' + (partTitleByKey[pk] || '');
            pBtn.addEventListener('click', () => {
              mem.partKey = pk;
              brState.dirty = true;
              renderBreakoutWorkspace();
            });
            pillsWrap.appendChild(pBtn);
          });
          roleLine.appendChild(pillsWrap);
          mRow.appendChild(roleLine);

          memBox.appendChild(mRow);
        });
      }
      card.appendChild(memBox);

      // Room Footer: Auto-Deal inside room + 1-Click Assign Jigsaw ONLY to this Group
      const foot = el('div', '', 'state');
      foot.style.marginTop = 'auto';
      foot.style.paddingTop = '6px';

      const dealBtn = el('button', '🔀 Deal A–' + validKeys[validKeys.length - 1], 'iconBtn');
      dealBtn.type = 'button';
      dealBtn.style.fontSize = '12px';
      dealBtn.style.padding = '5px 9px';
      dealBtn.addEventListener('click', () => {
        autoDealRoomParts(room);
        brState.dirty = true;
        renderBreakoutWorkspace();
      });
      foot.appendChild(dealBtn);

      const assignOneBtn = el('button', '🧩 Assign Only to This Group', 'btn ghost');
      assignOneBtn.type = 'button';
      assignOneBtn.style.fontSize = '12px';
      assignOneBtn.style.padding = '6px 11px';
      assignOneBtn.disabled = room.members.length === 0;
      assignOneBtn.addEventListener('click', () => assignJigsawToBreakoutRooms([room.roomNumber]));
      foot.appendChild(assignOneBtn);

      card.appendChild(foot);
      roomsGrid.appendChild(card);
    });
  }

  // Render Expert Huddle Groups View (All Part A's together, All Part B's together, etc.)
  const huddleGrid = $('brHuddleGrid');
  clearEl(huddleGrid);
  validKeys.forEach(pk => {
    const hCard = el('div', '', 'br-room-card');
    const hHead = el('div', '', 'state');
    hHead.appendChild(el('strong', '🔬 Expert Huddle — Part ' + pk));
    hHead.appendChild(el('span', partTitleByKey[pk] || ('Part ' + pk), 'lvl'));
    hCard.appendChild(hHead);

    const experts = [];
    brState.rooms.forEach(rm => {
      rm.members.forEach(m => {
        if (m.partKey === pk) experts.push({ member: m, roomName: rm.roomName });
      });
    });

    if (!experts.length) {
      hCard.appendChild(el('div', 'No students assigned to Part ' + pk + ' yet.', 'muted'));
    } else {
      experts.forEach((item, idx) => {
        const row = el('div', '', 'team-member-row');
        const left = el('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '7px';
        left.appendChild(el('span', '', 'pres-dot ' + (item.member.presenceStatus || 'OFFLINE')));
        const shown = teacherState.hideNames ? ('Expert ' + (idx + 1)) : item.member.fullName;
        left.appendChild(el('strong', shown));
        row.appendChild(left);
        row.appendChild(el('span', '🚪 ' + item.roomName, 'part-badge'));
        hCard.appendChild(row);
      });
    }
    huddleGrid.appendChild(hCard);
  });
}

function renderStudentBreakoutBanner(br) {
  const box = $('studentBreakoutBanner');
  if (!box) return;
  clearEl(box);
  if (!br || !br.roomName) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');

  const left = el('div');
  left.style.display = 'flex';
  left.style.flexDirection = 'column';
  left.style.gap = '6px';

  left.appendChild(el('div', '🚪 YOUR LIVE CLASSROOM BREAKOUT GROUP', 'eyebrow'));
  const titleLine = el('div');
  titleLine.style.fontWeight = '800';
  titleLine.style.fontSize = '18px';
  titleLine.textContent = '🚪 ' + br.roomName + (br.myPartKey ? (' · 🧩 Expert Part ' + br.myPartKey) : '');
  left.appendChild(titleLine);

  if (Array.isArray(br.members) && br.members.length) {
    const teamRow = el('div', '', 't-controls');
    teamRow.appendChild(el('span', 'Group Members:', 'muted'));
    br.members.forEach(m => {
      const lbl = (m.isMe ? ('⭐ ' + m.name + ' (You)') : ('👤 ' + m.name)) + (m.partKey ? (' · Part ' + m.partKey) : '');
      teamRow.appendChild(el('span', lbl, 'part-badge'));
    });
    left.appendChild(teamRow);
  }

  if (br.activeJigsawTitle) {
    left.appendChild(el('div', '📚 Assigned Group Jigsaw: [' + (br.activeJigsawCefr || 'A2') + '] ' + br.activeJigsawTitle, 'muted'));
  } else {
    left.appendChild(el('div', 'Your teacher placed you in this Breakout Group! Stay ready — your group reading will appear here.', 'muted'));
  }
  box.appendChild(left);

  if (br.activeJigsawId) {
    const openBtn = el('button', '🧩 Open Group Jigsaw (Part ' + (br.myPartKey || 'A') + ') →', 'btn');
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => openStudentJigsaw(br.activeJigsawId));
    box.appendChild(openBtn);
  }
}

// Breakout Workspace Event Listeners
$('brTeacherSelect').addEventListener('change', e => {
  brState.teacherFilter = e.target.value || 'ALL';
  brState.classFilter = 'ALL';
  brState.dirty = false;
  pollBreakoutWorkspace(true, true);
});
$('brClassSelect').addEventListener('change', e => {
  brState.classFilter = e.target.value || 'ALL';
  brState.dirty = false;
  pollBreakoutWorkspace(true, true);
});
$('brRefreshBtn').addEventListener('click', () => pollBreakoutWorkspace(true, false));
$('brFilterOnlineBtn').addEventListener('click', () => {
  brState.poolMode = 'ONLINE';
  renderBreakoutWorkspace();
});
$('brFilterAllBtn').addEventListener('click', () => {
  brState.poolMode = 'ALL';
  renderBreakoutWorkspace();
});
$('brAutoBuildBtn').addEventListener('click', () => autoBuildBreakoutRooms());
$('brAddRoomBtn').addEventListener('click', () => addEmptyBreakoutRoom());
$('brPlaceLateBtn').addEventListener('click', () => placeLatecomers());
$('brGoCreateCustomBtn').addEventListener('click', () => switchJigsawStudioTab('CREATE'));

$('brJigsawPicker').addEventListener('change', e => {
  brState.selectedPickerVal = e.target.value;
  const meta = getSelectedBreakoutJigsawMeta();
  if (meta.sourceType === 'EXISTING') {
    $('brCollabSelect').value = meta.collabMode || 'CLUE_BOARD';
    $('brPacingSelect').value = meta.pacingMode || 'AUTO';
  }
  renumberAndNormalizeRooms();
  renderBreakoutWorkspace();
});

$('brAutoDealPartsBtn').addEventListener('click', () => autoDealAllRoomsParts());
$('brSaveRoomsBtn').addEventListener('click', () => saveBreakoutRoomsNow());
$('brAssignSelectedBtn').addEventListener('click', () => assignJigsawToBreakoutRooms(null));
$('brOpenLiveAfterAssignBtn').addEventListener('click', () => {
  if (brState.lastAssignedJigsawId) jStudio.liveJigsawId = brState.lastAssignedJigsawId;
  switchJigsawStudioTab('LIVE');
});

$('brLobbyBox').addEventListener('dragover', e => {
  e.preventDefault();
  $('brLobbyBox').classList.add('drop-over');
});
$('brLobbyBox').addEventListener('dragleave', () => $('brLobbyBox').classList.remove('drop-over'));
$('brLobbyBox').addEventListener('drop', e => {
  e.preventDefault();
  $('brLobbyBox').classList.remove('drop-over');
  const code = brState.dragStudentCode || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
  if (code) moveStudentToBreakoutRoom(code, -1);
  brState.dragStudentCode = '';
});

$('brViewHomeBtn').addEventListener('click', () => {
  brState.viewMode = 'HOME';
  renderBreakoutWorkspace();
});
$('brViewHuddleBtn').addEventListener('click', () => {
  brState.viewMode = 'HUDDLE';
  renderBreakoutWorkspace();
});
$('brSelectAllRoomsBtn').addEventListener('click', () => {
  const allChecked = brState.rooms.length > 0 && brState.rooms.every(r => r.selected !== false);
  brState.rooms.forEach(r => { r.selected = !allChecked; });
  renderBreakoutWorkspace();
});
$('brClearRoomsBtn').addEventListener('click', () => clearAllBreakoutRoomsNow());


/* ---------- Jigsaw Step 2 Spoken Voice Clue Recorder Listeners ---------- */
$('jVcRecBtn').addEventListener('click', async () => {
  if (state.busy || !jStudent.data) return;
  try {
    await jigsawVoiceRec.start({
      maxSeconds: 50,
      onTick: sec => { $('jVcTimer').textContent = formatAudioClock(sec); },
      onAutoStop: rec => { if (rec) onJigsawVoiceCaptured(rec); }
    });
    $('jVoiceClueBox').classList.add('recording');
    $('jVcStatus').textContent = '🔴 Recording your Expert Clue… Explain your part in your own words!';
    $('jVcRecBtn').classList.add('hidden');
    $('jVcStopBtn').classList.remove('hidden');
    $('jVcPlayBtn').classList.add('hidden');
    $('jVcUploadBtn').classList.add('hidden');
  } catch (err) {
    showToast(err.message || 'Microphone access denied.');
  }
});

function onJigsawVoiceCaptured(rec) {
  $('jVoiceClueBox').classList.remove('recording');
  $('jVcStatus').textContent = '✅ Captured ' + rec.durationSeconds + 's — Preview or Share with Home Team!';
  $('jVcStopBtn').classList.add('hidden');
  $('jVcRecBtn').classList.remove('hidden');
  $('jVcRecBtn').textContent = '↺ Re-Record';
  $('jVcPlayBtn').classList.remove('hidden');
  $('jVcUploadBtn').classList.remove('hidden');
}

$('jVcStopBtn').addEventListener('click', async () => {
  const rec = await jigsawVoiceRec.stop();
  if (rec) onJigsawVoiceCaptured(rec);
});

$('jVcPlayBtn').addEventListener('click', () => {
  if (jigsawVoiceRec.lastUrl) {
    if (activeAudioPlayer) { try { activeAudioPlayer.pause(); } catch (e) {} }
    activeAudioPlayer = new Audio(jigsawVoiceRec.lastUrl);
    activeAudioPlayer.play().catch(() => {});
  }
});

$('jVcUploadBtn').addEventListener('click', async () => {
  if (state.busy || !jigsawVoiceRec.lastBlob || !jStudent.data) return;
  state.busy = true;
  $('jVcUploadBtn').disabled = true;
  $('jVcUploadBtn').textContent = '⏳ Uploading & Transcribing…';
  try {
    const b64 = await blobToBase64(jigsawVoiceRec.lastBlob);
    const res = await rpc('jigsawUploadVoiceClue', {
      auth: state.code,
      jigsawId: jStudent.data.jigsaw.jigsawId,
      base64Audio: b64,
      mimeType: jigsawVoiceRec.lastMime,
      durationSeconds: jigsawVoiceRec.lastDurationSec
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not upload voice clue.');
    jStudent.data.assignment.voiceFileId = res.voiceFileId;
    jStudent.data.assignment.voiceDuration = res.voiceDuration;
    if (res.transcript && !$('jMyClueInput').value.trim()) {
      $('jMyClueInput').value = res.transcript;
      jStudent.data.assignment.expertNote = res.transcript;
    }
    jigsawVoiceRec.resetPreviewUrl();
    $('jVcPlayBtn').classList.add('hidden');
    $('jVcUploadBtn').classList.add('hidden');
    $('jVcRecBtn').textContent = '🎙️ Record Voice Clue';
    showToast('🎙️ Spoken Voice Clue shared with your Home Team!');
    await openStudentJigsaw(jStudent.data.jigsaw.jigsawId, jStudent.previewPart || '', true);
  } catch (err) {
    showToast(err.message || 'Voice clue upload failed.');
  } finally {
    state.busy = false;
    $('jVcUploadBtn').disabled = false;
    $('jVcUploadBtn').textContent = '📤 Share Voice Clue with Team';
  }
});

/* ---------- Application Bootstrap & Session Auto-Restore ---------- */
(function init() {
  applySettings();
  if (SPE_CFG.emailLinkerUrl && $('emailLinkerBtn')) {
    $('emailLinkerBtn').href = SPE_CFG.emailLinkerUrl;
  }
  ensureBridgeReady().catch(() => {});
  populateTeacherSelectOptions(null);

  rpc('teacherListPublic').then(res => {
    if (res && res.ok && Array.isArray(res.teachers) && res.teachers.length) {
      populateTeacherSelectOptions(res.teachers);
    }
  }).catch(() => {});

  try {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('mode') === 'teacher' || params.get('role') === 'teacher') {
      setLoginMode('teacher');
    }
  } catch (e) {}

  try {
    const savedTeacher = JSON.parse(sessionStorage.getItem('ttsl_teacher_auth') || 'null');
    if (savedTeacher && savedTeacher.session) {
      teacherState.session = savedTeacher.session;
      teacherState.role = savedTeacher.role || 'TEACHER';
      teacherState.teacher = savedTeacher.teacher || '';
      teacherState.displayName = savedTeacher.displayName || savedTeacher.teacher || 'Teacher';
      teacherState.teacherFilter = teacherState.role === 'TEACHER' ? teacherState.teacher : 'ALL';
      showView('loadingView');
      $('loadingText').textContent = 'Reconnecting Live Speaking Radar...';
      rpc('teacherLivePoll', {
        session: teacherState.session,
        teacherFilter: teacherState.teacherFilter,
        classFilter: 'ALL',
        lessonFilter: 'AUTO'
      }).then(res => {
        if (res && res.ok) {
          $('logoutBtn').classList.remove('hidden');
          $('subBrand').textContent = 'Live Speaking Radar · ' + teacherState.displayName;
          renderTeacherRadar(res.data);
          showView('teacherView');
          startTeacherPolling();
        } else {
          sessionStorage.removeItem('ttsl_teacher_auth');
          teacherState.session = '';
          setLoginMode('teacher');
          showView('loginView');
        }
      }).catch(() => {
        setLoginMode('teacher');
        showView('loginView');
      });
      return;
    }

    const savedStudent = JSON.parse(sessionStorage.getItem('ttsl_portal_auth') || 'null');
    if (savedStudent && savedStudent.code) {
      state.portalContext = savedStudent;
      state.code = {
        code: savedStudent.code,
        email: savedStudent.email,
        session: savedStudent.session
      };
      showView('loadingView');
      $('loadingText').textContent = 'Reconnecting your Speaking Lab...';
      rpc('listSpeakingLessons', state.code).then(data => {
        renderDashboard(data);
        showView('dashboardView');
      }).catch(() => {
        sessionStorage.removeItem('ttsl_portal_auth');
        showView('loginView');
      });
    }
  } catch (e) {}
})();
