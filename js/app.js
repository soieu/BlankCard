// ============================================================
// Blank Card - Flashcard Deluxe Style Web App
// ============================================================

const BLANK_RE = /\{\{(.+?)\}\}/g;
const LEITNER_INTERVALS = [0, 0, 1, 3, 7, 14];

// ============================================================
// Supabase Setup
// ============================================================
const SUPABASE_URL = 'https://gbjmfovpttrhakzkusbg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdiam1mb3ZwdHRyaGFremt1c2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzE4ODIsImV4cCI6MjA5MTM0Nzg4Mn0.rU0Z4FF8UnoYBv-ixbmlb833d3neo1JN2md2VpDO9HU';

let db = null;
try {
  const _sb = window.supabase;
  if (_sb && _sb.createClient) {
    db = _sb.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (e) {
  console.warn('Supabase init failed, using localStorage only:', e);
}

// ============================================================
// Sync Code Management
// ============================================================
function generateSyncCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getSyncCode() {
  let code = localStorage.getItem('blankcard_sync_code');
  if (!code) {
    code = generateSyncCode();
    localStorage.setItem('blankcard_sync_code', code);
  }
  return code;
}

// ============================================================
// Data Layer (Supabase)
// ============================================================
const DEFAULT_DATA = { decks: [], stats: { dailyLog: {}, currentStreak: 0, longestStreak: 0, lastStudyDate: null } };

async function loadData() {
  const syncCode = getSyncCode();

  if (!db) {
    const local = localStorage.getItem('blankcard_local');
    if (local) return JSON.parse(local);
    return { ...DEFAULT_DATA };
  }

  try {
    const { data, error } = await db
      .from('blankcard_data')
      .select('data')
      .eq('sync_code', syncCode)
      .single();

    if (error && error.code === 'PGRST116') {
      const newData = { ...DEFAULT_DATA };
      await db.from('blankcard_data').insert({ sync_code: syncCode, data: newData });
      return newData;
    }
    if (error) throw error;

    const result = data.data;
    if (!result.stats) {
      result.stats = { ...DEFAULT_DATA.stats };
    }
    localStorage.setItem('blankcard_local', JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('Load error:', e);
    const local = localStorage.getItem('blankcard_local');
    if (local) return JSON.parse(local);
    return { ...DEFAULT_DATA };
  }
}

let _saveTimeout = null;
async function saveData(data) {
  localStorage.setItem('blankcard_local', JSON.stringify(data));

  if (!db) return;

  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(async () => {
    const syncCode = getSyncCode();
    try {
      await db
        .from('blankcard_data')
        .update({ data: data, updated_at: new Date().toISOString() })
        .eq('sync_code', syncCode);
    } catch (e) {
      console.error('Save error:', e);
    }
  }, 500);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getDueCards(deck) {
  const now = Date.now();
  return deck.cards.filter(c => !c.nextReview || c.nextReview <= now);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// App Controller
// ============================================================
const app = {
  data: { decks: [], stats: { dailyLog: {}, currentStreak: 0, longestStreak: 0, lastStudyDate: null } },
  currentDeckId: null,
  currentView: 'home',
  viewHistory: [],
  inputMode: 'blank',
  // Study state
  studyQueue: [],
  studyIndex: 0,
  studyCorrect: 0,
  studyWrong: 0,
  revealed: false,
  typingMode: false,
  studyHistory: [],
  // Edit state
  editingCardId: null,
  openMenuId: null,
  _importBuffer: [],

  // =========================================================
  // Navigation
  // =========================================================
  navigate(view, pushHistory = true) {
    if (pushHistory && this.currentView !== view) {
      this.viewHistory.push(this.currentView);
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    this.currentView = view;

    const backBtn = document.getElementById('btn-back');
    const title = document.getElementById('header-title');
    const actions = document.getElementById('header-actions');
    actions.innerHTML = '';

    if (view === 'home') {
      backBtn.classList.add('hidden');
      title.textContent = 'Blank Card';
    } else if (view === 'deck') {
      backBtn.classList.remove('hidden');
      const deck = this.getDeck();
      title.textContent = deck ? deck.name : '';
      actions.innerHTML = `
        <button class="header-btn" onclick="app.exportDeck()" title="내보내기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>`;
    } else if (view === 'add') {
      backBtn.classList.remove('hidden');
      title.textContent = '카드 추가';
    } else if (view === 'study') {
      backBtn.classList.remove('hidden');
      title.textContent = '학습';
      actions.innerHTML = `
        <button class="header-btn" id="btn-undo" onclick="app.undoLastAnswer()" title="되돌리기" style="opacity:0.3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>`;
    } else if (view === 'complete') {
      backBtn.classList.remove('hidden');
      title.textContent = '결과';
    } else if (view === 'stats') {
      backBtn.classList.remove('hidden');
      title.textContent = '학습 통계';
    }
  },

  goBack() {
    if (this.viewHistory.length > 0) {
      const prev = this.viewHistory.pop();
      this.navigate(prev, false);
      if (prev === 'home') this.renderDecks();
      if (prev === 'deck') this.renderDeckDetail();
    } else {
      this.navigate('home', false);
      this.renderDecks();
    }
  },

  getDeck(id) {
    const deckId = id || this.currentDeckId;
    return this.data.decks.find(d => d.id === deckId);
  },

  async save() {
    await saveData(this.data);
  },

  toast(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  },

  // =========================================================
  // Sync
  // =========================================================
  showSync() {
    document.getElementById('my-sync-code').textContent = getSyncCode();
    document.getElementById('sync-code-input').value = '';
    document.getElementById('modal-sync').classList.remove('hidden');
  },

  copySyncCode() {
    const code = getSyncCode();
    navigator.clipboard.writeText(code).then(() => {
      this.toast('동기화 코드가 복사되었습니다');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.toast('동기화 코드가 복사되었습니다');
    });
  },

  async applySyncCode() {
    const input = document.getElementById('sync-code-input');
    const code = input.value.trim().toUpperCase();
    if (!code || code.length < 4) {
      this.toast('올바른 동기화 코드를 입력해주세요');
      return;
    }

    if (!db) {
      this.toast('클라우드 연결이 필요합니다. 새로고침 후 다시 시도해주세요.');
      return;
    }

    try {
      const { data, error } = await db
        .from('blankcard_data')
        .select('data')
        .eq('sync_code', code)
        .single();

      if (error || !data) {
        this.toast('해당 코드의 데이터를 찾을 수 없습니다');
        return;
      }

      localStorage.setItem('blankcard_sync_code', code);
      this.data = data.data;
      if (!this.data.stats) {
        this.data.stats = { dailyLog: {}, currentStreak: 0, longestStreak: 0, lastStudyDate: null };
      }
      localStorage.setItem('blankcard_local', JSON.stringify(this.data));
      this.renderDecks();
      this.closeModal('modal-sync');
      this.toast('동기화 완료!');
    } catch (e) {
      this.toast('동기화 중 오류가 발생했습니다');
      console.error(e);
    }
  },

  // =========================================================
  // Dark Mode
  // =========================================================
  toggleDarkMode() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = isDark ? '' : 'dark';
    localStorage.setItem('darkMode', isDark ? 'false' : 'true');
    this.updateDarkModeIcon();
  },

  loadTheme() {
    const dark = localStorage.getItem('darkMode') === 'true';
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    this.updateDarkModeIcon();
  },

  updateDarkModeIcon() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    document.getElementById('icon-moon').classList.toggle('hidden', isDark);
    document.getElementById('icon-sun').classList.toggle('hidden', !isDark);
  },

  // =========================================================
  // Home / Deck List
  // =========================================================
  renderDecks() {
    const list = document.getElementById('deck-list');
    const empty = document.getElementById('empty-decks');

    if (this.data.decks.length === 0) {
      empty.classList.remove('hidden');
      list.innerHTML = '';
      return;
    }

    empty.classList.add('hidden');
    list.innerHTML = this.data.decks.map(deck => {
      const due = getDueCards(deck).length;
      const total = deck.cards.length;
      const badgeClass = due === 0 ? 'deck-badge zero' : 'deck-badge';
      return `
        <div class="deck-item" onclick="app.openDeck('${deck.id}')">
          <div class="deck-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h4"/>
            </svg>
          </div>
          <div class="deck-info">
            <div class="deck-name">${this.escapeHtml(deck.name)}</div>
            <div class="deck-meta"><span>${total}장</span></div>
          </div>
          <span class="${badgeClass}">${due}</span>
          <div class="deck-actions-menu" onclick="event.stopPropagation()">
            <button class="deck-menu-btn" onclick="app.toggleDeckMenu('${deck.id}', event)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/>
              </svg>
            </button>
            <div class="deck-menu hidden" id="menu-${deck.id}">
              <button onclick="app.renameDeck('${deck.id}')">이름 변경</button>
              <button onclick="app.resetDeck('${deck.id}')">학습 초기화</button>
              <button class="danger" onclick="app.deleteDeck('${deck.id}')">삭제</button>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  toggleDeckMenu(deckId, e) {
    e.stopPropagation();
    const menu = document.getElementById(`menu-${deckId}`);
    document.querySelectorAll('.deck-menu').forEach(m => {
      if (m.id !== `menu-${deckId}`) m.classList.add('hidden');
    });
    menu.classList.toggle('hidden');
  },

  showCreateDeck() {
    document.getElementById('modal-deck-title').textContent = '새 덱 만들기';
    document.getElementById('deck-name-input').value = '';
    document.getElementById('modal-deck').classList.remove('hidden');
    document.getElementById('deck-name-input').focus();
    this._deckEditId = null;
  },

  createDeck() {
    const input = document.getElementById('deck-name-input');
    const name = input.value.trim();
    if (!name) return;

    if (this._deckEditId) {
      const deck = this.getDeck(this._deckEditId);
      if (deck) {
        deck.name = name;
        this.save();
        this.renderDecks();
        this.toast('덱 이름이 변경되었습니다');
      }
    } else {
      this.data.decks.push({
        id: generateId(), name, cards: [], createdAt: Date.now()
      });
      this.save();
      this.renderDecks();
      this.toast('덱이 생성되었습니다');
    }
    this.closeModal('modal-deck');
  },

  renameDeck(deckId) {
    const deck = this.getDeck(deckId);
    if (!deck) return;
    document.getElementById('modal-deck-title').textContent = '덱 이름 변경';
    document.getElementById('deck-name-input').value = deck.name;
    document.getElementById('modal-deck').classList.remove('hidden');
    document.getElementById('deck-name-input').focus();
    this._deckEditId = deckId;
    this.closeDeckMenus();
  },

  resetDeck(deckId) {
    const deck = this.getDeck(deckId);
    if (!deck) return;
    if (!confirm('학습 진도를 초기화하시겠습니까?')) return;
    deck.cards.forEach(c => { c.box = 1; c.nextReview = null; c.lastReview = null; });
    this.save();
    this.renderDecks();
    this.toast('학습이 초기화되었습니다');
    this.closeDeckMenus();
  },

  deleteDeck(deckId) {
    if (!confirm('이 덱을 삭제하시겠습니까?')) return;
    this.data.decks = this.data.decks.filter(d => d.id !== deckId);
    this.save();
    this.renderDecks();
    this.toast('덱이 삭제되었습니다');
    this.closeDeckMenus();
  },

  closeDeckMenus() {
    document.querySelectorAll('.deck-menu').forEach(m => m.classList.add('hidden'));
  },

  closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  },

  // =========================================================
  // Deck Detail
  // =========================================================
  openDeck(deckId) {
    this.currentDeckId = deckId;
    this.renderDeckDetail();
    this.navigate('deck');
  },

  renderDeckDetail() {
    const deck = this.getDeck();
    if (!deck) return;

    const total = deck.cards.length;
    const due = getDueCards(deck).length;
    const mastered = deck.cards.filter(c => c.box >= 5).length;
    const starred = deck.cards.filter(c => c.starred).length;

    document.getElementById('deck-stats').innerHTML = `
      <div class="stat-item"><div class="stat-value">${total}</div><div class="stat-label">전체</div></div>
      <div class="stat-item"><div class="stat-value">${due}</div><div class="stat-label">대기</div></div>
      <div class="stat-item"><div class="stat-value">${starred}</div><div class="stat-label">별표</div></div>
      <div class="stat-item"><div class="stat-value">${mastered}</div><div class="stat-label">마스터</div></div>
    `;

    const btnStudy = document.getElementById('btn-study');
    if (total === 0) {
      btnStudy.textContent = '카드를 먼저 추가하세요';
      btnStudy.disabled = true;
    } else {
      btnStudy.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> 학습 시작`;
      btnStudy.disabled = false;
    }

    const container = document.getElementById('card-list-container');
    const emptyCards = document.getElementById('empty-cards');

    if (total === 0) {
      container.innerHTML = '';
      emptyCards.classList.remove('hidden');
    } else {
      emptyCards.classList.add('hidden');
      container.innerHTML = deck.cards.map(card => {
        const displayText = card.type === 'blank'
          ? card.text.replace(BLANK_RE, '<span class="blank-word">$1</span>')
          : `<strong>${this.escapeHtml(card.front)}</strong> → ${this.escapeHtml(card.back)}`;
        const boxLabel = `Box ${card.box || 1}`;
        const starClass = card.starred ? 'star-btn starred' : 'star-btn';
        const starFill = card.starred ? 'fill="#FFC107"' : 'fill="none"';
        return `
          <div class="card-item">
            <div class="card-item-content" onclick="app.editCard('${card.id}')">
              <div class="card-text">${displayText}</div>
              <div class="card-bottom">
                <span class="card-box-indicator">${boxLabel}</span>
              </div>
            </div>
            <button class="${starClass}" onclick="app.toggleStar('${card.id}', event)">
              <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" ${starFill}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
          </div>`;
      }).join('');
    }
  },

  // =========================================================
  // Star / Bookmark
  // =========================================================
  toggleStar(cardId, event) {
    event.stopPropagation();
    const deck = this.getDeck();
    const card = deck.cards.find(c => c.id === cardId);
    if (!card) return;
    card.starred = !card.starred;
    this.save();
    this.renderDeckDetail();
  },

  toggleStudyStar(event) {
    event.stopPropagation();
    if (this.studyIndex >= this.studyQueue.length) return;
    const card = this.studyQueue[this.studyIndex];
    const deck = this.getDeck();
    const realCard = deck.cards.find(c => c.id === card.id);
    if (!realCard) return;
    realCard.starred = !realCard.starred;
    card.starred = realCard.starred;
    this.save();
    this.updateStudyStarBtn();
  },

  updateStudyStarBtn() {
    if (this.studyIndex >= this.studyQueue.length) return;
    const card = this.studyQueue[this.studyIndex];
    const btn = document.getElementById('study-star-btn');
    btn.classList.toggle('starred', !!card.starred);
    const svg = btn.querySelector('svg');
    svg.setAttribute('fill', card.starred ? '#FFC107' : 'none');
  },

  // =========================================================
  // Add Cards
  // =========================================================
  showAddCards() {
    this.navigate('add');
    document.getElementById('blank-input').value = '';
    document.getElementById('blank-preview').innerHTML = '';
    document.getElementById('basic-front').value = '';
    document.getElementById('basic-back').value = '';
    document.getElementById('import-preview').innerHTML = '';
    document.getElementById('file-label-text').textContent = '파일 선택';
    document.getElementById('btn-import').disabled = true;
    this._importBuffer = [];
    this.setInputMode(this.inputMode);
  },

  setInputMode(mode) {
    this.inputMode = mode;
    document.querySelectorAll('.input-mode-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    document.getElementById('input-blank').classList.toggle('hidden', mode !== 'blank');
    document.getElementById('input-basic').classList.toggle('hidden', mode !== 'basic');
    document.getElementById('input-import').classList.toggle('hidden', mode !== 'import');
  },

  addBlankCards() {
    const deck = this.getDeck();
    if (!deck) return;
    const raw = document.getElementById('blank-input').value.trim();
    if (!raw) return this.toast('텍스트를 입력해주세요');

    const lines = raw.split('\n').filter(l => l.trim());
    let added = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      BLANK_RE.lastIndex = 0;
      if (!BLANK_RE.test(trimmed)) continue;
      BLANK_RE.lastIndex = 0;
      deck.cards.push({
        id: generateId(), type: 'blank', text: trimmed,
        box: 1, nextReview: null, lastReview: null, starred: false
      });
      added++;
    }
    if (added === 0) return this.toast('{{}}로 감싼 빈칸이 있는 줄이 없습니다');
    this.save();
    document.getElementById('blank-input').value = '';
    document.getElementById('blank-preview').innerHTML = '';
    this.toast(`${added}장의 카드가 추가되었습니다`);
    this.goBack();
    this.renderDeckDetail();
  },

  addBasicCard() {
    const deck = this.getDeck();
    if (!deck) return;
    const front = document.getElementById('basic-front').value.trim();
    const back = document.getElementById('basic-back').value.trim();
    if (!front || !back) return this.toast('앞면과 뒷면을 모두 입력해주세요');
    deck.cards.push({
      id: generateId(), type: 'basic', front, back,
      box: 1, nextReview: null, lastReview: null, starred: false
    });
    this.save();
    document.getElementById('basic-front').value = '';
    document.getElementById('basic-back').value = '';
    this.toast('카드가 추가되었습니다');
  },

  updateBlankPreview() {
    const raw = document.getElementById('blank-input').value;
    const preview = document.getElementById('blank-preview');
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length === 0) { preview.innerHTML = ''; return; }

    let validCount = 0;
    const items = lines.map(line => {
      const trimmed = line.trim();
      BLANK_RE.lastIndex = 0;
      if (!BLANK_RE.test(trimmed)) return null;
      BLANK_RE.lastIndex = 0;
      validCount++;
      const display = trimmed.replace(BLANK_RE, '<span class="blank-slot"></span>');
      return `<div class="preview-item">${display}</div>`;
    }).filter(Boolean);

    if (items.length === 0) { preview.innerHTML = ''; return; }
    preview.innerHTML = `<div class="preview-count">미리보기 (${validCount}장)</div>` + items.join('');
  },

  // =========================================================
  // File Import
  // =========================================================
  previewImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById('file-label-text').textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      this._importBuffer = [];

      for (const line of lines) {
        const trimmed = line.trim();
        BLANK_RE.lastIndex = 0;
        if (BLANK_RE.test(trimmed)) {
          BLANK_RE.lastIndex = 0;
          this._importBuffer.push({ type: 'blank', text: trimmed });
        } else {
          let parts = null;
          for (const sep of ['\t', ',', ';']) {
            const split = trimmed.split(sep);
            if (split.length >= 2 && split[0].trim() && split[1].trim()) {
              parts = split;
              break;
            }
          }
          if (parts) {
            this._importBuffer.push({ type: 'basic', front: parts[0].trim(), back: parts.slice(1).join(',').trim() });
          }
        }
      }

      const preview = document.getElementById('import-preview');
      if (this._importBuffer.length === 0) {
        preview.innerHTML = '<div class="preview-item" style="color:var(--danger)">인식된 카드가 없습니다</div>';
        document.getElementById('btn-import').disabled = true;
      } else {
        preview.innerHTML = `<div class="preview-count">${this._importBuffer.length}장 인식됨</div>` +
          this._importBuffer.slice(0, 20).map(c => {
            if (c.type === 'blank') {
              BLANK_RE.lastIndex = 0;
              return `<div class="preview-item">${c.text.replace(BLANK_RE, '<span class="blank-slot"></span>')}</div>`;
            }
            return `<div class="preview-item"><strong>${this.escapeHtml(c.front)}</strong> → ${this.escapeHtml(c.back)}</div>`;
          }).join('') +
          (this._importBuffer.length > 20 ? `<div class="preview-item" style="color:var(--text-secondary)">... 외 ${this._importBuffer.length - 20}장</div>` : '');
        document.getElementById('btn-import').disabled = false;
      }
    };
    reader.readAsText(file);
  },

  executeImport() {
    const deck = this.getDeck();
    if (!deck || this._importBuffer.length === 0) return;

    for (const c of this._importBuffer) {
      const card = {
        id: generateId(), type: c.type,
        box: 1, nextReview: null, lastReview: null, starred: false
      };
      if (c.type === 'blank') card.text = c.text;
      else { card.front = c.front; card.back = c.back; }
      deck.cards.push(card);
    }

    const count = this._importBuffer.length;
    this._importBuffer = [];
    this.save();
    this.toast(`${count}장의 카드를 가져왔습니다`);
    this.goBack();
    this.renderDeckDetail();
  },

  // =========================================================
  // Export
  // =========================================================
  exportDeck() {
    const deck = this.getDeck();
    if (!deck) return;

    const lines = deck.cards.map(c => {
      if (c.type === 'blank') return c.text;
      return `${c.front}\t${c.back}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('내보내기 완료');
  },

  exportAllData() {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blankcard_backup_${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('전체 백업 완료');
  },

  // =========================================================
  // Edit Card
  // =========================================================
  editCard(cardId) {
    const deck = this.getDeck();
    const card = deck.cards.find(c => c.id === cardId);
    if (!card) return;
    this.editingCardId = cardId;
    const textarea = document.getElementById('edit-card-text');
    textarea.value = card.type === 'blank' ? card.text : `${card.front}\t${card.back}`;
    document.getElementById('modal-edit').classList.remove('hidden');
    textarea.focus();
    this.updateEditPreview();
  },

  updateEditPreview() {
    const text = document.getElementById('edit-card-text').value.trim();
    const preview = document.getElementById('edit-preview');
    BLANK_RE.lastIndex = 0;
    if (BLANK_RE.test(text)) {
      BLANK_RE.lastIndex = 0;
      preview.innerHTML = `<div class="preview-item">${text.replace(BLANK_RE, '<span class="blank-slot"></span>')}</div>`;
    } else {
      preview.innerHTML = '';
    }
  },

  saveEditCard() {
    const deck = this.getDeck();
    const card = deck.cards.find(c => c.id === this.editingCardId);
    if (!card) return;
    const text = document.getElementById('edit-card-text').value.trim();
    if (!text) return this.toast('내용을 입력해주세요');

    BLANK_RE.lastIndex = 0;
    if (BLANK_RE.test(text)) {
      card.type = 'blank'; card.text = text;
    } else if (text.includes('\t')) {
      const [front, ...rest] = text.split('\t');
      card.type = 'basic'; card.front = front.trim(); card.back = rest.join('\t').trim();
    } else {
      card.type = 'blank'; card.text = text;
    }
    this.save();
    this.closeEditModal();
    this.renderDeckDetail();
    this.toast('카드가 수정되었습니다');
  },

  deleteCard() {
    if (!confirm('이 카드를 삭제하시겠습니까?')) return;
    const deck = this.getDeck();
    deck.cards = deck.cards.filter(c => c.id !== this.editingCardId);
    this.save();
    this.closeEditModal();
    this.renderDeckDetail();
    this.toast('카드가 삭제되었습니다');
  },

  closeEditModal() {
    document.getElementById('modal-edit').classList.add('hidden');
    this.editingCardId = null;
  },

  // =========================================================
  // Study Mode
  // =========================================================
  showStudyOptions() {
    const deck = this.getDeck();
    if (!deck || deck.cards.length === 0) return;

    const due = getDueCards(deck).length;
    const all = deck.cards.length;
    const starred = deck.cards.filter(c => c.starred).length;
    const wrong = deck.cards.filter(c => (c.box || 1) === 1).length;

    document.getElementById('opt-count-due').textContent = `${due}장`;
    document.getElementById('opt-count-all').textContent = `${all}장`;
    document.getElementById('opt-count-starred').textContent = `${starred}장`;
    document.getElementById('opt-count-wrong').textContent = `${wrong}장`;

    document.querySelector('input[name="study-filter"][value="due"]').checked = true;
    document.getElementById('opt-typing-mode').checked = false;
    document.getElementById('modal-study-options').classList.remove('hidden');
  },

  confirmStudyStart() {
    const deck = this.getDeck();
    if (!deck) return;

    const filter = document.querySelector('input[name="study-filter"]:checked').value;
    this.typingMode = document.getElementById('opt-typing-mode').checked;

    let cards;
    if (filter === 'due') cards = getDueCards(deck);
    else if (filter === 'all') cards = [...deck.cards];
    else if (filter === 'starred') cards = deck.cards.filter(c => c.starred);
    else if (filter === 'wrong') cards = deck.cards.filter(c => (c.box || 1) === 1);

    if (!cards || cards.length === 0) {
      this.toast('해당 조건의 카드가 없습니다');
      return;
    }

    this.studyQueue = [...cards].sort(() => Math.random() - 0.5);
    this.studyIndex = 0;
    this.studyCorrect = 0;
    this.studyWrong = 0;
    this.revealed = false;
    this.studyHistory = [];

    this.closeModal('modal-study-options');
    this.navigate('study');
    this.renderStudyCard();
  },

  renderStudyCard() {
    if (this.studyIndex >= this.studyQueue.length) {
      this.showStudyComplete();
      return;
    }

    const card = this.studyQueue[this.studyIndex];
    const total = this.studyQueue.length;
    const current = this.studyIndex + 1;

    document.getElementById('study-progress').innerHTML = `
      <span>${current} / ${total}</span>
      <div class="progress-bar"><div class="progress-fill" style="width: ${(current / total) * 100}%"></div></div>
    `;

    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.style.opacity = this.studyHistory.length > 0 ? '1' : '0.3';

    const content = document.getElementById('study-card-content');
    const hint = document.getElementById('study-hint');
    const controls = document.getElementById('study-controls');
    const studyCard = document.getElementById('study-card');

    this.revealed = false;
    controls.classList.add('hidden');

    this.updateStudyStarBtn();

    if (this.typingMode) {
      hint.textContent = '정답을 입력하고 Enter';
      hint.style.opacity = '1';
      studyCard.onclick = null;

      if (card.type === 'blank') {
        const blanks = [];
        const re = /\{\{(.+?)\}\}/g;
        let match;
        while ((match = re.exec(card.text)) !== null) blanks.push(match[1]);

        let idx = 0;
        const display = card.text.replace(BLANK_RE, () => {
          const i = idx++;
          return `<input type="text" class="typing-input" data-index="${i}" data-answer="${this.escapeAttr(blanks[i])}" placeholder="?" autocomplete="off">`;
        });
        content.innerHTML = display;
        content.innerHTML += `<button class="btn-check-answer" onclick="app.checkTypingAnswer()">확인</button>`;
        const firstInput = content.querySelector('.typing-input');
        if (firstInput) setTimeout(() => firstInput.focus(), 100);
      } else {
        content.innerHTML = `
          <div style="font-size: 20px; font-weight: 600; margin-bottom: 12px;">${this.escapeHtml(card.front)}</div>
          <input type="text" class="typing-input" data-answer="${this.escapeAttr(card.back)}" placeholder="정답 입력" autocomplete="off">
          <button class="btn-check-answer" onclick="app.checkTypingAnswer()">확인</button>`;
        const input = content.querySelector('.typing-input');
        if (input) setTimeout(() => input.focus(), 100);
      }
    } else {
      hint.textContent = '탭하여 정답 확인';
      hint.style.opacity = '1';
      studyCard.onclick = () => app.revealBlanks();

      if (card.type === 'blank') {
        const blanks = [];
        const re = /\{\{(.+?)\}\}/g;
        let match;
        while ((match = re.exec(card.text)) !== null) blanks.push(match[1]);

        let idx = 0;
        const display = card.text.replace(BLANK_RE, () => {
          return `<span class="blank-slot" data-answer="${this.escapeAttr(blanks[idx++])}"></span>`;
        });
        content.innerHTML = display;
      } else {
        content.innerHTML = `<div style="font-size: 20px; font-weight: 600;">${this.escapeHtml(card.front)}</div>`;
      }
    }
  },

  checkTypingAnswer() {
    if (this.revealed) return;
    this.revealed = true;

    const content = document.getElementById('study-card-content');
    const inputs = content.querySelectorAll('.typing-input');
    const hint = document.getElementById('study-hint');
    const controls = document.getElementById('study-controls');
    inputs.forEach(input => {
      const answer = input.dataset.answer;
      const userAnswer = input.value.trim();
      const correct = userAnswer.toLowerCase() === answer.toLowerCase();
      input.classList.add(correct ? 'correct' : 'wrong');
      input.disabled = true;
      if (!correct) {
        const show = document.createElement('div');
        show.className = 'typing-answer-display';
        show.textContent = `→ ${answer}`;
        input.parentNode.insertBefore(show, input.nextSibling);
      }
    });

    const checkBtn = content.querySelector('.btn-check-answer');
    if (checkBtn) checkBtn.remove();

    hint.style.opacity = '0';
    controls.classList.remove('hidden');
  },

  revealBlanks() {
    if (this.revealed || this.typingMode) return;
    this.revealed = true;

    const card = this.studyQueue[this.studyIndex];
    const content = document.getElementById('study-card-content');
    const hint = document.getElementById('study-hint');
    const controls = document.getElementById('study-controls');

    if (card.type === 'blank') {
      content.querySelectorAll('.blank-slot').forEach(slot => {
        slot.textContent = slot.dataset.answer;
        slot.classList.add('revealed');
      });
    } else {
      content.innerHTML += `<div style="margin-top: 20px; padding-top: 16px; border-top: 2px solid var(--border); color: var(--primary); font-weight: 600;">${this.escapeHtml(card.back)}</div>`;
    }

    hint.style.opacity = '0';
    controls.classList.remove('hidden');
  },

  answerCard(correct) {
    const card = this.studyQueue[this.studyIndex];
    const deck = this.getDeck();
    const realCard = deck.cards.find(c => c.id === card.id);

    if (realCard) {
      this.studyHistory.push({
        cardId: realCard.id,
        previousBox: realCard.box,
        previousNextReview: realCard.nextReview,
        previousLastReview: realCard.lastReview,
        wasCorrect: correct
      });

      if (correct) {
        realCard.box = Math.min((realCard.box || 1) + 1, 5);
        this.studyCorrect++;
      } else {
        realCard.box = 1;
        this.studyWrong++;
      }
      realCard.lastReview = Date.now();
      const interval = LEITNER_INTERVALS[realCard.box] || 0;
      realCard.nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;
    }

    this.save();
    this.studyIndex++;
    this.renderStudyCard();
  },

  // =========================================================
  // Undo
  // =========================================================
  undoLastAnswer() {
    if (this.studyHistory.length === 0 || this.studyIndex <= 0) return;

    const snapshot = this.studyHistory.pop();
    const deck = this.getDeck();
    const realCard = deck.cards.find(c => c.id === snapshot.cardId);

    if (realCard) {
      realCard.box = snapshot.previousBox;
      realCard.nextReview = snapshot.previousNextReview;
      realCard.lastReview = snapshot.previousLastReview;
    }

    if (snapshot.wasCorrect) this.studyCorrect--;
    else this.studyWrong--;

    this.studyIndex--;
    this.save();
    this.renderStudyCard();
    this.toast('되돌리기 완료');
  },

  // =========================================================
  // Study Complete & Stats
  // =========================================================
  showStudyComplete() {
    this.recordStudyResult();
    document.getElementById('study-result').innerHTML = `
      <div class="result-item correct">
        <div class="result-value">${this.studyCorrect}</div>
        <div class="result-label">맞음</div>
      </div>
      <div class="result-item wrong">
        <div class="result-value">${this.studyWrong}</div>
        <div class="result-label">틀림</div>
      </div>
    `;
    document.getElementById('study-controls').classList.add('hidden');
    this.navigate('complete');
  },

  recordStudyResult() {
    const today = todayStr();
    const stats = this.data.stats;
    if (!stats.dailyLog) stats.dailyLog = {};

    if (!stats.dailyLog[today]) {
      stats.dailyLog[today] = { studied: 0, correct: 0, wrong: 0 };
    }
    stats.dailyLog[today].studied += this.studyCorrect + this.studyWrong;
    stats.dailyLog[today].correct += this.studyCorrect;
    stats.dailyLog[today].wrong += this.studyWrong;

    stats.lastStudyDate = today;
    stats.currentStreak = this.calculateStreak();
    if (stats.currentStreak > (stats.longestStreak || 0)) {
      stats.longestStreak = stats.currentStreak;
    }

    this.save();
  },

  calculateStreak() {
    const log = this.data.stats.dailyLog || {};
    let streak = 0;
    const d = new Date();
    while (true) {
      const key = d.toISOString().slice(0, 10);
      if (log[key] && log[key].studied > 0) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  },

  // =========================================================
  // Stats View
  // =========================================================
  showStats() {
    this.navigate('stats');
    this.renderStats();
  },

  renderStats() {
    const stats = this.data.stats;
    const log = stats.dailyLog || {};
    const streak = this.calculateStreak();

    let totalStudied = 0, totalCorrect = 0;
    for (const day of Object.values(log)) {
      totalStudied += day.studied;
      totalCorrect += day.correct;
    }
    const accuracy = totalStudied > 0 ? Math.round((totalCorrect / totalStudied) * 100) : 0;
    const studyDays = Object.keys(log).filter(k => log[k].studied > 0).length;

    document.getElementById('streak-display').innerHTML = `
      <div class="streak-fire">🔥</div>
      <div class="streak-number">${streak}</div>
      <div class="streak-label">연속 학습일</div>
    `;

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card"><div class="stat-value">${totalStudied}</div><div class="stat-label">총 학습 카드</div></div>
      <div class="stat-card"><div class="stat-value">${accuracy}%</div><div class="stat-label">정답률</div></div>
      <div class="stat-card"><div class="stat-value">${studyDays}</div><div class="stat-label">학습한 날</div></div>
      <div class="stat-card"><div class="stat-value">${stats.longestStreak || 0}</div><div class="stat-label">최장 연속</div></div>
    `;

    const today = new Date();
    const days = [];
    for (let i = 34; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = log[key];
      const count = entry ? entry.studied : 0;
      const isToday = i === 0;
      let level = '';
      if (count > 0) level = count <= 5 ? 'level-1' : count <= 15 ? 'level-2' : count <= 30 ? 'level-3' : 'level-4';
      days.push(`<div class="cal-day ${level} ${isToday ? 'today' : ''}" title="${key}: ${count}장"></div>`);
    }
    document.getElementById('stats-calendar').innerHTML = days.join('');

    const logEntries = Object.entries(log)
      .filter(([, v]) => v.studied > 0)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 10);

    document.getElementById('stats-log').innerHTML = logEntries.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;">아직 학습 기록이 없습니다</div>'
      : logEntries.map(([date, v]) => `
        <div class="log-item">
          <span class="log-date">${date}</span>
          <div class="log-detail">
            <span class="log-correct">✓ ${v.correct}</span>
            <span class="log-wrong">✗ ${v.wrong}</span>
            <span>${v.studied}장</span>
          </div>
        </div>`).join('');
  },

  // =========================================================
  // Utilities
  // =========================================================
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // =========================================================
  // Init
  // =========================================================
  async init() {
    this.loadTheme();
    this.data = await loadData();
    this.renderDecks();

    // Live preview
    document.getElementById('blank-input').addEventListener('input', () => this.updateBlankPreview());
    document.getElementById('edit-card-text').addEventListener('input', () => this.updateEditPreview());

    // Enter for deck name
    document.getElementById('deck-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createDeck();
    });

    // Close menus
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.deck-actions-menu')) this.closeDeckMenus();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (this.currentView !== 'study') return;

      if (this.typingMode) {
        if (e.key === 'Enter' && !this.revealed) {
          e.preventDefault();
          this.checkTypingAnswer();
        } else if (this.revealed) {
          if (e.code === 'ArrowLeft' || e.key === '1') this.answerCard(false);
          else if (e.code === 'ArrowRight' || e.key === '2') this.answerCard(true);
        }
      } else {
        if (e.code === 'Space' && !this.revealed) {
          e.preventDefault();
          this.revealBlanks();
        } else if (this.revealed) {
          if (e.code === 'ArrowLeft' || e.key === '1') this.answerCard(false);
          else if (e.code === 'ArrowRight' || e.key === '2') this.answerCard(true);
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undoLastAnswer();
      }
    });

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
