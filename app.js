/**
 * Talk Today Speaking Portal — Top-Level HTTPS Frontend (TT Portal Protected)
 *
 * SECURITY & ARCHITECTURE INVARIANTS:
 *  1. ZERO `.innerHTML` or `insertAdjacentHTML` — every dynamic element uses `document.createElement` + `textContent`.
 *  2. Runs top-level over HTTPS so `navigator.mediaDevices.getUserMedia` works cleanly without GAS iframe restrictions.
 *  3. Communicates with the isolated standalone Apps Script backend via a hidden RPC bridge (`?page=bridge`).
 *  4. Authenticates students via The TT Portal (`portalOpen`: Student Code + Registered Guardian Email)
 *     and teachers via `teacherOpen` (strict Teacher-of-the-Class isolation).
 *  5. Strictly hides AI rubric scores, bands, and transcripts from students.
 */
(function () {
  'use strict';

  var cfg = window.SPE_PUBLIC_CONFIG || {};
  var urlParams = new URLSearchParams(window.location.search);

  var state = {
    webAppUrl: String(cfg.appsScriptWebAppUrl || ''),
    bridgeToken: 'bridge_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    bridgeFrame: null,
    bridgeWindow: null,
    bridgeReady: false,
    bridgeQueue: [],
    rpcSeq: 0,
    rpcPending: {},

    // TT Portal Student Session (in-memory only — safe on shared classroom tablets/computers)
    auth: {
      code: '',
      email: '',
      session: '',
      lang: 'en'
    },
    student: null,
    siblings: [],
    appData: null,

    // Speaking Runner State
    attemptId: '',
    sessionId: 'sess_' + Math.random().toString(36).slice(2, 10),
    level: (urlParams.get('level') || '').toUpperCase(),
    tasks: [],
    taskIndex: 0,
    phase: 'ready',
    mediaRecorder: null,
    mediaStream: null,
    chunks: [],
    timerId: null,
    startAt: 0,
    currentBlob: null,
    currentMime: '',
    currentDuration: 0,
    recordingStartedAt: '',
    recordingEndedAt: '',
    rerecordCount: 0,
    maxRerecords: 1,
    micCheckSeconds: 5,
    micRecording: false,
    submitting: false,
    busy: false,
    beaconTimer: null,

    // Teacher Radar State
    teacherSession: '',
    teacherRole: '',
    teacherName: '',
    teacherHideNames: false,
    teacherPollTimer: null,
    teacherCurrentAttemptId: ''
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }

  function toast(msg, bad) {
    var t = $('toast');
    if (!t) return;
    t.textContent = String(msg || '');
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 4500);
  }

  function isoNow() { return new Date().toISOString(); }
  function ua() { return navigator.userAgent || ''; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  }

  function deviceLabel() {
    var u = ua();
    if (/iPhone|iPad/i.test(u)) return 'iOS Safari/WebKit';
    if (/Android/i.test(u)) return 'Android Chrome';
    if (/Safari/i.test(u) && !/Chrome|CriOS|Edg/i.test(u)) return 'Desktop Safari';
    if (/Chrome|CriOS/i.test(u)) return 'Chrome';
    return 'Browser';
  }

  // =========================================================================
  // 1. HIDDEN APPS SCRIPT BRIDGE (Top-Level Microphone + GAS Backend)
  // =========================================================================

  function flushBridgeQueue_() {
    if (!state.bridgeReady || !state.bridgeWindow) return;
    while (state.bridgeQueue.length) {
      state.bridgeWindow.postMessage(state.bridgeQueue.shift(), '*');
    }
  }

  function initBridge_() {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:$|[?#])/.test(state.webAppUrl)) {
      $('connPill').textContent = 'Backend Not Configured';
      return;
    }

    window.addEventListener('message', function (ev) {
      var data = ev && ev.data;
      if (!data || data.token !== state.bridgeToken) return;

      if (data.type === 'SPE_BRIDGE_READY') {
        state.bridgeWindow = ev.source;
        state.bridgeReady = true;
        $('connPill').textContent = '🔒 TT Portal Ready';
        $('connPill').classList.add('ready');
        flushBridgeQueue_();
        loadPublicTeachers_();
        return;
      }

      if (data.type !== 'SPE_GAS_RESULT') return;
      if (!state.bridgeWindow || ev.source !== state.bridgeWindow) return;
      var pending = state.rpcPending[data.id];
      if (!pending) return;
      delete state.rpcPending[data.id];
      clearTimeout(pending.timeoutId);
      if (data.ok) pending.onOk && pending.onOk(data.result);
      else pending.onErr && pending.onErr(new Error(data.error || 'Request failed'));
    });

    var sep = state.webAppUrl.indexOf('?') === -1 ? '?' : '&';
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.border = '0';
    frame.src = state.webAppUrl + sep + 'page=bridge&token=' + encodeURIComponent(state.bridgeToken);
    document.body.appendChild(frame);
    state.bridgeFrame = frame;
  }

  function rpc(fnName, args) {
    return new Promise(function (resolve, reject) {
      if (typeof google !== 'undefined' && google.script && google.script.run) {
        var runner = google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(function (err) {
            reject(new Error((err && err.message) || String(err || 'Request failed')));
          });
        runner[fnName].apply(runner, args || []);
        return;
      }

      if (!state.bridgeFrame) {
        reject(new Error('Talk Today Portal server is not connected.'));
        return;
      }

      var id = 'rpc_' + (++state.rpcSeq) + '_' + Date.now();
      var timeoutId = setTimeout(function () {
        if (!state.rpcPending[id]) return;
        delete state.rpcPending[id];
        reject(new Error('The server took too long to respond. Please try again.'));
      }, 180000);

      state.rpcPending[id] = { onOk: resolve, onErr: reject, timeoutId: timeoutId };
      var msg = {
        type: 'SPE_GAS_CALL',
        token: state.bridgeToken,
        id: id,
        fnName: fnName,
        args: args || []
      };

      if (state.bridgeReady && state.bridgeWindow) state.bridgeWindow.postMessage(msg, '*');
      else state.bridgeQueue.push(msg);
    });
  }

  // =========================================================================
  // 2. VIEW SWITCHING & PROGRESS ANIMATION
  // =========================================================================

  function showTopView(viewId) {
    ['loginView', 'studentPortalView', 'teacherView'].forEach(function (id) {
      $(id).classList.toggle('hidden', id !== viewId);
    });
    $('logoutBtn').classList.toggle('hidden', viewId === 'loginView');
  }

  var progTimer = null;
  function startLoginProgress_(stages) {
    var box = $('portalProgBox');
    var fill = $('progBarFill');
    var lbl = $('progStageLabel');
    box.classList.add('active');
    var idx = 0;
    fill.style.width = '24%';
    lbl.textContent = stages[0];
    clearInterval(progTimer);
    progTimer = setInterval(function () {
      idx = Math.min(idx + 1, stages.length - 1);
      fill.style.width = Math.min(92, (idx + 1) * 25) + '%';
      lbl.textContent = stages[idx];
    }, 550);
  }

  function stopLoginProgress_() {
    clearInterval(progTimer);
    $('portalProgBox').classList.remove('active');
  }

  // Role Tabs (Student vs Class Teacher)
  function switchRoleTab_(mode) {
    var isTeacher = mode === 'teacher';
    $('roleStudentBtn').classList.toggle('on', !isTeacher);
    $('roleTeacherBtn').classList.toggle('on', isTeacher);
    $('portalStudentHead').classList.toggle('hidden', isTeacher);
    $('portalForm').classList.toggle('hidden', isTeacher);
    $('portalSupportLink').classList.toggle('hidden', isTeacher);
    $('portalTeacherHead').classList.toggle('hidden', !isTeacher);
    $('teacherLoginForm').classList.toggle('hidden', !isTeacher);
    $('otpVerifyBox').classList.add('hidden');
    $('portalSupportForm').classList.add('hidden');
    $('loginErr').textContent = '';
  }

  $('roleStudentBtn').onclick = function () { switchRoleTab_('student'); };
  $('roleTeacherBtn').onclick = function () { switchRoleTab_('teacher'); };

  if (urlParams.get('mode') === 'teacher') {
    switchRoleTab_('teacher');
  }

  // =========================================================================
  // 3. TT PORTAL STUDENT AUTHENTICATION, SIBLING SWITCHER & SUPPORT TICKETS
  // =========================================================================

  async function doStudentLogin_(code, email) {
    if (state.busy) return;
    $('loginErr').textContent = '';
    if (!code) {
      $('loginErr').textContent = 'Please enter your Student Code.';
      return;
    }
    var isOwnerWord = code.toLowerCase() === 'jamalmorelli' || email.toLowerCase() === 'jamalmorelli';
    if (!isOwnerWord && !email) {
      $('loginErr').textContent = 'Please enter your Registered Guardian Email.';
      return;
    }

    state.busy = true;
    $('loginSubmitBtn').disabled = true;
    startLoginProgress_([
      'Verifying student record...',
      'Checking registered guardian email...',
      'Loading cohort speaking pack...',
      'Opening Speaking Portal...'
    ]);

    try {
      var res = await rpc('portalOpen', [{
        code: code,
        email: email || code,
        session: state.auth.session,
        lang: 'en'
      }]);

      stopLoginProgress_();
      if (!res || !res.ok) {
        if (res && res.session) state.auth.session = res.session;
        if (res && res.needVerification) {
          state.auth.code = code;
          state.auth.email = email;
          $('otpVerifyBox').classList.remove('hidden');
          $('loginErr').textContent = 'Please verify your email with a 6-digit code.';
          return;
        }
        $('loginErr').textContent = (res && res.error) || 'Sign-in failed.';
        return;
      }

      state.auth.code = res.student.code;
      state.auth.email = isOwnerWord ? 'jamalmorelli' : email;
      state.auth.session = res.session || '';
      state.student = res.student;
      state.siblings = res.siblings || [];
      state.appData = res.appData || {};

      enterStudentPortal_();
    } catch (err) {
      stopLoginProgress_();
      $('loginErr').textContent = err.message || 'Could not sign in.';
    } finally {
      state.busy = false;
      $('loginSubmitBtn').disabled = false;
    }
  }

  $('portalForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    doStudentLogin_($('studentCode').value.trim(), $('parentEmail').value.trim());
  });

  // OTP handlers
  $('btnSendOtp').onclick = async function () {
    $('otpMsg').textContent = '';
    $('btnSendOtp').disabled = true;
    try {
      var r = await rpc('portalRequestCode', [{
        code: state.auth.code,
        email: state.auth.email,
        session: state.auth.session
      }]);
      if (r && r.session) state.auth.session = r.session;
      $('otpMsg').textContent = r && r.sent ? ('Code prepared for ' + r.to) : 'Could not send verification code.';
    } catch (e) {
      $('otpMsg').textContent = e.message;
    } finally {
      $('btnSendOtp').disabled = false;
    }
  };

  $('btnVerifyOtp').onclick = async function () {
    $('otpMsg').textContent = '';
    try {
      var r = await rpc('portalVerifyCode', [{
        otp: $('otpInput').value.trim(),
        session: state.auth.session
      }]);
      if (r && r.verified) {
        state.auth.session = r.session || state.auth.session;
        $('otpVerifyBox').classList.add('hidden');
        await doStudentLogin_(state.auth.code, state.auth.email);
      } else {
        $('otpMsg').textContent = 'Invalid or expired code.';
      }
    } catch (e) {
      $('otpMsg').textContent = e.message;
    }
  };

  // Support Ticket Form
  $('showSupportFormLink').onclick = function (ev) {
    ev.preventDefault();
    $('portalSupportForm').classList.remove('hidden');
    $('supCode').value = $('studentCode').value.trim();
    $('supEmail').value = $('parentEmail').value.trim();
  };

  $('cancelSupportBtn').onclick = function () {
    $('portalSupportForm').classList.add('hidden');
    $('supMsg').textContent = '';
  };

  $('portalSupportForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var c = $('supCode').value.trim();
    var n = $('supName').value.trim();
    var em = $('supEmail').value.trim();
    if (!c && !n && !em) {
      $('supMsg').textContent = 'Please enter your student code or name.';
      return;
    }
    $('supBtn').disabled = true;
    try {
      await rpc('submitSupportTicket', [c, n, em]);
      $('portalSupportForm').classList.add('hidden');
      toast('Support request sent to Talk Today Administration.');
    } catch (e) {
      $('supMsg').textContent = e.message || 'Could not submit support request.';
    } finally {
      $('supBtn').disabled = false;
    }
  });

  function enterStudentPortal_() {
    stopTeacherPolling_();
    var st = state.student || {};
    var prof = (state.appData && state.appData.profile) || {};

    $('dashStudentName').textContent = st.fullName || 'Student';
    $('dashStudentCode').textContent = '#' + (st.code || '');
    $('dashClassChip').textContent = '📚 ' + (st.className || 'Talk Today Cohort');
    $('dashTeacherChip').textContent = '👩‍🏫 ' + (st.teacher || 'Staff');
    $('dashPackChip').textContent = '🎯 Recommended: ' + (prof.assignedPack || 'BEG');
    $('dashAgeChip').textContent = '👶 ' + (prof.ageBand || 'Student');

    // Sibling Switcher
    var sibBar = $('siblingBar');
    var sibBtns = $('siblingButtons');
    sibBtns.replaceChildren();
    if (state.siblings && state.siblings.length > 1) {
      sibBar.classList.add('visible');
      state.siblings.forEach(function (sib) {
        var b = el('button', sib.name + ' (#' + sib.id + ')', 'sibling-btn' + (String(sib.id) === String(st.code) ? ' active' : ''));
        b.type = 'button';
        b.onclick = function () {
          if (String(sib.id) === String(st.code)) return;
          resetRunnerState_();
          doStudentLogin_(String(sib.id), state.auth.email);
        };
        sibBtns.appendChild(b);
      });
    } else {
      sibBar.classList.remove('visible');
    }

    // Pack selector & cohort tailoring
    var defaultPack = prof.assignedPack || 'BEG';
    if (['BEG', 'INT', 'ADV'].indexOf(state.level) >= 0 && !prof.packLockedByTeacher) {
      $('packSelect').value = state.level;
    } else {
      $('packSelect').value = defaultPack;
    }
    $('packSelect').disabled = !!prof.packLockedByTeacher;
    $('packLockNotice').textContent = prof.packLockedByTeacher
      ? ('🔒 Your teacher pinned the ' + prof.assignedPack + ' speaking pack for ' + (st.className || 'your class') + '.')
      : ('Automatically matched to your cohort (' + (st.className || prof.cefr || defaultPack) + ').');

    state.micCheckSeconds = Number((state.appData && state.appData.micCheckSeconds) || 5);
    renderStudentHistory_((state.appData && state.appData.history) || []);

    resetRunnerToReady_();
    showTopView('studentPortalView');
    startStudentBeacons_();
  }

  function renderStudentHistory_(items) {
    var wrap = $('studentHistoryCard');
    var list = $('studentHistoryList');
    list.replaceChildren();
    if (!items || !items.length) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    items.forEach(function (h) {
      var row = el('div', null, 'history-row');
      var left = el('div');
      left.appendChild(el('strong', 'Pack ' + (h.level || '—') + ' · '));
      left.appendChild(el('span', h.submittedAt ? h.submittedAt.replace('T', ' ').slice(0, 16) : '', 'sub'));
      var badge = el('span', h.statusLabel || 'Submitted — Pending Staff Review', 'chip live');
      row.appendChild(left);
      row.appendChild(badge);
      list.appendChild(row);
    });
  }

  function sendStudentBeacon_(stage) {
    if (!state.student || !state.auth.session) return;
    rpc('studentBeacon', [{
      code: state.auth.code,
      email: state.auth.email,
      session: state.auth.session,
      stage: stage,
      level: $('packSelect').value,
      attemptId: state.attemptId
    }]).catch(function () {});
  }

  function startStudentBeacons_() {
    clearInterval(state.beaconTimer);
    sendStudentBeacon_('LOBBY');
    state.beaconTimer = setInterval(function () {
      if (document.visibilityState === 'hidden' || !state.student) return;
      var stg = 'LOBBY';
      if (state.phase === 'mic') stg = 'MIC_CHECK';
      else if (state.phase === 'prep_ready' || state.phase === 'prep') stg = state.taskIndex === 0 ? 'PREP_1' : 'PREP_2';
      else if (state.phase === 'recording' || state.phase === 'review') stg = state.taskIndex === 0 ? 'REC_1' : 'REC_2';
      else if (state.phase === 'done') stg = 'SUBMITTED';
      sendStudentBeacon_(stg);
    }, 15000);
  }

  // =========================================================================
  // 4. SPEAKING PLACEMENT RUNNER (Top-Level getUserMedia + Single Stream)
  // =========================================================================

  function setPills_(step) {
    var order = ['ready', 'mic', 'task1', 'task2', 'done'];
    var cur = order.indexOf(step);
    document.querySelectorAll('.step-pill').forEach(function (pill) {
      var s = pill.getAttribute('data-step');
      var mine = order.indexOf(s);
      pill.classList.remove('on', 'done');
      if (mine === cur) pill.classList.add('on');
      else if (mine < cur) pill.classList.add('done');
    });
  }

  function showRunnerStep_(stepId) {
    ['stepReady', 'stepMic', 'stepTask', 'stepDone'].forEach(function (id) {
      $(id).classList.toggle('hidden', id !== stepId);
    });
  }

  function stopTracks_() {
    try {
      if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(function (t) { t.stop(); });
      }
    } catch (e) {}
    state.mediaStream = null;
  }

  function clearTimer_() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function resetRunnerState_() {
    clearTimer_();
    stopTracks_();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.attemptId = '';
    state.tasks = [];
    state.taskIndex = 0;
    state.currentBlob = null;
    state.rerecordCount = 0;
    state.submitting = false;
    state.micRecording = false;
  }

  function resetRunnerToReady_() {
    resetRunnerState_();
    state.phase = 'ready';
    $('readyStatus').textContent = '';
    setPills_('ready');
    showRunnerStep_('stepReady');
  }

  function hasLiveMic_() {
    if (!state.mediaStream) return false;
    var tracks = state.mediaStream.getAudioTracks ? state.mediaStream.getAudioTracks() : [];
    return !!(tracks.length && tracks.some(function (t) { return t.readyState === 'live'; }));
  }

  function setMicTracksEnabled_(enabled) {
    if (!state.mediaStream || !state.mediaStream.getAudioTracks) return;
    state.mediaStream.getAudioTracks().forEach(function (t) {
      try { t.enabled = !!enabled; } catch (e) {}
    });
  }

  function ensureMicStream_() {
    if (hasLiveMic_()) return Promise.resolve(state.mediaStream);
    stopTracks_();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Microphone recording requires a modern HTTPS browser (Chrome or Safari).'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    }).then(function (stream) {
      state.mediaStream = stream;
      setMicTracksEnabled_(false);
      return stream;
    });
  }

  function preferredMime_() {
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  function micError_(err) {
    var name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Microphone permission was denied. Allow microphone access in your browser bar, then tap again.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No microphone was found on this device.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Your microphone is busy in another app. Close the other app and try again.';
    }
    return (err && err.message) ? err.message : 'Microphone could not start.';
  }

  function recordSeconds_(maxSec, onTick, onDone) {
    maxSec = Math.max(3, Number(maxSec) || 5);
    if (!window.MediaRecorder) {
      onDone(null, new Error('Audio recording is not supported in this browser.'));
      return;
    }

    ensureMicStream_().then(function (stream) {
      setMicTracksEnabled_(true);
      state.chunks = [];
      var mime = preferredMime_();
      try {
        state.mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (e) {
        state.mediaRecorder = new MediaRecorder(stream);
      }
      state.currentMime = state.mediaRecorder.mimeType || mime || 'audio/webm';
      state.recordingStartedAt = isoNow();
      state.startAt = Date.now();
      state.micRecording = true;

      state.mediaRecorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) state.chunks.push(ev.data);
      };
      state.mediaRecorder.onerror = function (ev) {
        clearTimer_();
        stopTracks_();
        state.micRecording = false;
        onDone(null, new Error(micError_(ev && ev.error ? ev.error : ev)));
      };
      state.mediaRecorder.onstop = function () {
        clearTimer_();
        state.micRecording = false;
        setMicTracksEnabled_(false);
        state.recordingEndedAt = isoNow();
        var type = state.currentMime || 'audio/webm';
        var blob = new Blob(state.chunks, { type: type });
        var duration = Math.max(0, (Date.now() - state.startAt) / 1000);
        if (!blob.size || blob.size < 400) {
          onDone(null, new Error('The recording was silent or empty. Speak closer to the microphone and try again.'));
          return;
        }
        onDone({ blob: blob, mime: type, duration: duration }, null);
      };

      try {
        state.mediaRecorder.start(250);
      } catch (e1) {
        state.mediaRecorder.start();
      }

      clearTimer_();
      state.timerId = setInterval(function () {
        var elapsed = (Date.now() - state.startAt) / 1000;
        onTick && onTick(elapsed, maxSec);
        if (elapsed >= maxSec && state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
          state.mediaRecorder.stop();
        }
      }, 200);
    }).catch(function (err) {
      state.micRecording = false;
      onDone(null, new Error(micError_(err)));
    });
  }

  function stopRecording_() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
  }

  function blobToBase64_(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read audio recording.')); };
      reader.onload = function () {
        var r = String(reader.result || '');
        var idx = r.indexOf(',');
        if (idx === -1) { reject(new Error('Could not encode audio recording.')); return; }
        resolve(r.slice(idx + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  // Start Speaking Check Button
  $('btnStart').onclick = async function () {
    if (state.busy) return;
    state.busy = true;
    $('btnStart').disabled = true;
    $('readyStatus').textContent = 'Checking microphone permission…';

    try {
      await ensureMicStream_();
      $('readyStatus').textContent = 'Preparing your speaking prompts…';

      var res = await rpc('studentStartAttempt', [{
        auth: state.auth,
        level: $('packSelect').value,
        device: deviceLabel(),
        userAgent: ua(),
        clientTimestamp: isoNow(),
        sessionId: state.sessionId
      }]);

      if (!res || !res.ok) {
        throw new Error('Could not start speaking check.');
      }

      state.attemptId = res.attemptId;
      state.level = res.level;
      state.tasks = res.tasks || [];
      state.micCheckSeconds = res.micCheckSeconds || 5;
      state.phase = 'mic';

      setPills_('mic');
      showRunnerStep_('stepMic');
      state.busy = false;
      $('btnStart').disabled = false;
      setTimeout(startMicCheck_, 200);
    } catch (err) {
      state.busy = false;
      $('btnStart').disabled = false;
      $('readyStatus').textContent = '';
      toast(err.message || 'Could not start.', true);
    }
  };

  var micBlob = null;
  function startMicCheck_() {
    if (state.busy || state.micRecording) return;
    micBlob = null;
    $('micConfirmRow').classList.add('hidden');
    $('micPlayback').classList.add('hidden');
    $('btnMicRecord').classList.add('hidden');
    $('btnMicStop').classList.remove('hidden');
    $('micStatus').textContent = 'Speak now for 5 seconds…';
    $('micTimer').className = 'timer live';
    $('micTimer').textContent = '00:00';
    sendStudentBeacon_('MIC_CHECK');

    recordSeconds_(state.micCheckSeconds || 5, function (elapsed, max) {
      $('micTimer').textContent = fmt(Math.min(elapsed, max));
    }, function (result, err) {
      $('btnMicStop').classList.add('hidden');
      $('btnMicRecord').classList.remove('hidden');
      $('micTimer').className = 'timer';
      if (err) {
        $('micStatus').textContent = err.message;
        toast(err.message, true);
        return;
      }
      micBlob = result.blob;
      var audio = $('micPlayback');
      audio.src = URL.createObjectURL(result.blob);
      audio.classList.remove('hidden');
      try { audio.play(); } catch (e) {}
      $('micConfirmRow').classList.remove('hidden');
      $('micStatus').textContent = 'Listen to your check, then confirm you can hear yourself clearly.';
    });
  }

  $('btnMicRecord').onclick = startMicCheck_;
  $('btnMicStop').onclick = stopRecording_;
  $('btnMicRetry').onclick = function () {
    micBlob = null;
    $('micPlayback').removeAttribute('src');
    $('micPlayback').classList.add('hidden');
    $('micConfirmRow').classList.add('hidden');
    $('micTimer').textContent = '00:00';
    startMicCheck_();
  };

  $('btnMicOk').onclick = async function () {
    if (!micBlob || state.busy) return;
    state.busy = true;
    $('btnMicOk').disabled = true;
    try {
      await rpc('studentConfirmMic', [{
        auth: state.auth,
        attemptId: state.attemptId,
        passed: true,
        clientTimestamp: isoNow(),
        userAgent: ua()
      }]);
      state.taskIndex = 0;
      state.rerecordCount = 0;
      beginTask_();
    } catch (err) {
      toast(err.message || 'Could not confirm microphone.', true);
    } finally {
      state.busy = false;
      $('btnMicOk').disabled = false;
    }
  };

  function currentTask_() { return state.tasks[state.taskIndex]; }

  function beginTask_() {
    var t = currentTask_();
    if (!t) { toast('Task missing.', true); return; }
    state.phase = 'prep_ready';
    state.currentBlob = null;
    state.rerecordCount = 0;
    setPills_(state.taskIndex === 0 ? 'task1' : 'task2');
    showRunnerStep_('stepTask');

    $('taskTitle').textContent = 'Task ' + t.taskNumber + ' · ' + String(t.taskType || '').replace(/_/g, ' ');
    $('taskChip').textContent = t.level;
    $('taskPrompt').textContent = t.promptText;
    $('taskTimer').textContent = fmt(t.preparationSeconds);
    $('taskTimer').className = 'timer prep';
    $('taskStatus').textContent = 'Preparation starts automatically…';
    $('taskPlayback').classList.add('hidden');
    $('taskPlayback').removeAttribute('src');
    $('taskActionRow').classList.remove('hidden');
    $('taskRecRow').classList.add('hidden');
    $('taskAfterRow').classList.add('hidden');
    $('btnStartPrep').disabled = false;
    $('btnStartPrep').textContent = 'Start preparation';

    sendStudentBeacon_(state.taskIndex === 0 ? 'PREP_1' : 'PREP_2');
    setTimeout(function () {
      if (state.phase === 'prep_ready') startPrep_(t);
    }, 400);
  }

  $('btnReadAloud').onclick = function () {
    var t = currentTask_();
    if (!t || !window.speechSynthesis) { toast('Speech synthesis unavailable on this device.', true); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(t.ttsText || t.promptText);
    u.lang = 'en-US';
    u.rate = 0.94;
    window.speechSynthesis.speak(u);
  };

  $('btnStopAloud').onclick = function () {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  };

  $('btnStartPrep').onclick = function () {
    var t = currentTask_();
    if (!t) return;
    if (state.phase === 'prep_ready') startPrep_(t);
    else if (state.phase === 'record_ready') startTaskRecord_(t);
  };

  function startPrep_(t) {
    state.phase = 'prep';
    $('btnStartPrep').disabled = true;
    var left = Number(t.preparationSeconds) || 10;
    $('taskTimer').className = 'timer prep';
    $('taskStatus').textContent = 'Prepare your answer…';
    clearTimer_();
    state.timerId = setInterval(function () {
      left -= 1;
      $('taskTimer').textContent = fmt(left);
      if (left <= 0) {
        clearTimer_();
        state.phase = 'record_ready';
        $('taskStatus').textContent = 'Recording starts now…';
        $('btnStartPrep').disabled = false;
        $('btnStartPrep').textContent = 'Start recording';
        setTimeout(function () {
          if (state.phase === 'record_ready') startTaskRecord_(t);
        }, 300);
      }
    }, 1000);
  }

  function startTaskRecord_(t) {
    if (state.phase === 'recording' || state.micRecording) return;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.phase = 'recording';
    $('taskActionRow').classList.add('hidden');
    $('taskRecRow').classList.remove('hidden');
    $('taskAfterRow').classList.add('hidden');
    $('taskTimer').className = 'timer live';
    $('taskStatus').textContent = 'Recording… speak clearly now';
    sendStudentBeacon_(state.taskIndex === 0 ? 'REC_1' : 'REC_2');

    recordSeconds_(Number(t.maximumRecordingSeconds) || 60, function (elapsed, max) {
      $('taskTimer').textContent = fmt(Math.min(elapsed, max));
    }, function (result, err) {
      $('taskRecRow').classList.add('hidden');
      if (err) {
        state.phase = 'record_ready';
        $('taskActionRow').classList.remove('hidden');
        $('btnStartPrep').disabled = false;
        $('btnStartPrep').textContent = 'Start recording';
        $('taskStatus').textContent = err.message;
        toast(err.message, true);
        return;
      }
      state.currentBlob = result.blob;
      state.currentMime = result.mime;
      state.currentDuration = result.duration;
      var audio = $('taskPlayback');
      audio.src = URL.createObjectURL(result.blob);
      audio.classList.remove('hidden');
      try { audio.play(); } catch (e) {}
      state.phase = 'review';
      $('taskAfterRow').classList.remove('hidden');
      var canRe = state.rerecordCount < state.maxRerecords;
      $('btnRerecord').disabled = !canRe;
      $('btnRerecord').textContent = canRe ? 'Rerecord once' : 'Rerecord used';
      $('taskStatus').textContent = 'Listen to your recording, then Keep & upload (or rerecord once).';
    });
  }

  $('btnStopRec').onclick = stopRecording_;

  $('btnRerecord').onclick = function () {
    if (state.rerecordCount >= state.maxRerecords) {
      toast('Only one rerecord is allowed per task.', true);
      return;
    }
    state.rerecordCount += 1;
    state.currentBlob = null;
    $('taskPlayback').classList.add('hidden');
    $('taskAfterRow').classList.add('hidden');
    state.phase = 'record_ready';
    startTaskRecord_(currentTask_());
  };

  $('btnKeepUpload').onclick = async function () {
    if (!state.currentBlob || state.busy) return;
    var t = currentTask_();
    state.busy = true;
    $('btnKeepUpload').disabled = true;
    $('btnRerecord').disabled = true;
    $('taskStatus').textContent = 'Uploading & saving securely… please wait';

    try {
      var b64 = await blobToBase64_(state.currentBlob);
      var res = await rpc('studentUploadResponse', [{
        auth: state.auth,
        attemptId: state.attemptId,
        promptId: t.promptId,
        taskNumber: t.taskNumber,
        base64Audio: b64,
        mimeType: state.currentMime,
        duration: state.currentDuration || 0,
        recordingStartedAt: state.recordingStartedAt,
        recordingEndedAt: state.recordingEndedAt,
        rerecordCount: state.rerecordCount,
        clientTimestamp: isoNow(),
        userAgent: ua()
      }]);

      if (!res || !res.ok) throw new Error('Upload failed.');
      toast('Task ' + t.taskNumber + ' uploaded ✓');
      state.busy = false;
      $('btnKeepUpload').disabled = false;

      if (state.taskIndex === 0) {
        state.taskIndex = 1;
        state.rerecordCount = 0;
        beginTask_();
      } else {
        await finalizeSubmission_();
      }
    } catch (err) {
      state.busy = false;
      $('btnKeepUpload').disabled = false;
      $('btnRerecord').disabled = state.rerecordCount >= state.maxRerecords;
      $('taskStatus').textContent = 'Upload failed — please try again.';
      toast(err.message || 'Upload failed', true);
    }
  };

  async function finalizeSubmission_() {
    if (state.submitting) return;
    state.submitting = true;
    $('taskStatus').textContent = 'Finalizing your speaking submission…';
    try {
      var res = await rpc('studentSubmitAttempt', [{
        auth: state.auth,
        attemptId: state.attemptId,
        clientTimestamp: isoNow(),
        userAgent: ua()
      }]);
      stopTracks_();
      state.phase = 'done';
      if (res && res.history) {
        state.appData.history = res.history;
        renderStudentHistory_(res.history);
      }
      $('doneMessage').textContent = (res && res.message) || 'Your speaking test has been submitted. Talk Today staff will confirm your placement.';
      setPills_('done');
      showRunnerStep_('stepDone');
      toast('Speaking check submitted ✓');
    } catch (err) {
      state.submitting = false;
      $('taskStatus').textContent = err.message || 'Submit failed — tap Keep & upload again.';
      toast(err.message || 'Submit failed', true);
    }
  }

  $('btnBackToPortal').onclick = function () {
    resetRunnerToReady_();
    sendStudentBeacon_('LOBBY');
  };

  // =========================================================================
  // 5. CLASS TEACHER / DIRECTOR LIVE SPEAKING RADAR
  // =========================================================================

  async function loadPublicTeachers_() {
    try {
      var res = await rpc('teacherListPublic', []);
      if (!res || !res.ok || !res.teachers) return;
      var sel = $('teacherNameSelect');
      sel.replaceChildren(el('option', 'Select your Teacher profile...', ''));
      sel.firstChild.value = '';
      res.teachers.forEach(function (t) {
        var opt = el('option', t.label);
        opt.value = t.key;
        sel.appendChild(opt);
      });
    } catch (e) {}
  }

  $('teacherLoginForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (state.busy) return;
    var tName = $('teacherNameSelect').value.trim();
    var tEmail = $('teacherEmailInput').value.trim();
    if (!tName && tEmail.toLowerCase() !== 'jamalmorelli') {
      $('loginErr').textContent = 'Please select your Teacher profile.';
      return;
    }
    if (!tEmail) {
      $('loginErr').textContent = 'Please enter your registered teacher email.';
      return;
    }

    state.busy = true;
    $('teacherSubmitBtn').disabled = true;
    $('loginErr').textContent = '';
    startLoginProgress_([
      'Verifying Talk Today teacher credentials...',
      'Enforcing teacher-of-the-class isolation...',
      'Opening Live Speaking Radar...'
    ]);

    try {
      var res = await rpc('teacherOpen', [{ teacher: tName || 'DIRECTOR', email: tEmail }]);
      stopLoginProgress_();
      if (!res || !res.ok) {
        $('loginErr').textContent = (res && res.error) || 'Teacher sign-in failed.';
        return;
      }
      state.teacherSession = res.session;
      state.teacherRole = res.role;
      state.teacherName = res.displayName || res.teacher;
      enterTeacherRadar_(res.data);
    } catch (err) {
      stopLoginProgress_();
      $('loginErr').textContent = err.message || 'Teacher sign-in failed.';
    } finally {
      state.busy = false;
      $('teacherSubmitBtn').disabled = false;
    }
  });

  function enterTeacherRadar_(initialData) {
    clearInterval(state.beaconTimer);
    resetRunnerState_();
    $('tchDisplayName').textContent = state.teacherName;
    $('tchRoleBadge').textContent = state.teacherRole;
    $('tchDirectorWrap').classList.toggle('hidden', state.teacherRole !== 'DIRECTOR');
    $('tchInspectCard').classList.add('hidden');
    $('tchTableCard').classList.remove('hidden');

    renderTeacherData_(initialData, true);
    showTopView('teacherView');

    stopTeacherPolling_();
    state.teacherPollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden' || !$('tchInspectCard').classList.contains('hidden')) return;
      pollTeacherRadar_(false);
    }, 7000);
  }

  function stopTeacherPolling_() {
    if (state.teacherPollTimer) clearInterval(state.teacherPollTimer);
    state.teacherPollTimer = null;
  }

  async function pollTeacherRadar_(rebuildDropdowns) {
    if (!state.teacherSession) return;
    try {
      var res = await rpc('teacherLivePoll', [{
        session: state.teacherSession,
        teacherFilter: state.teacherRole === 'DIRECTOR' ? $('tchTeacherSelect').value : state.teacherName,
        classFilter: $('tchClassSelect').value
      }]);
      if (res && res.ok) renderTeacherData_(res.data, rebuildDropdowns);
    } catch (e) {}
  }

  function renderTeacherData_(data, rebuildDropdowns) {
    if (!data) return;
    $('tchPolledAt').textContent = 'Live Sync · ' + String(data.polledAt || '').slice(11, 19);
    $('kpiTotal').textContent = String((data.summary && data.summary.totalStudents) || 0);
    $('kpiOnline').textContent = String((data.summary && data.summary.onlineCount) || 0);
    $('kpiSubmitted').textContent = String((data.summary && data.summary.submittedCount) || 0);

    if (rebuildDropdowns) {
      if (state.teacherRole === 'DIRECTOR' && data.availableTeachers) {
        var tSel = $('tchTeacherSelect');
        var curT = data.teacherFilter || 'ALL';
        tSel.replaceChildren();
        var oAllT = el('option', 'All Teachers');
        oAllT.value = 'ALL';
        tSel.appendChild(oAllT);
        data.availableTeachers.forEach(function (tk) {
          var o = el('option', tk);
          o.value = tk;
          tSel.appendChild(o);
        });
        tSel.value = curT;
      }

      var cSel = $('tchClassSelect');
      var curC = data.classFilter || 'ALL';
      cSel.replaceChildren();
      var oAllC = el('option', 'All My Classes');
      oAllC.value = 'ALL';
      cSel.appendChild(oAllC);
      (data.availableClasses || []).forEach(function (cn) {
        var o = el('option', cn);
        o.value = cn;
        cSel.appendChild(o);
      });
      cSel.value = curC;
    }

    $('tchPinPackSelect').value = data.pinnedPack || 'AUTO';
    $('tchPinPackSelect').disabled = ($('tchClassSelect').value === 'ALL');

    var body = $('tchRosterBody');
    body.replaceChildren();
    var students = data.students || [];
    if (!students.length) {
      var trE = el('tr');
      var tdE = el('td', 'No students in the selected cohort.', 'sub');
      tdE.colSpan = 6;
      trE.appendChild(tdE);
      body.appendChild(trE);
      return;
    }

    students.forEach(function (st, idx) {
      var tr = el('tr');
      var displayName = state.teacherHideNames ? ('Student ' + (idx + 1)) : st.fullName;
      var tdName = el('td');
      tdName.appendChild(el('strong', displayName));
      if (!state.teacherHideNames) {
        tdName.appendChild(el('div', '#' + st.code + ' · Rec: ' + st.recommendedPack, 'sub'));
      }
      tr.appendChild(tdName);
      tr.appendChild(el('td', st.className || '—'));

      var tdPres = el('td');
      var pCls = st.presence === 'LIVE' ? 'chip live' : (st.presence === 'IDLE' ? 'chip idle' : 'chip offline');
      tdPres.appendChild(el('span', st.presence, pCls));
      tr.appendChild(tdPres);

      tr.appendChild(el('td', st.stage || '—'));

      var latest = st.latestAttempt;
      var tdLatest = el('td', latest ? (latest.level + ' · ' + latest.status + (latest.finalBand ? ' (' + latest.finalBand + ')' : '')) : '—');
      tr.appendChild(tdLatest);

      var tdAct = el('td');
      if (latest && latest.attemptId) {
        var btn = el('button', '🎧 Inspect', 'btn btn-ghost');
        btn.type = 'button';
        btn.style.padding = '6px 11px';
        btn.style.fontSize = '12.5px';
        btn.onclick = function () { openTeacherAttempt_(latest.attemptId); };
        tdAct.appendChild(btn);
      } else {
        tdAct.appendChild(el('span', '—', 'sub'));
      }
      tr.appendChild(tdAct);
      body.appendChild(tr);
    });
  }

  $('tchTeacherSelect').onchange = function () {
    $('tchClassSelect').value = 'ALL';
    pollTeacherRadar_(true);
  };
  $('tchClassSelect').onchange = function () { pollTeacherRadar_(false); };
  $('tchRefreshBtn').onclick = function () { pollTeacherRadar_(true); };
  $('tchHideNamesBtn').onclick = function () {
    state.teacherHideNames = !state.teacherHideNames;
    $('tchHideNamesBtn').textContent = state.teacherHideNames ? '👁 Show Names' : '🙈 Hide Names';
    pollTeacherRadar_(false);
  };

  $('tchPinPackSelect').onchange = async function () {
    var cls = $('tchClassSelect').value;
    if (!cls || cls === 'ALL') {
      toast('Select a specific class cohort first to pin a speaking pack.', true);
      return;
    }
    try {
      var r = await rpc('teacherPinClassPack', [{
        session: state.teacherSession,
        className: cls,
        pack: $('tchPinPackSelect').value
      }]);
      toast(r.pinnedPack ? ('Pinned ' + r.pinnedPack + ' pack for ' + cls) : ('Set ' + cls + ' back to Auto pack'));
    } catch (e) {
      toast(e.message || 'Could not pin pack', true);
    }
  };

  async function openTeacherAttempt_(attemptId) {
    state.teacherCurrentAttemptId = attemptId;
    $('tchTableCard').classList.add('hidden');
    $('tchInspectCard').classList.remove('hidden');
    $('tchInspectMeta').replaceChildren(el('p', 'Loading student recordings & AI rubric…', 'sub'));
    $('tchInspectResponses').replaceChildren();
    $('tchInspectScores').replaceChildren();
    $('tchSaveStatus').textContent = '';

    try {
      var res = await rpc('teacherGetAttempt', [{ session: state.teacherSession, attemptId: attemptId }]);
      if (!res || !res.ok) throw new Error('Could not load attempt.');
      var a = res.attempt;
      var meta = $('tchInspectMeta');
      meta.replaceChildren();
      meta.appendChild(el('h2', a.fullName + ' (#' + a.studentId + ')'));
      meta.appendChild(el('p', 'Class: ' + (a.className || '—') + ' · Pack: ' + a.level + ' · Status: ' + a.status + ' · Final Band: ' + (a.finalBand || 'Pending'), 'sub'));

      $('tchFinalBand').value = a.finalBand || '';
      $('tchNotes').value = a.reviewerNotes || '';
      $('tchChkUnusable').checked = false;
      $('tchChkRetest').checked = false;

      var rWrap = $('tchInspectResponses');
      rWrap.appendChild(el('h3', 'Recordings & Whisper Transcripts'));
      (res.responses || []).forEach(function (r) {
        var box = el('div', null, 'card');
        box.style.background = '#0b1120';
        box.appendChild(el('strong', 'Task ' + r.taskNumber + ' (' + (r.duration || 0) + 's)'));
        box.appendChild(el('p', r.transcript || '(No speech detected)', 'sub'));
        if (r.hasAudio) {
          var pBtn = el('button', '▶ Load & Play Audio', 'btn btn-ghost');
          pBtn.type = 'button';
          var aud = el('audio', null, 'hidden');
          aud.controls = true;
          pBtn.onclick = async function () {
            pBtn.disabled = true;
            pBtn.textContent = 'Loading audio…';
            try {
              var play = await rpc('teacherPlayAudio', [{
                session: state.teacherSession,
                attemptId: attemptId,
                fileId: r.audioFileId
              }]);
              if (play && play.dataUrl) {
                aud.src = play.dataUrl;
                aud.classList.remove('hidden');
                try { aud.play(); } catch (e2) {}
              }
            } catch (err) {
              toast(err.message || 'Playback failed', true);
            } finally {
              pBtn.disabled = false;
              pBtn.textContent = '▶ Load & Play Audio';
            }
          };
          box.appendChild(pBtn);
          box.appendChild(aud);
        }
        rWrap.appendChild(box);
      });

      var sWrap = $('tchInspectScores');
      sWrap.appendChild(el('h3', 'AI Provisional 5-Dimension Rubric (Staff Only)'));
      (res.scores || []).forEach(function (s) {
        var sBox = el('div', null, 'card');
        sBox.style.background = '#0b1120';
        sBox.appendChild(el('strong', 'Task ' + s.taskNumber + ': ' + (s.total != null ? s.total : '—') + '/20 · Band: ' + (s.recommendedBand || '—')));
        sBox.appendChild(el('p', 'Task Completion: ' + s.taskCompletion + '/4 · Intelligibility: ' + s.intelligibility + '/4 · Fluency: ' + s.fluency + '/4 · Grammar: ' + s.grammarControl + '/4 · Vocabulary: ' + s.vocabularyRange + '/4', 'sub'));
        sBox.appendChild(el('p', 'Evidence: ' + (s.evidence || '—'), 'sub'));
        sWrap.appendChild(sBox);
      });
    } catch (err) {
      toast(err.message || 'Could not inspect attempt', true);
    }
  }

  $('tchBackBtn').onclick = function () {
    $('tchInspectCard').classList.add('hidden');
    $('tchTableCard').classList.remove('hidden');
    pollTeacherRadar_(false);
  };

  $('tchSaveReviewBtn').onclick = async function () {
    if (!state.teacherCurrentAttemptId) return;
    $('tchSaveReviewBtn').disabled = true;
    $('tchSaveStatus').textContent = 'Saving…';
    try {
      var res = await rpc('teacherSaveReview', [{
        session: state.teacherSession,
        attemptId: state.teacherCurrentAttemptId,
        finalBand: $('tchFinalBand').value,
        notes: $('tchNotes').value,
        recordingUnusable: $('tchChkUnusable').checked,
        requestRetest: $('tchChkRetest').checked
      }]);
      $('tchSaveStatus').textContent = 'Saved ✓ (' + (res.status || 'REVIEWED') + ')';
      toast('Teacher review saved ✓');
    } catch (err) {
      $('tchSaveStatus').textContent = '';
      toast(err.message || 'Could not save review', true);
    } finally {
      $('tchSaveReviewBtn').disabled = false;
    }
  };

  // =========================================================================
  // 6. SIGN OUT / ACCOUNT SWITCH
  // =========================================================================

  $('logoutBtn').onclick = function () {
    sendStudentBeacon_('OFFLINE');
    clearInterval(state.beaconTimer);
    stopTeacherPolling_();
    resetRunnerState_();
    state.auth = { code: '', email: '', session: '', lang: 'en' };
    state.student = null;
    state.siblings = [];
    state.appData = null;
    state.teacherSession = '';
    state.teacherRole = '';
    $('studentCode').value = '';
    $('parentEmail').value = '';
    $('teacherEmailInput').value = '';
    $('loginErr').textContent = '';
    showTopView('loginView');
  };

  window.addEventListener('pagehide', stopTracks_);
  window.addEventListener('beforeunload', stopTracks_);

  // Boot!
  initBridge_();
})();
