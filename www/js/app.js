'use strict';

/* ============================================================
   DB MODULE - localStorage abstraction
   ============================================================ */
const DB = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem('dsv2_' + key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('dsv2_' + key, JSON.stringify(value)); } catch {}
  },
  update(key, updater, fallback = null) {
    const current = this.get(key, fallback);
    const updated = updater(current);
    this.set(key, updated);
    return updated;
  }
};

/* ============================================================
   UTILS
   ============================================================ */
const Utils = {
  id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },
  pad(n) { return String(n).padStart(2, '0'); },
  formatTime(sec) {
    return `${this.pad(Math.floor(sec / 60))}:${this.pad(sec % 60)}`;
  },
  today() { return new Date().toISOString().split('T')[0]; },
  daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  },
  daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  },
  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
  formatDateFull(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },
  isOverdue(dateStr) {
    if (!dateStr) return false;
    const due = new Date(dateStr + 'T23:59:59');
    return due < new Date();
  },
  daysUntil(dateStr) {
    if (!dateStr) return null;
    const diff = Math.ceil((new Date(dateStr + 'T00:00:00') - new Date()) / 86400000);
    return diff;
  },
  weekLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
  shortDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
  },
  clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
};

/* ============================================================
   SETTINGS MANAGER
   ============================================================ */
const Settings = {
  defaults: {
    focusDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    cycles: 4,
    autoStart: false,
    sounds: true,
    notifications: false,
    volume: 70,
    onboarded: false
  },
  get(key) {
    const all = DB.get('settings', this.defaults);
    return key in all ? all[key] : this.defaults[key];
  },
  set(key, value) {
    DB.update('settings', s => ({ ...(s || this.defaults), [key]: value }), this.defaults);
  },
  getAll() { return { ...this.defaults, ...DB.get('settings', {}) }; }
};

/* ============================================================
   TOAST SYSTEM
   ============================================================ */
const Toast = {
  show(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const icons = { success: '✓', error: '✕', info: '◆' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${icons[type] || '◆'}</span><span>${message}</span>`;
    container.appendChild(t);
    setTimeout(() => t.remove(), duration);
  }
};

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
const Modal = {
  onConfirm: null,
  show(title, body, { confirmText = 'Save', onConfirm, cancelText = 'Cancel', showCancel = true } = {}) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    this.onConfirm = onConfirm;

    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    if (showCancel) {
      const cancel = document.createElement('button');
      cancel.className = 'btn-modal btn-modal-secondary';
      cancel.textContent = cancelText;
      cancel.onclick = () => this.hide();
      footer.appendChild(cancel);
    }
    if (onConfirm) {
      const confirm = document.createElement('button');
      confirm.className = 'btn-modal btn-modal-primary';
      confirm.textContent = confirmText;
      confirm.onclick = () => { onConfirm(); this.hide(); };
      footer.appendChild(confirm);
    }

    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('visible');
    // Focus first input
    setTimeout(() => {
      const inp = document.querySelector('#modal-body input, #modal-body textarea');
      if (inp) inp.focus();
    }, 350);
  },
  hide() {
    document.getElementById('modal-overlay').classList.remove('visible');
    this.onConfirm = null;
  },
  handleOverlayClick(e) {
    if (e.target === document.getElementById('modal-overlay')) this.hide();
  }
};

/* ============================================================
   AUDIO ENGINE - Web Audio API (Layered + Persistent Volume)
   ============================================================ */
const AudioEngine = {
  ctx: null,
  sources: {},
  gains: {},
  masterGain: null,
  activeSound: null,    // base sound id
  activeOverlay: null,  // overlay sound id (wind/thunder)

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = Settings.get('volume') / 100;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  createBuffer(type) {
    const sr = this.ctx.sampleRate;
    const frames = sr * 4;
    const buffer = this.ctx.createBuffer(1, frames, sr);
    const data = buffer.getChannelData(0);

    if (type === 'white') {
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    } else if (type === 'brown') {
      let last = 0;
      for (let i = 0; i < frames; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      }
    } else if (type === 'pink') {
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < frames; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
        data[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)/7; b6 = w*0.115926;
      }
    } else if (type === 'rain') {
      let prev = 0;
      for (let i = 0; i < frames; i++) {
        const w = Math.random() * 2 - 1;
        prev = prev * 0.98 + w * 0.02;
        data[i] = (w * 0.4 + prev * 0.3) * 0.8;
      }
    } else if (type === 'wind') {
      let lp = 0;
      for (let i = 0; i < frames; i++) {
        const w = Math.random() * 2 - 1;
        lp = lp * 0.999 + w * 0.001;
        const swell = Math.sin(i / (sr * 3)) * 0.5 + 0.5;
        data[i] = (lp * 8 + w * 0.05) * swell * 0.4;
      }
    } else if (type === 'thunder') {
      // Continuous low rumble floor
      for (let i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.015;
      }
      // 4–7 distinct thunder crack+rumble bursts
      const burstCount = 4 + Math.floor(Math.random() * 4);
      for (let b = 0; b < burstCount; b++) {
        const bp     = Math.floor(Math.random() * frames * 0.82);
        const peak   = 0.55 + Math.random() * 0.45;
        const decay  = 2.5  + Math.random() * 3.5;
        const bLen   = Math.min(Math.floor(sr * (1.2 + Math.random() * 1.5)), frames - bp);
        let lp = 0;
        for (let i = 0; i < bLen; i++) {
          const env = Math.exp(-(i / sr) * decay);
          const raw = Math.random() * 2 - 1;
          lp = lp * 0.91 + raw * 0.09;
          data[bp + i] += (raw * 0.3 + lp * 0.7) * env * peak;
          data[bp + i]  = Math.max(-1, Math.min(1, data[bp + i]));
        }
      }
    }
    return buffer;
  },

  _startNode(id, type, vol, isOverlay = false) {
    const buffer = this.createBuffer(type);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.masterGain);
    source.connect(gainNode);
    source.start();
    gainNode.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 1.5);
    this.sources[id] = source;
    this.gains[id] = gainNode;
  },

  _stopNode(id, fadeTime = 1) {
    const gainNode = this.gains[id];
    const src = this.sources[id];
    if (gainNode && this.ctx) {
      gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeTime);
      if (src) setTimeout(() => { try { src.stop(); } catch {} }, fadeTime * 1000 + 100);
    }
    delete this.sources[id];
    delete this.gains[id];
  },

  play(soundId, type, volume = 0.5) {
    this.ensureCtx();
    // Toggle base sound off if same
    if (this.activeSound === soundId) {
      this._stopNode(soundId);
      this.activeSound = null;
      return;
    }
    // Stop previous base
    if (this.activeSound) this._stopNode(this.activeSound);
    this._startNode(soundId, type, volume);
    this.activeSound = soundId;
  },

  playOverlay(soundId, type, volume = 0.25) {
    this.ensureCtx();
    // Toggle overlay off if same
    if (this.activeOverlay === soundId) {
      this._stopNode(soundId);
      this.activeOverlay = null;
      return;
    }
    // Stop previous overlay
    if (this.activeOverlay) this._stopNode(this.activeOverlay);
    this._startNode(soundId, type, volume, true);
    this.activeOverlay = soundId;
  },

  stopAll(fadeTime = 1) {
    Object.keys(this.sources).forEach(id => this._stopNode(id, fadeTime));
    this.sources = {};
    this.gains = {};
    this.activeSound = null;
    this.activeOverlay = null;
  },

  setVolume(vol) {
    Settings.set('volume', Math.round(vol * 100));
    if (this.masterGain) this.masterGain.gain.value = vol;
  },

  playChime() {
    this.ensureCtx();
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.2);
      g.gain.linearRampToValueAtTime(0.15, now + i * 0.2 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 0.8);
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(now + i * 0.2);
      osc.stop(now + i * 0.2 + 0.9);
    });
  }
};

/* ============================================================
   FOCUS ENGINE
   ============================================================ */
const FocusEngine = {
  state: {
    mode: 'focus',   // 'focus' | 'short' | 'long'
    running: false,
    elapsed: 0,
    cycle: 0
  },
  _timer: null,

  getDuration() {
    const map = {
      focus: Settings.get('focusDuration') * 60,
      short: Settings.get('shortBreak') * 60,
      long:  Settings.get('longBreak') * 60
    };
    return map[this.state.mode];
  },

  getRemaining() {
    return Math.max(0, this.getDuration() - this.state.elapsed);
  },

  getProgress() {
    const dur = this.getDuration();
    return dur > 0 ? this.state.elapsed / dur : 0;
  },

  start() {
    if (this.state.running) return;
    AudioEngine.ensureCtx();
    this.state.running = true;
    this._timer = setInterval(() => this.tick(), 1000);
    this.updateUI();
  },

  pause() {
    if (!this.state.running) return;
    this.state.running = false;
    clearInterval(this._timer);
    this._timer = null;
    this.updateUI();
  },

  reset() {
    this.state.running = false;
    this.state.elapsed = 0;
    clearInterval(this._timer);
    this._timer = null;
    this.updateUI();
  },

  tick() {
    this.state.elapsed++;
    if (this.state.elapsed >= this.getDuration()) {
      this.complete();
    } else {
      this.updateUI();
    }
  },

  complete() {
    clearInterval(this._timer);
    this._timer = null;
    this.state.running = false;

    if (this.state.mode === 'focus') {
      const duration = Settings.get('focusDuration');
      const linkedTaskId = App.linkedTaskId;

      // Record session first
      const sessions = DB.get('sessions', []);
      const newSession = {
        id: Utils.id(),
        date: Utils.today(),
        ts: Date.now(),
        duration,
        taskId: linkedTaskId || null,
        note: ''
      };
      sessions.push(newSession);
      DB.set('sessions', sessions);

      this.state.cycle++;
      if (Settings.get('sounds')) AudioEngine.playChime();
      NotificationSystem.send('Session Complete!', 'Great work. Time for a break. 🎯');

      // Show session complete modal
      const cyclesDone = Settings.get('cycles');
      const nextMode = this.state.cycle >= cyclesDone ? 'long' : 'short';
      if (this.state.cycle >= cyclesDone) this.state.cycle = 0;
      this.state.mode = nextMode;
      this.state.elapsed = 0;

      Modal.show('🎯 Session Complete!', `
        <div style="text-align:center;margin-bottom:16px">
          <div style="font-size:48px">🎉</div>
          <div style="font-size:16px;font-weight:700;color:var(--text);margin-top:8px">${duration} min focus block done!</div>
          <div style="font-size:13px;color:var(--text-3);margin-top:4px">Next: ${nextMode === 'short' ? 'Short break' : 'Long break'} →</div>
        </div>
        <div class="form-field">
          <label class="form-label">What did you accomplish?</label>
          <textarea class="form-input" id="session-note" rows="3" placeholder="Optionally note what you worked on..." style="min-height:80px"></textarea>
        </div>
        ${linkedTaskId ? (() => {
          const t = TasksEngine.getAll().find(x => x.id === linkedTaskId);
          return t ? `
          <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--card);border-radius:var(--r-sm);margin-top:4px">
            <span style="font-size:14px">✅</span>
            <span style="font-size:13px;color:var(--text-2);flex:1">${App.escHtml(t.title)}</span>
            <button class="btn-sm btn-primary" style="font-size:11px;padding:4px 8px"
              onclick="TasksEngine.toggle('${linkedTaskId}');Toast.show('Task completed!','success');this.textContent='✓ Done';this.disabled=true">Mark Done</button>
          </div>` : '';
        })() : ''}
      `, {
        confirmText: 'Start Break',
        cancelText: 'Skip',
        onConfirm: () => {
          const note = document.getElementById('session-note')?.value.trim() || '';
          if (note) {
            // Update last session note
            const sess = DB.get('sessions', []);
            if (sess.length) { sess[sess.length - 1].note = note; DB.set('sessions', sess); }
          }
          Toast.show('Break time! 🌿', 'success');
          if (Settings.get('autoStart')) setTimeout(() => this.start(), 800);
          this.updateUI();
          if (App.currentScreen === 'focus') App.render('focus');
        }
      });
      Toast.show('Focus session complete! 🎯', 'success');
    } else {
      if (Settings.get('sounds')) AudioEngine.playChime();
      Toast.show('Break over. Back to focus!', 'info');
      this.state.mode = 'focus';
      this.state.elapsed = 0;
      if (Settings.get('autoStart')) {
        setTimeout(() => this.start(), 1500);
      } else {
        this.updateUI();
      }
    }

    this.updateUI();
    if (App.currentScreen === 'focus') App.render('focus');
  },

  setMode(mode) {
    this.reset();
    this.state.mode = mode;
    this.updateUI();
  },

  getTodaySessions() {
    return (DB.get('sessions', [])).filter(s => s.date === Utils.today());
  },

  getStreak() {
    const sessions = DB.get('sessions', []);
    if (!sessions.length) return 0;
    const dates = [...new Set(sessions.map(s => s.date))].sort().reverse();
    if (dates[0] !== Utils.today() && dates[0] !== Utils.daysAgo(1)) return 0;
    let streak = 0;
    let check = Utils.today();
    for (const date of dates) {
      if (date === check) { streak++; const d = new Date(check); d.setDate(d.getDate()-1); check = d.toISOString().split('T')[0]; }
      else break;
    }
    return streak;
  },

  getFocusScore() {
    const today = this.getTodaySessions();
    const minutes = today.reduce((s, sess) => s + (sess.duration || 25), 0);
    return Math.min(100, Math.round((minutes / 120) * 100));
  },

  updateUI() {
    const timeEl = document.getElementById('ring-time');
    const modeEl = document.getElementById('ring-mode-label');
    const sessEl = document.getElementById('ring-session-count');
    const btnEl  = document.getElementById('focus-play-btn');
    const ring   = document.getElementById('focus-ring');

    if (!timeEl) return;

    const remaining = this.getRemaining();
    timeEl.textContent = Utils.formatTime(remaining);
    modeEl.textContent = { focus: 'Focus', short: 'Short Break', long: 'Long Break' }[this.state.mode];
    const todaySess = this.getTodaySessions().length;
    sessEl.textContent = `${todaySess} session${todaySess !== 1 ? 's' : ''} today`;

    btnEl.textContent = this.state.running ? '⏸' : '▶';
    if (this.state.running) {
      document.querySelector('.ctrl-btn-primary')?.classList.add('running-pulse');
    } else {
      document.querySelector('.ctrl-btn-primary')?.classList.remove('running-pulse');
    }

    // Update ring
    const circumference = 565.49;
    const progress = this.getProgress();
    const modeColors = { focus: '#7C3AED', short: '#22D3EE', long: '#10B981' };
    ring.style.strokeDashoffset = circumference * (1 - progress);
    ring.setAttribute('stroke', modeColors[this.state.mode]);

    // Cycle dots
    const dots = document.querySelectorAll('.cycle-dot');
    const cycles = Settings.get('cycles');
    dots.forEach((dot, i) => {
      dot.classList.remove('done', 'current');
      if (i < this.state.cycle) dot.classList.add('done');
      else if (i === this.state.cycle && this.state.mode === 'focus') dot.classList.add('current');
    });

    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.state.mode);
    });
  }
};

/* ============================================================
   TASKS ENGINE
   ============================================================ */
const TasksEngine = {
  getAll() { return DB.get('tasks', []); },

  create(data) {
    const tasks = this.getAll();
    const task = { id: Utils.id(), createdAt: Date.now(), completed: false, subtasks: [], tags: [], ...data };
    tasks.unshift(task);
    DB.set('tasks', tasks);
    return task;
  },

  update(id, data) {
    DB.update('tasks', tasks => tasks.map(t => t.id === id ? { ...t, ...data } : t), []);
  },

  delete(id) {
    DB.update('tasks', tasks => tasks.filter(t => t.id !== id), []);
  },

  toggle(id) {
    DB.update('tasks', tasks => tasks.map(t => t.id === id ? { ...t, completed: !t.completed, completedAt: !t.completed ? Date.now() : null } : t), []);
  },

  addSubtask(taskId, text) {
    DB.update('tasks', tasks => tasks.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: [...(t.subtasks || []), { id: Utils.id(), text, done: false }] };
    }), []);
  },

  toggleSubtask(taskId, subId) {
    DB.update('tasks', tasks => tasks.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: t.subtasks.map(s => s.id === subId ? { ...s, done: !s.done } : s) };
    }), []);
  },

  getQuadrant(task) {
    if (task.quadrant) return task.quadrant;
    const map = { urgent: 'q1', high: 'q2', medium: 'q3', low: 'q4' };
    return map[task.priority] || 'q3';
  },

  filter(tasks, criteria) {
    let result = [...tasks];
    if (criteria.search) {
      const q = criteria.search.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q) || (t.tags || []).some(tag => tag.toLowerCase().includes(q)));
    }
    if (criteria.priority && criteria.priority !== 'all') {
      result = result.filter(t => t.priority === criteria.priority);
    }
    if (criteria.status === 'active') result = result.filter(t => !t.completed);
    if (criteria.status === 'done')   result = result.filter(t => t.completed);
    return result;
  }
};

/* ============================================================
   NOTIFICATION SYSTEM
   ============================================================ */
const NotificationSystem = {
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  },

  send(title, body, icon = '🎯') {
    if (!Settings.get('notifications')) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>' + icon + '</text></svg>' });
    } catch {}
  },

  async enable() {
    const granted = await this.requestPermission();
    if (granted) {
      Settings.set('notifications', true);
      Toast.show('Notifications enabled ✓', 'success');
    } else {
      Toast.show('Notification permission denied', 'error');
      Settings.set('notifications', false);
    }
    return granted;
  }
};

/* ============================================================
   HABIT ENGINE
   ============================================================ */
const HabitEngine = {
  getAll() { return DB.get('habits', []); },

  create(data) {
    const habits = this.getAll();
    const habit = { id: Utils.id(), createdAt: Date.now(), checkins: [], ...data };
    habits.push(habit);
    DB.set('habits', habits);
    return habit;
  },

  delete(id) {
    DB.update('habits', h => h.filter(x => x.id !== id), []);
  },

  checkIn(id) {
    const today = Utils.today();
    DB.update('habits', habits => habits.map(h => {
      if (h.id !== id) return h;
      const checkins = [...(h.checkins || [])];
      if (!checkins.includes(today)) checkins.push(today);
      return { ...h, checkins };
    }), []);
  },

  uncheckIn(id) {
    const today = Utils.today();
    DB.update('habits', habits => habits.map(h => {
      if (h.id !== id) return h;
      return { ...h, checkins: (h.checkins || []).filter(d => d !== today) };
    }), []);
  },

  isCheckedIn(habit) {
    return (habit.checkins || []).includes(Utils.today());
  },

  getStreak(habit) {
    const checkins = new Set(habit.checkins || []);
    let streak = 0;
    let date = new Date();
    // Check today or yesterday
    const todayStr = Utils.today();
    const yesterStr = Utils.daysAgo(1);
    if (!checkins.has(todayStr) && !checkins.has(yesterStr)) return 0;
    if (!checkins.has(todayStr)) date.setDate(date.getDate() - 1);
    while (true) {
      const d = date.toISOString().split('T')[0];
      if (!checkins.has(d)) break;
      streak++;
      date.setDate(date.getDate() - 1);
    }
    return streak;
  },

  getBestStreak(habit) {
    const checkins = [...(habit.checkins || [])].sort();
    if (!checkins.length) return 0;
    let best = 1, cur = 1;
    for (let i = 1; i < checkins.length; i++) {
      const diff = Utils.daysBetween(checkins[i-1], checkins[i]);
      if (diff === 1) { cur++; best = Math.max(best, cur); }
      else cur = 1;
    }
    return best;
  },

  getCompletionRate(habit, days = 30) {
    const checkins = new Set(habit.checkins || []);
    let count = 0;
    for (let i = 0; i < days; i++) {
      if (checkins.has(Utils.daysAgo(i))) count++;
    }
    return Math.round((count / days) * 100);
  },

  getHeatmapData(habit, weeks = 12) {
    const days = weeks * 7;
    const checkins = new Set(habit.checkins || []);
    return Array.from({ length: days }, (_, i) => ({
      date: Utils.daysAgo(days - 1 - i),
      done: checkins.has(Utils.daysAgo(days - 1 - i))
    }));
  },

  /* Check if today is a scheduled day based on frequency */
  isScheduledToday(habit) {
    const freq = habit.frequency || 'daily';
    if (freq === 'daily') return true;
    const day = new Date().getDay(); // 0=Sun, 6=Sat
    if (freq === 'weekday') return day >= 1 && day <= 5;
    if (freq === 'weekend') return day === 0 || day === 6;
    return true;
  },

  EMOJI_LIST: ['💪','🧘','📚','🏃','💧','🥗','😴','✍️','🎯','🧠','🎸','🌿','🏋️','🚴','🍎','☀️','🌙','🔥','⚡','💡','🎨','🧪','💻','🌊','🧹','📝','🎵','🏊','🤸','🙏','🎤','🌱','🐾','🧩','❤️','🦷','📖','🫁']
};

/* ============================================================
   GOALS ENGINE
   ============================================================ */
const GoalsEngine = {
  getAll() { return DB.get('goals', []); },

  create(data) {
    const goals = this.getAll();
    const goal = { id: Utils.id(), createdAt: Date.now(), milestones: [], ...data };
    goals.push(goal);
    DB.set('goals', goals);
    return goal;
  },

  update(id, data) {
    DB.update('goals', goals => goals.map(g => g.id === id ? { ...g, ...data } : g), []);
  },

  delete(id) {
    DB.update('goals', goals => goals.filter(g => g.id !== id), []);
  },

  addMilestone(goalId, text) {
    DB.update('goals', goals => goals.map(g => {
      if (g.id !== goalId) return g;
      return { ...g, milestones: [...(g.milestones || []), { id: Utils.id(), text, done: false }] };
    }), []);
  },

  toggleMilestone(goalId, mId) {
    DB.update('goals', goals => goals.map(g => {
      if (g.id !== goalId) return g;
      return { ...g, milestones: (g.milestones || []).map(m => m.id === mId ? { ...m, done: !m.done } : m) };
    }), []);
  },

  getProgress(goal) {
    // Manual override takes precedence if set
    if (typeof goal.manualProgress === 'number') return goal.manualProgress;
    const ms = goal.milestones || [];
    if (!ms.length) return 0;
    return Math.round((ms.filter(m => m.done).length / ms.length) * 100);
  },

  CATEGORIES: {
    work:     { label: 'Work',     icon: '💼', cls: 'cat-work' },
    health:   { label: 'Health',   icon: '💪', cls: 'cat-health' },
    learn:    { label: 'Learning', icon: '📚', cls: 'cat-learn' },
    finance:  { label: 'Finance',  icon: '💰', cls: 'cat-finance' },
    personal: { label: 'Personal', icon: '🌱', cls: 'cat-personal' }
  }
};

const Intelligence = {
  getSuggestions() {
    const hour = new Date().getHours();
    const suggestions = [];

    // Time-based suggestion
    const todaySess = FocusEngine.getTodaySessions();
    if (hour >= 6 && hour < 10 && todaySess.length === 0) {
      suggestions.push({ icon: '🌅', text: 'Morning peak window. Start a focus session now for maximum output.' });
    } else if (hour >= 14 && hour < 16 && todaySess.length < 2) {
      suggestions.push({ icon: '⚡', text: 'Early afternoon — fight the slump with a 25-min deep work sprint.' });
    } else if (hour >= 20) {
      suggestions.push({ icon: '🌙', text: 'Wind down time. Review your goals and plan tomorrow with intention.' });
    }

    // Urgent tasks
    const urgent = TasksEngine.getAll().filter(t => t.priority === 'urgent' && !t.completed);
    if (urgent.length) {
      suggestions.push({ icon: '🔥', text: `${urgent.length} urgent task${urgent.length > 1 ? 's' : ''} waiting. Clear them before deep work.` });
    }

    // Habit streaks at risk
    const atRisk = HabitEngine.getAll().filter(h => {
      const streak = HabitEngine.getStreak(h);
      return streak > 0 && !HabitEngine.isCheckedIn(h);
    });
    if (atRisk.length) {
      suggestions.push({ icon: '🏅', text: `${atRisk.length} habit streak${atRisk.length > 1 ? 's' : ''} at risk. Don't break the chain!` });
    }

    // Overdue tasks
    const overdue = TasksEngine.getAll().filter(t => !t.completed && Utils.isOverdue(t.dueDate));
    if (overdue.length) {
      suggestions.push({ icon: '⏰', text: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}. Address or reschedule today.` });
    }

    // Default positive
    if (!suggestions.length) {
      suggestions.push({ icon: '✨', text: 'You\'re on track. Keep building momentum — consistency beats intensity.' });
    }

    return suggestions.slice(0, 3);
  }
};

/* ============================================================
   CHART ENGINE - Canvas-based graphs
   ============================================================ */
const ChartEngine = {

  /* Shared drawing helpers */
  _dpr() { return window.devicePixelRatio || 1; },

  _setup(canvas, h = 100) {
    const dpr = this._dpr();
    const w   = canvas.parentElement.clientWidth || 300;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  },

  /* Bar chart — values[], colors, labels */
  drawBar(canvas, values, opts = {}) {
    const h = opts.h || 100;
    const { ctx, w } = this._setup(canvas, h);
    const {
      color      = '#7C3AED',
      colorEmpty = 'rgba(26,26,50,0.8)',
      maxVal     = Math.max(...values, 1),
      padX       = 4,
      radius     = 3,
      gradient   = true
    } = opts;

    ctx.clearRect(0, 0, w, h);

    const n      = values.length;
    const gap    = 4;
    const barW   = (w - padX * 2 - gap * (n - 1)) / n;
    const chartH = h - 10;

    values.forEach((v, i) => {
      const x    = padX + i * (barW + gap);
      const pct  = maxVal > 0 ? v / maxVal : 0;
      const barH = Math.max(pct * chartH, v > 0 ? 3 : 0);
      const y    = chartH - barH;

      // Empty bar background
      ctx.fillStyle = colorEmpty;
      this._roundRect(ctx, x, 0, barW, chartH, radius);
      ctx.fill();

      if (barH > 0) {
        if (gradient) {
          const grad = ctx.createLinearGradient(0, y, 0, chartH);
          grad.addColorStop(0, color);
          grad.addColorStop(1, color.replace(')', ', 0.4)').replace('rgb', 'rgba'));
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = color;
        }
        this._roundRect(ctx, x, y, barW, barH, radius);
        ctx.fill();

        // Value label on top if > 0
        if (v > 0 && barH > 14) {
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.font = `bold ${Math.min(9, barW * 0.4)}px JetBrains Mono, monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(v, x + barW / 2, y + 9);
        }
      }
    });
  },

  /* Line chart — multi-series [{values, color, label}] */
  drawLine(canvas, series, opts = {}) {
    const h = opts.h || 100;
    const { ctx, w } = this._setup(canvas, h);
    const {
      maxVal = Math.max(...series.flatMap(s => s.values), 1),
      padX   = 8,
      padY   = 10,
      fill   = true
    } = opts;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(26,26,50,0.8)';
    ctx.lineWidth   = 1;
    [0.25, 0.5, 0.75, 1].forEach(pct => {
      const y = padY + (1 - pct) * (h - padY * 2);
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(w - padX, y);
      ctx.stroke();
    });

    series.forEach(s => {
      const pts = s.values.map((v, i) => ({
        x: padX + (i / Math.max(s.values.length - 1, 1)) * (w - padX * 2),
        y: padY + (1 - (maxVal > 0 ? v / maxVal : 0)) * (h - padY * 2)
      }));

      if (pts.length < 2) return;

      // Fill area
      if (fill) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, h - padY);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, h - padY);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, s.color.replace(')', ', 0.25)').replace('rgb', 'rgba'));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fill();
      }

      // Line (smooth bezier)
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const cpx = (pts[i-1].x + pts[i].x) / 2;
        ctx.bezierCurveTo(cpx, pts[i-1].y, cpx, pts[i].y, pts[i].x, pts[i].y);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.stroke();

      // Dots
      pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle   = s.color;
        ctx.strokeStyle = 'var(--card, #0E0E1E)';
        ctx.lineWidth   = 1.5;
        ctx.fill();
        ctx.stroke();
      });
    });
  },

  /* Ring / donut chart */
  drawDonut(canvas, pct, opts = {}) {
    const size = opts.size || 80;
    const dpr  = this._dpr();
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2, r = size * 0.38, sw = size * 0.1;
    const start = -Math.PI / 2;
    const end   = start + (pct / 100) * Math.PI * 2;
    const color = opts.color || '#7C3AED';

    ctx.clearRect(0, 0, size, size);

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(26,26,50,0.9)';
    ctx.lineWidth = sw;
    ctx.stroke();

    // Fill
    if (pct > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, end);
      ctx.strokeStyle = color;
      ctx.lineWidth   = sw;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
};


/* ============================================================
   AMBIENT CANVAS — Subtle floating particle background
   ============================================================ */
const AmbientCanvas = {
  particles: [],
  raf: null,
  init() {
    const canvas = document.getElementById('ambient-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    // Create particles
    this.particles = Array.from({ length: 28 }, () => this.mkParticle(canvas));
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.particles.forEach(p => {
        p.y -= p.vy;
        p.x += Math.sin(p.phase + Date.now() * 0.0003) * 0.4;
        p.phase += 0.005;
        p.life  -= 0.003;
        if (p.life <= 0) Object.assign(p, this.mkParticle(canvas, true));
        const alpha = Math.min(p.life, 1 - p.life) * 2 * p.maxAlpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color.replace('A)', `${Math.max(0, alpha)})`);
        ctx.fill();
      });
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  },
  mkParticle(canvas, fromBottom = false) {
    const colors = ['rgba(124,58,237,A)', 'rgba(34,211,238,A)', 'rgba(99,102,241,A)', 'rgba(167,139,250,A)'];
    return {
      x: Math.random() * canvas.width,
      y: fromBottom ? canvas.height + 5 : Math.random() * canvas.height,
      r: 1 + Math.random() * 2.5,
      vy: 0.12 + Math.random() * 0.28,
      phase: Math.random() * Math.PI * 2,
      life: Math.random(),
      maxAlpha: 0.08 + Math.random() * 0.12,
      color: colors[Math.floor(Math.random() * colors.length)]
    };
  }
};

const App = {
  currentScreen: 'focus',
  taskView: 'list',
  taskFilter: { status: 'active', priority: 'all', search: '' },
  linkedTaskId: null,      // Task linked to current focus session
  lastSessionNote: '',     // Note from last completed session

  navigate(screen) {
    if (this.currentScreen === screen) return;

    // Cleanup
    if (this.currentScreen === 'focus') FocusEngine.pause();

    this.currentScreen = screen;

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.screen === screen);
    });

    this.render(screen);
    document.getElementById('screen-wrap').scrollTo(0, 0);
  },

  render(screen) {
    const el = document.getElementById('screen-content');
    el.className = 'animate-fade';
    const renders = {
      focus:     () => this.renderFocus(),
      tasks:     () => this.renderTasks(),
      habits:    () => this.renderHabits(),
      goals:     () => this.renderGoals(),
      settings:  () => this.renderSettings()
    };
    el.innerHTML = (renders[screen] || renders.focus)();
    const inits = {
      focus:     () => { this.initFocus(); },
      tasks:     () => this.initTasks(),
      habits:    () => {},
      goals:     () => {},
    };
    (inits[screen] || (() => {}))();
  },

  /* ——— FOCUS SCREEN ——— */
  renderFocus() {
    const sessions = FocusEngine.getTodaySessions();
    const streak = FocusEngine.getStreak();
    const score = FocusEngine.getFocusScore();
    const suggestions = Intelligence.getSuggestions();
    const cycles = Settings.get('cycles');
    const circumference = 565.49;

    return `
    <div id="focus-screen">
      <div class="screen-header">
        <div>
          <div class="screen-title">DSV2</div>
          <div class="screen-subtitle">STREAK ${streak}d · SCORE ${score}%</div>
        </div>
        <button class="header-btn" onclick="App.showFocusSettings()">⚙</button>
      </div>

      <div class="focus-modes">
        ${['focus','short','long'].map(m => `
          <button class="mode-btn ${FocusEngine.state.mode === m ? 'active' : ''}" data-mode="${m}" onclick="FocusEngine.setMode('${m}')">
            ${{ focus: 'Focus', short: 'Short', long: 'Long' }[m]}
          </button>`).join('')}
      </div>

      <div class="focus-presets" style="display:flex;gap:6px;padding:0 16px 4px;overflow-x:auto">
        ${[
          {id:'pomodoro', label:'🍅 Pomodoro', focus:25, short:5, long:15, cycles:4},
          {id:'deepwork', label:'🧠 Deep Work', focus:90, short:20, long:30, cycles:2},
          {id:'sprint',   label:'⚡ Sprint',   focus:50, short:10, long:20, cycles:3}
        ].map(p => `
          <button class="filter-chip" style="flex-shrink:0" onclick="App.applyPreset(${p.focus},${p.short},${p.long},${p.cycles},'${p.label}')">${p.label}</button>
        `).join('')}
      </div>

      <div class="focus-ring-wrap">
        <div class="focus-ring-container">
          <svg id="focus-ring-bg" viewBox="0 0 200 200" fill="none">
            <circle cx="100" cy="100" r="90" stroke="#1C1C30" stroke-width="10"/>
          </svg>
          <svg id="focus-ring-svg" viewBox="0 0 200 200" fill="none" style="position:absolute;top:0;left:0;width:100%;height:100%;transform:rotate(-90deg)">
            <circle id="focus-ring" cx="100" cy="100" r="90" stroke="#7C3AED" stroke-width="10"
              stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"
              stroke-linecap="round" style="transition:stroke-dashoffset 0.9s ease,stroke 0.3s"/>
          </svg>
          <div class="ring-info">
            <div id="ring-time" class="ring-time">${Utils.formatTime(Settings.get('focusDuration') * 60)}</div>
            <div id="ring-mode-label" class="ring-mode-label">Focus</div>
            <div id="ring-session-count" class="ring-session-count">${sessions.length} sessions today</div>
          </div>
        </div>
      </div>

      <div class="cycle-dots">
        ${Array.from({ length: cycles }, (_, i) => `<div class="cycle-dot" data-i="${i}"></div>`).join('')}
      </div>

      <div class="focus-controls">
        <button class="ctrl-btn" onclick="FocusEngine.reset()" title="Reset">↺</button>
        <button class="ctrl-btn ctrl-btn-primary" id="focus-play-btn" onclick="FocusEngine.state.running ? FocusEngine.pause() : FocusEngine.start()">▶</button>
        <button class="ctrl-btn" onclick="FocusEngine.complete()" title="Skip">⏭</button>
      </div>

      <div class="audio-panel">
        <div class="audio-title">Base Sound</div>
        <div class="audio-sounds">
          ${[
            {id:'white',type:'white',icon:'🌊',label:'White'},
            {id:'brown',type:'brown',icon:'🍂',label:'Brown'},
            {id:'pink',type:'pink',icon:'🌸',label:'Pink'},
            {id:'rain',type:'rain',icon:'🌧',label:'Rain'}
          ].map(s => `
            <button class="sound-btn ${AudioEngine.activeSound === s.id ? 'active' : ''}" id="snd-${s.id}"
              onclick="App.toggleSound('${s.id}','${s.type}')">
              <span class="sound-icon">${s.icon}</span>
              <span class="sound-label">${s.label}</span>
            </button>`).join('')}
          <button class="sound-btn ${!AudioEngine.activeSound ? 'active' : ''}" id="snd-off"
            onclick="App.stopAllSounds()">
            <span class="sound-icon">🔇</span>
            <span class="sound-label">Off</span>
          </button>
          <div></div>
        </div>
        <div class="audio-title" style="padding-top:10px">Overlay Layer</div>
        <div class="audio-sounds">
          ${[
            {id:'wind',type:'wind',icon:'💨',label:'Wind'},
            {id:'thunder',type:'thunder',icon:'⛈',label:'Thunder'}
          ].map(s => `
            <button class="sound-btn ${AudioEngine.activeOverlay === s.id ? 'active' : ''}" id="ovl-${s.id}"
              onclick="App.toggleOverlay('${s.id}','${s.type}')">
              <span class="sound-icon">${s.icon}</span>
              <span class="sound-label">${s.label}</span>
            </button>`).join('')}
          <button class="sound-btn ${!AudioEngine.activeOverlay ? 'active' : ''}" id="ovl-off"
            onclick="App.stopOverlay()">
            <span class="sound-icon">🔇</span>
            <span class="sound-label">None</span>
          </button>
        </div>
        <div class="volume-row">
          <span class="volume-label">Vol</span>
          <input type="range" min="0" max="100" value="${Settings.get('volume')}" id="vol-slider"
            oninput="AudioEngine.setVolume(this.value/100);document.getElementById('vol-display').textContent=this.value">
          <span class="volume-label mono" id="vol-display">${Settings.get('volume')}</span>
        </div>
      </div>

      <div class="intel-section">
        <div class="intel-title">Intelligence</div>
        ${suggestions.map(s => `
          <div class="intel-card">
            <div class="intel-icon">${s.icon}</div>
            <div class="intel-text">${s.text}</div>
          </div>`).join('')}
      </div>

      ${sessions.length ? `
      <div style="padding:0 16px 8px">
        <div class="intel-title">Today's Sessions</div>
        <div class="today-sessions">
          ${sessions.map((s, i) => `
            <div class="session-chip" title="${s.note ? s.note : ''}">#${i+1} · ${s.duration || 25}min${s.note ? ' 📝' : ''}</div>`).join('')}
        </div>
      </div>` : ''}

      ${this.renderAnalytics()}

      <div style="padding:0 16px 8px">
        <div class="intel-title">Quick Actions</div>
        ${this.linkedTaskId ? (() => {
          const t = TasksEngine.getAll().find(x => x.id === this.linkedTaskId);
          return t ? `
          <div class="linked-task-card">
            <div class="linked-task-dot"></div>
            <div class="linked-task-text">🎯 ${this.escHtml(t.title)}</div>
            <button class="linked-task-clear" onclick="App.clearLinkedTask()" title="Unlink">✕</button>
          </div>` : '';
        })() : `
          <button class="btn-sm" style="margin-bottom:8px;width:100%;justify-content:center;display:flex;align-items:center;gap:6px"
            onclick="App.showLinkTask()">🔗 Link a task to this session</button>`}
        <div class="quick-task-row">
          <input type="text" class="quick-task-input" id="quick-task-inp" placeholder="Quick add task..." onkeydown="if(event.key==='Enter')App.quickAddTask()">
          <button class="quick-task-add" onclick="App.quickAddTask()">+</button>
        </div>
      </div>
    </div>`;
  },

  initFocus() {
    FocusEngine.updateUI();
    this.initAnalytics();
  },

  /* ——— ANALYTICS ——— */
  renderAnalytics() {
    const sessions  = DB.get('sessions', []);
    const habits    = HabitEngine.getAll();

    // Build 7-day data
    const days      = 7;
    const dayLabels = [];
    const focusMins = [];
    const habitPcts = [];

    for (let i = days - 1; i >= 0; i--) {
      const d    = Utils.daysAgo(i);
      const lbl  = Utils.shortDay(d);
      dayLabels.push(lbl);

      const daySessions = sessions.filter(s => s.date === d);
      focusMins.push(daySessions.reduce((acc, s) => acc + (s.duration || 25), 0));

      const pct = habits.length
        ? Math.round(habits.filter(h => (h.checkins || []).includes(d)).length / habits.length * 100)
        : 0;
      habitPcts.push(pct);
    }

    const totalMins   = focusMins.reduce((a, b) => a + b, 0);
    const avgMins     = days ? Math.round(totalMins / days) : 0;
    const bestDay     = Math.max(...focusMins);
    const score       = FocusEngine.getFocusScore();
    const streak      = FocusEngine.getStreak();
    const avgHabit    = habitPcts.length
      ? Math.round(habitPcts.reduce((a,b) => a+b, 0) / habitPcts.length)
      : 0;

    const hasHabits = habits.length > 0;

    return `
    <div class="analytics-section">
      <div class="intel-title" style="margin-bottom:10px">Analytics — Last 7 Days</div>

      <div class="analytics-grid">
        <div class="analytics-stat">
          <div class="analytics-stat-val">${totalMins}<span style="font-size:13px">m</span></div>
          <div class="analytics-stat-lbl">Total Focus</div>
        </div>
        <div class="analytics-stat">
          <div class="analytics-stat-val">${streak}<span style="font-size:13px">d</span></div>
          <div class="analytics-stat-lbl">Streak</div>
        </div>
        <div class="analytics-stat">
          <div class="analytics-stat-val" style="color:var(--amber)">${score}%</div>
          <div class="analytics-stat-lbl">Score</div>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-title">
          Daily Focus (min)
          <span class="chart-title-stat">${avgMins}m avg · ${bestDay}m best</span>
        </div>
        <div class="chart-canvas-wrap">
          <canvas id="chart-focus"></canvas>
        </div>
        <div class="chart-x-labels">
          ${dayLabels.map(l => `<span>${l}</span>`).join('')}
        </div>
      </div>

      ${hasHabits ? `
      <div class="chart-card">
        <div class="chart-title">
          Habit Completion %
          <span class="chart-title-stat" style="color:var(--green)">${avgHabit}% avg</span>
        </div>
        ${habits.length > 1 ? `
        <div class="chart-legend">
          <div class="legend-item"><div class="legend-dot" style="background:#10B981"></div>Overall</div>
          ${habits.slice(0,3).map((h,i) => {
            const colors = ['#7C3AED','#22D3EE','#F59E0B'];
            return `<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div>${h.name.slice(0,10)}</div>`;
          }).join('')}
        </div>` : ''}
        <div class="chart-canvas-wrap">
          <canvas id="chart-habits"></canvas>
        </div>
        <div class="chart-x-labels">
          ${dayLabels.map(l => `<span>${l}</span>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
  },

  initAnalytics() {
    const sessions = DB.get('sessions', []);
    const habits   = HabitEngine.getAll();
    const days     = 7;

    // Focus minutes bar chart
    const focusMins = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = Utils.daysAgo(i);
      const daySess = sessions.filter(s => s.date === d);
      focusMins.push(daySess.reduce((acc, s) => acc + (s.duration || 25), 0));
    }

    const focusCanvas = document.getElementById('chart-focus');
    if (focusCanvas) {
      ChartEngine.drawBar(focusCanvas, focusMins, {
        color:  '#7C3AED',
        h:      100,
        radius: 4
      });
    }

    // Habit completion line chart
    const habitCanvas = document.getElementById('chart-habits');
    if (habitCanvas && habits.length) {
      const colors = ['#10B981', '#7C3AED', '#22D3EE', '#F59E0B'];

      // Overall series
      const series = [{
        label:  'Overall',
        color:  '#10B981',
        values: Array.from({ length: days }, (_, i) => {
          const d = Utils.daysAgo(days - 1 - i);
          return habits.length
            ? Math.round(habits.filter(h => (h.checkins || []).includes(d)).length / habits.length * 100)
            : 0;
        })
      }];

      // Per-habit lines (up to 3 extras)
      habits.slice(0, 3).forEach((h, idx) => {
        series.push({
          label:  h.name,
          color:  colors[idx + 1] || '#6366F1',
          values: Array.from({ length: days }, (_, i) => {
            const d = Utils.daysAgo(days - 1 - i);
            return (h.checkins || []).includes(d) ? 100 : 0;
          })
        });
      });

      ChartEngine.drawLine(habitCanvas, series, { maxVal: 100, h: 100 });
    }
  },

  quickAddTask() {
    const inp = document.getElementById('quick-task-inp');
    const title = inp?.value.trim();
    if (!title) return;
    TasksEngine.create({ title, priority: 'medium' });
    inp.value = '';
    Toast.show('Task added ✓', 'success');
    // Optional: link it immediately
    const tasks = TasksEngine.getAll();
    const newTask = tasks[0];
    if (newTask && !this.linkedTaskId) {
      this.linkedTaskId = newTask.id;
      this.render('focus');
    }
  },

  showLinkTask() {
    const tasks = TasksEngine.getAll().filter(t => !t.completed);
    if (!tasks.length) { Toast.show('No active tasks to link', 'info'); return; }
    Modal.show('Link Task to Session', `
      <div style="font-size:13px;color:var(--text-3);margin-bottom:12px">Select the task you're working on right now:</div>
      <div style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
        ${tasks.slice(0, 15).map(t => `
          <button onclick="App.setLinkedTask('${t.id}')" style="text-align:left;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;color:var(--text);font-size:13px;display:flex;align-items:center;gap:8px">
            <span class="priority-${t.priority || 'medium'}" style="height:20px;border-radius:2px;width:3px;display:inline-block;flex-shrink:0"></span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escHtml(t.title)}</span>
          </button>`).join('')}
      </div>
    `, { showCancel: true, cancelText: 'Cancel' });
  },

  setLinkedTask(id) {
    this.linkedTaskId = id;
    Modal.hide();
    Toast.show('Task linked 🔗', 'success');
    this.render('focus');
  },

  clearLinkedTask() {
    this.linkedTaskId = null;
    this.render('focus');
  },

  applyPreset(focus, short, long, cycles, label) {
    FocusEngine.reset();
    Settings.set('focusDuration', focus);
    Settings.set('shortBreak', short);
    Settings.set('longBreak', long);
    Settings.set('cycles', cycles);
    Toast.show(`${label} preset applied`, 'success');
    this.render('focus');
  },

  toggleSound(id, type) {
    const vol = Settings.get('volume') / 100;
    AudioEngine.play(id, type, vol * 0.7);
    document.querySelectorAll('[id^="snd-"]').forEach(b => b.classList.remove('active'));
    const activeId = AudioEngine.activeSound;
    document.getElementById(activeId ? `snd-${activeId}` : 'snd-off')?.classList.add('active');
  },

  stopAllSounds() {
    AudioEngine.stopAll();
    document.querySelectorAll('[id^="snd-"],[id^="ovl-"]').forEach(b => b.classList.remove('active'));
    document.getElementById('snd-off')?.classList.add('active');
    document.getElementById('ovl-off')?.classList.add('active');
  },

  toggleOverlay(id, type) {
    AudioEngine.ensureCtx();
    const vol = Settings.get('volume') / 100;
    AudioEngine.playOverlay(id, type, vol * 0.3);
    document.querySelectorAll('[id^="ovl-"]').forEach(b => b.classList.remove('active'));
    const activeOvl = AudioEngine.activeOverlay;
    document.getElementById(activeOvl ? `ovl-${activeOvl}` : 'ovl-off')?.classList.add('active');
  },

  stopOverlay() {
    if (AudioEngine.activeOverlay) {
      AudioEngine._stopNode(AudioEngine.activeOverlay);
      AudioEngine.activeOverlay = null;
    }
    document.querySelectorAll('[id^="ovl-"]').forEach(b => b.classList.remove('active'));
    document.getElementById('ovl-off')?.classList.add('active');
  },

  showFocusSettings() {
    const s = Settings.getAll();
    Modal.show('Focus Settings', `
      <div class="form-field">
        <label class="form-label">Focus Duration (min)</label>
        <input type="number" class="form-input" id="set-focus" value="${s.focusDuration}" min="1" max="180">
      </div>
      <div class="form-field">
        <label class="form-label">Short Break (min)</label>
        <input type="number" class="form-input" id="set-short" value="${s.shortBreak}" min="1" max="60">
      </div>
      <div class="form-field">
        <label class="form-label">Long Break (min)</label>
        <input type="number" class="form-input" id="set-long" value="${s.longBreak}" min="1" max="120">
      </div>
      <div class="form-field">
        <label class="form-label">Cycles Before Long Break</label>
        <input type="number" class="form-input" id="set-cycles" value="${s.cycles}" min="1" max="10">
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">
        <span style="font-size:14px;color:var(--text)">Auto-start next session</span>
        <div class="toggle-switch ${s.autoStart ? 'on' : ''}" id="set-auto" onclick="this.classList.toggle('on')"></div>
      </div>
    `, {
      confirmText: 'Save',
      onConfirm: () => {
        Settings.set('focusDuration', parseInt(document.getElementById('set-focus').value) || 25);
        Settings.set('shortBreak',    parseInt(document.getElementById('set-short').value) || 5);
        Settings.set('longBreak',     parseInt(document.getElementById('set-long').value) || 15);
        Settings.set('cycles',        parseInt(document.getElementById('set-cycles').value) || 4);
        Settings.set('autoStart',     document.getElementById('set-auto').classList.contains('on'));
        FocusEngine.reset();
        Toast.show('Settings saved', 'success');
        this.render('focus');
      }
    });
  },

  /* ——— TASKS SCREEN ——— */
  renderTasks() {
    const tasks = TasksEngine.getAll();
    const filtered = TasksEngine.filter(tasks, this.taskFilter);
    const total = tasks.filter(t => !t.completed).length;
    const done  = tasks.filter(t => t.completed).length;

    return `
    <div id="tasks-screen">
      <div class="screen-header">
        <div>
          <div class="screen-title">Task Center</div>
          <div class="screen-subtitle">${total} ACTIVE · ${done} DONE</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <div class="view-toggle">
            <button class="view-btn ${this.taskView === 'list' ? 'active' : ''}" onclick="App.setTaskView('list')" title="List">≡</button>
            <button class="view-btn ${this.taskView === 'matrix' ? 'active' : ''}" onclick="App.setTaskView('matrix')" title="Matrix">⊞</button>
          </div>
          <button class="header-btn" onclick="App.showCreateTask()">+</button>
        </div>
      </div>

      <div class="task-filters">
        ${[
          {v:'active',l:'Active'},
          {v:'all',l:'All'},
          {v:'done',l:'Done'}
        ].map(f => `
          <button class="filter-chip ${this.taskFilter.status === f.v ? 'active' : ''}"
            onclick="App.setTaskFilter('status','${f.v}')">${f.l}</button>`).join('')}
        ${['urgent','high','medium','low'].map(p => `
          <button class="filter-chip ${this.taskFilter.priority === p ? 'active' : ''}"
            onclick="App.setTaskFilter('priority','${p}')">${p.charAt(0).toUpperCase()+p.slice(1)}</button>`).join('')}
        <button class="filter-chip ${this.taskFilter.priority === 'all' && this.taskFilter.status === 'active' ? '' : 'active'}"
          onclick="App.clearTaskFilters()" style="opacity:0.6">Clear</button>
      </div>

      <div class="search-bar">
        <span class="search-icon">⌕</span>
        <input type="text" class="form-input" placeholder="Search tasks..." value="${this.taskFilter.search}"
          oninput="App.setTaskFilter('search',this.value)" style="padding-left:32px">
      </div>

      ${this.taskView === 'list'
        ? this.renderTaskList(filtered)
        : this.renderEisenhower(tasks.filter(t => !t.completed))}
    </div>`;
  },

  renderTaskList(tasks) {
    if (!tasks.length) {
      return `<div class="empty-state">
        <div class="empty-icon">✓</div>
        <div class="empty-title">All clear!</div>
        <div class="empty-desc">Add tasks with the + button above.</div>
      </div>`;
    }
    return `<div class="task-list">
      ${tasks.map(t => this.renderTaskItem(t)).join('')}
    </div>`;
  },

  renderTaskItem(t) {
    const subsDone = (t.subtasks || []).filter(s => s.done).length;
    const subsTotal = (t.subtasks || []).length;
    const overdue = !t.completed && Utils.isOverdue(t.dueDate);
    return `
    <div class="task-item priority-${t.priority || 'medium'} ${t.completed ? 'completed' : ''}" id="task-${t.id}">
      <div class="priority-${t.priority || 'medium'}"></div>
      <button class="task-check" onclick="App.toggleTask('${t.id}')">✓</button>
      <div class="task-body">
        <div class="task-title">${this.escHtml(t.title)}</div>
        ${t.notes ? `<div class="task-notes-text">${this.escHtml(t.notes.length > 80 ? t.notes.slice(0, 80) + '…' : t.notes)}</div>` : ''}
        <div class="task-meta">
          ${(t.tags || []).map(tag => `<span class="task-tag">${this.escHtml(tag)}</span>`).join('')}
          ${t.dueDate ? `<span class="task-due ${overdue ? 'overdue' : ''}">${overdue ? '⚠ ' : ''}${Utils.formatDate(t.dueDate)}</span>` : ''}
          ${subsTotal ? `<span class="subtask-progress">${subsDone}/${subsTotal}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <div class="task-action-row">
          <button class="icon-btn" onclick="App.showTaskDetail('${t.id}')">⋯</button>
          <button class="icon-btn danger" onclick="App.deleteTask('${t.id}')">✕</button>
        </div>
      </div>
    </div>`;
  },

  renderEisenhower(tasks) {
    const quadrants = {
      q1: { label: 'Do First', sub: 'Urgent + Important', tasks: [] },
      q2: { label: 'Schedule', sub: 'Important, Not Urgent', tasks: [] },
      q3: { label: 'Delegate', sub: 'Urgent, Not Important', tasks: [] },
      q4: { label: 'Eliminate', sub: 'Neither', tasks: [] }
    };
    tasks.forEach(t => {
      const q = TasksEngine.getQuadrant(t);
      if (quadrants[q]) quadrants[q].tasks.push(t);
    });
    return `<div class="eisenhower-grid">
      ${Object.entries(quadrants).map(([q, data]) => `
        <div class="quadrant ${q}">
          <div class="quadrant-title">${data.label}<br><span style="font-size:9px;opacity:0.7;font-weight:400">${data.sub}</span></div>
          ${data.tasks.length
            ? data.tasks.slice(0, 5).map(t => `
                <div class="q-task-item ${t.completed ? 'completed' : ''}" style="display:flex;align-items:flex-start;gap:4px;cursor:pointer">
                  <span style="flex:1;font-size:11px" onclick="App.showTaskDetail('${t.id}')">${this.escHtml(t.title)}</span>
                  <button onclick="App.showMoveQuadrant('${t.id}')" style="font-size:10px;color:var(--text-3);flex-shrink:0;padding:0 2px" title="Move">⇄</button>
                </div>`).join('')
            : '<div class="q-empty">No tasks</div>'}
          ${data.tasks.length > 5 ? `<div class="q-empty">+${data.tasks.length - 5} more</div>` : ''}
        </div>`).join('')}
    </div>`;
  },

  showMoveQuadrant(taskId) {
    const task = TasksEngine.getAll().find(t => t.id === taskId);
    if (!task) return;
    const labels = { q1: '🔴 Do First', q2: '🟠 Schedule', q3: '🟣 Delegate', q4: '⚪ Eliminate' };
    const current = TasksEngine.getQuadrant(task);
    Modal.show('Move to Quadrant', `
      <p style="font-size:13px;color:var(--text-2);margin-bottom:12px">${this.escHtml(task.title)}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${Object.entries(labels).map(([q, label]) => `
          <button class="btn-sm ${current === q ? 'btn-primary' : ''}"
            style="padding:10px;text-align:left"
            onclick="App.moveToQuadrant('${taskId}','${q}')">
            ${label}
          </button>`).join('')}
      </div>
    `, { showCancel: true, cancelText: 'Cancel' });
  },

  moveToQuadrant(taskId, quadrant) {
    TasksEngine.update(taskId, { quadrant });
    Modal.hide();
    Toast.show('Task moved ✓', 'success');
    this.render('tasks');
  },

  initTasks() {},

  setTaskView(v) { this.taskView = v; this.render('tasks'); },
  setTaskFilter(key, val) { this.taskFilter[key] = val; this.render('tasks'); },
  clearTaskFilters() { this.taskFilter = { status: 'active', priority: 'all', search: '' }; this.render('tasks'); },

  toggleTask(id) {
    TasksEngine.toggle(id);
    const task = TasksEngine.getAll().find(t => t.id === id);
    if (task?.completed) Toast.show('Task completed! ✓', 'success');
    this.render('tasks');
  },

  deleteTask(id) {
    TasksEngine.delete(id);
    Toast.show('Task deleted', 'info');
    this.render('tasks');
  },

  showCreateTask() {
    Modal.show('New Task', `
      <div class="form-field">
        <label class="form-label">Title</label>
        <input type="text" class="form-input" id="t-title" placeholder="What needs to be done?">
      </div>
      <div class="form-field">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="t-notes" rows="2" placeholder="Additional context..." style="min-height:60px"></textarea>
      </div>
      <div class="form-field">
        <label class="form-label">Priority</label>
        <select class="form-select" id="t-priority">
          <option value="urgent">🔴 Urgent</option>
          <option value="high">🟠 High</option>
          <option value="medium" selected>🟣 Medium</option>
          <option value="low">⚪ Low</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Eisenhower Quadrant</label>
        <select class="form-select" id="t-quadrant">
          <option value="q1">🔴 Urgent & Important — Do First</option>
          <option value="q2">🟠 Important, Not Urgent — Schedule</option>
          <option value="q3" selected>🟣 Urgent, Not Important — Delegate</option>
          <option value="q4">⚪ Neither — Eliminate</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Due Date</label>
        <input type="date" class="form-input" id="t-due">
      </div>
      <div class="form-field">
        <label class="form-label">Tags (comma separated)</label>
        <input type="text" class="form-input" id="t-tags" placeholder="work, personal, health">
      </div>
    `, {
      confirmText: 'Add Task',
      onConfirm: () => {
        const title = document.getElementById('t-title').value.trim();
        if (!title) { Toast.show('Title is required', 'error'); return; }
        TasksEngine.create({
          title,
          notes:     document.getElementById('t-notes').value.trim(),
          priority:  document.getElementById('t-priority').value,
          quadrant:  document.getElementById('t-quadrant').value,
          dueDate:   document.getElementById('t-due').value || null,
          tags:      document.getElementById('t-tags').value.split(',').map(s => s.trim()).filter(Boolean)
        });
        Toast.show('Task added ✓', 'success');
        this.render('tasks');
      }
    });
  },

  showTaskDetail(id) {
    const task = TasksEngine.getAll().find(t => t.id === id);
    if (!task) return;
    const subs = task.subtasks || [];
    Modal.show(task.title, `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span class="badge badge-${task.priority}">${task.priority}</span>
        ${task.dueDate ? `<span style="font-size:12px;color:var(--text-3);font-family:var(--font-mono)">${Utils.formatDate(task.dueDate)}</span>` : ''}
        ${(task.tags || []).map(tag => `<span class="task-tag">${this.escHtml(tag)}</span>`).join('')}
      </div>
      <div style="font-size:13px;color:var(--text-3);margin-bottom:12px">Subtasks</div>
      <div class="subtask-list" id="subtask-list">
        ${subs.map(s => `
          <div class="subtask-item ${s.done ? 'done' : ''}" id="sub-${s.id}">
            <div class="subtask-cb" onclick="App.toggleSub('${id}','${s.id}')">✓</div>
            <span class="subtask-text">${this.escHtml(s.text)}</span>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <input type="text" class="form-input" id="new-sub" placeholder="Add subtask..." style="flex:1">
        <button class="btn-sm btn-primary" onclick="App.addSubTask('${id}')">+</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:16px">
        <button class="btn-sm" onclick="App.showEditTask('${id}');Modal.hide()">Edit</button>
        <button class="btn-sm" style="color:var(--rose)" onclick="App.deleteTask('${id}');Modal.hide()">Delete</button>
      </div>
    `, { showCancel: false, confirmText: 'Close', onConfirm: () => {} });
  },

  addSubTask(taskId) {
    const inp = document.getElementById('new-sub');
    const text = inp?.value.trim();
    if (!text) return;
    TasksEngine.addSubtask(taskId, text);
    inp.value = '';
    // Refresh subtask list in modal
    const task = TasksEngine.getAll().find(t => t.id === taskId);
    const subs = task?.subtasks || [];
    const list = document.getElementById('subtask-list');
    if (list) list.innerHTML = subs.map(s => `
      <div class="subtask-item ${s.done ? 'done' : ''}" id="sub-${s.id}">
        <div class="subtask-cb" onclick="App.toggleSub('${taskId}','${s.id}')">✓</div>
        <span class="subtask-text">${this.escHtml(s.text)}</span>
      </div>`).join('');
  },

  toggleSub(taskId, subId) {
    TasksEngine.toggleSubtask(taskId, subId);
    const item = document.getElementById(`sub-${subId}`);
    if (item) item.classList.toggle('done');
  },

  showEditTask(id) {
    const task = TasksEngine.getAll().find(t => t.id === id);
    if (!task) return;
    Modal.show('Edit Task', `
      <div class="form-field">
        <label class="form-label">Title</label>
        <input type="text" class="form-input" id="t-title" value="${this.escHtml(task.title)}">
      </div>
      <div class="form-field">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="t-notes" rows="2" style="min-height:60px">${this.escHtml(task.notes || '')}</textarea>
      </div>
      <div class="form-field">
        <label class="form-label">Priority</label>
        <select class="form-select" id="t-priority">
          ${['urgent','high','medium','low'].map(p => `
            <option value="${p}" ${task.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Due Date</label>
        <input type="date" class="form-input" id="t-due" value="${task.dueDate || ''}">
      </div>
      <div class="form-field">
        <label class="form-label">Tags</label>
        <input type="text" class="form-input" id="t-tags" value="${(task.tags || []).join(', ')}">
      </div>
    `, {
      confirmText: 'Update',
      onConfirm: () => {
        const title = document.getElementById('t-title').value.trim();
        if (!title) return;
        TasksEngine.update(id, {
          title,
          notes:    document.getElementById('t-notes').value.trim(),
          priority: document.getElementById('t-priority').value,
          dueDate:  document.getElementById('t-due').value || null,
          tags:     document.getElementById('t-tags').value.split(',').map(s => s.trim()).filter(Boolean)
        });
        Toast.show('Task updated', 'success');
        this.render('tasks');
      }
    });
  },

  /* ——— HABITS SCREEN ——— */
  renderHabits() {
    const habits = HabitEngine.getAll();
    return `
    <div id="habits-screen">
      <div class="screen-header">
        <div>
          <div class="screen-title">Habits</div>
          <div class="screen-subtitle">${habits.length} TRACKED · ${habits.filter(h => HabitEngine.isCheckedIn(h)).length} DONE TODAY</div>
        </div>
        <button class="header-btn" onclick="App.showCreateHabit()">+</button>
      </div>

      ${habits.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">🔥</div>
          <div class="empty-title">No habits yet</div>
          <div class="empty-desc">Build consistent routines that compound over time.</div>
        </div>` : ''}

      ${habits.length > 0 ? `
      <div class="card" style="margin:8px 16px">
        <div class="card-title">This Week's Summary</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center">
          <div>
            <div style="font-size:22px;font-weight:700;font-family:var(--font-mono);color:var(--cyan)">${habits.filter(h => HabitEngine.isCheckedIn(h)).length}/${habits.length}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px">Done Today</div>
          </div>
          <div>
            <div style="font-size:22px;font-weight:700;font-family:var(--font-mono);color:var(--amber)">${Math.max(...habits.map(h => HabitEngine.getStreak(h)), 0)}d</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px">Best Streak</div>
          </div>
          <div>
            <div style="font-size:22px;font-weight:700;font-family:var(--font-mono);color:var(--green)">${habits.length ? Math.round(habits.reduce((s,h) => s + HabitEngine.getCompletionRate(h, 7), 0) / habits.length) : 0}%</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px">7d Rate</div>
          </div>
        </div>
        <div style="margin-top:12px">
          ${habits.map(h => {
            const rate7 = HabitEngine.getCompletionRate(h, 7);
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:var(--text-2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escHtml(h.name)}</span>
              <div class="progress-bar" style="width:80px"><div class="progress-fill" style="width:${rate7}%"></div></div>
              <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-3);min-width:30px;text-align:right">${rate7}%</span>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${habits.map(h => this.renderHabitItem(h)).join('')}

      ${habits.length > 0 ? `
      <div class="habit-heatmap-wrap">
        <div class="heatmap-title">All Habits — Last 12 Weeks</div>
        ${this.renderCombinedHeatmap(habits)}
      </div>` : ''}
    </div>`;
  },

  renderHabitItem(h) {
    const done = HabitEngine.isCheckedIn(h);
    const streak = HabitEngine.getStreak(h);
    const best = HabitEngine.getBestStreak(h);
    const rate = HabitEngine.getCompletionRate(h, 30);
    const freq = h.frequency || 'daily';
    const freqLabels = { daily: 'Daily', weekday: 'Weekdays', weekend: 'Weekends' };
    const scheduled = HabitEngine.isScheduledToday(h);
    return `
    <div class="habit-item ${done ? 'done' : ''} ${!scheduled ? 'not-scheduled' : ''}" id="habit-${h.id}"
      style="${!scheduled ? 'opacity:0.5' : ''}">
      <div class="habit-emoji">${h.emoji || '💪'}</div>
      <button class="habit-check-btn" onclick="App.toggleHabit('${h.id}')" ${!scheduled ? 'disabled' : ''}>✓</button>
      <div class="habit-info">
        <div class="habit-name" style="display:flex;align-items:center;gap:6px">
          ${this.escHtml(h.name)}
          ${freq !== 'daily' ? `<span class="freq-badge ${freq}">${freqLabels[freq] || freq}</span>` : ''}
        </div>
        <div class="habit-stats">
          <span class="habit-stat habit-streak">🔥 ${streak}d</span>
          <span class="habit-stat">Best ${best}d</span>
          <span class="habit-stat">${rate}% (30d)</span>
        </div>
      </div>
      <div class="habit-actions">
        <button class="icon-btn danger" onclick="App.deleteHabit('${h.id}')">✕</button>
      </div>
    </div>
    <div class="habit-heatmap-wrap" style="padding:0 16px 8px">
      <div class="heatmap-grid">
        ${HabitEngine.getHeatmapData(h, 12).map(cell => `
          <div class="heatmap-cell ${cell.done ? 'done-full' : ''}" title="${cell.date}"></div>`).join('')}
      </div>
    </div>`;
  },

  renderCombinedHeatmap(habits) {
    const days = 84; // 12 weeks
    const data = Array.from({ length: days }, (_, i) => {
      const date = Utils.daysAgo(days - 1 - i);
      const done = habits.filter(h => (h.checkins || []).includes(date)).length;
      const pct = habits.length ? done / habits.length : 0;
      return { date, pct };
    });
    return `<div class="heatmap-grid">
      ${data.map(d => {
        const cls = d.pct === 0 ? '' : d.pct < 0.5 ? 'done-1' : 'done-full';
        return `<div class="heatmap-cell ${cls}" title="${d.date}: ${Math.round(d.pct*100)}%"></div>`;
      }).join('')}
    </div>`;
  },

  toggleHabit(id) {
    const habits = HabitEngine.getAll();
    const h = habits.find(x => x.id === id);
    if (!h) return;
    if (HabitEngine.isCheckedIn(h)) {
      HabitEngine.uncheckIn(id);
      Toast.show('Unchecked', 'info');
    } else {
      HabitEngine.checkIn(id);
      const streak = HabitEngine.getStreak({ ...h, checkins: [...(h.checkins || []), Utils.today()] });
      Toast.show(streak > 1 ? `🔥 ${streak} day streak!` : 'Habit checked in ✓', 'success');
    }
    this.render('habits');
  },

  deleteHabit(id) {
    HabitEngine.delete(id);
    Toast.show('Habit removed', 'info');
    this.render('habits');
  },

  showCreateHabit() {
    const emojis = HabitEngine.EMOJI_LIST;
    Modal.show('New Habit', `
      <div class="form-field">
        <label class="form-label">Habit Name</label>
        <input type="text" class="form-input" id="h-name" placeholder="e.g. Morning meditation">
      </div>
      <div class="form-field">
        <label class="form-label">Icon</label>
        <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">
          <span id="h-emoji-preview" style="font-size:28px">💪</span>
          <span style="font-size:12px;color:var(--text-3)">Selected</span>
        </div>
        <div class="emoji-picker-grid">
          ${emojis.map((e, i) => `
            <div class="emoji-opt ${i === 0 ? 'selected' : ''}" data-emoji="${e}"
              onclick="document.querySelectorAll('.emoji-opt').forEach(x=>x.classList.remove('selected'));this.classList.add('selected');document.getElementById('h-emoji-preview').textContent=this.dataset.emoji">${e}</div>`).join('')}
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Frequency</label>
        <select class="form-select" id="h-freq">
          <option value="daily">📅 Every Day</option>
          <option value="weekday">🏢 Weekdays Only (Mon–Fri)</option>
          <option value="weekend">🏖 Weekends Only (Sat–Sun)</option>
        </select>
      </div>
    `, {
      confirmText: 'Create Habit',
      onConfirm: () => {
        const name = document.getElementById('h-name').value.trim();
        if (!name) { Toast.show('Name required', 'error'); return; }
        const selectedEmoji = document.querySelector('.emoji-opt.selected')?.dataset.emoji || '💪';
        HabitEngine.create({ name, emoji: selectedEmoji, frequency: document.getElementById('h-freq').value });
        Toast.show('Habit created 🌱', 'success');
        this.render('habits');
      }
    });
  },

  /* ——— GOALS SCREEN ——— */
  renderGoals() {
    const goals = GoalsEngine.getAll();
    return `
    <div id="goals-screen">
      <div class="screen-header">
        <div>
          <div class="screen-title">Goals</div>
          <div class="screen-subtitle">${goals.length} GOALS · ${goals.filter(g => GoalsEngine.getProgress(g) === 100).length} COMPLETE</div>
        </div>
        <button class="header-btn" onclick="App.showCreateGoal()">+</button>
      </div>

      ${goals.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">🎯</div>
          <div class="empty-title">No goals yet</div>
          <div class="empty-desc">Define what matters most. Break it into milestones.</div>
        </div>` : ''}

      ${goals.map(g => this.renderGoalItem(g)).join('')}
    </div>`;
  },

  renderGoalItem(g) {
    const progress = GoalsEngine.getProgress(g);
    const daysLeft = Utils.daysUntil(g.deadline);
    const ms = g.milestones || [];
    const cat = g.category ? GoalsEngine.CATEGORIES[g.category] : null;
    const hasManual = typeof g.manualProgress === 'number';
    return `
    <div class="goal-item" id="goal-${g.id}">
      <div class="goal-header">
        <div style="flex:1;min-width:0">
          ${cat ? `<span class="goal-category-badge ${cat.cls}">${cat.icon} ${cat.label}</span>` : ''}
          <div class="goal-title" style="margin-top:${cat ? '4px' : '0'}">${this.escHtml(g.title)}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0">
          <button class="icon-btn" onclick="App.showEditGoal('${g.id}')">✎</button>
          <button class="icon-btn" onclick="App.showAddMilestone('${g.id}')">+</button>
          <button class="icon-btn danger" onclick="App.deleteGoal('${g.id}')">✕</button>
        </div>
      </div>
      ${g.description ? `<div class="goal-desc">${this.escHtml(g.description)}</div>` : ''}
      <div class="goal-progress-wrap">
        <div class="progress-row">
          <span class="progress-label">${hasManual ? '✋ Manual' : '🎯 Milestone'} Progress</span>
          <span class="progress-pct">${progress}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <input type="range" min="0" max="100" value="${g.manualProgress ?? ''}" placeholder="${progress}"
            style="flex:1;height:4px"
            oninput="App.setGoalProgress('${g.id}',+this.value)"
            title="Drag to set manual progress">
          <span style="font-size:10px;color:var(--text-3);font-family:var(--font-mono);flex-shrink:0">override</span>
          ${hasManual ? `<button onclick="App.clearGoalProgress('${g.id}')" style="font-size:10px;color:var(--text-3)">✕</button>` : ''}
        </div>
      </div>
      ${g.deadline ? `
        <div class="goal-countdown ${daysLeft !== null && daysLeft < 7 ? 'urgent' : ''}">
          ${daysLeft === null ? '' : daysLeft > 0 ? `⏳ ${daysLeft} days left` : daysLeft === 0 ? '⚠ Due today' : `⚠ Overdue by ${Math.abs(daysLeft)} days`}
        </div>` : ''}
      ${ms.length ? `
        <div class="milestones">
          ${ms.map(m => `
            <div class="milestone-item ${m.done ? 'done' : ''}" onclick="App.toggleMilestone('${g.id}','${m.id}')">
              <div class="milestone-cb">✓</div>
              <span class="milestone-text">${this.escHtml(m.text)}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
  },

  setGoalProgress(id, val) {
    GoalsEngine.update(id, { manualProgress: val });
    // Update the progress display live without full re-render
    const item = document.getElementById(`goal-${id}`);
    if (item) {
      const fill = item.querySelector('.progress-fill');
      const pct  = item.querySelector('.progress-pct');
      if (fill) fill.style.width = val + '%';
      if (pct)  pct.textContent = val + '%';
    }
  },

  clearGoalProgress(id) {
    GoalsEngine.update(id, { manualProgress: undefined });
    this.render('goals');
  },

  showCreateGoal() {
    const cats = GoalsEngine.CATEGORIES;
    Modal.show('New Goal', `
      <div class="form-field">
        <label class="form-label">Goal Title</label>
        <input type="text" class="form-input" id="g-title" placeholder="What do you want to achieve?">
      </div>
      <div class="form-field">
        <label class="form-label">Category</label>
        <select class="form-select" id="g-cat">
          <option value="">No category</option>
          ${Object.entries(cats).map(([k,v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea class="form-input" id="g-desc" rows="2" placeholder="Why does this matter?"></textarea>
      </div>
      <div class="form-field">
        <label class="form-label">Target Date</label>
        <input type="date" class="form-input" id="g-deadline">
      </div>
    `, {
      confirmText: 'Create Goal',
      onConfirm: () => {
        const title = document.getElementById('g-title').value.trim();
        if (!title) { Toast.show('Title required', 'error'); return; }
        GoalsEngine.create({
          title,
          category: document.getElementById('g-cat').value || null,
          description: document.getElementById('g-desc').value.trim(),
          deadline: document.getElementById('g-deadline').value || null
        });
        Toast.show('Goal created 🎯', 'success');
        this.render('goals');
      }
    });
  },

  showEditGoal(id) {
    const g = GoalsEngine.getAll().find(x => x.id === id);
    if (!g) return;
    const cats = GoalsEngine.CATEGORIES;
    Modal.show('Edit Goal', `
      <div class="form-field">
        <label class="form-label">Goal Title</label>
        <input type="text" class="form-input" id="g-title" value="${this.escHtml(g.title)}">
      </div>
      <div class="form-field">
        <label class="form-label">Category</label>
        <select class="form-select" id="g-cat">
          <option value="">No category</option>
          ${Object.entries(cats).map(([k,v]) => `<option value="${k}" ${g.category === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea class="form-input" id="g-desc" rows="2">${this.escHtml(g.description || '')}</textarea>
      </div>
      <div class="form-field">
        <label class="form-label">Target Date</label>
        <input type="date" class="form-input" id="g-deadline" value="${g.deadline || ''}">
      </div>
    `, {
      confirmText: 'Update Goal',
      onConfirm: () => {
        const title = document.getElementById('g-title').value.trim();
        if (!title) { Toast.show('Title required', 'error'); return; }
        GoalsEngine.update(id, {
          title,
          category: document.getElementById('g-cat').value || null,
          description: document.getElementById('g-desc').value.trim(),
          deadline: document.getElementById('g-deadline').value || null
        });
        Toast.show('Goal updated ✓', 'success');
        this.render('goals');
      }
    });
  },

  showAddMilestone(goalId) {
    Modal.show('Add Milestone', `
      <div class="form-field">
        <label class="form-label">Milestone</label>
        <input type="text" class="form-input" id="m-text" placeholder="A concrete step...">
      </div>
    `, {
      confirmText: 'Add',
      onConfirm: () => {
        const text = document.getElementById('m-text').value.trim();
        if (!text) return;
        GoalsEngine.addMilestone(goalId, text);
        Toast.show('Milestone added ✓', 'success');
        this.render('goals');
      }
    });
  },

  toggleMilestone(goalId, mId) {
    GoalsEngine.toggleMilestone(goalId, mId);
    const goal = GoalsEngine.getAll().find(g => g.id === goalId);
    const pct = GoalsEngine.getProgress(goal);
    if (pct === 100) Toast.show('Goal complete! 🎉', 'success');
    this.render('goals');
  },

  deleteGoal(id) {
    GoalsEngine.delete(id);
    Toast.show('Goal removed', 'info');
    this.render('goals');
  },


  /* ——— SETTINGS SCREEN ——— */
  renderSettings() {
    const s = Settings.getAll();
    const notifSupported = 'Notification' in window;
    const notifGranted   = notifSupported && Notification.permission === 'granted';
    return `
    <div id="settings-screen">
      <div class="screen-header">
        <div>
          <div class="screen-title">Settings</div>
          <div class="screen-subtitle">CONFIGURE YOUR SANCTUARY</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Focus Timer</div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Focus Duration</div>
            <div class="setting-desc">Length of each work session</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <input type="number" class="number-input" value="${s.focusDuration}" min="1" max="180"
              onchange="Settings.set('focusDuration',+this.value)">
            <span style="font-size:12px;color:var(--text-3)">min</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Short Break</div>
            <div class="setting-desc">Break between focus sessions</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <input type="number" class="number-input" value="${s.shortBreak}" min="1" max="60"
              onchange="Settings.set('shortBreak',+this.value)">
            <span style="font-size:12px;color:var(--text-3)">min</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Long Break</div>
            <div class="setting-desc">After completing all cycles</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <input type="number" class="number-input" value="${s.longBreak}" min="1" max="120"
              onchange="Settings.set('longBreak',+this.value)">
            <span style="font-size:12px;color:var(--text-3)">min</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Cycles per Long Break</div>
            <div class="setting-desc">Focus sessions before long break</div>
          </div>
          <input type="number" class="number-input" value="${s.cycles}" min="1" max="10"
            onchange="Settings.set('cycles',+this.value)">
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Behavior</div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Auto-start next session</div>
            <div class="setting-desc">Automatically begin after timer ends</div>
          </div>
          <div class="toggle-switch ${s.autoStart ? 'on' : ''}"
            onclick="this.classList.toggle('on');Settings.set('autoStart',this.classList.contains('on'))"></div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Completion chimes</div>
            <div class="setting-desc">Sound when session ends</div>
          </div>
          <div class="toggle-switch ${s.sounds ? 'on' : ''}"
            onclick="this.classList.toggle('on');Settings.set('sounds',this.classList.contains('on'))"></div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Push notifications</div>
            <div class="setting-desc">${notifGranted ? 'Enabled — alerts when session ends' : notifSupported ? 'Get alerted when sessions end' : 'Not supported in this browser'}</div>
          </div>
          <div class="toggle-switch ${s.notifications && notifGranted ? 'on' : ''}" id="notif-toggle"
            onclick="App.toggleNotifications(this)"></div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Data</div>
        <div class="setting-row" onclick="App.exportData()" style="cursor:pointer">
          <div class="setting-info">
            <div class="setting-label">Export Data</div>
            <div class="setting-desc">Download all your data as JSON</div>
          </div>
          <span style="color:var(--text-3);font-size:18px">↓</span>
        </div>
        <div class="setting-row" style="cursor:pointer" onclick="document.getElementById('import-file').click()">
          <div class="setting-info">
            <div class="setting-label">Import Data</div>
            <div class="setting-desc">Restore from a previous export</div>
          </div>
          <span style="color:var(--text-3);font-size:18px">↑</span>
          <input type="file" id="import-file" accept=".json" style="display:none"
            onchange="App.importData(this)">
        </div>
        <div class="setting-row" onclick="App.clearData()" style="cursor:pointer">
          <div class="setting-info">
            <div class="setting-label" style="color:var(--rose)">Clear All Data</div>
            <div class="setting-desc">Permanently delete all your data</div>
          </div>
          <span style="color:var(--rose);font-size:18px">✕</span>
        </div>
      </div>

      <div class="app-info-section">
        <div class="app-logo">DSV2</div>
        <div class="app-version">v2.0.0 · All data stored locally · Offline-first</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:8px">Built for deep work, designed for humans.</div>
      </div>
    </div>`;
  },

  importData(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.tasks)    DB.set('tasks',    data.tasks);
        if (data.habits)   DB.set('habits',   data.habits);
        if (data.goals)    DB.set('goals',    data.goals);
        if (data.sessions) DB.set('sessions', data.sessions);
        Toast.show('Data imported successfully ✓', 'success');
        this.render('settings');
      } catch {
        Toast.show('Invalid file format', 'error');
      }
    };
    reader.readAsText(file);
    input.value = '';
  },

  async toggleNotifications(el) {
    const isOn = el.classList.contains('on');
    if (isOn) {
      Settings.set('notifications', false);
      el.classList.remove('on');
      Toast.show('Notifications disabled', 'info');
    } else {
      const granted = await NotificationSystem.enable();
      if (granted) el.classList.add('on');
    }
  },

  exportData() {
    const data = {
      tasks:    DB.get('tasks', []),
      habits:   DB.get('habits', []),
      goals:    DB.get('goals', []),
      sessions: DB.get('sessions', []),
      settings: Settings.getAll(),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `digital-sanctuary-${Utils.today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('Data exported ✓', 'success');
  },

  clearData() {
    Modal.show('Clear All Data', `
      <p style="color:var(--text-2);font-size:14px;line-height:1.6">
        This will permanently delete all your sessions, tasks, habits, and goals. This cannot be undone.
      </p>
    `, {
      confirmText: 'Clear Everything',
      onConfirm: () => {
        ['tasks','habits','goals','sessions'].forEach(key => DB.set(key, null));
        FocusEngine.reset();
        Toast.show('All data cleared', 'info');
        this.render('settings');
      }
    });
  },

  renderOnboardingBanner() {
    if (Settings.get('onboarded')) return '';
    return `
    <div style="margin:12px 16px 0;background:linear-gradient(135deg,#1A0A30,#0A1A30);border:1px solid var(--violet-dim);border-radius:var(--r);padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:14px;font-weight:700;color:var(--text)">👋 Welcome to DSV2</div>
        <button onclick="Settings.set('onboarded',true);this.closest('[style]').remove()" style="font-size:18px;color:var(--text-3)">✕</button>
      </div>
      <div style="font-size:12px;color:var(--text-2);line-height:1.6">
        Start a <strong style="color:var(--violet)">Focus</strong> session, build <strong style="color:var(--amber)">Habits</strong>, set <strong style="color:var(--cyan)">Goals</strong>, and set long-term <strong style="color:var(--green)">Goals</strong>. All data stays on your device.
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <span style="font-size:11px;background:var(--border);padding:3px 8px;border-radius:20px;color:var(--text-3)">⏎ Space to start timer</span>
        <span style="font-size:11px;background:var(--border);padding:3px 8px;border-radius:20px;color:var(--text-3)">Esc to close modals</span>
      </div>
    </div>`;
  },

  /* ——— UTILITIES ——— */
  escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  init() {
    this.render('focus');
    // Resume audio context on any interaction
    document.addEventListener('touchstart', () => AudioEngine.ensureCtx(), { once: true });
    document.addEventListener('click',      () => AudioEngine.ensureCtx(), { once: true });
    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (this.currentScreen === 'focus') {
          FocusEngine.state.running ? FocusEngine.pause() : FocusEngine.start();
        }
      }
      if (e.code === 'Escape') Modal.hide();
      // Number keys 1-7 for nav
      const navMap = { '1':'focus','2':'tasks','3':'habits','4':'goals','5':'settings' };
      if (navMap[e.key] && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        this.navigate(navMap[e.key]);
      }
    });
    // Ambient particle canvas
    AmbientCanvas.init();

    // Show onboarding on first load (inject into focus screen after render)
    if (!Settings.get('onboarded')) {
      const banner = this.renderOnboardingBanner();
      if (banner) {
        const sc = document.getElementById('screen-content');
        if (sc) sc.insertAdjacentHTML('afterbegin', banner);
      }
    }
  }
};

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => App.init());
/* ============================================================
   SERVICE WORKER REGISTRATION
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW registration is optional — app works without it
    });
  });
}
