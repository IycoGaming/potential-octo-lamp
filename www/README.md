# DSV2

> A premium Focus Operating System — built for deep work, habits, and goals.

![Version](https://img.shields.io/badge/version-3.0.0-7C3AED?style=flat-square)
![Status](https://img.shields.io/badge/status-live-10B981?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-ready-22D3EE?style=flat-square)

---

## 🚀 Deploy to GitHub Pages (2 minutes)

1. **Fork / upload** this folder to a new GitHub repository
2. Go to **Settings → Pages**
3. Under *Source*, select `main` branch → `/` (root)
4. Click **Save** — your app will be live at `https://username.github.io/repository-name`

---

## ✨ Features

| Module | What it does |
|---|---|
| **Focus Engine** | Pomodoro / Deep Work / Sprint timer with SVG ring, streaks, and session notes |
| **Audio Engine** | Rain · White · Brown · Pink noise + Wind & Thunder overlays via Web Audio API |
| **Task Command** | Full CRUD with priority, subtasks, tags, due dates, Eisenhower Matrix |
| **Habit Tracker** | Daily check-ins, emoji icons, frequency (daily/weekdays/weekends), heatmap |
| **Goal System** | Long-term goals with milestones, categories, manual progress override |
| **Intelligence** | Rule-based smart suggestions based on time, streaks, urgency |

---

## 🏗 File Structure

```
digital-dsv2/
├── index.html          ← App shell + navigation
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker (offline support)
├── css/
│   └── app.css         ← Design system + all styles
├── js/
│   └── app.js          ← All modules + logic (vanilla JS)
└── icons/              ← (add your own app icons)
```

---

## ⚡ Tech Stack

- **Pure HTML + CSS + Vanilla JS** — zero dependencies, zero build steps
- **Web Audio API** — procedurally generated ambient sounds
- **localStorage** — all data stored locally, fully offline
- **Service Worker** — works without internet after first load
- **PWA** — installable on iOS, Android, and desktop

---

## 🎨 Design

Dark theme with violet/cyan accents, Inter + JetBrains Mono typography, ambient particle canvas, and smooth spring animations throughout.

---

## 📱 Install as App

**iOS Safari:** Share → Add to Home Screen  
**Android Chrome:** Menu → Add to Home Screen  
**Desktop Chrome:** Address bar install icon

---

*All data is stored locally on your device. Nothing is sent to any server.*
