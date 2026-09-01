/* =========================================================
   db.js  —  데이터 계층
   LocalDB    : 이 브라우저에만 저장 (혼자 사용)
   FirestoreDB: Firebase에 저장 (여러 선생님이 함께 사용)

   두 provider 모두 같은 6개 메서드를 제공하므로
   app.js는 어느 쪽을 쓰는지 알 필요가 없습니다.
   ========================================================= */

const DAYS = ['월', '화', '수', '목', '금'];

// ── 공통 헬퍼 ──────────────────────────────────────────────

function _emptyRoom() {
  return {
    config: null,
    classSettings: {},
    specialists: [],
    referenceBoards: [],
    maxWeek: 1,
    lastSavedBy: '',
    lastSavedAt: new Date().toISOString(),
    history: {}
  };
}

// app.js는 classes[반][요일]이 반드시 배열이길 기대함.
// {} 로 저장된 빈 반 데이터를 올바른 형식으로 정규화.
function _normalize(data) {
  if (!data) return null;
  if (data.history) {
    Object.values(data.history).forEach(wData => {
      if (!wData.classes) wData.classes = {};
      Object.keys(wData.classes).forEach(k => {
        const cls = wData.classes[k];
        DAYS.forEach(d => { if (!Array.isArray(cls[d])) cls[d] = []; });
      });
      if (!wData.bgColors)        wData.bgColors = {};
      if (!wData.targets)         wData.targets = {};
      if (!wData.specialistCells) wData.specialistCells = {};
      if (!wData.specialists)     wData.specialists = [];
      if (!wData.fixedSlots)      wData.fixedSlots = [];
    });
  }
  return data;
}

// 관리자 저장: 설정 + 전체 주차 데이터
function _buildAdminPayload(existing, state) {
  const data = {
    ...existing,
    config: state.config || null,
    classSettings: state.classSettings || {},
    specialists: state.specialists || [],
    referenceBoards: state.referenceBoards || [],
    maxWeek: state.maxWeek || 1,
    lastSavedBy: state.userProfile?.name || '나',
    lastSavedAt: new Date().toISOString(),
    history: {}
  };
  for (let w = 1; w <= (state.maxWeek || 1); w++) {
    const wData = (state.history || {})[w];
    if (!wData) continue;
    data.history[w] = {
      // 저장소에서 지은 주차 이름. 빠뜨리면 새로고침할 때마다 "N주차"로 되돌아감
      name:              wData.name              || '',
      specialistAutofilled: !!wData.specialistAutofilled,
      targets:           wData.targets           || {},
      specialistTargets: wData.specialistTargets || {},
      specialistMemo:    wData.specialistMemo    || '',
      weeklyMemo:        wData.weeklyMemo        || '',
      specialistCells:   wData.specialistCells   || {},
      specialists:       wData.specialists       || [],
      fixedSlots:        wData.fixedSlots        || [],
      classes:           wData.classes           || {},
      bgColors:          wData.bgColors          || {}
    };
  }
  return data;
}

// 반 저장: 자기 반 칸만 기존 데이터 위에 덮어씀
function _applyClassPayload(existing, classNum, state) {
  if (!existing.history) existing.history = {};
  for (let w = 1; w <= (state.maxWeek || 1); w++) {
    const wData = (state.history || {})[w];
    if (!wData) continue;
    if (!existing.history[w])           existing.history[w] = {};
    if (!existing.history[w].classes)   existing.history[w].classes = {};
    if (!existing.history[w].bgColors)  existing.history[w].bgColors = {};
    existing.history[w].classes[classNum]  = (wData.classes  || {})[classNum] || {};
    existing.history[w].bgColors[classNum] = (wData.bgColors || {})[classNum] || {};
  }
  if (!existing.classSettings) existing.classSettings = {};
  existing.classSettings[classNum] = (state.classSettings || {})[classNum] || {};
  existing.lastSavedBy = state.userProfile?.name || '';
  existing.lastSavedAt = new Date().toISOString();
  return existing;
}

// ── LocalDB (혼자 사용) ────────────────────────────────────

const LocalDB = {
  _key(roomCode) { return `jugan-local-room-${roomCode}`; },

  async listRooms() {
    return Object.keys(localStorage)
      .filter(k => k.startsWith('jugan-local-room-'))
      .map(k => k.replace('jugan-local-room-', ''));
  },

  async createRoom(roomCode) {
    const key = this._key(roomCode);
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, JSON.stringify(_emptyRoom()));
    return true;
  },

  async load(roomCode) {
    const saved = localStorage.getItem(this._key(roomCode));
    if (!saved) return null;
    try { return _normalize(JSON.parse(saved)); } catch { return null; }
  },

  async saveAdmin(roomCode, state) {
    const existing = (await this.load(roomCode)) || {};
    localStorage.setItem(this._key(roomCode), JSON.stringify(_buildAdminPayload(existing, state)));
  },

  async saveClass(roomCode, classNum, state) {
    const existing = (await this.load(roomCode)) || {};
    localStorage.setItem(this._key(roomCode), JSON.stringify(_applyClassPayload(existing, classNum, state)));
  },

  async deleteRoom(roomCode) {
    localStorage.removeItem(this._key(roomCode));
  }
};

// ── FirestoreDB (함께 사용) ────────────────────────────────
// 방 하나 = 문서 하나. 방 전체를 JSON 문자열 한 칸에 담습니다.
// Firestore의 중첩 배열 제약을 피할 수 있고, 저장 형식이 LocalDB와 완전히 같아집니다.

const FirestoreDB = {
  _col() { return firebase.firestore().collection('rooms'); },
  _doc(roomCode) { return this._col().doc(roomCode); },

  async listRooms() {
    const snap = await this._col().get();
    return snap.docs.map(d => d.id).sort();
  },

  async createRoom(roomCode) {
    const ref = this._doc(roomCode);
    const snap = await ref.get();
    if (snap.exists) return false;
    await ref.set({
      data: JSON.stringify(_emptyRoom()),
      updatedAt: new Date().toISOString()
    });
    return true;
  },

  async load(roomCode) {
    const snap = await this._doc(roomCode).get();
    if (!snap.exists) return null;
    try { return _normalize(JSON.parse(snap.data().data || '{}')); } catch { return null; }
  },

  // 두 선생님이 동시에 저장해도 서로의 내용을 덮어쓰지 않도록
  // 읽기 → 수정 → 쓰기를 트랜잭션으로 묶습니다.
  async _update(roomCode, mutate) {
    const ref = this._doc(roomCode);
    await firebase.firestore().runTransaction(async tx => {
      const snap = await tx.get(ref);
      let existing = {};
      if (snap.exists) {
        try { existing = _normalize(JSON.parse(snap.data().data || '{}')) || {}; } catch { existing = {}; }
      }
      const next = mutate(existing);
      tx.set(ref, {
        data: JSON.stringify(next),
        updatedAt: new Date().toISOString()
      });
    });
  },

  async saveAdmin(roomCode, state) {
    await this._update(roomCode, existing => _buildAdminPayload(existing, state));
  },

  async saveClass(roomCode, classNum, state) {
    await this._update(roomCode, existing => _applyClassPayload(existing, classNum, state));
  },

  async deleteRoom(roomCode) {
    await this._doc(roomCode).delete();
  }
};

// ── DB 프록시 ──────────────────────────────────────────────

const DB = {
  _provider: null,
  mode: null,  // 'local' | 'server'

  setLocal()  { this.mode = 'local';  this._provider = LocalDB; },
  setServer() { this.mode = 'server'; this._provider = FirestoreDB; },

  isReady() { return this._provider !== null; },

  async listRooms()                      { return this._provider.listRooms(); },
  async createRoom(roomCode)             { return this._provider.createRoom(roomCode); },
  async load(roomCode)                   { return this._provider.load(roomCode); },
  async saveAdmin(roomCode, state)       { return this._provider.saveAdmin(roomCode, state); },
  async saveClass(roomCode, classNum, s) { return this._provider.saveClass(roomCode, classNum, s); },
  async deleteRoom(roomCode)             { return this._provider.deleteRoom(roomCode); }
};

// ── FirebaseDB 호환 alias ─────────────────────────────────
// app.js가 수정 없이 동작하도록 FirebaseDB 이름을 DB 프록시에 연결.
// _provider가 null(모드 미선택)일 때는 빈 값 반환해 앱이 멈추지 않게 함.
const FirebaseDB = {
  init() {},
  async load(r)            { return DB._provider ? DB.load(r) : null; },
  async saveAdmin(r, s)    { return DB._provider ? DB.saveAdmin(r, s) : null; },
  async saveClass(r, c, s) { return DB._provider ? DB.saveClass(r, c, s) : null; },
  async listRooms()        { return DB._provider ? DB.listRooms() : []; },
  async createRoom(r)      { return DB._provider ? DB.createRoom(r) : false; },
  async deleteRoom(r)      { return DB._provider ? DB.deleteRoom(r) : null; }
};
