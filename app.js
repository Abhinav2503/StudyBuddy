/**
 * app.js — Study Buddy: Focus Garden
 * ═══════════════════════════════════════════════════════
 * Architecture:
 * • AppState  – single source of truth (sessionStorage-backed)
 * • Timer     – Date.now() timestamps (immune to browser freezes)
 * • Face      – face-api.js throttled via FaceWorkerBridge
 * • Pet       – emoji-driven virtual pet with XP & levelling
 * • Study     – YouTube iframe or PDF.js renderer
 * • Report    – html2pdf.js session summary
 * ═══════════════════════════════════════════════════════
 */

'use strict';

/* ═══════════════════════════════════════
   0 – PDF.js worker config
═══════════════════════════════════════ */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ═══════════════════════════════════════
   1 – APP STATE
═══════════════════════════════════════ */
const AppState = {
  phase: 'idle',      /* idle | calibrating | studying | break | complete */

  session: {
    startTime:      null,
    endTime:        null,
    plannedMins:    25,
    pomodoroCount:  0,    /* stored across page reloads via sessionStorage */
    focusedMs:      0,    /* total ms face was detected */
    unfocusedMs:    0,
    distractions:   0,
    lastFocusState: true, /* was user focused on previous tick? */
    tickStart:      null, /* when current focus/unfocus window started */
  },

  timer: {
    startTimestamp: null,   /* Date.now() when timer started / resumed */
    remainingMs:    25 * 60 * 1000,
    pausedRemainingMs: null,
    rafId:          null,   /* requestAnimationFrame id */
    isRunning:      false,
    isPaused:       false,
    totalMs:        25 * 60 * 1000,
  },

  face: {
    modelsLoaded:   false,
    isFacePresent:  false,
    videoReady:     false,
    stream:         null,
  },

  pet: {
    name:   'Sprout',
    emoji:  '🐣',
    mood:   'Waiting for you…',
    xp:     0,
    xpMax:  100,
    level:  1,
  },

  study: {
    source:       'youtube',
    pdfDoc:       null,
    currentPage:  1,
    totalPages:   0,
  }
};

/* Load persisted pomodoro count */
AppState.session.pomodoroCount =
  parseInt(sessionStorage.getItem('sb_pomodoroCount') || '0', 10);

/* ═══════════════════════════════════════
   2 – DOM HELPERS
═══════════════════════════════════════ */
const $ = id => document.getElementById(id);

const DOM = {
  /* Header */
  modelStatus:    $('modelStatus'),
  statusText:     $('modelStatus').querySelector('.status-text'),
  pomodoroCount:  $('pomodoroCount'),

  /* Pet */
  petEmoji:       $('petEmoji'),
  petName:        $('petName'),
  petMood:        $('petMood'),
  petLevel:       $('petLevel'),
  xpBar:          $('xpBar'),
  xpValue:        $('xpValue'),
  xpMax:          $('xpMax'),

  /* Timer */
  timerMinutes:   $('timerMinutes'),
  timerSeconds:   $('timerSeconds'),
  timerPhase:     $('timerPhase'),
  ringProgress:   $('ringProgress'),
  durationPicker: $('durationPicker'),

  /* Camera */
  webcamFeed:     $('webcamFeed'),
  faceCanvas:     $('faceCanvas'),
  faceRing:       $('faceRing'),
  faceStatus:     $('faceStatus'),
  camLabel:       $('camLabel'),

  /* Controls */
  startBtn:       $('startBtn'),
  pauseBtn:       $('pauseBtn'),
  endBtn:         $('endBtn'),

  /* Stats */
  liveStats:      $('liveStats'),
  focusPct:       $('focusPct'),
  distractCount:  $('distractCount'),
  elapsedTime:    $('elapsedTime'),

  /* Study */
  youtubePanel:   $('youtubePanel'),
  pdfPanel:       $('pdfPanel'),
  iframeWrapper:  $('iframeWrapper'),
  pdfCanvas:      $('pdfCanvas'),
  pdfNav:         $('pdfNav'),
  pdfPlaceholder: $('pdfPlaceholder'),
  pdfPageInfo:    $('pdfPageInfo'),

  /* Source buttons */
  btnYoutube:     $('btnYoutube'),
  btnPdf:         $('btnPdf'),

  /* Modal */
  reportModal:    $('reportModal'),
  reportEmoji:    $('reportEmoji'),
  reportTitle:    $('reportTitle'),
  reportSubtitle: $('reportSubtitle'),
  rsDuration:     $('rsDuration'),
  rsFocus:        $('rsFocus'),
  rsDistractions: $('rsDistractions'),
  rsXP:           $('rsXP'),
  reportMessage:  $('reportMessage'),

  /* Toast */
  toast:          $('distractionToast'),
  toastPet:       $('toastPet'),
  toastMsg:       $('toastMsg'),
};

/* ═══════════════════════════════════════
   3 – PET SYSTEM
═══════════════════════════════════════ */
const PET_STAGES = [
  { level: 1,  emoji: '🐣', name: 'Sprout',   xpMax: 100  },
  { level: 2,  emoji: '🐥', name: 'Chirpy',   xpMax: 200  },
  { level: 3,  emoji: '🐦', name: 'Fledge',   xpMax: 350  },
  { level: 4,  emoji: '🦜', name: 'Polly',    xpMax: 550  },
  { level: 5,  emoji: '🦅', name: 'Eagle',    xpMax: 800  },
  { level: 6,  emoji: '🌟', name: 'Scholar',  xpMax: Infinity },
];

const PET_MOODS = {
  idle:      { emoji: '🐣', mood: 'Waiting for you…'    },
  happy:     { emoji: '😸', mood: 'You\'re crushing it!' },
  focused:   { emoji: '🤓', mood: 'Stay focused! 📚'     },
  distracted:{ emoji: '😿', mood: 'Come back! I miss you!'},
  sleeping:  { emoji: '😴', mood: 'Break time… zzz'      },
  excited:   { emoji: '🎉', mood: 'Amazing session!!'     },
};

const Pet = {
  setMood (key) {
    const m = PET_MOODS[key] || PET_MOODS.idle;
    const stage = PET_STAGES.find(s => s.level === AppState.pet.level) || PET_STAGES[0];
    DOM.petEmoji.textContent = AppState.phase === 'idle' || AppState.phase === 'complete'
      ? (m.emoji)
      : stage.emoji;
    DOM.petMood.textContent  = m.mood;
    /* Bounce animation */
    DOM.petEmoji.classList.remove('bounce');
    void DOM.petEmoji.offsetWidth;
    DOM.petEmoji.classList.add('bounce');
  },

  addXP (amount) {
    const p = AppState.pet;
    p.xp += amount;
    const stage = PET_STAGES.find(s => s.level === p.level) || PET_STAGES[0];

    /* Level up? */
    if (p.xp >= stage.xpMax) {
      p.xp -= stage.xpMax;
      const nextStage = PET_STAGES.find(s => s.level === p.level + 1);
      if (nextStage) {
        p.level++;
        p.xpMax = nextStage.xpMax;
        Toast.show(`🎉 ${nextStage.name} levelled up to Lv.${p.level}!`, '🌟');
      }
    }
    Pet.render();
  },

  render () {
    const p = AppState.pet;
    const stage = PET_STAGES.find(s => s.level === p.level) || PET_STAGES[0];
    DOM.petLevel.textContent = p.level;
    DOM.petName.textContent  = stage.name;
    DOM.xpValue.textContent  = p.xp;
    DOM.xpMax.textContent    = stage.xpMax === Infinity ? '∞' : stage.xpMax;
    DOM.xpBar.style.width    = stage.xpMax === Infinity
      ? '100%'
      : `${Math.min(100, (p.xp / stage.xpMax) * 100)}%`;
    DOM.pomodoroCount.textContent = AppState.session.pomodoroCount;
  }
};

/* ═══════════════════════════════════════
   4 – TIMER (Date.now() based)
═══════════════════════════════════════ */
const CIRCUMFERENCE = 2 * Math.PI * 52; /* matches SVG r="52" */

const Timer = {
  /* Call every rAF frame */
  _tick () {
    if (!AppState.timer.isRunning) return;

    const elapsed      = Date.now() - AppState.timer.startTimestamp;
    const remaining    = AppState.timer.pausedRemainingMs !== null
      ? AppState.timer.pausedRemainingMs
      : Math.max(0, AppState.timer.remainingMs - elapsed);

    Timer._render(remaining);

    if (remaining <= 0) {
      Timer._onComplete();
      return;
    }

    AppState.timer.rafId = requestAnimationFrame(Timer._tick.bind(Timer));
  },

  _render (remainingMs) {
    const totalSecs = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;

    DOM.timerMinutes.textContent = String(mins).padStart(2, '0');
    DOM.timerSeconds.textContent = String(secs).padStart(2, '0');

    /* Ring */
    const fraction = remainingMs / AppState.timer.totalMs;
    const offset   = CIRCUMFERENCE * (1 - fraction);
    DOM.ringProgress.style.strokeDashoffset = offset;

    /* Colour urgency */
    DOM.ringProgress.classList.toggle('danger-mode', fraction < .2);
  },

  start (durationMs) {
    AppState.timer.totalMs           = durationMs;
    AppState.timer.remainingMs       = durationMs;
    AppState.timer.startTimestamp    = Date.now();
    AppState.timer.pausedRemainingMs = null;
    AppState.timer.isRunning         = true;
    AppState.timer.isPaused          = false;
    AppState.timer.rafId             = requestAnimationFrame(Timer._tick.bind(Timer));
  },

  pause () {
    if (!AppState.timer.isRunning) return;
    /* Snapshot remaining time */
    const elapsed = Date.now() - AppState.timer.startTimestamp;
    AppState.timer.pausedRemainingMs =
      Math.max(0, AppState.timer.remainingMs - elapsed);
    AppState.timer.isRunning = false;
    AppState.timer.isPaused  = true;
    cancelAnimationFrame(AppState.timer.rafId);
  },

  resume () {
    if (!AppState.timer.isPaused) return;
    /* Restart from paused snapshot */
    AppState.timer.remainingMs    = AppState.timer.pausedRemainingMs;
    AppState.timer.startTimestamp = Date.now();
    AppState.timer.pausedRemainingMs = null;
    AppState.timer.isRunning      = true;
    AppState.timer.isPaused       = false;
    AppState.timer.rafId          = requestAnimationFrame(Timer._tick.bind(Timer));
  },

  stop () {
    AppState.timer.isRunning = false;
    cancelAnimationFrame(AppState.timer.rafId);
  },

  _onComplete () {
    Timer.stop();
    FaceWorkerBridge.stop();
    AppState.phase = 'complete';
    AppState.session.pomodoroCount++;
    sessionStorage.setItem('sb_pomodoroCount', AppState.session.pomodoroCount);

    Pet.setMood('excited');
    Pet.addXP(50);

    DOM.timerPhase.textContent = 'Done! 🎉';
    DOM.ringProgress.classList.remove('danger-mode');
    DOM.ringProgress.style.strokeDashoffset = 0;

    setTimeout(() => App.showReport(), 800);
  }
};

/* ═══════════════════════════════════════
   5 – FACE DETECTION
═══════════════════════════════════════ */
const MODELS_URL =
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';

const FaceTracker = {
  _detectionRunning: false,

  async initModels () {
    try {
      UI.setModelStatus('loading', 'Loading AI models…');
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
      AppState.face.modelsLoaded = true;
      UI.setModelStatus('ready', 'AI Ready ✓');
      console.log('[FaceTracker] Models loaded.');
      FaceTracker.startCamera();
    } catch (err) {
      console.error('[FaceTracker] Model load failed:', err);
      UI.setModelStatus('error', 'AI load failed — check network');
    }
  },

  async startCamera () {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false
      });
      AppState.face.stream   = stream;
      DOM.webcamFeed.srcObject = stream;

      DOM.webcamFeed.addEventListener('loadeddata', () => {
        AppState.face.videoReady = true;
        /* Begin the calibration detection loop via worker bridge */
        FaceWorkerBridge.init(FaceTracker._onWorkerTick.bind(FaceTracker));
        FaceWorkerBridge.start(1500);
        DOM.faceStatus.textContent = 'Looking for your face…';
      }, { once: true });

    } catch (err) {
      console.warn('[FaceTracker] Camera denied:', err);
      DOM.faceStatus.textContent = 'Camera blocked — allow access & refresh.';
    }
  },

  /* Called by FaceWorkerBridge every 1500 ms */
  async _onWorkerTick () {
    if (this._detectionRunning) return;
    if (!AppState.face.videoReady) return;
    if (!AppState.face.modelsLoaded) return;

    this._detectionRunning = true;
    try {
      const opts       = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
      const detection  = await faceapi.detectSingleFace(DOM.webcamFeed, opts);

      const faceFound  = !!detection;
      AppState.face.isFacePresent = faceFound;

      /* Draw detection box on canvas overlay */
      FaceTracker._drawOverlay(detection);

      if (AppState.phase === 'idle' || AppState.phase === 'calibrating') {
        FaceTracker._updateCalibrationUI(faceFound);
      } else if (AppState.phase === 'studying') {
        FaceTracker._updateFocusTracking(faceFound);
      }

    } catch (err) {
      /* Silently swallow frame errors */
    } finally {
      this._detectionRunning = false;
    }
  },

  _drawOverlay (detection) {
    const video  = DOM.webcamFeed;
    const canvas = DOM.faceCanvas;
    const ctx    = canvas.getContext('2d');

    canvas.width  = video.videoWidth  || video.clientWidth;
    canvas.height = video.videoHeight || video.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!detection) return;

    /* Scale detection box to canvas size */
    const scaleX = canvas.width  / (video.videoWidth  || canvas.width);
    const scaleY = canvas.height / (video.videoHeight || canvas.height);
    const box    = detection.box;

    ctx.strokeStyle = '#4caf78';
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = '#4caf78';
    ctx.shadowBlur  = 8;
    ctx.strokeRect(
      box.x * scaleX,
      box.y * scaleY,
      box.width  * scaleX,
      box.height * scaleY
    );
  },

  _updateCalibrationUI (faceFound) {
    if (faceFound) {
      DOM.faceRing.classList.add('detected');
      DOM.faceStatus.textContent = '✓ Face detected!';
      DOM.startBtn.disabled = false;   /* ← unlock Start button */
    } else {
      DOM.faceRing.classList.remove('detected');
      DOM.faceStatus.textContent = 'Searching for face…';
      DOM.startBtn.disabled = true;
    }
  },

  _updateFocusTracking (faceFound) {
    const now = Date.now();
    const s   = AppState.session;

    /* Track focused / unfocused time */
    if (s.tickStart !== null) {
      const segMs = now - s.tickStart;
      if (s.lastFocusState) s.focusedMs   += segMs;
      else                  s.unfocusedMs += segMs;
    }
    s.tickStart      = now;
    s.lastFocusState = faceFound;

    if (!faceFound) {
      s.distractions++;
      Pet.setMood('distracted');
      Toast.show("Hey! Come back to studying! 📚", '😿');
      DOM.faceRing.classList.remove('detected');
      DOM.faceStatus.textContent = 'Face not detected!';
    } else {
      Pet.setMood('focused');
      DOM.faceRing.classList.add('detected');
      DOM.faceStatus.textContent = '✓ Focused!';
    }

    /* Live stats update */
    const totalMs = s.focusedMs + s.unfocusedMs;
    const pct     = totalMs > 0 ? Math.round((s.focusedMs / totalMs) * 100) : 100;
    const elapsed = Math.floor((now - s.startTime) / 60000);

    DOM.focusPct.textContent     = pct;
    DOM.distractCount.textContent = s.distractions;
    DOM.elapsedTime.textContent  = elapsed;

    /* Award XP every tick for being focused */
    if (faceFound) Pet.addXP(2);
  },

  stop () {
    FaceWorkerBridge.stop();
  }
};

/* ═══════════════════════════════════════
   6 – UI UTILITIES
═══════════════════════════════════════ */
const UI = {
  setModelStatus (type, text) {
    DOM.modelStatus.className = `status-badge ${type}`;
    DOM.statusText.textContent = text;
  },

  showStartUI () {
    DOM.startBtn.classList.remove('hidden');
    DOM.pauseBtn.classList.add('hidden');
    DOM.endBtn.classList.add('hidden');
    DOM.durationPicker.style.display = '';
    DOM.liveStats.style.display      = 'none';
    DOM.timerPhase.textContent = 'Focus';
    DOM.ringProgress.classList.remove('break-mode', 'danger-mode');
  },

  showStudyUI () {
    DOM.startBtn.classList.add('hidden');
    DOM.pauseBtn.classList.remove('hidden');
    DOM.endBtn.classList.remove('hidden');
    DOM.durationPicker.style.display = 'none';
    DOM.liveStats.style.display      = '';
    DOM.timerPhase.textContent = 'Focus';
    DOM.camLabel.textContent   = 'Focus Tracker (Live)';
  }
};

/* ═══════════════════════════════════════
   7 – TOAST NOTIFICATIONS
═══════════════════════════════════════ */
let _toastTimeout = null;
const Toast = {
  show (msg, petEmoji = '😿') {
    DOM.toastMsg.textContent  = msg;
    DOM.toastPet.textContent  = petEmoji;
    DOM.toast.classList.add('show');
    clearTimeout(_toastTimeout);
    _toastTimeout = setTimeout(() => DOM.toast.classList.remove('show'), 3500);
  }
};

/* ═══════════════════════════════════════
   8 – PDF RENDERER
═══════════════════════════════════════ */
const PDFViewer = {
  async render (page) {
    const s = AppState.study;
    if (!s.pdfDoc || page < 1 || page > s.totalPages) return;
    s.currentPage = page;

    const pdfPage  = await s.pdfDoc.getPage(page);
    const wrapper  = DOM.pdfCanvas.parentElement;
    const viewport = pdfPage.getViewport({ scale: (wrapper.clientWidth - 24) / pdfPage.getViewport({ scale: 1 }).width });

    DOM.pdfCanvas.width  = viewport.width;
    DOM.pdfCanvas.height = viewport.height;

    await pdfPage.render({
      canvasContext: DOM.pdfCanvas.getContext('2d'),
      viewport
    }).promise;

    DOM.pdfPageInfo.textContent = `Page ${page} / ${s.totalPages}`;
  }
};

/* ═══════════════════════════════════════
   9 – REPORT BUILDER
═══════════════════════════════════════ */
const Report = {
  build () {
    const s   = AppState.session;
    const now = Date.now();

    /* Close any open tracking segment */
    if (s.tickStart !== null) {
      const segMs = now - s.tickStart;
      if (s.lastFocusState) s.focusedMs   += segMs;
      else                  s.unfocusedMs += segMs;
    }

    const totalMs   = s.focusedMs + s.unfocusedMs || 1;
    const focusPct  = Math.round((s.focusedMs / totalMs) * 100);
    const durationM = Math.round((now - s.startTime) / 60000);
    const xpEarned  = Math.floor(focusPct * durationM / 10);
    Pet.addXP(xpEarned);

    /* Determine trophy */
    let emoji = '🏆', title = 'Session Complete!', subtitle = 'Great job, scholar!';
    if (focusPct >= 85)      { emoji = '🌟'; subtitle = 'Exceptional focus! You\'re a star!'; }
    else if (focusPct >= 65) { emoji = '🏅'; subtitle = 'Good effort — keep it up!'; }
    else                     { emoji = '💪'; title = 'Room to Grow!'; subtitle = 'Every session counts. Try again!'; }

    const msgs = [
      'Remember: consistency beats perfection. One session at a time.',
      `You studied for ${durationM} minute${durationM !== 1 ? 's' : ''}. That\'s ${durationM} minutes of growth!`,
      `Your pet ${PET_STAGES.find(s => s.level === AppState.pet.level)?.name || 'Sprout'} is proud of you!`,
      'Deep work + regular breaks = a powerful learner. 🧠',
    ];

    DOM.reportEmoji.textContent    = emoji;
    DOM.reportTitle.textContent    = title;
    DOM.reportSubtitle.textContent = subtitle;
    DOM.rsDuration.textContent     = durationM;
    DOM.rsFocus.textContent        = focusPct + '%';
    DOM.rsDistractions.textContent = s.distractions;
    DOM.rsXP.textContent           = '+' + xpEarned;
    DOM.reportMessage.textContent  = msgs[Math.floor(Math.random() * msgs.length)];

    /* Store to sessionStorage */
    const history = JSON.parse(sessionStorage.getItem('sb_history') || '[]');
    history.push({
      date:        new Date().toLocaleString(),
      duration:    durationM,
      focusPct,
      distractions: s.distractions,
      xpEarned,
    });
    sessionStorage.setItem('sb_history', JSON.stringify(history));

    DOM.reportModal.classList.remove('hidden');
  }
};

/* ═══════════════════════════════════════
   10 – PUBLIC App OBJECT (called from HTML)
═══════════════════════════════════════ */
const App = {

  /* ── Source Switching ── */
  setSource (src) {
    AppState.study.source = src;
    DOM.youtubePanel.classList.toggle('hidden', src !== 'youtube');
    DOM.pdfPanel.classList.toggle('hidden',     src !== 'pdf');
    DOM.btnYoutube.classList.toggle('active',   src === 'youtube');
    DOM.btnPdf.classList.toggle('active',       src === 'pdf');
  },

  /* ── YouTube Loader ── */
  loadYoutube () {
    const raw = $('youtubeUrl').value.trim();
    const id  = App._extractYouTubeId(raw);
    if (!id) {
      Toast.show('Invalid YouTube URL — try again.', '😿');
      return;
    }
    DOM.iframeWrapper.innerHTML = `
      <iframe
        src="https://www.youtube-nocookie.com/embed/${id}?autoplay=0&rel=0&modestbranding=1"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        style="width:100%;height:100%;border:none;">
      </iframe>`;
  },

  _extractYouTubeId (url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  },

  /* ── PDF Loader ── */
  async loadPDF (input) {
    const file = input.files[0];
    if (!file) return;
    DOM.pdfPlaceholder.style.display = 'none';

    const arrayBuffer = await file.arrayBuffer();
    const doc         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    AppState.study.pdfDoc      = doc;
    AppState.study.totalPages  = doc.numPages;
    AppState.study.currentPage = 1;

    DOM.pdfNav.style.display = '';
    await PDFViewer.render(1);
  },

  pdfNextPage () { PDFViewer.render(AppState.study.currentPage + 1); },
  pdfPrevPage () { PDFViewer.render(AppState.study.currentPage - 1); },

  /* ── Duration Picker ── */
  setDuration (mins, btn) {
    AppState.session.plannedMins = mins;
    document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const ms = mins * 60 * 1000;
    AppState.timer.totalMs     = ms;
    AppState.timer.remainingMs = ms;
    Timer._render(ms);
  },

  /* ── Start Session ── */
  startSession () {
    if (DOM.startBtn.disabled) return;

    AppState.phase             = 'studying';
    AppState.session.startTime = Date.now();
    AppState.session.focusedMs   = 0;
    AppState.session.unfocusedMs = 0;
    AppState.session.distractions = 0;
    AppState.session.tickStart   = Date.now();
    AppState.session.lastFocusState = true;
    AppState.session.endTime     = null;

    UI.showStudyUI();
    Pet.setMood('focused');

    const durationMs = AppState.session.plannedMins * 60 * 1000;
    Timer.start(durationMs);

    /* Worker already running for calibration — it will now drive focus tracking too */
    Toast.show('Session started! Stay focused! 🚀', '🤓');
  },

  /* ── Pause / Resume ── */
  togglePause () {
    if (!AppState.timer.isPaused) {
      Timer.pause();
      FaceWorkerBridge.stop();
      AppState.phase = 'break';
      Pet.setMood('sleeping');
      DOM.pauseBtn.innerHTML = '<span class="btn-icon">▶</span><span>Resume</span>';
      DOM.timerPhase.textContent = 'Paused';
      DOM.camLabel.textContent   = 'Paused';
    } else {
      Timer.resume();
      FaceWorkerBridge.start(1500);
      AppState.phase = 'studying';
      Pet.setMood('focused');
      DOM.pauseBtn.innerHTML = '<span class="btn-icon">⏸</span><span>Pause</span>';
      DOM.timerPhase.textContent = 'Focus';
      DOM.camLabel.textContent   = 'Focus Tracker (Live)';
      AppState.session.tickStart = Date.now();
    }
  },

  /* ── End Session Early ── */
  endSession () {
    Timer.stop();
    FaceWorkerBridge.stop();
    AppState.phase = 'complete';
    AppState.session.endTime = Date.now();
    AppState.session.pomodoroCount++;
    sessionStorage.setItem('sb_pomodoroCount', AppState.session.pomodoroCount);
    App.showReport();
  },

  /* ── Show Report ── */
  showReport () {
    Report.build();
    Pet.render();
  },

  /* ── Download PDF Report ── */
  downloadReport () {
    const s       = AppState.session;
    const p       = AppState.pet;
    const stage   = PET_STAGES.find(st => st.level === p.level) || PET_STAGES[0];
    const now     = new Date();
    const durationM = Math.round((Date.now() - s.startTime) / 60000);
    const totalMs   = s.focusedMs + s.unfocusedMs || 1;
    const focusPct  = Math.round((s.focusedMs / totalMs) * 100);

    const html = `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:30px;
                  background:#fff;border-radius:16px;border:3px solid #4caf78;">
        <h1 style="color:#3a9162;font-size:1.8rem;margin-bottom:4px;">🌱 Study Buddy Report</h1>
        <p style="color:#7a9478;margin-bottom:20px;">${now.toLocaleString()}</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          ${[
            ['⏱ Duration',      durationM + ' minutes'],
            ['👁 Focus Score',  focusPct + '%'],
            ['⚠️ Distractions', s.distractions],
            ['🍅 Pomodoros',    s.pomodoroCount],
            ['🐾 Pet Level',    `Lv.${p.level} – ${stage.name}`],
          ].map(([k,v]) => `
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #d4e8c2;font-weight:700;
                         background:#e8f5e3;">${k}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #d4e8c2;">${v}</td>
            </tr>`).join('')}
        </table>
        <p style="color:#3a9162;font-style:italic;text-align:center;">
          Keep learning — every session makes you stronger! 🚀
        </p>
      </div>`;

    // 1. Create container and assign the off-screen layout canvas ID
    const el = document.createElement('div');
    el.id = 'printed-report-canvas';
    el.innerHTML = html;

    // 2. Explicitly append to body so mobile engines register the dimensions
    document.body.appendChild(el);

    // 3. Build precise configurations
    const opt = {
      filename:   `StudyBuddy_Report_${now.toISOString().slice(0,10)}.pdf`,
      margin:     10,
      image:      { type: 'jpeg', quality: .98 },
      html2canvas:{ 
        scale: 2, 
        useCORS: true, 
        logging: false,
        letterRendering: true
      },
      jsPDF:      { unit: 'mm', format: 'a5', orientation: 'portrait' }
    };

    // 4. Run execution pipeline with asynchronous callback synchronization
    html2pdf().set(opt).from(el).save().then(() => {
      console.log("[Report Engine] Mobile PDF generation complete. Cleaning canvas...");
      el.remove();
    }).catch(err => {
      console.error("[Report Engine] PDF Generation Failed:", err);
      if (el) el.remove();
    });
  },

  /* ── Close Report & Reset ── */
  closeReport () {
    DOM.reportModal.classList.add('hidden');
    AppState.phase = 'idle';

    /* Reset timer display */
    const ms = AppState.session.plannedMins * 60 * 1000;
    Timer._render(ms);
    DOM.timerPhase.textContent = 'Focus';
    DOM.ringProgress.style.strokeDashoffset = 0;
    DOM.ringProgress.classList.remove('danger-mode', 'break-mode');

    /* Reset controls */
    UI.showStartUI();
    DOM.pauseBtn.innerHTML = '<span class="btn-icon">⏸</span><span>Pause</span>';
    DOM.camLabel.textContent = 'Camera Calibration';

    /* Resume worker for re-calibration */
    FaceWorkerBridge.start(1500);

    Pet.setMood('idle');
    Pet.render();
  }
};

/* ═══════════════════════════════════════
   11 – INIT ON LOAD
═══════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  /* Restore XP/level from sessionStorage */
  const savedPet = JSON.parse(sessionStorage.getItem('sb_pet') || 'null');
  if (savedPet) Object.assign(AppState.pet, savedPet);

  Pet.render();
  Pet.setMood('idle');
  UI.showStartUI();
  Timer._render(AppState.session.plannedMins * 60 * 1000);

  /* Wait for face-api.js to be loaded by the deferred script */
  function waitForFaceAPI (retries = 20) {
    if (typeof faceapi !== 'undefined') {
      FaceTracker.initModels();
    } else if (retries > 0) {
      setTimeout(() => waitForFaceAPI(retries - 1), 300);
    } else {
      UI.setModelStatus('error', 'face-api.js failed to load');
    }
  }
  waitForFaceAPI();

  /* Save pet state before user leaves */
  window.addEventListener('beforeunload', () => {
    sessionStorage.setItem('sb_pet', JSON.stringify(AppState.pet));
  });
});

/* Expose App globally for HTML onclick attributes */
window.App = App;