# 🌱 Study Buddy – Focus Garden

> A free, browser-based "Walled Garden" study app for children — combining a Pomodoro timer, virtual pet gamification, local PDF/YouTube study materials, and AI-powered focus tracking via facial recognition.

![Study Buddy Screenshot](https://placehold.co/800x400/e8f5e3/3a9162?text=Study+Buddy+%F0%9F%8C%B1+Focus+Garden)

---

## ✨ Features

| Feature | Details |
|---|---|
| 🍅 **Bulletproof Pomodoro Timer** | Uses `Date.now()` timestamps — immune to browser tab freezes |
| 👁 **AI Focus Tracking** | `face-api.js` detects whether your face is present, throttled via a Web Worker (1 detection per 1.5 s) |
| 🔒 **Cold-Start Calibration** | "Start Session" is disabled until AI models are loaded AND a face is detected |
| 🐾 **Virtual Pet** | An emoji pet that levels up (Lv.1–6) based on your focus and XP |
| 📄 **Local PDF Viewer** | Upload any PDF — rendered in-browser via `pdf.js` with page navigation |
| 📺 **YouTube Study Mode** | Paste any YouTube URL — loads in a privacy-preserving iframe |
| 📊 **Session Report** | Downloadable PDF report via `html2pdf.js` with focus %, distractions, XP |
| 🧠 **Zero data sent anywhere** | All data lives in `sessionStorage` — completely private |

---

## 🗂 Project Structure

```
study-buddy/
├── index.html            ← App shell, split-screen layout, all modals
├── style.css             ← Cottagecore EdTech design system
├── app.js                ← Core logic (timer, pet, face tracking, PDF, report)
├── faceWorker-bridge.js  ← Web Worker bridge for throttled face detection
└── README.md             ← This file
```

---

## 🚀 Quick Start (3 steps)

### Option A — VS Code Live Server (recommended)

1. **Clone the repo**
   ```bash
   git clone https://github.com/YOUR-USERNAME/study-buddy.git
   cd study-buddy
   ```

2. **Open in VS Code**
   ```bash
   code .
   ```

3. **Install the Live Server extension**
   - Open Extensions (`Ctrl+Shift+X`)
   - Search **"Live Server"** by Ritwick Dey → Install

4. **Right-click `index.html`** → **"Open with Live Server"**
   - A browser tab opens at `http://127.0.0.1:5500`
   - ✅ Done!

> **Why a local server?** Face detection and PDF loading use browser APIs (`getUserMedia`, `fetch`) that require either `localhost` or `https://` — opening `index.html` as a `file://` URL will not work.

### Option B — Python HTTP server

```bash
# Python 3
python -m http.server 5500

# Then open: http://localhost:5500
```

### Option C — Node.js `serve`

```bash
npx serve .
# Then open the printed URL
```

---

## 🌐 Deploy to GitHub Pages (free hosting)

GitHub Pages serves over `https://`, so everything works perfectly.

### Step-by-step

1. **Create a GitHub repository**
   - Go to [github.com/new](https://github.com/new)
   - Name it `study-buddy` (or anything you like)
   - Set to **Public**
   - Click **Create repository**

2. **Push your code**
   ```bash
   cd study-buddy
   git init
   git add .
   git commit -m "🌱 Initial Study Buddy release"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/study-buddy.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**
   - Open your repo on GitHub
   - Go to **Settings → Pages**
   - Under **Source**, select `Deploy from a branch`
   - Branch: `main`, Folder: `/ (root)`
   - Click **Save**

4. **Your app goes live at:**
   ```
   https://YOUR-USERNAME.github.io/study-buddy/
   ```
   *(It may take 1–2 minutes for the first deploy.)*

5. **(Optional) Share it!**
   Add the Pages URL to your repo's **About** section (gear icon on the repo home page) so visitors can click straight to the live app.

---

## 🧠 Technical Architecture

### Timer — `Date.now()` timestamps

```
Standard setInterval approach          Date.now() approach (ours)
─────────────────────────────          ──────────────────────────
tick 1: 1000ms  ✓                      start: recordTimestamp
tick 2: 1000ms  ✓                      each rAF: remaining = snapshot − Date.now()
tick 3: 2800ms  ✗ (tab was frozen)     freeze proof — always accurate
```

The timer stores `startTimestamp` and calculates `remaining = pausedSnapshot - (Date.now() - startTimestamp)` every `requestAnimationFrame`. A frozen tab cannot drift the timer.

### Face Detection — Web Worker + Throttle

```
  Web Worker (faceWorker-bridge.js)
  ┌──────────────────────────────────┐
  │  setInterval 1500ms → postMessage│  ← lives in Worker thread
  └──────────┬───────────────────────┘
             │ 'TICK'
  Main Thread│
  ┌──────────▼───────────────────────┐
  │  faceapi.detectSingleFace(video) │  ← needs DOM/Canvas, runs here
  │  → update UI / tracking          │
  └──────────────────────────────────┘
```

`face-api.js` requires DOM/Canvas APIs unavailable in a true Worker, so we use the Worker purely as a throttle clock — it posts a message every 1500 ms. The main thread performs the actual detection only when ticked, preventing CPU overheating.

### Cold-Start Calibration

```
App loads
  ↓
face-api.js models fetch from CDN  ──(fail?)──→ error badge
  ↓ (success)
Camera stream starts
  ↓
Worker ticks every 1500ms → detectSingleFace()
  ↓ face detected?
  YES → Start button unlocks 🟢
  NO  → Start button stays disabled 🔴
```

### Data Flow

```
sessionStorage keys:
  sb_pomodoroCount  ← number  (persists across refreshes in the same tab session)
  sb_pet            ← { xp, level } (persists across refreshes)
  sb_history        ← [{ date, duration, focusPct, distractions, xpEarned }]
```

---

## 🎮 Virtual Pet Stages

| Level | Emoji | Name | XP to next |
|---|---|---|---|
| 1 | 🐣 | Sprout | 100 |
| 2 | 🐥 | Chirpy | 200 |
| 3 | 🐦 | Fledge | 350 |
| 4 | 🦜 | Polly | 550 |
| 5 | 🦅 | Eagle | 800 |
| 6 | 🌟 | Scholar | ∞ |

XP earned:
- +2 XP every 1.5 s of detected focus
- +50 XP for completing a full Pomodoro
- Bonus XP at session end based on `(focusPct × durationMins) / 10`

---

## 📦 Libraries Used (all CDN — no installation needed)

| Library | Purpose | CDN |
|---|---|---|
| `face-api.js` v0.22.2 | Face detection | jsDelivr |
| `@vladmandic/face-api` models | Tiny face detector weights | jsDelivr |
| `pdf.js` 3.11 | PDF rendering | cdnjs |
| `html2pdf.js` 0.10 | Session report PDF export | cdnjs |
| Google Fonts | Baloo 2 + Nunito | fonts.googleapis.com |

All libraries are loaded from CDN — no `npm install` or build step needed.

---

## 🔒 Privacy & Safety

- ✅ **No video is stored or transmitted** — face detection runs entirely in-browser
- ✅ **No backend, no database, no accounts**
- ✅ YouTube loads via `youtube-nocookie.com` to minimise tracking
- ✅ All study data stays in `sessionStorage` (cleared when browser tab closes)
- ✅ Works offline after first load if models are cached by the browser

---

## 🛠 Troubleshooting

| Problem | Fix |
|---|---|
| "AI load failed — check network" | You need an internet connection on first load to download the AI models from CDN |
| Camera doesn't start | Click **Allow** when the browser asks for camera permission; check browser settings |
| Start button stays disabled | Make sure your face is clearly visible in the camera box and well-lit |
| PDF doesn't render | Make sure you're running a local server (not `file://`) |
| YouTube iframe blocked | Some YouTube videos disable embedding — try a different video |

---

## 🤝 Contributing

Pull requests welcome! Ideas for improvement:

- [ ] Add a break timer (5-minute Pomodoro breaks)
- [ ] Multiple pet types to unlock
- [ ] Offline model caching with Service Worker
- [ ] Parent dashboard via a second HTML page
- [ ] Sound effects and background music options
- [ ] Streak tracking across days (via `localStorage`)

---

## 📄 License

MIT License — free to use, modify, and share.

---

*Built with 💚 — no frameworks, no build tools, just HTML, CSS, and JavaScript.*
