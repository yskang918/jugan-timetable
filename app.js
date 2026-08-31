/**
 * Weekly Learning Program - Advanced Architecture v2.5 (Surgical UI Fix)
 */

const App = {
    state: {
        currentWeek: 1,
        maxWeek: 1,
        config: {
            grade: '',
            classCount: 4,
            periods: { "월": 6, "화": 6, "수": 5, "목": 6, "금": 6 },
            subjects: [],
            annualTargets: {} // { subject: totalHours }
        },
        specialists: [],
        history: {},
        isMarkingMode: false,
        markingColor: '#fef08a',
        isHelperMode: false,
        selectedSub: null,
        selectedSidebarColor: null,
        spPreviewOpen: false,
        referenceBoards: [],
        userProfile: null, // { name, classNum }
        roomCode: '',
        isAdmin: false,
        isDirty: false, // 서버 저장 후 수정 여부
        isSpDirty: false, // 전담 미저장 여부
        classSettings: {} // { [classNum]: { [subName]: { enabled, periods, preferredSlot, blockSize } } }
    },

    days: ["월", "화", "수", "목", "금"],

    init() {
        FirebaseDB.init();
        this.loadData();
        this.cacheDOM();
        this.bindEvents();
        this.initWeekData(this.state.currentWeek);
        this.checkLogin(true); // checkLogin → updateNavForRole 에서 알맞은 화면(전체 시간표)으로 전환됨
    },

    loadData() {
        const saved = localStorage.getItem('school-planner-v4');
        if (saved) {
            const data = JSON.parse(saved);
            this.state = { ...this.state, ...data };
        }
        if (!this.state.markingColor) this.state.markingColor = '#fef08a';
        if (!this.state.referenceBoards || this.state.referenceBoards.length === 0) {
            this.state.referenceBoards = [
                { name: '참고 시간표 1', data: {}, marks: {} },
                { name: '참고 시간표 2', data: {}, marks: {} }
            ];
        }
        if (!this.state.specialists || this.state.specialists.length === 0) {
            this.state.specialists = [
                { subject: '전담 1', desc: '', data: {}, marks: {}, bg: '#ffffff' },
                { subject: '전담 2', desc: '', data: {}, marks: {}, bg: '#ffffff' }
            ];
        }
        if (!this.state.history) this.state.history = {};
        // 마이그레이션: 기존 state.specialists(전역) → 주차별 history[w].specialists
        if (this.state.specialists && this.state.specialists.length > 0) {
            for (let w = 1; w <= (this.state.maxWeek || 1); w++) {
                if (this.state.history[w] && (!this.state.history[w].specialists || this.state.history[w].specialists.length === 0)) {
                    this.state.history[w].specialists = JSON.parse(JSON.stringify(this.state.specialists));
                }
            }
        }
        // UI 상태는 항상 초기값으로 리셋 (저장값 무시)
        this.state.spPreviewOpen = false;
        this.state.isMarkingMode = false;
        this.state.sptViewMode = 'specialist';
        this.state.sptWeek = this.state.currentWeek || 1;
        if (!this.state.config) this.state.config = { grade: '', classCount: 4, periods: { "월": 6, "화": 6, "수": 5, "목": 6, "금": 6 }, subjects: [] };
        if (!this.state.config.adminPin) this.state.config.adminPin = '0000';
        // weekAnchor: { week: N, startDate: 'YYYY-MM-DD' } - 주차 날짜 기준점
        if (!this.state.config.weekAnchor) this.state.config.weekAnchor = null;

        // Data Migration: subjects string[] -> {name, blockSize}[]
        if (this.state.config.subjects && this.state.config.subjects.length > 0) {
            this.state.config.subjects = this.state.config.subjects.map(s => {
                if (typeof s === 'string') return { name: s, blockSize: (s.includes('미술') || s.includes('실과')) ? 2 : 1 };
                if (s.isBlock !== undefined) {
                    const newObj = { name: s.name, blockSize: s.isBlock ? 2 : 1 };
                    delete s.isBlock;
                    return newObj;
                }
                if (!s.blockSize) s.blockSize = 1; 
                return s;
            });
        } else {
            const defaults = ["국어", "사회", "도덕", "수학", "과학", "체육", "음악", "미술", "영어", "자율", "동아리", "봉사", "진로"];
            this.state.config.subjects = defaults.map(s => ({ name: s, blockSize: (s === '미술' || s === '실과') ? 2 : 1 }));
        }
    },

    saveData() {
        localStorage.setItem('school-planner-v4', JSON.stringify(this.state));
        this._scheduleAutosave();
    },

    // 수정할 때마다 짧은 지연 후 전체 데이터를 자동 저장(빠른 연속 입력은 하나로 묶어서 저장)
    _scheduleAutosave() {
        if (!this.state.roomCode) return;
        const indicator = document.getElementById('autosave-indicator');
        if (indicator) indicator.textContent = '● 저장 대기 중...';
        clearTimeout(this._autosaveTimer);
        this._autosaveTimer = setTimeout(async () => {
            try {
                await FirebaseDB.saveAdmin(this.state.roomCode, this.state);
                if (indicator) {
                    indicator.textContent = '✓ 자동 저장됨';
                    clearTimeout(this._autosaveIndicatorTimer);
                    this._autosaveIndicatorTimer = setTimeout(() => { indicator.textContent = ''; }, 2000);
                }
            } catch (e) {
                if (indicator) indicator.textContent = '⚠ 자동 저장 실패';
            }
        }, 800);
    },

    // 주차별 전담 배열 반환 (week 생략 시 currentWeek)
    _sp(week) {
        const w = (week !== undefined && week !== null) ? week : this.state.currentWeek;
        return this.state.history[w]?.specialists ?? this.state.specialists ?? [];
    },

    // 특정 반·요일·교시에 실제 배정된 전담 보드 반환 (색상 조회용)
    _spForCell(c, d, p, week) {
        const cStr = String(c);
        return this._sp(week).find(sp => {
            const w = (week !== undefined && week !== null) ? week : this.state.currentWeek;
            if ((sp.hiddenWeeks || []).includes(w)) return false;
            if (!sp.data[d] || !sp.data[d][p]) return false;
            const classes = String(sp.data[d][p]).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
            return classes.includes(cStr);
        }) || null;
    },

    initWeekData(week) {
        if (!this.state.history[week]) {
            const targets = {};
            this.state.config.subjects.forEach(s => targets[s.name] = 0);
            const classes = {};
            for (let cNum = 1; cNum <= this.state.config.classCount; cNum++) {
                classes[cNum] = { "월":[], "화":[], "수":[], "목":[], "금":[] };
            }
            this.state.history[week] = { targets, classes, bgColors: {}, specialistTargets: {}, specialistMemo: '', weeklyMemo: '', specialistCells: {}, specialists: [], fixedSlots: [], specialistAutofilled: false };
        }
    },

    cacheDOM() {
        this.dom = {
            menus: {
                settings: document.getElementById('settings-view'),
                specialist: document.getElementById('specialist-view'),
                'specialist-teacher': document.getElementById('specialist-teacher-view'),
                timetable: document.getElementById('timetable-view'),
                'timetable-all': document.getElementById('timetable-view')
            },
            navs: document.querySelectorAll('.nav-item'),
            weekLabel: document.getElementById('current-week-label'),
            weekTargetContainer: document.getElementById('week-target-container'),
            allClassesContainer: document.getElementById('all-classes-container'),
            gradeInput: document.getElementById('input-grade'),
            classCountInput: document.getElementById('input-class-count'),
            periodInputs: { "월": document.getElementById('pd-mon'), "화": document.getElementById('pd-tue'), "수": document.getElementById('pd-wed'), "목": document.getElementById('pd-thu'), "금": document.getElementById('pd-fri') },
            subjectList: document.getElementById('subject-config-list'),
            specialistContainer: document.getElementById('specialist-boards-container'),
            specialistSummary: document.getElementById('specialist-summary-container'),
            modalContainer: document.getElementById('modal-container'),
            modalTitle: document.getElementById('modal-title'),
            modalContent: document.getElementById('modal-content'),
            modalConfirm: document.getElementById('btn-modal-confirm'),
            modalCancel: document.getElementById('btn-modal-cancel'),
            modalClose: document.getElementById('btn-modal-close'),
            palette: document.getElementById('subject-palette'),
            loginOverlay: document.getElementById('login-overlay'),
            userBadge: document.getElementById('user-badge'),
            userInfoText: document.getElementById('user-info-text'),
            btnLogout: document.getElementById('btn-logout'),
            loginName: document.getElementById('login-name'),
            loginClassNum: document.getElementById('login-class-num'),
            loginRoomCode: document.getElementById('login-room-code'),
            btnLogin: document.getElementById('btn-login'),
            btnCreateRoom: document.getElementById('btn-create-room'),
            btnServerSave: document.getElementById('btn-server-save'),
            btnServerLoad: document.getElementById('btn-server-load')
        };
    },

    bindEvents() {
        this.dom.navs.forEach(btn => btn.addEventListener('click', (e) => this.switchMenu(e.target.id.replace('btn-', ''))));
        document.getElementById('btn-prev-week').addEventListener('click', () => this.changeWeek(-1));
        document.getElementById('btn-next-week').addEventListener('click', () => this.changeWeek(1));
        document.getElementById('btn-create-week').addEventListener('click', () => this.createNewWeek());
        document.getElementById('btn-edit-week-date').addEventListener('click', () => this.openWeekDateModal());
        
        this.dom.weekTargetContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('target-input-global')) {
                const sub = e.target.dataset.sub;
                this.state.history[this.state.currentWeek].targets[sub] = parseInt(e.target.value) || 0;
                this.saveData();
                this.renderAllValidationGrids();
                
                // Update total sum in global target bar
                const targets = this.state.history[this.state.currentWeek].targets;
                const total = this.state.config.subjects.reduce((a, s) => a + (targets[s.name] || 0), 0);
                const totalCell = this.dom.weekTargetContainer.querySelector('.total-val');
                if (totalCell) totalCell.textContent = total;
            }
        });

        this.dom.weekTargetContainer.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('target-input-global')) return;
            const inputs = [...this.dom.weekTargetContainer.querySelectorAll('.target-input-global')];
            const idx = inputs.indexOf(e.target);
            if (e.key === 'ArrowRight' && idx < inputs.length - 1) { e.preventDefault(); inputs[idx + 1].focus(); inputs[idx + 1].select(); }
            else if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); inputs[idx - 1].focus(); inputs[idx - 1].select(); }
        });

        // 전담 잠금 셀 focus 인터셉트 (capture 단계)
        this.dom.allClassesContainer.addEventListener('focus', (e) => {
            if (e.target.classList.contains('cell-input') && e.target.dataset.spLocked === '1') {
                e.target.blur();
                this.showConfirm('전담 시간 수정', '이 교시는 전담 시간입니다.<br>수정하시겠습니까?').then(r => {
                    if (r) {
                        this._unlockSpCell(e.target);
                        e.target.focus();
                    }
                });
            }
        }, true);

        this.dom.allClassesContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('cell-input')) {
                const cNum = e.target.dataset.cls;
                const d = e.target.dataset.day;
                const idx = parseInt(e.target.dataset.idx);
                const trimmed = e.target.value.trim();
                this.state.history[this.state.currentWeek].classes[cNum][d][idx] = trimmed;
                if (!trimmed) {
                    if (this.state.history[this.state.currentWeek].bgColors?.[cNum]?.[d]?.[idx]) {
                        this.state.history[this.state.currentWeek].bgColors[cNum][d][idx] = null;
                        e.target.removeAttribute('data-bg-locked');
                    }
                    e.target.style.backgroundColor = '';
                    e.target.style.fontWeight = '';
                }
                e.target.style.fontWeight = '';
                e.target.style.color = '';
                this.state.isDirty = true;
                const saveBtn = e.target.closest('.timetable-section')?.querySelector('.btn-save-class');
                if (saveBtn) { saveBtn.textContent = '저장'; saveBtn.style.background = '#f59e0b'; saveBtn.style.borderColor = '#f59e0b'; }
                this.saveData();
                this.renderSingleValidationGrid(cNum);
                this.calculateAndRenderValidationView();
                this._renderTargetBar();
            }
        });

        // 🟢 NEW: Arrow navigation for Annual Summary Inputs
        this.dom.menus.validation = document.getElementById('validation-view');
        this.dom.menus.validation.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('val-ann-input')) return;
            const inputs = [...this.dom.menus.validation.querySelectorAll('.val-ann-input')];
            const idx = inputs.indexOf(e.target);
            if (e.key === 'ArrowRight' && idx < inputs.length - 1) { e.preventDefault(); inputs[idx + 1].focus(); inputs[idx + 1].select(); }
            else if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); inputs[idx - 1].focus(); inputs[idx - 1].select(); }
        });
        this.dom.allClassesContainer.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('cell-input')) return;
            const moves = { ArrowRight: [0,1], ArrowLeft: [0,-1], ArrowDown: [1,0], ArrowUp: [-1,0] };
            if (!moves[e.key]) return;
            e.preventDefault();
            const [dp, dd] = moves[e.key];
            const cNum = e.target.dataset.cls;
            const curDayIdx = this.days.indexOf(e.target.dataset.day);
            const curPeriod = parseInt(e.target.dataset.idx);
            const newDayIdx = curDayIdx + dd;
            const newPeriod = curPeriod + dp;
            if (newDayIdx < 0 || newDayIdx >= this.days.length || newPeriod < 0) return;
            const newDay = this.days[newDayIdx];
            const next = this.dom.allClassesContainer.querySelector(`.cell-input[data-cls="${cNum}"][data-day="${newDay}"][data-idx="${newPeriod}"]`);
            if (next) { next.focus(); next.select(); }
        });

        this.dom.allClassesContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-clear-class') || e.target.classList.contains('btn-clear-class-admin')) {
                const cNum = e.target.dataset.cls;
                this.clearClass(cNum);
            } else if (e.target.classList.contains('cell-input')) {
                // 관리자 색상 셀 → 확인 후 수정
                if (e.target.dataset.bgLocked === '1') {
                    this.showConfirm('관리자 설정 시간', '이 교시는 관리자가 설정한 시간입니다.<br>수정하시겠습니까?').then(r => {
                        if (r) {
                            e.target.removeAttribute('data-bg-locked');
                            const cNum = e.target.dataset.cls, d = e.target.dataset.day, idx = parseInt(e.target.dataset.idx);
                            if (this.state.selectedSub) {
                                e.target.value = this.state.selectedSub;
                                this.state.history[this.state.currentWeek].classes[cNum][d][idx] = this.state.selectedSub;
                                this.state.isDirty = true;
                                this.saveData();
                                this.renderSingleValidationGrid(cNum);
                                this.calculateAndRenderValidationView();
                            }
                            e.target.focus();
                        }
                    });
                    return;
                }
                // 전담 잠금 셀에 과목/색상 클릭 시도 → 확인 후 적용
                if (e.target.dataset.spLocked === '1' && (this.state.selectedSub || (this.state.selectedSidebarColor !== null && this.state.selectedSidebarColor !== undefined))) {
                    this.showConfirm('전담 시간 수정', '이 교시는 전담 시간입니다.<br>수정하시겠습니까?').then(r => {
                        if (r) { this._unlockSpCell(e.target); e.target.click(); }
                    });
                    return;
                }
                const cNum = e.target.dataset.cls, d = e.target.dataset.day, idx = parseInt(e.target.dataset.idx);
                let changed = false;
                if (this.state.selectedSub) {
                    e.target.value = this.state.selectedSub;
                    this.state.history[this.state.currentWeek].classes[cNum][d][idx] = this.state.selectedSub;
                    e.target.style.fontWeight = '';
                    e.target.style.color = '';
                    changed = true;
                }
                if (this.state.selectedSidebarColor !== null && this.state.selectedSidebarColor !== undefined) {
                    if (!this.state.isAdmin) return;
                    const color = this.state.selectedSidebarColor;
                    if (!this.state.history[this.state.currentWeek].bgColors) this.state.history[this.state.currentWeek].bgColors = {};
                    if (!this.state.history[this.state.currentWeek].bgColors[cNum]) this.state.history[this.state.currentWeek].bgColors[cNum] = {};
                    if (!this.state.history[this.state.currentWeek].bgColors[cNum][d]) this.state.history[this.state.currentWeek].bgColors[cNum][d] = [];
                    this.state.history[this.state.currentWeek].bgColors[cNum][d][idx] = color;
                    e.target.style.backgroundColor = color || '';
                    e.target.style.color = '';
                    e.target.style.fontWeight = color ? 'bold' : '';
                    changed = true;
                } else if (this.state.selectedSidebarColor === null && this.state.isAdmin && this.state.history[this.state.currentWeek].bgColors?.[cNum]?.[d]?.[idx]) {
                    this.state.history[this.state.currentWeek].bgColors[cNum][d][idx] = null;
                    e.target.style.backgroundColor = '';
                    e.target.style.fontWeight = '';
                    e.target.removeAttribute('data-bg-locked');
                    changed = true;
                }
                if (changed) {
                    this.state.isDirty = true;
                    const saveBtn = e.target.closest('.timetable-section')?.querySelector('.btn-save-class');
                    if (saveBtn) { saveBtn.textContent = '저장'; saveBtn.style.background = '#f59e0b'; saveBtn.style.borderColor = '#f59e0b'; }
                    this.saveData();
                    this.renderSingleValidationGrid(cNum);
                    this.renderSubjectPalette();
                }
            }
        });

        const btnSpAdd = document.getElementById('btn-add-specialist');
        if (btnSpAdd) btnSpAdd.addEventListener('click', () => this.addSpecialistBoard());

        // 전담 보드 & 참고용 전담 시간표 키보드 방향키 네비게이션
        const spView = document.getElementById('specialist-view');
        if (spView) {
            spView.addEventListener('keydown', (e) => {
                const inp = e.target;
                let d, p, board, cls, attrD, attrP;
                if (inp.classList.contains('cell-input') && inp.getAttribute('data-sp-d')) {
                    d = inp.getAttribute('data-sp-d');
                    p = parseInt(inp.getAttribute('data-sp-p'));
                    board = inp.closest('.specialist-table-wrapper');
                    cls = 'cell-input'; attrD = 'data-sp-d'; attrP = 'data-sp-p';
                } else if (inp.classList.contains('sp-ref-input') && inp.getAttribute('data-ref-d')) {
                    d = inp.getAttribute('data-ref-d');
                    p = parseInt(inp.getAttribute('data-ref-p'));
                    board = inp.closest('.sp-ref-board');
                    cls = 'sp-ref-input'; attrD = 'data-ref-d'; attrP = 'data-ref-p';
                } else return;
                if (!d || isNaN(p) || !board) return;
                const dIdx = this.days.indexOf(d);
                let nextInp = null;
                if (e.key === 'ArrowRight' && dIdx < this.days.length - 1) {
                    e.preventDefault();
                    nextInp = board.querySelector(`.${cls}[${attrD}="${this.days[dIdx+1]}"][${attrP}="${p}"]`);
                } else if (e.key === 'ArrowLeft' && dIdx > 0) {
                    e.preventDefault();
                    nextInp = board.querySelector(`.${cls}[${attrD}="${this.days[dIdx-1]}"][${attrP}="${p}"]`);
                } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault();
                    nextInp = board.querySelector(`.${cls}[${attrD}="${d}"][${attrP}="${p+1}"]`);
                } else if (e.key === 'ArrowUp' && p > 0) {
                    e.preventDefault();
                    nextInp = board.querySelector(`.${cls}[${attrD}="${d}"][${attrP}="${p-1}"]`);
                }
                if (nextInp) { nextInp.focus(); nextInp.select(); }
            });
        }
        
        const btnSpPreview = document.getElementById('btn-toggle-sp-preview');
        if (btnSpPreview) btnSpPreview.addEventListener('click', () => this.toggleSpPreview());
        
        const btnMarking = document.getElementById('btn-toggle-marking');
        if (btnMarking) btnMarking.addEventListener('click', () => this.toggleMarkingMode());

        const btnHelper = document.getElementById('btn-toggle-helper');
        if (btnHelper) btnHelper.addEventListener('click', () => this.toggleHelperMode());

        const colorPresets = document.querySelectorAll('.mark-color-btn');
        colorPresets.forEach(btn => btn.addEventListener('click', (e) => { this.setMarkingColor(e.target.dataset.color, e.target); }));

        document.getElementById('btn-weekly-memo').addEventListener('click', () => this.openWeeklyMemoModal());
        document.getElementById('btn-random-all').addEventListener('click', () => this.randomAssignAll());
        document.getElementById('btn-print-guide').addEventListener('click', () => this.printWeeklyGuide());
        document.getElementById('btn-ppo-close').addEventListener('click', () => document.getElementById('print-preview-overlay').classList.add('hide'));

        // 🗂️ 1단계 타일 보드
        // mousedown에서 처리하는 이유: click은 브라우저가 먼저 발생시키는 blur보다 늦게 오는데,
        // blur가 즉시 재렌더링을 일으키면 클릭 대상 타일이 DOM에서 떨어져나가 click이 못 잡힘.
        // mousedown 시점에 선점해서 편집 중이던 값을 먼저 커밋하고, 이어서 우리가 직접 처리한다.
        const tsBody = document.getElementById('tile-step-body');
        if (tsBody) {
            tsBody.addEventListener('mousedown', (e) => {
                if (e.target.closest('.ts-tile-input')) return; // 입력 중인 칸 자체를 누르는 건 그대로 둠
                e.preventDefault();

                const openInput = tsBody.querySelector('.ts-tile-input');
                if (openInput) {
                    const wData = this.state.history[this.state.currentWeek];
                    wData.classes[openInput.dataset.cls][openInput.dataset.day][parseInt(openInput.dataset.idx)] = openInput.value.trim();
                }

                const xBtn = e.target.closest('.ts-tile-x');
                if (xBtn) { this.tileClearX(xBtn.dataset.cls, xBtn.dataset.day, parseInt(xBtn.dataset.idx)); return; }

                const tile = e.target.closest('.ts-tile');
                if (!tile || tile.classList.contains('ts-tile-none')) {
                    this.state.tileSel = null;
                    this.saveData();
                    this.renderTileStep();
                    return;
                }
                this.tileClick(tile.dataset.cls, tile.dataset.day, parseInt(tile.dataset.idx));
            });
            tsBody.addEventListener('keydown', (e) => {
                if (e.target.classList.contains('ts-tile-input') && e.key === 'Enter') e.target.blur();
            });
            tsBody.addEventListener('blur', (e) => {
                if (e.target.classList.contains('ts-tile-input')) {
                    this.tileInputCommit(e.target.dataset.cls, e.target.dataset.day, parseInt(e.target.dataset.idx), e.target.value);
                }
            }, true);
        }
        document.getElementById('btn-ppo-check').addEventListener('click', () => this.runFinalCheck());
        document.getElementById('btn-ppo-print').addEventListener('click', () => this.printPDF());
        document.getElementById('btn-ppo-download').addEventListener('click', () => this.downloadPDF());
        document.getElementById('btn-clear-all').addEventListener('click', () => this.clearAllClasses());

        document.getElementById('btn-add-subject').addEventListener('click', () => { this.sortSubjectRows(); const count = this.dom.subjectList.querySelectorAll('.subject-row').length; this.addSubjectConfigItem('', count); });
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());

        this.dom.modalClose.addEventListener('click', () => this.closeModal(false));
        this.dom.modalCancel.addEventListener('click', () => this.closeModal(false));
        this.dom.modalConfirm.addEventListener('click', () => this.closeModal(true));

        this.dom.palette.addEventListener('click', (e) => {
            const card = e.target.closest('.palette-card');
            if (card) {
                const sub = card.dataset.sub;
                if (this.state.selectedSub === sub) {
                    this.state.selectedSub = null;
                } else {
                    this.state.selectedSub = sub;
                }
                this.renderSubjectPalette();
            }
        });


        // 🔒 Login UI Events
        if (this.dom.btnLogin) {
            this.dom.btnLogin.addEventListener('click', () => this.handleLogin());
        }
        const checkLoginReady = () => {
            const roomCode = this.dom.loginRoomCode?.value.trim();
            const name = this.dom.loginName?.value.trim();
            const classNum = this.dom.loginClassNum?.value.trim();
            const ready = roomCode && name && (classNum === '전담' || parseInt(classNum) >= 1);
            if (this.dom.btnLogin) this.dom.btnLogin.classList.toggle('active', !!ready);
        };
        this.dom.loginName?.addEventListener('input', checkLoginReady);
        this.dom.loginClassNum?.addEventListener('input', checkLoginReady);
        this.dom.loginRoomCode?.addEventListener('change', checkLoginReady);
        if (this.dom.btnCreateRoom) {
            this.dom.btnCreateRoom.addEventListener('click', () => this.handleCreateRoom());
        }
        document.getElementById('btn-superadmin')?.addEventListener('click', () => this.handleSuperAdmin());
        if (this.dom.btnLogout) {
            this.dom.btnLogout.addEventListener('click', () => this.handleLogout());
        }
    },

    /* --- 🔒 Auth Methods --- */
    checkLogin(fromInit = false) {
        if (!this.state.userProfile) {
            if (this.dom.loginOverlay) this.dom.loginOverlay.classList.remove('hide');
            if (this.dom.userBadge) this.dom.userBadge.classList.add('hide');
            document.getElementById('btn-admin-mode')?.classList.add('hide');
            this._setServerBtns(false);
            this._loadRoomList();
        } else {
            if (this.dom.loginOverlay) this.dom.loginOverlay.classList.add('hide');
            this._setServerBtns(true);
            this.renderUserProfile();
            this.updateNavForRole();
            if (!this.state.roomCode) {
                this._promptRoomCode();
            } else if (fromInit) {
                // 새로고침으로 세션 복원 시 서버에서 최신 데이터 자동 로드
                this.loadFromServer();
            }
        }
    },

    _setServerBtns(visible) {
        const save = document.getElementById('btn-server-save');
        const load = document.getElementById('btn-server-load');
        // 전체저장은 관리자만, ↺ 아이콘은 로그인한 모든 사용자
        if (save) save.style.display = (visible && this.state.isAdmin) ? 'inline-flex' : 'none';
        if (load) load.style.display = visible ? 'inline-flex' : 'none';
    },

    async _loadRoomList() {
        const sel = this.dom.loginRoomCode;
        if (!sel) return;
        sel.innerHTML = '<option value="">불러오는 중...</option>';
        try {
            const rooms = await FirebaseDB.listRooms();
            if (rooms.length === 0) {
                sel.innerHTML = '<option value="">생성된 학년이 없습니다</option>';
            } else {
                sel.innerHTML = '<option value="">학년을 선택해주세요</option>' +
                    rooms.map(r => `<option value="${r}">${r}</option>`).join('');
            }
        } catch (e) {
            sel.innerHTML = '<option value="">로드 실패 — 새로고침해주세요</option>';
        }
    },

    handleCreateRoom() {
        const overlay = document.getElementById('create-room-overlay');
        const schoolInput = document.getElementById('cr-school');
        const gradeSelect = document.getElementById('cr-grade');
        const previewCode = document.getElementById('cr-preview-code');
        const confirmBtn = document.getElementById('btn-cr-confirm');
        const errorBox = document.getElementById('cr-error');
        if (!overlay) return;

        const showError = (msg) => { errorBox.textContent = msg; errorBox.classList.remove('hide'); };
        const hideError = () => errorBox.classList.add('hide');

        // 초기화
        schoolInput.value = '';
        gradeSelect.value = '';
        previewCode.textContent = '—';
        confirmBtn.disabled = true;
        confirmBtn.textContent = '생성하기';
        hideError();
        overlay.classList.remove('hide');
        setTimeout(() => schoolInput.focus(), 50);

        const updatePreview = () => {
            const school = schoolInput.value.trim();
            const grade = gradeSelect.value;
            const code = school && grade ? `${school}${grade}` : '';
            previewCode.textContent = code || '—';
            confirmBtn.disabled = !code;
            hideError();
        };
        schoolInput.oninput = updatePreview;
        gradeSelect.onchange = updatePreview;

        const close = () => {
            overlay.classList.add('hide');
            schoolInput.oninput = null;
            gradeSelect.onchange = null;
            confirmBtn.onclick = null;
            document.getElementById('btn-cr-cancel').onclick = null;
            document.getElementById('btn-cr-close').onclick = null;
        };

        confirmBtn.onclick = async () => {
            const roomCode = previewCode.textContent;
            if (!roomCode || roomCode === '—') return;
            confirmBtn.disabled = true;
            confirmBtn.textContent = '생성 중...';
            try {
                const created = await FirebaseDB.createRoom(roomCode);
                if (!created) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = '생성하기';
                    showError(`"${roomCode}" 방은 이미 존재합니다.`);
                    return;
                }
                close();
                await this._loadRoomList();
                if (this.dom.loginRoomCode) {
                    this.dom.loginRoomCode.value = roomCode;
                    this.dom.loginRoomCode.dispatchEvent(new Event('change'));
                }
                this.showToast(`"${roomCode}" 학년이 생성되었습니다.`);
            } catch (e) {
                console.error('방 생성 오류:', e);
                confirmBtn.disabled = false;
                confirmBtn.textContent = '생성하기';
                showError('학년 생성 중 오류가 발생했습니다. 다시 시도해주세요.');
            }
        };

        document.getElementById('btn-cr-cancel').onclick = close;
        document.getElementById('btn-cr-close').onclick = close;
    },

    handleSuperAdmin() {
        const expectedPin = this.state.config?.adminPin || '0000';

        this.showPrompt('관리자 인증', '관리자 PIN 4자리를 입력해주세요.', 'password').then(pw => {
            if (pw === null) return;
            if (pw !== expectedPin) {
                this.showAlert('인증 실패', '관리자 PIN이 올바르지 않습니다.');
                return;
            }
            this.openRoomManager();
        });
    },

    async openRoomManager() {
        const overlay = document.getElementById('room-manage-overlay');
        const list = document.getElementById('rm-room-list');
        if (!overlay || !list) return;

        overlay.classList.remove('hide');
        list.innerHTML = '<li class="rm-loading">불러오는 중...</li>';

        const render = async () => {
            try {
                const rooms = await FirebaseDB.listRooms();
                if (rooms.length === 0) {
                    list.innerHTML = '<li class="rm-loading">생성된 방이 없습니다.</li>';
                    return;
                }
                list.innerHTML = rooms.map(r => `
                    <li class="rm-room-item">
                        <span class="rm-room-name">${r}</span>
                        <button class="rm-delete-btn" data-room="${r}">삭제</button>
                    </li>`).join('');
            } catch (e) {
                list.innerHTML = '<li class="rm-loading">로드 실패. 다시 시도해주세요.</li>';
            }
        };
        await render();

        list.onclick = async (e) => {
            const btn = e.target.closest('.rm-delete-btn');
            const cancelBtn = e.target.closest('.rm-cancel-btn');
            const confirmBtn = e.target.closest('.rm-confirm-btn');

            if (cancelBtn) {
                // 취소 → 원래 상태로 복원
                const item = cancelBtn.closest('.rm-room-item');
                const roomCode = item.dataset.room;
                item.innerHTML = `<span class="rm-room-name">${roomCode}</span><button class="rm-delete-btn" data-room="${roomCode}">삭제</button>`;
                return;
            }

            if (confirmBtn) {
                const item = confirmBtn.closest('.rm-room-item');
                const roomCode = item.dataset.room;
                confirmBtn.disabled = true;
                confirmBtn.textContent = '삭제 중...';
                try {
                    await FirebaseDB.deleteRoom(roomCode);
                    await render();
                    this._loadRoomList();
                    this.showToast(`"${roomCode}" 방이 삭제되었습니다.`);
                } catch (err) {
                    await render();
                    this.showToast('삭제 중 오류가 발생했습니다.');
                }
                return;
            }

            if (btn) {
                const roomCode = btn.dataset.room;
                const item = btn.closest('.rm-room-item');
                item.dataset.room = roomCode;
                item.innerHTML = `
                    <span class="rm-room-name rm-warn">⚠ "${roomCode}" 삭제할까요?</span>
                    <div style="display:flex;gap:6px;">
                        <button class="rm-cancel-btn" data-room="${roomCode}">취소</button>
                        <button class="rm-confirm-btn" data-room="${roomCode}">삭제 확인</button>
                    </div>`;
            }
        };

        const close = () => { overlay.classList.add('hide'); list.onclick = null; };
        document.getElementById('btn-rm-close').onclick = close;
        document.getElementById('btn-rm-done').onclick = close;
    },

    _promptRoomCode() {
        this.showPrompt('방 코드 입력', '방 코드를 입력해주세요.<br>(예: 한미소초4학년)').then(code => {
            if (!code || !code.trim()) return;
            this.state.roomCode = code.trim();
            this.saveData();
            this.loadFromServer();
        });
    },
    handleLogin() {
        const roomCode = this.dom.loginRoomCode.value.trim();
        const name = this.dom.loginName.value.trim();
        const rawClass = this.dom.loginClassNum.value.trim();
        const isSpecialist = rawClass === '전담';
        const classNum = isSpecialist ? '전담' : parseInt(rawClass);
        if (!roomCode) return this.showAlert('입력 오류', '방 코드를 입력해주세요.');
        if (!name) return this.showAlert('입력 오류', '성함을 입력해주세요.');
        if (!isSpecialist && (!classNum || classNum < 1)) return this.showAlert('입력 오류', '올바른 반 번호를 입력해주세요 (1 이상) 또는 전담을 입력하세요.');
        this.state.userProfile = { name, classNum, isSpecialist };
        this.state.roomCode = roomCode;
        this.state.isAdmin = false;
        this.saveData();
        this.checkLogin();
        this.loadFromServer().then(() => this._checkLocalMigration());
    },

    async _checkLocalMigration() {
        if (window._appMode !== 'server') return;

        // 이미 확인한 경우 다시 묻지 않음
        if (localStorage.getItem('jugan-local-migrated')) return;

        const localRaw = localStorage.getItem('jugan-local-room-MY_LOCAL_ROOM');
        if (!localRaw) return;

        let localData;
        try { localData = JSON.parse(localRaw); } catch { return; }

        // 로컬에 의미 있는 데이터가 있는지 확인 (학년 설정 또는 주차 데이터)
        const hasContent = localData.config?.grade ||
            Object.keys(localData.history || {}).some(w => {
                const wd = localData.history[w];
                return wd && Object.keys(wd.classes || {}).length > 0;
            });
        if (!hasContent) return;

        // 서버 방에 이미 데이터가 있으면 제안 안 함
        if (this.state.config?.grade) return;

        // 다시 묻지 않도록 먼저 플래그 저장
        localStorage.setItem('jugan-local-migrated', '1');

        const confirmed = await this.showConfirm(
            '로컬 데이터 발견',
            `혼자 사용 모드에서 저장한 데이터가 있습니다.<br><br>` +
            `서버 방 <b>${this.state.roomCode}</b>에 업로드하시겠습니까?<br><br>` +
            `<span style="color:#64748b;font-size:0.88rem;">※ 관리자 PIN 확인이 필요합니다.</span>`
        );
        if (!confirmed) return;

        // 로컬 데이터의 관리자 PIN으로 확인
        const pin = await this.showPinModal();
        if (pin === null) return;
        const expectedPin = localData.config?.adminPin || '0000';
        if (pin !== expectedPin) {
            return this.showAlert('오류', '관리자 PIN이 맞지 않습니다.');
        }

        // 로컬 데이터를 현재 state에 적용
        this.state = {
            ...this.state,
            config:         localData.config         || this.state.config,
            classSettings:  localData.classSettings  || {},
            specialists:    localData.specialists    || [],
            referenceBoards: localData.referenceBoards || [],
            maxWeek:        localData.maxWeek        || 1,
            history:        localData.history        || {},
            isAdmin: true
        };
        this.saveData();

        await this.saveToServer();
        this.renderTimetableLayout?.();
        this.calculateAndRenderValidationView?.();
    },
    handleLogout() {
        this.showConfirm('로그아웃', '로그아웃하면 현재 세션이 종료됩니다.<br>계속하시겠습니까?').then(res => {
            if (res) {
                this.state.userProfile = null;
                this.state.isAdmin = false;
                this.saveData();
                location.reload();
            }
        });
    },
    toggleAdminMode() {
        if (this.state.isAdmin) {
            this.state.isAdmin = false;
            this.saveData();
            this.updateNavForRole();
            this._setServerBtns(true);
            this.renderTimetableLayout();
        } else {
            this.showPinModal().then(pw => {
                if (pw === null) return;
                if (pw !== (this.state.config.adminPin || '0000')) {
                    // 틀렸을 때 PIN 박스 흔들기
                    const boxes = document.querySelectorAll('.pin-box');
                    boxes.forEach(b => { b.value = ''; b.classList.add('pin-error'); });
                    setTimeout(() => boxes.forEach(b => b.classList.remove('pin-error')), 600);
                    if (boxes[0]) boxes[0].focus();
                    return;
                }
                this.closeModal(false);
                this.state.isAdmin = true;
                this.saveData();
                this.updateNavForRole();
                this._setServerBtns(true);
                this.renderTimetableLayout();
            });
        }
    },
    showPinModal() {
        return new Promise(resolve => {
            this.dom.modalTitle.textContent = '관리자 모드';
            this.dom.modalContent.innerHTML = `
                <p style="font-size:0.88rem; color:#64748b; margin-bottom:20px;">관리자 비밀번호 4자리를 입력하세요.</p>
                <div class="pin-input-wrap">
                    <input class="pin-box" type="password" inputmode="numeric" maxlength="1" autocomplete="off">
                    <input class="pin-box" type="password" inputmode="numeric" maxlength="1" autocomplete="off">
                    <input class="pin-box" type="password" inputmode="numeric" maxlength="1" autocomplete="off">
                    <input class="pin-box" type="password" inputmode="numeric" maxlength="1" autocomplete="off">
                </div>`;
            this.dom.modalCancel.classList.remove('hide');
            this.dom.modalConfirm.textContent = '확인';
            this.dom.modalContainer.classList.remove('hide');

            const boxes = [...document.querySelectorAll('.pin-box')];
            boxes[0]?.focus();

            boxes.forEach((box, i) => {
                box.addEventListener('input', () => {
                    box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
                    if (box.value && i < 3) boxes[i + 1].focus();
                    if (boxes.every(b => b.value)) {
                        resolve(boxes.map(b => b.value).join(''));
                    }
                });
                box.addEventListener('keydown', e => {
                    if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
                });
            });

            this.modalResolve = (confirmed) => {
                if (!confirmed) resolve(null);
            };
        });
    },
    renderUserProfile() {
        if (this.state.userProfile && this.dom.userBadge) {
            this.dom.userBadge.classList.remove('hide');
            if (this.dom.userInfoText) {
                if (window._appMode === 'local') {
                    this.dom.userInfoText.textContent = '로컬 모드';
                } else {
                    const p = this.state.userProfile;
                    const displayName = String(p.name || '').endsWith('선생님') ? p.name : `${p.name} 선생님`;
                    this.dom.userInfoText.textContent = p.isSpecialist ? `전담 ${displayName}` : `${p.classNum}반 ${displayName}`;
                }
            }
            const adminBtn = document.getElementById('btn-admin-mode');
            if (adminBtn) adminBtn.classList.toggle('hide', window._appMode === 'local');
        }
    },
    updateNavForRole() {
        const isAdmin = this.state.isAdmin;
        const isLocalMode = window._appMode === 'local';
        const adminOnlyIds = ['btn-settings', 'btn-validation', 'btn-specialist', 'btn-timetable-all'];
        adminOnlyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hide', !isAdmin);
        });
        const adminBtn = document.getElementById('btn-admin-mode');
        if (adminBtn) {
            adminBtn.classList.toggle('active', isAdmin && !isLocalMode);
            adminBtn.classList.toggle('hide', isLocalMode);
            adminBtn.title = isAdmin ? '관리자 모드 해제' : '관리자 모드';
        }
        if (this.dom.userBadge) {
            this.dom.userBadge.classList.toggle('user-card-admin', isAdmin && !isLocalMode);
        }
        const colorSection = document.getElementById('color-highlighter-section');
        if (colorSection) colorSection.classList.toggle('hide', !isAdmin);
        const isSpecialist = !!this.state.userProfile?.isSpecialist;
        const spTeacherBtn = document.getElementById('btn-specialist-teacher');
        if (spTeacherBtn) spTeacherBtn.classList.toggle('hide', isLocalMode || !(isAdmin || isSpecialist));
        const timetableBtn = document.getElementById('btn-timetable');
        if (timetableBtn) timetableBtn.classList.toggle('hide', isLocalMode || (isSpecialist && !isAdmin));
        // 모드 전환 시 적절한 메뉴로 이동
        if (isLocalMode) {
            this.switchMenu('timetable-all');
        } else if (isSpecialist && !isAdmin) {
            this.switchMenu('specialist-teacher');
        } else if (isAdmin) {
            this.switchMenu('timetable-all');
        } else {
            this.switchMenu('timetable');
        }
    },

    async switchMenu(menuId) {
        this.dom.navs.forEach(nav => nav.classList.remove('active'));
        const activeNav = document.getElementById(`btn-${menuId}`);
        if (activeNav) activeNav.classList.add('active');
        // 전담 미저장 경고
        const currentMenu = document.querySelector('.nav-item.active')?.id?.replace('btn-', '');
        if (currentMenu === 'specialist' && menuId !== 'specialist' && this.state.isSpDirty) {
            const go = await this.showConfirm('전담 미저장 경고', '전담 데이터가 서버에 저장되지 않았습니다.<br>저장하지 않고 이동하면 다른 기기에 반영되지 않습니다.<br><br>그래도 이동하시겠습니까?');
            if (!go) return;
        }
        // timetable-all과 timetable은 같은 섹션을 공유하므로 중복 hide 방지
        const uniqueMenus = new Set(Object.values(this.dom.menus));
        uniqueMenus.forEach(v => { if(v) v.classList.add('hide'); });
        if (this.dom.menus[menuId]) this.dom.menus[menuId].classList.remove('hide');
        if (menuId === 'timetable') this.renderTimetableLayout('single');
        else if (menuId === 'timetable-all') this.renderTimetableLayout('all');
        else if (menuId === 'settings') this.renderSettingsView();
        else if (menuId === 'specialist') this.renderSpecialistView();
        else if (menuId === 'specialist-teacher') this.renderSpecialistTeacherView();
        else if (menuId === 'validation') this.calculateAndRenderValidationView();
    },

    showAlert(t, m) {
        return new Promise(resolve => {
            this.dom.modalTitle.textContent = t; this.dom.modalContent.innerHTML = `<div class="alert">${m}</div>`;
            this.dom.modalCancel.classList.add('hide'); this.dom.modalConfirm.textContent = '확인'; this.dom.modalContainer.classList.remove('hide'); this.modalResolve = resolve;
        });
    },
    showConfirm(t, m) {
        return new Promise(resolve => {
            this.dom.modalTitle.textContent = t; this.dom.modalContent.innerHTML = `<div>${m}</div>`;
            this.dom.modalCancel.classList.remove('hide'); this.dom.modalConfirm.textContent = '확인'; this.dom.modalContainer.classList.remove('hide'); this.modalResolve = resolve;
        });
    },
    showPrompt(t, m, type = 'text') {
        return new Promise(resolve => {
            this.dom.modalTitle.textContent = t;
            this.dom.modalContent.innerHTML = `<div style="margin-bottom:12px;">${m}</div><input id="modal-prompt-input" type="${type}" class="setting-input" style="width:100%;" autocomplete="off">`;
            this.dom.modalCancel.classList.remove('hide'); this.dom.modalConfirm.textContent = '확인'; this.dom.modalContainer.classList.remove('hide');
            const inp = document.getElementById('modal-prompt-input');
            if (inp) { inp.focus(); inp.addEventListener('keydown', e => { if (e.key === 'Enter') this.closeModal(true); }); }
            this.modalResolve = (confirmed) => resolve(confirmed ? (document.getElementById('modal-prompt-input')?.value ?? null) : null);
        });
    },
    closeModal(res) {
        this.dom.modalContainer.classList.add('hide');
        const modalEl = this.dom.modalContainer.querySelector('.modal');
        modalEl.classList.remove('modal-wide', 'modal-memo');
        if (this.modalResolve) { this.modalResolve(res); this.modalResolve = null; }
    },

    // ── 반별 저장 버튼 ──
    async saveClassToServer(classNum) {
        if (!this.state.roomCode) return this.showAlert('오류', '방 코드가 없습니다. 다시 로그인해주세요.');
        const btn = document.querySelector(`.btn-save-class[data-cls="${classNum}"]`);
        if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
        try {
            if (this.state.isAdmin) {
                await FirebaseDB.saveAdmin(this.state.roomCode, this.state);
                this.showToast('✅ 전체 데이터를 저장했습니다.');
            } else {
                await FirebaseDB.saveClass(this.state.roomCode, classNum, this.state);
                this.showToast(`✅ ${classNum}반 시간표를 저장했습니다.`);
            }
            this.state.isDirty = false;
            const allSaveBtns = document.querySelectorAll('.btn-save-class');
            allSaveBtns.forEach(b => { b.textContent = '저장'; b.style.background = ''; b.style.borderColor = ''; });
        } catch (e) {
            this.showToast('❌ 저장 실패: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; }
        }
    },

    // ── 전체 저장 (수동) ──
    async saveToServer() {
        if (!this.state.roomCode) return;
        const btn = this.dom.btnServerSave;
        if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
        try {
            await FirebaseDB.saveAdmin(this.state.roomCode, this.state);
            this.showToast('✅ 전체 저장 완료');
            const indicator = document.getElementById('autosave-indicator');
            if (indicator) { indicator.textContent = ''; clearTimeout(this._autosaveIndicatorTimer); }
        } catch (e) {
            this.showToast('❌ 저장 실패: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '💾 반별 시간표 저장'; }
        }
    },

    // ── 서버에서 불러오기 ──
    async loadFromServer() {
        if (!this.state.roomCode) return;
        const btn = this.dom.btnServerLoad;
        if (btn) { btn.disabled = true; btn.textContent = '불러오는 중...'; }
        try {
            const data = await FirebaseDB.load(this.state.roomCode);
            if (!data) {
                this.showToast('아직 저장된 데이터가 없습니다. 설정부터 시작해주세요.');
                return;
            }
            // 로그인 상태·UI 상태는 유지하고 나머지만 덮어씀
            const keep = { userProfile: this.state.userProfile, roomCode: this.state.roomCode, isAdmin: this.state.isAdmin, selectedSub: this.state.selectedSub, selectedSidebarColor: this.state.selectedSidebarColor, spPreviewOpen: false, isMarkingMode: false, isHelperMode: false, markingColor: this.state.markingColor };
            this.state = { ...this.state, ...data, ...keep };
            // 새 방이거나 서버에 과목이 없으면 기본 과목 적용
            if (!this.state.config) this.state.config = { grade: '', classCount: 4, periods: { "월": 6, "화": 6, "수": 5, "목": 6, "금": 6 }, subjects: [] };
            if (!this.state.config.subjects || this.state.config.subjects.length === 0) {
                const defaults = ["국어", "사회", "도덕", "수학", "과학", "체육", "음악", "미술", "영어", "자율", "동아리", "봉사", "진로"];
                this.state.config.subjects = defaults.map(s => ({ name: s, blockSize: (s === '미술' || s === '실과') ? 2 : 1 }));
            }
            if (!this.state.referenceBoards || this.state.referenceBoards.length === 0) {
                this.state.referenceBoards = [
                    { name: '참고 시간표 1', data: {}, marks: {} },
                    { name: '참고 시간표 2', data: {}, marks: {} }
                ];
            }
            if (!this.state.specialists || this.state.specialists.length === 0) {
                this.state.specialists = [
                    { subject: '전담 1', desc: '', data: {}, marks: {}, bg: '#ffffff' },
                    { subject: '전담 2', desc: '', data: {}, marks: {}, bg: '#ffffff' }
                ];
            }
            // maxWeek에 맞춰 주차 데이터 초기화 보정
            for (let w = 1; w <= this.state.maxWeek; w++) this.initWeekData(w);
            // 마이그레이션: 기존 state.specialists(전역) → 주차별 history[w].specialists
            if (this.state.specialists && this.state.specialists.length > 0) {
                for (let w = 1; w <= (this.state.maxWeek || 1); w++) {
                    if (this.state.history[w] && (!this.state.history[w].specialists || this.state.history[w].specialists.length === 0)) {
                        this.state.history[w].specialists = JSON.parse(JSON.stringify(this.state.specialists));
                    }
                }
            }
            // 항상 최신 주차로 이동
            this.state.currentWeek = this.state.maxWeek;
            // 이 주차에 전담 배정을 아직 한 번도 반영한 적 없으면(예: 배포 직후 첫 접속) 여기서 채움.
            // 이미 채운 적 있는 주차는 건드리지 않음 — 사람이 지운 칸이 되살아나지 않게.
            const curWData = this.state.history[this.state.currentWeek];
            if (curWData && !curWData.specialistAutofilled) {
                this._autofillSpecialistsForWeek(this.state.currentWeek);
            }
            this.saveData();
            this.renderTimetableLayout();
            this.calculateAndRenderValidationView?.();
            const who = data.lastSavedBy ? `(${data.lastSavedBy} 저장본)` : '';
            this.showToast(`✅ 서버에서 불러오기 완료 ${who}`);
        } catch (e) {
            this.showToast('❌ 불러오기 실패: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '↓ 새로고침'; }
            this._setServerBtns(true);
        }
    },

    // ── 토스트 알림 ──
    showToast(msg, duration = 3500) {
        let toast = document.getElementById('app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.className = 'app-toast app-toast-show';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { toast.className = 'app-toast'; }, duration);
    },

    /* --- 사용 설명서 --- */
    showGuide() {
        const h = `
            <div style="font-size:0.88rem; line-height:1.75; color:#334155;">
                <div style="margin-bottom:18px; padding:12px 14px; background:#eef2ff; border-radius:10px; border:1px solid #e0e7ff;">
                    <b style="color:#4338ca;">추천 사용 순서</b><br>
                    <b>1. 설정 → 2. 시수확인 → 3. 전담배정</b>은 학기 초에 한 번 세팅해두면 평소엔 거의 안 건드려도 됩니다.<br>
                    매주 실제로 쓰는 화면은 <b>4. 전체 시간표</b> 하나예요.
                </div>

                <h4 style="margin:0 0 6px; color:#1e293b;">1. 설정</h4>
                <p style="margin:0 0 14px; color:#64748b;">학년, 학급 수, 요일별 교시 수, 사용할 과목 목록을 등록합니다. 학기 초에 한 번만 하면 됩니다.</p>

                <h4 style="margin:0 0 6px; color:#1e293b;">2. 시수확인</h4>
                <p style="margin:0 0 14px; color:#64748b;">과목별 목표 시수를 등록하고, 지금까지 실제로 배정된 시수와 비교해서 확인하는 화면입니다.</p>

                <h4 style="margin:0 0 6px; color:#1e293b;">3. 전담배정</h4>
                <p style="margin:0 0 14px; color:#64748b;">
                    영어·체육처럼 전담 선생님이 가르치는 과목을 어느 요일·교시에 몇 반이 듣는지, 표 안에 <b>반 번호</b>로 미리 입력해두는 곳입니다.<br>
                    예: 화요일 3교시 칸에 "1"이라고 적으면 → 1반이 그 시간에 이 전담 수업을 듣는다는 뜻이에요.<br>
                    여기서는 입력만 해두고, 실제 시간표 반영은 <b>4. 전체 시간표</b>에서 합니다.
                </p>

                <h4 style="margin:0 0 6px; color:#1e293b;">4. 전체 시간표 — 매주 이 화면만 쓰면 됩니다</h4>
                <ol style="margin:0 0 14px; padding-left:20px; color:#475569;">
                    <li style="margin-bottom:6px;"><b>📥 이번 주 전담과목 가져오기</b> — 3번에서 입력해둔 전담 과목 중, 이번 주에 실제로 있는 과목만 골라 "가져오기"를 누릅니다. (이번 주에 없거나 줄어든 과목은 안 누르면 돼요)</li>
                    <li style="margin-bottom:6px;"><b>📌 주간 공통 과목 고정</b> — 안전교육, 방송조회처럼 모든 반이 같은 요일·교시에 똑같이 하는 시간이 있으면, 요일·교시·과목을 고르고 "전체 반 고정 배정"을 누르세요.</li>
                    <li style="margin-bottom:6px;"><b>이번 주 목표 차시 입력</b> — 위 두 가지를 가져오면 해당 과목의 목표 차시가 자동으로 채워집니다. 국어·수학 등 나머지 과목의 이번 주 목표 차시를 표에 직접 입력하세요.</li>
                    <li style="margin-bottom:6px;"><b>전체 랜덤 배정</b> — 목표 차시를 다 입력했으면 눌러주세요. 나머지 빈 칸에 과목이 자동으로 배치됩니다. <b>이미 채워진 전담·고정배정 칸은 절대 건드리지 않으니</b> 안심하고 눌러도 됩니다.</li>
                    <li style="margin-bottom:6px;"><b>세부 수정</b> — 특정 칸만 직접 바꾸고 싶으면, 왼쪽 "과목 직접 입력하기"에서 과목을 클릭한 뒤 시간표의 원하는 칸을 클릭하면 그 자리에 채워집니다.</li>
                    <li><b>📄 주간학습안내</b> — 완성된 시간표를 학생·학부모용 안내문 형태로 출력합니다.</li>
                </ol>

                <h4 style="margin:0 0 6px; color:#1e293b;">알아두면 좋은 것들</h4>
                <ul style="margin:0; padding-left:20px; color:#64748b;">
                    <li style="margin-bottom:6px;">전담·고정배정으로 채워진 칸은 잠겨 있어서, 클릭해도 바로 안 바뀌고 한 번 더 확인을 물어봅니다.</li>
                    <li style="margin-bottom:6px;">"랜덤 배정 선호 시간 설정"에서 반마다 특정 과목을 오전/오후 등 원하는 시간대에 우선 배치하도록 정할 수 있습니다.</li>
                    <li>"로컬 모드"는 이 브라우저에만 데이터가 저장됩니다. 다른 기기나 브라우저에서는 보이지 않아요.</li>
                </ul>
            </div>
        `;
        this.dom.modalTitle.textContent = '📖 사용 설명서';
        this.dom.modalContent.innerHTML = h;
        this.dom.modalCancel.classList.add('hide');
        this.dom.modalConfirm.textContent = '닫기';
        this.dom.modalContainer.classList.remove('hide');
        this.dom.modalContainer.querySelector('.modal').classList.add('modal-wide');
        this.modalResolve = null;
    },

    /* --- Smart Assignment Modal --- */
    showAssignmentModal() {
        return new Promise(resolve => {
            const weekData = this.state.history[this.state.currentWeek], targets = weekData.targets;
            const subjects = this.state.config.subjects, classCount = this.state.config.classCount;

            // 현재 시간표에 입력된 과목별 차시 수 집계 → 반당 평균
            const filledCounts = {};
            subjects.forEach(s => filledCounts[s.name] = 0);
            for (let c = 1; c <= classCount; c++) {
                const cd = weekData.classes[c] || {};
                this.days.forEach(d => {
                    (cd[d] || []).forEach(v => { if (v && filledCounts[v] !== undefined) filledCounts[v]++; });
                });
            }
            // 전체 합계 → 반당 평균 (정수)
            subjects.forEach(s => {
                filledCounts[s.name] = classCount > 0 ? Math.round(filledCounts[s.name] / classCount) : 0;
            });

            let h = `<div class="assignment-setup">
                <p style="font-size:0.82rem; color:#64748b; margin-bottom:14px;">배정할 과목을 선택하세요. 랜덤 배정 차시 = 이번 주 목표 − 이미 배정된 차시 (반당 평균)</p>
                <div style="max-height:380px; overflow-y:auto; border:1px solid #e5e7eb; border-radius:10px;">
                <table style="width:100%; font-size:0.83rem; border-collapse:collapse;">
                <thead style="background:#f8fafc; position:sticky; top:0;">
                <tr style="border-bottom:1px solid #e5e7eb;">
                  <th style="padding:10px 8px; text-align:left; width:32px;"><input type="checkbox" id="assign-select-all" checked></th>
                  <th style="padding:10px 8px; text-align:left;">과목</th>
                  <th style="padding:10px 8px; text-align:center; color:#64748b;">이번 주 목표</th>
                  <th style="padding:10px 8px; text-align:center; color:#64748b;">이미 배정</th>
                  <th style="padding:10px 8px; text-align:center; color:#059669; font-weight:700;">랜덤 배정</th>
                  <th style="padding:10px 8px; text-align:center; color:#64748b;">연차시</th>
                </tr></thead><tbody>`;

            subjects.forEach(sObj => {
                const sub = sObj.name;
                const weekly = targets[sub] || 0;
                const filled = filledCounts[sub] || 0;
                const rand = Math.max(0, weekly - filled);
                const dim = rand === 0 ? 'opacity:0.4;' : '';
                h += `<tr style="border-bottom:1px solid #f1f5f9; ${dim}">
                    <td style="padding:10px 8px;"><input type="checkbox" class="assign-subject-chk" data-sub="${sub}" ${rand > 0 ? 'checked':''}></td>
                    <td style="padding:10px 8px; font-weight:600;">${sub}</td>
                    <td style="padding:10px 8px; text-align:center;">${weekly}차시</td>
                    <td style="padding:10px 8px; text-align:center; color:#64748b;">${filled > 0 ? filled + '차시' : '—'}</td>
                    <td style="padding:10px 8px; text-align:center; font-weight:700; color:${rand > 0 ? '#059669' : '#94a3b8'};">${rand}차시</td>
                    <td style="padding:10px 8px; text-align:center;">
                        <select class="assign-block-size" data-sub="${sub}" style="padding:4px 6px; border:1px solid #e2e8f0; border-radius:6px; font-size:0.8rem;">
                            <option value="1" ${sObj.blockSize <= 1 ? 'selected':''}>단독</option>
                            <option value="2" ${sObj.blockSize === 2 ? 'selected':''}>2차시</option>
                            <option value="3" ${sObj.blockSize === 3 ? 'selected':''}>3차시</option>
                        </select>
                    </td>
                </tr>`;
            });

            h += `</tbody></table></div></div>`;
            this.dom.modalTitle.textContent = '전체 랜덤 배정';
            this.dom.modalContent.innerHTML = h;
            this.dom.modalCancel.classList.remove('hide');
            this.dom.modalConfirm.textContent = '배정 시작';
            this.dom.modalContainer.classList.remove('hide');
            const sa = document.getElementById('assign-select-all');
            if (sa) sa.addEventListener('change', (e) => { document.querySelectorAll('.assign-subject-chk').forEach(chk => chk.checked = e.target.checked); });
            this.modalResolve = (conf) => {
                if (!conf) return resolve(null);
                const sel = [];
                document.querySelectorAll('.assign-subject-chk').forEach(chk => {
                    if (chk.checked) {
                        const sub = chk.dataset.sub, bs = parseInt(document.querySelector(`.assign-block-size[data-sub="${sub}"]`).value);
                        sel.push({ name: sub, blockSize: bs });
                    }
                });
                resolve(sel);
            };
        });
    },
    randomAssignAll() { this.showAssignmentModal().then(c => { if(c && c.length > 0) this.executeRandomAssign(c); }); },
    // 과목명 첫 글자가 같으면 같은 계열(예: 체육/체(운)/체(강), 국어/국(도))로 보고 같은 날 중복 배정을 피함
    _subjectFamily(name) { return (name || '').charAt(0); },

    executeRandomAssign(selected) {
        const weekData = this.state.history[this.state.currentWeek], targets = weekData.targets;
        for (let c = 1; c <= this.state.config.classCount; c++) {
            const cd = weekData.classes[c], cur = {}, pd = {}, famDays = {}; selected.forEach(s => { cur[s.name] = 0; pd[s.name] = []; });
            const markFamily = (sub, d) => {
                const fc = this._subjectFamily(sub);
                if (!famDays[fc]) famDays[fc] = new Set();
                famDays[fc].add(d);
            };
            const famBlocked = (sub, d) => {
                const fc = this._subjectFamily(sub);
                return !!(famDays[fc] && famDays[fc].has(d));
            };
            this.days.forEach(d => { const mp = this.state.config.periods[d]; if(!cd[d]) cd[d] = []; for(let p=0; p<mp; p++){ const v = cd[d][p]; if(v) { if (cur[v] !== undefined) { cur[v]++; if(!pd[v].includes(d)) pd[v].push(d); } markFamily(v, d); } } });

            const blks = [], sngs = [];
            selected.forEach(sO => {
                const sub = sO.name, need = Math.max(0, (targets[sub]||0) - cur[sub]);
                const cfgSub = this.state.config.subjects.find(s => s.name === sub);
                // 반별 설정이 있으면 우선 적용, 없으면 전역 설정 사용
                const classOverride = (this.state.classSettings[c] || {})[sub];
                const pref = classOverride?.preferredSlot !== undefined
                    ? classOverride.preferredSlot
                    : (cfgSub ? (cfgSub.preferredSlot || 0) : 0);
                let t = (sub.includes('국어') || sub.includes('수학')) ? 1 : ((sub.includes('사회') || sub.includes('과학')) ? 2 : 3);

                if (sO.blockSize > 1) {
                    for(let i=0; i<Math.floor(need / sO.blockSize); i++) blks.push({ name: sub, tier: t, size: sO.blockSize, pref });
                    for(let i=0; i<(need % sO.blockSize); i++) sngs.push({ name: sub, tier: t, pref });
                } else {
                    for(let i=0; i<need; i++) sngs.push({ name: sub, tier: t, pref });
                }
            });

            const shf = (a) => a.sort(() => Math.random() - 0.5); shf(blks); shf(sngs);

            const ass = (sub, size, ps, pe) => {
                const sd = [...this.days].sort(() => Math.random() - 0.5);
                // 1순위: 선호 시간대 + 같은 날 중복 없음 + 같은 계열 겹침 없음
                for (let d of sd) { if (pd[sub].includes(d) || famBlocked(sub, d)) continue; const mp = this.state.config.periods[d]; for (let p = ps; p <= Math.min(pe, mp - size); p++) { let ok = true; for(let k=0; k<size; k++) if(cd[d][p+k]) ok = false; if(ok) { for(let k=0; k<size; k++) cd[d][p+k] = sub; pd[sub].push(d); markFamily(sub, d); return true; } } }
                // 2순위: 전체 시간대 + 같은 날 중복 없음 + 같은 계열 겹침 없음
                for (let d of sd) { if (pd[sub].includes(d) || famBlocked(sub, d)) continue; const mp = this.state.config.periods[d]; for (let p = 0; p <= mp - size; p++) { let ok = true; for(let k=0; k<size; k++) if(cd[d][p+k]) ok = false; if(ok) { for(let k=0; k<size; k++) cd[d][p+k] = sub; pd[sub].push(d); markFamily(sub, d); return true; } } }
                // 3순위: 같은 날 중복은 피하되, 같은 계열 겹침은 허용(빈 칸 부족 시 차선)
                for (let d of sd) { if (pd[sub].includes(d)) continue; const mp = this.state.config.periods[d]; for (let p = 0; p <= mp - size; p++) { let ok = true; for(let k=0; k<size; k++) if(cd[d][p+k]) ok = false; if(ok) { for(let k=0; k<size; k++) cd[d][p+k] = sub; pd[sub].push(d); markFamily(sub, d); return true; } } }
                // 최후 수단: 빈 칸이면 어디든 배치
                for (let d of sd) { const mp = this.state.config.periods[d]; for (let p = 0; p <= mp - size; p++) { let ok = true; for(let k=0; k<size; k++) if(cd[d][p+k]) ok = false; if(ok) { for(let k=0; k<size; k++) cd[d][p+k] = sub; markFamily(sub, d); return true; } } }
                if (size > 1) { for(let i=0; i<size; i++) ass(sub, 1, ps, pe); return true; } return false;
            };

            const getBounds = (pref) => {
                if (pref === 1) return [0, 1]; // 1-2교시
                if (pref === 2) return [2, 3]; // 3-4교시
                if (pref === 3) return [4, 5]; // 5-6교시
                return [0, 5]; // 기본: 전체 시간대
            };

            blks.forEach(item => { const b = getBounds(item.pref); ass(item.name, item.size, b[0], b[1]); });
            sngs.forEach(item => { const b = getBounds(item.pref); ass(item.name, 1, b[0], b[1]); });
        }
        this.saveData(); this.renderTimetableLayout(); this.showAlert('배정 완료', '선호 시간대와 과목 계열(같은 첫 글자) 중복을 피해서 전체 반 배정이 완료되었습니다.');
    },

    /* --- 반별 랜덤 배정 설정 카드 --- */
    renderRandomSettingsCard(classNum) {
        const subs = this.state.config.subjects;
        const cs = this.state.classSettings[classNum] || {};

        const slotOptions = (cur) => [
            [0,'기본 (자동)'], [1,'1-2교시 선호'], [2,'3-4교시 선호'], [3,'5-6교시 선호']
        ].map(([v,l]) => `<option value="${v}" ${cur==v?'selected':''}>${l}</option>`).join('');

        let rows = subs.map(s => {
            const ov = cs[s.name] || {};
            const pref = ov.preferredSlot !== undefined ? ov.preferredSlot : (s.preferredSlot || 0);
            return `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:10px 14px; font-weight:600; color:var(--text-main);">${s.name}</td>
                <td style="padding:10px 14px;">
                    <select style="width:100%; padding:7px 10px; border:1.5px solid #e2e8f0; border-radius:8px; font-size:0.85rem; background:#f8fafc;"
                        onchange="App.saveClassSetting(${classNum},'${s.name}','preferredSlot',+this.value)">${slotOptions(pref)}</select>
                </td>
            </tr>`;
        }).join('');

        return `<div class="card" style="margin-top:0;">
            <div class="section-header" style="padding-bottom:12px;">
                <div>
                    <h3 style="font-size:0.95rem; font-weight:700;">랜덤 배정 선호 시간 설정</h3>
                    <p class="subtitle" style="font-size:0.8rem; margin-top:3px;">관리자가 전체 랜덤 배정 시 이 설정이 우리 반에 적용됩니다. 매주 유지됩니다.</p>
                </div>
            </div>
            <div style="border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;">
            <table style="width:100%; font-size:0.85rem; border-collapse:collapse;">
                <thead style="background:#f8fafc; border-bottom:1px solid #e5e7eb;">
                <tr>
                    <th style="padding:10px 14px; text-align:left; color:#64748b; font-weight:600;">과목</th>
                    <th style="padding:10px 14px; text-align:left; color:#64748b; font-weight:600;">선호 시간대</th>
                </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        </div>`;
    },
    _unlockSpCell(input) {
        input.removeAttribute('readonly');
        input.removeAttribute('data-sp-locked');
        input.removeAttribute('title');
        input.classList.remove('sp-locked');
        // 상태에서도 잠금 해제
        const cNum = input.dataset.cls, d = input.dataset.day, p = parseInt(input.dataset.idx);
        const sc = this.state.history[this.state.currentWeek].specialistCells;
        if (sc?.[cNum]?.[d]) delete sc[cNum][d][p];
        this.saveData();
    },

    saveClassSetting(classNum, subName, field, value) {
        if (!this.state.classSettings[classNum]) this.state.classSettings[classNum] = {};
        if (!this.state.classSettings[classNum][subName]) this.state.classSettings[classNum][subName] = {};
        this.state.classSettings[classNum][subName][field] = value;
        this.saveData();
    },

    async saveWeeklyMemo(val) {
        const wData = this.state.history[this.state.currentWeek];
        if (!wData) return;
        wData.weeklyMemo = val;
        this.saveData();
        // 반별 시간표의 인라인 textarea도 동기화
        const inlineTA = document.getElementById('weekly-memo-textarea');
        if (inlineTA && inlineTA.value !== val) inlineTA.value = val;
        if (this.state.roomCode) {
            try {
                await FirebaseDB.saveAdmin(this.state.roomCode, this.state);
                this.showToast('✅ 전달사항이 저장되었습니다.');
            } catch (e) {
                this.showToast('❌ 서버 저장 실패: ' + e.message);
            }
        } else {
            this.showToast('전달사항이 저장되었습니다.');
        }
    },

    openWeeklyMemoModal() {
        const week = this.state.currentWeek;
        const memo = this.state.history[week]?.weeklyMemo || '';
        const modalEl = this.dom.modalContainer.querySelector('.modal');
        this.dom.modalTitle.textContent = `${week}주차 전달사항 및 특이사항`;
        this.dom.modalContent.innerHTML = `
            <p style="font-size:0.82rem; color:#94a3b8; margin-bottom:10px;">반별 시간표에 표시됩니다. 저장 후 전체 저장을 눌러 공유하세요.</p>
            <textarea id="memo-modal-textarea"
                style="width:100%; min-height:160px; padding:12px 14px; border:1.5px solid #e2e8f0; border-radius:8px; font-size:0.9rem; resize:vertical; box-sizing:border-box; font-family:inherit; color:#374151; line-height:1.7;"
                placeholder="이번 주 전달사항이나 특이사항을 입력하세요...">${memo}</textarea>`;
        modalEl.classList.add('modal-memo');
        this.dom.modalCancel.classList.remove('hide');
        this.dom.modalConfirm.textContent = '저장';
        this.dom.modalContainer.classList.remove('hide');
        const ta = document.getElementById('memo-modal-textarea');
        if (ta) ta.focus();
        this.modalResolve = (confirmed) => {
            modalEl.classList.remove('modal-memo');
            if (confirmed) {
                const val = document.getElementById('memo-modal-textarea')?.value ?? '';
                this.saveWeeklyMemo(val);
            }
        };
    },

    /* --- Timetable Render --- */
    // 상단 "이번 주 목표" 표만 다시 그림 (반별 시간표 입력칸은 그대로 두어 포커스가 끊기지 않게)
    _renderTargetBar(mode) {
        if (!mode) mode = this._timetableMode || 'all';
        this._syncSpecialistTargets(this.state.currentWeek);
        const tgts = this.state.history[this.state.currentWeek].targets, subs = this.state.config.subjects;
        let th = `<div class="target-table-wrapper"><table class="target-table"><thead><tr><th>목표 차시</th>`;
        subs.forEach(s => th += `<th>${s.name}</th>`);
        th += `<th>합계</th></tr></thead><tbody><tr><td class="target-row-label">이번 주 목표</td>`;
        const targetReadonly = (mode === 'single');
        let tv = 0;
        subs.forEach(s => {
            const isAuto = this._isSpecialistManagedSubject(s.name);
            const locked = targetReadonly || isAuto;
            const cls = `target-input-global target-cell-input${locked ? ' target-locked' : ''}${isAuto ? ' target-auto' : ''}`;
            const title = isAuto
                ? '전담 배정에서 자동으로 계산됩니다. 반별 시간표에서 칸을 지우면 여기도 같이 줄어듭니다.'
                : (targetReadonly ? '관리자만 목표 차시를 변경할 수 있습니다.' : '');
            th += `<td><input type="text" inputmode="numeric" class="${cls}" data-sub="${s.name}" value="${tgts[s.name] || 0}"${locked ? ' readonly' : ''}${title ? ` title="${title}"` : ''}></td>`;
            tv += tgts[s.name] || 0;
        });
        th += `<td class="total-val">${tv}</td></tr></tbody></table></div>`;
        this.dom.weekTargetContainer.innerHTML = th;
    },

    renderTimetableLayout(mode) {
        // mode가 없으면 현재 활성 메뉴 기준으로 판단
        if (!mode) {
            const activeNav = document.querySelector('.nav-item.active');
            mode = activeNav?.id === 'btn-timetable-all' ? 'all' : 'single';
        }
        this._timetableMode = mode;
        this.dom.weekLabel.textContent = `${this.state.currentWeek}주차 시간표`;
        this.updateWeekDateDisplay();
        this.renderWeekBookmarks();
        this._renderTargetBar(mode);

        // 전체 시간표(all): 모든 반, 반별 시간표(single): 자기 반만
        const classesToRender = mode === 'all'
            ? Array.from({ length: this.state.config.classCount }, (_, i) => i + 1)
            : [this.state.userProfile?.classNum].filter(Boolean);

        let lh = '';
        for (const c of classesToRender) {
            const isLast = (c === classesToRender[classesToRender.length - 1]);
            if (mode === 'single') {
                // 반별 시간표: 왼쪽(시간표+전달사항) / 오른쪽(차시확인+랜덤배정) 컬럼 구조
                const weeklyMemo = this.state.history[this.state.currentWeek].weeklyMemo || '';
                const memoBody = weeklyMemo
                    ? `<p id="weekly-memo-textarea" style="font-size:0.88rem; color:#374151; white-space:pre-wrap; line-height:1.7; padding:4px 0;">${weeklyMemo}</p>`
                    : `<p style="font-size:0.85rem; color:#94a3b8; padding:4px 0;">이번 주 전달사항이 없습니다.</p>`;
                lh += `
                <div class="integrated-layout" style="align-items:flex-start;">
                    <div style="flex:3; min-width:0; display:flex; flex-direction:column; gap:16px;">
                        <div class="card" style="margin-bottom:0;">
                            <div class="section-header" style="padding-bottom:10px;">
                                <h3><span class="active-class-name">${c}반</span> 시간표</h3>
                                <div style="display:flex;gap:6px;align-items:center;">
                                    <button class="btn-secondary btn-sm" onclick="App.copyClassTable(${c}, this)" title="표를 복사해 Word에 붙여넣기">복사</button>
                                    ${this.state.isAdmin ? `<button class="btn-clear-class-admin btn-secondary btn-sm" data-cls="${c}" onclick="App.clearClass(${c})">삭제</button>` : ''}
                                    ${this.state.isAdmin || String(this.state.userProfile?.classNum) === String(c) ? `<button class="btn-save-class btn-primary-small" data-cls="${c}" onclick="App.saveClassToServer(${c})">저장</button>` : ''}
                                </div>
                            </div>
                            <div class="table-responsive mt-2">
                                <table class="excel-table">${this.getTimetableGridHtml(c)}</table>
                            </div>
                        </div>
                        <div class="card" style="margin-bottom:0;">
                            <div class="section-header" style="padding-bottom:10px;">
                                <h3 style="font-size:0.95rem; font-weight:700;">주차 전달사항 및 특이사항</h3>
                            </div>
                            ${memoBody}
                        </div>
                    </div>
                    <div style="flex:1.5; min-width:0; position:sticky; top:80px; display:flex; flex-direction:column; gap:16px;">
                        <div class="card" style="margin-bottom:0;">
                            <div class="section-header" style="padding-bottom:10px;">
                                <h3>차시 확인</h3>
                            </div>
                            <div class="table-responsive mt-2">
                                <table class="excel-table val-table" id="val-grid-${c}"></table>
                            </div>
                        </div>
                        ${this.renderRandomSettingsCard(c)}
                    </div>
                </div>`;
            } else {
                // 전체 시간표(all): 기존 레이아웃 유지
                lh += `
                <div class="integrated-layout" style="${isLast ? '' : 'border-bottom: 1.5px solid #f1f5f9; margin-bottom: 20px; padding-bottom: 20px;'}">
                    <div class="timetable-section card" style="margin-bottom:0; min-height:480px; height:480px;">
                        <div class="section-header" style="padding-bottom:10px;">
                            <h3><span class="active-class-name">${c}반</span> 시간표</h3>
                            <div style="display:flex;gap:6px;align-items:center;">
                                <button class="btn-secondary btn-sm" onclick="App.copyClassTable(${c}, this)" title="표를 복사해 Word에 붙여넣기">복사</button>
                                ${this.state.isAdmin ? `<button class="btn-clear-class-admin btn-secondary btn-sm" data-cls="${c}" onclick="App.clearClass(${c})">삭제</button>` : ''}
                                ${this.state.isAdmin || String(this.state.userProfile?.classNum) === String(c) ? `<button class="btn-save-class btn-primary-small" data-cls="${c}" onclick="App.saveClassToServer(${c})">저장</button>` : ''}
                            </div>
                        </div>
                        <div class="table-responsive mt-2">
                            <table class="excel-table">${this.getTimetableGridHtml(c)}</table>
                        </div>
                    </div>
                    <div class="validation-section card" style="margin-bottom:0; min-height:480px; height:480px;">
                        <div class="section-header" style="padding-bottom:10px;">
                            <h3>차시 확인</h3>
                        </div>
                        <div class="table-responsive mt-2">
                            <table class="excel-table val-table" id="val-grid-${c}"></table>
                        </div>
                    </div>
                </div>`;
            }
        }

        if (this.dom.allClassesContainer) {
            this.dom.allClassesContainer.style.display = 'block';
            this.dom.allClassesContainer.innerHTML = lh;
        }
        // 관리자 전용 버튼: 전체 시간표(all) 모드 + 관리자일 때만 표시
        const adminOnlyBtns = ['btn-clear-all', 'btn-create-week', 'btn-weekly-memo', 'btn-random-all', 'btn-server-save', 'fixed-slots-card'];
        adminOnlyBtns.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hide', mode !== 'all' || !this.state.isAdmin);
        });
        if (mode === 'all' && this.state.isAdmin) {
            this.renderFixedSlotsCard();
        }
        this.renderAllValidationGrids();
        this.renderSubjectPalette();
    },
    renderSubjectPalette() {
        if (!this.dom.palette) return;
        const subs = this.state.config.subjects;
        const weekData = this.state.history[this.state.currentWeek];
        const targets = weekData.targets;
        
        // Count current assignments in this week
        const counts = {}; subs.forEach(s => counts[s.name] = 0);
        for (let c = 1; c <= this.state.config.classCount; c++) {
            const cd = weekData.classes[c] || { "월":[], "화":[], "수":[], "목":[], "금":[] };
            this.days.forEach(d => { if(cd[d]) cd[d].forEach(v => { if(v && counts[v] !== undefined) counts[v]++; }); });
        }

        let h = '';
        subs.forEach(s => {
            const sub = s.name;
            const targetTotal = (targets[sub] || 0) * this.state.config.classCount;
            const currentTotal = counts[sub];
            const isActive = this.state.selectedSub === sub;
            h += `
                <div class="palette-card ${isActive ? 'active' : ''}" data-sub="${sub}">
                    ${sub}
                </div>`;
        });
        this.dom.palette.innerHTML = h;
        
        const display = document.getElementById('selected-sub-display');
        if (display) display.textContent = this.state.selectedSub ? `✓ "${this.state.selectedSub}" 선택됨` : '';
    },

    getTimetableGridHtml(c) {
        const wData = this.state.history[this.state.currentWeek];
        if (!wData.classes[c]) {
            wData.classes[c] = { "월":[], "화":[], "수":[], "목":[], "금":[] };
        }
        const data = wData.classes[c], maxP = Math.max(...Object.values(this.state.config.periods));
        const spCells = wData.specialistCells || {};
        let h = `<thead><tr><th width="40">교시</th>${this.days.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>`;
        for (let p=0; p<maxP; p++) {
            h += `<tr><td class="col-head">${p+1}</td>`;
            this.days.forEach(d => {
                if (p < this.state.config.periods[d]) {
                    const val = data[d][p] || '';
                    const isSpLocked = !!(spCells[c]?.[d]?.[p]);
                    let s = '';
                    const customBg = wData.bgColors?.[c]?.[d]?.[p] ?? null;

                    if (customBg) {
                        s = `style="background-color:${customBg}; font-weight:bold;"`;
                    } else if (val && isSpLocked) {
                        // 전담 가져오기로 채워진 셀만 전담 색상 적용 (해당 반·교시에 배정한 보드 기준)
                        const sp = this._spForCell(c, d, p);
                        if (sp && sp.bg) s = `style="background-color:${sp.bg}; color:${sp.color || '#000'}; font-weight:bold;"`;
                    }
                    const lockAttr = isSpLocked ? ' data-sp-locked="1" readonly title="전담 시간 (클릭하면 수정 확인)"' : '';
                    const lockClass = isSpLocked ? ' sp-locked' : '';
                    const bgLockAttr = (customBg && !this.state.isAdmin) ? ' data-bg-locked="1" title="관리자가 지정한 색상 구역 (클릭하면 수정 확인)"' : '';
                    h += `<td><input type="text" class="cell-input${lockClass}" ${s} data-cls="${c}" data-day="${d}" data-idx="${p}" value="${val}"${lockAttr}${bgLockAttr}></td>`;
                } else h += `<td style="background:#d1d5db; cursor:not-allowed;" title="${p+1}교시는 ${d}요일 수업 없음"></td>`;
            });
            h += `</tr>`;
        }
        return h + '</tbody>';
    },

    /* --- 1단계: 반별 시간표 크게 보기·정리 (타일 보드) --- */
    openTileStep() {
        this.state.tileSel = null;
        document.getElementById('tile-step-overlay').classList.remove('hide');
        this.renderTileStep();
    },
    closeTileStep() {
        this.state.tileSel = null;
        document.getElementById('tile-step-overlay').classList.add('hide');
        // 반영된 변경사항을 일반 화면에도 즉시 보이게
        this.renderTimetableLayout();
    },

    renderTileStep() {
        const body = document.getElementById('tile-step-body');
        if (!body) return;
        const wData = this.state.history[this.state.currentWeek];
        const maxP = Math.max(...Object.values(this.state.config.periods));
        const sel = this.state.tileSel;

        let h = '';
        for (let c = 1; c <= this.state.config.classCount; c++) {
            const cStr = String(c);
            if (!wData.classes[cStr]) wData.classes[cStr] = { "월": [], "화": [], "수": [], "목": [], "금": [] };
            const data = wData.classes[cStr];
            const spCells = wData.specialistCells || {};

            h += `<div class="ts-class-card"><div class="ts-class-title">${c}반</div><div class="ts-grid">`;
            h += `<div></div>${this.days.map(d => `<div class="ts-head">${d}</div>`).join('')}`;
            for (let p = 0; p < maxP; p++) {
                h += `<div class="ts-period-label">${p + 1}</div>`;
                this.days.forEach(d => {
                    if (p >= this.state.config.periods[d]) { h += `<div class="ts-tile ts-tile-none"></div>`; return; }
                    const val = data[d][p] || '';
                    const isSel = !!(sel && sel.cls === cStr && sel.day === d && sel.p === p);
                    const isSpLocked = !!(spCells[cStr]?.[d]?.[p]);
                    const sp = isSpLocked ? this._spForCell(c, d, p) : null;
                    const bg = (!isSel && sp && sp.bg) ? ` style="background-color:${sp.bg};"` : '';
                    const cls = `ts-tile${!val ? ' ts-tile-empty' : ''}${isSel ? ' ts-tile-selected' : ''}`;

                    if (isSel) {
                        h += `<div class="${cls}" data-cls="${cStr}" data-day="${d}" data-idx="${p}">
                            <input type="text" class="ts-tile-input" value="${val}" data-cls="${cStr}" data-day="${d}" data-idx="${p}">
                            ${val ? `<div class="ts-tile-x" data-cls="${cStr}" data-day="${d}" data-idx="${p}">✕</div>` : ''}
                        </div>`;
                    } else {
                        h += `<div class="${cls}"${bg} data-cls="${cStr}" data-day="${d}" data-idx="${p}"><span class="ts-tile-label">${val}</span></div>`;
                    }
                });
            }
            h += `</div></div>`;
        }
        body.innerHTML = h;

        const input = body.querySelector('.ts-tile-input');
        if (input) { input.focus(); input.select(); }
    },

    // 타일 클릭: 아무것도 선택 안 된 상태 → 이 칸을 선택(분홍+흔들림)
    //           같은 칸을 다시 클릭 → 선택 해제
    //           다른 칸 클릭 → 두 칸의 내용을 서로 교환
    tileClick(cStr, d, p) {
        const sel = this.state.tileSel;
        const wData = this.state.history[this.state.currentWeek];
        if (!sel) {
            this.state.tileSel = { cls: cStr, day: d, p };
        } else if (sel.cls === cStr && sel.day === d && sel.p === p) {
            this.state.tileSel = null;
        } else {
            const a = wData.classes[sel.cls][sel.day], b = wData.classes[cStr][d];
            const tmp = a[sel.p] || '';
            a[sel.p] = b[p] || '';
            b[p] = tmp;
            this._swapSpecialistLock(sel.cls, sel.day, sel.p, cStr, d, p);
            this.state.tileSel = null;
            this.state.isDirty = true;
            this.saveData();
        }
        this.renderTileStep();
    },

    // 두 칸을 맞바꿀 때 "전담 잠금" 표시도 같이 따라가게 함
    _swapSpecialistLock(cls1, d1, p1, cls2, d2, p2) {
        const wData = this.state.history[this.state.currentWeek];
        if (!wData.specialistCells) wData.specialistCells = {};
        const sc = wData.specialistCells;
        const get = (c, d, p) => !!(sc[c]?.[d]?.[p]);
        const set = (c, d, p, v) => {
            if (v) {
                if (!sc[c]) sc[c] = {};
                if (!sc[c][d]) sc[c][d] = {};
                sc[c][d][p] = true;
            } else {
                if (sc[c]?.[d]) delete sc[c][d][p];
            }
        };
        const v1 = get(cls1, d1, p1), v2 = get(cls2, d2, p2);
        set(cls1, d1, p1, v2);
        set(cls2, d2, p2, v1);
    },

    tileClearX(cStr, d, p) {
        const wData = this.state.history[this.state.currentWeek];
        wData.classes[cStr][d][p] = '';
        if (wData.specialistCells?.[cStr]?.[d]) delete wData.specialistCells[cStr][d][p];
        this.state.tileSel = null;
        this.state.isDirty = true;
        this.saveData();
        this.renderTileStep();
    },

    tileInputCommit(cStr, d, p, val) {
        const wData = this.state.history[this.state.currentWeek];
        wData.classes[cStr][d][p] = val.trim();
        this.state.tileSel = null;
        this.state.isDirty = true;
        this.saveData();
        this.renderTileStep();
    },

    /* --- Validation --- */
    renderAllValidationGrids() { for (let c = 1; c <= this.state.config.classCount; c++) this.renderSingleValidationGrid(c); },
    renderSingleValidationGrid(c) {
        const el = document.getElementById(`val-grid-${c}`); if (!el) return;
        if (!this.state.history[this.state.currentWeek].classes[c]) {
            this.state.history[this.state.currentWeek].classes[c] = { "월":[], "화":[], "수":[], "목":[], "금":[] };
        }
        const cd = this.state.history[this.state.currentWeek].classes[c], targets = this.state.history[this.state.currentWeek].targets, cts = {};
        this.days.forEach(d => { (cd[d] || []).forEach(s => { if(s) cts[s] = (cts[s]||0)+1; }); });
        const subs = this.state.config.subjects;
        let h = `<thead><tr><th>과목</th><th>배정</th><th>과목</th><th>배정</th></tr></thead><tbody>`;
        for (let i = 0; i < subs.length; i += 2) {
            const s1 = subs[i].name, s2 = subs[i+1] ? subs[i+1].name : null, c1 = cts[s1]||0, t1 = targets[s1]||0;
            h += `<tr><td style="font-weight:600; color:var(--text-sub); font-size:0.85rem;">${s1}</td><td class="${this.getValClass(c1, t1)}">${c1}/${t1}</td>`;
            if (s2) { const c2 = cts[s2]||0, t2 = targets[s2]||0; h += `<td style="font-weight:600; color:var(--text-sub); font-size:0.85rem;">${s2}</td><td class="${this.getValClass(c2, t2)}">${c2}/${t2}</td>`; }
            else h += `<td></td><td></td>`; h += `</tr>`;
        }
        const act = subs.reduce((a, s) => a + (cts[s.name] || 0), 0), tar = subs.reduce((a, s) => a + (targets[s.name] || 0), 0);
        h += `<tr style="border-top: 1.5px solid var(--border-color);">
                <td colspan="2" style="font-weight:700; color:var(--text-main); background:#f9fafb;">주간 총계</td>
                <td colspan="2" class="${this.getValClass(act, tar)}" style="font-weight:800; font-size:0.9rem;">${act} / ${tar}</td>
              </tr>`;
        el.innerHTML = h + `</tbody>`;
    },

    /* --- Validation View (The Dashboard) --- */
    calculateAndRenderValidationView() {
        if (!this.dom.menus.validation) {
            this.dom.menus.validation = document.getElementById('validation-view');
        }
        if (this.dom.menus.validation.classList.contains('hide')) return;

        const subs = this.state.config.subjects;
        const history = this.state.history;
        const annT = this.state.config.annualTargets || {};
        const classCount = this.state.config.classCount;

        // 1. Annual Summary: 주차별 "이번 주 목표" 차시 합산 (반별 입력값과 무관)
        const totalCounts = {};
        subs.forEach(s => totalCounts[s.name] = 0);

        Object.values(history).forEach(weekData => {
            const targets = weekData.targets || {};
            subs.forEach(s => {
                totalCounts[s.name] += (targets[s.name] || 0);
            });
        });

        const table = document.getElementById('annual-summary-table');
        if (table) {
            let h = `<thead><tr><th>항목 / 과목</th>`;
            subs.forEach(s => h += `<th class="text-center font-bold" style="background:#f1f5f9;">${s.name}</th>`);
            h += `<th class="text-center" style="background:var(--primary-light); color:var(--primary-dark);">합계</th></tr></thead><tbody>`;
            
            // Row 1: 기준시수 (Target)
            h += `<tr><td class="col-head" style="text-align:center; font-weight:700;">기준시수</td>`;
            let sumTarget = 0;
            subs.forEach(s => {
                const target = annT[s.name] || 0;
                sumTarget += target;
                h += `<td class="text-center"><input type="text" inputmode="numeric" class="val-ann-input" style="width:100%; border:none; text-align:center; font-weight:700;" value="${target}" onchange="App.setAnnualTarget('${s.name}', this.value)"></td>`;
            });
            h += `<td class="text-center font-bold" style="background:#f8fafc;">${sumTarget}</td></tr>`;

            // Row 2: 누적시수 (주차별 목표 차시 합산)
            h += `<tr><td class="col-head" style="text-align:center; font-weight:700;">누적시수</td>`;
            let sumActual = 0;
            subs.forEach(s => {
                const actual = totalCounts[s.name] || 0;
                sumActual += actual;
                h += `<td class="text-center font-bold" style="background:#f8fafc;">${actual}</td>`;
            });
            h += `<td class="text-center font-bold" style="background:#f8fafc;">${sumActual}</td></tr>`;

            // Row 3: 편차 (Difference)
            h += `<tr><td class="col-head" style="text-align:center; font-weight:700;">편차</td>`;
            let sumDiff = 0;
            subs.forEach(s => {
                const target = annT[s.name] || 0;
                const actual = totalCounts[s.name] || 0;
                const diff = actual - target;
                sumDiff += diff;
                const diffColor = diff === 0 ? 'color:var(--primary-color);' : (diff > 0 ? 'color:#b91c1c;' : 'color:#92400e;');
                h += `<td class="text-center font-bold" style="${diffColor}">${diff > 0 ? '+' : ''}${diff}</td>`;
            });
            h += `<td class="text-center font-bold" style="background:#f8fafc;">${sumDiff > 0 ? '+' : ''}${sumDiff}</td></tr>`;

            table.innerHTML = h + '</tbody>';
        }

        // 2. Weekly Per-Class Deviation (Class vs Subject for Current Week)
        const weekData = history[this.state.currentWeek];
        const targets = weekData.targets || {};
        const devContainer = document.getElementById('class-deviation-container');
        if (devContainer) {
            let h = `<div class="table-responsive"><table class="excel-table deviation-table"><thead><tr><th class="dev-class-col">반 / 과목</th>`;
            subs.forEach(s => h += `<th class="dev-sub-col">${s.name}</th>`);
            h += `</tr></thead><tbody>`;

            for (let c = 1; c <= classCount; c++) {
                const cd = weekData.classes[c] || {};
                const classCounts = {};
                subs.forEach(s => classCounts[s.name] = 0);
                this.days.forEach(d => {
                    (cd[d] || []).forEach(val => {
                        if (val && classCounts[val] !== undefined) classCounts[val]++;
                    });
                });

                h += `<tr style="cursor:pointer;" onclick="App.showClassDeviationDetail(${c})"><td class="col-head dev-class-col">${c}반 <span class="btn-detail-badge">기록보기</span></td>`;
                subs.forEach(s => {
                    const sub = s.name;
                    const diff = classCounts[sub] - (targets[sub] || 0);
                    let color = '';
                    if (diff > 0) color = 'background-color:#fee2e2; color:#b91c1c; font-weight:bold;';
                    else if (diff < 0) color = 'background-color:#fffbeb; color:#92400e; font-weight:bold;';
                    else color = 'color:#10b981; font-weight:700;';
                    
                    h += `<td style="${color} font-size:0.85rem;">${diff > 0 ? '+' : ''}${diff}</td>`;
                });
                h += `</tr>`;
            }
            devContainer.innerHTML = h + '</tbody></table></div>';
        }
    },

    showClassDeviationDetail(cNum) {
        const subs = this.state.config.subjects;
        const history = this.state.history;
        const maxWeek = this.state.maxWeek;

        let h = `<div class="deviation-detail-wrap">
            <p class="mb-4 text-sm text-gray-600"><strong>${cNum}반</strong>의 주차별 과목별 편차 기록입니다. (0이 아닌 칸을 확인하세요)</p>
            <div class="table-responsive" style="max-height:65vh; border:1px solid var(--border-color); border-radius:8px; overflow:auto;">
                <table class="excel-table" style="font-size:0.8rem;">
                    <thead class="sticky top-0 bg-gray-50">
                        <tr><th>주차</th>${subs.map(s => `<th>${s.name}</th>`).join('')}</tr>
                    </thead>
                    <tbody>`;
        
        for (let w = 1; w <= maxWeek; w++) {
            const weekData = history[w];
            if (!weekData) continue;
            
            const currTargets = weekData.targets || {};
            const cd = weekData.classes[cNum] || {};
            const counts = {}; subs.forEach(s => counts[s.name] = 0);
            
            this.days.forEach(d => {
                (cd[d] || []).forEach(v => {
                    if (v && counts[v] !== undefined) counts[v]++;
                });
            });

            h += `<tr><td class="col-head" style="background:#f9fafb;">${w}주</td>`;
            subs.forEach(s => {
                const sub = s.name;
                const diff = counts[sub] - (currTargets[sub] || 0);
                const color = diff === 0 ? 'color:#cbd5e1;' : (diff > 0 ? 'color:#ef4444; font-weight:bold;' : 'color:#f59e0b; font-weight:bold;');
                h += `<td style="${color}">${diff > 0 ? '+' : ''}${diff}</td>`;
            });
            h += `</tr>`;
        }
        
        h += `</tbody></table></div></div>`;

        this.dom.modalTitle.textContent = `${cNum}반 상세 시수 기록`;
        this.dom.modalContent.innerHTML = h;
        this.dom.modalCancel.classList.add('hide');
        this.dom.modalConfirm.textContent = '닫기';
        this.dom.modalContainer.classList.remove('hide');
        this.dom.modalContainer.querySelector('.modal').classList.add('modal-wide');
        this.modalResolve = null;
    },

    setAnnualTarget(sub, val) {
        if (!this.state.config.annualTargets) this.state.config.annualTargets = {};
        this.state.config.annualTargets[sub] = parseInt(val) || 0;
        this.saveData();
        this.calculateAndRenderValidationView();
    },

    getValClass(c, t) { 
        if (c === t) return 'val-ok'; 
        if (!t && c > 0) return 'val-over';
        return c > t ? 'val-over' : 'val-warn'; 
    },

    /* --- SURGICAL Specialist UI FIX --- */
    renderSpecialistView() {
        const cont = this.dom.specialistContainer; if (!cont) return;
        cont.innerHTML = '';
        const badge = document.getElementById('sp-week-badge');
        if (badge) badge.textContent = `${this.state.currentWeek}주차`;
        this._sp().forEach((sp, idx) => {
            // MATCH CSS: .specialist-table-wrapper
            const div = document.createElement('div'); div.className = 'specialist-table-wrapper';
            const spName = sp.subject || sp.name || '전담', spDesc = sp.desc || '';
            const isHidden = (sp.hiddenWeeks || []).includes(this.state.currentWeek);
            if (isHidden) div.style.cssText = 'opacity:0.45; position:relative;';

            // MATCH CSS structure: .specialist-table-header, .sp-header-inputs, .sp-subject-input, .sp-desc-input
            let h = `
                ${isHidden ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:2;display:flex;align-items:center;justify-content:center;pointer-events:none;"><span style="background:rgba(0,0,0,0.55);color:#fff;padding:6px 18px;border-radius:20px;font-weight:700;font-size:0.9rem;">이번 주 숨김 — 주간학습에 미반영</span></div>` : ''}
                <div class="specialist-table-header" style="background-color:${sp.bg || '#f9fafb'};">
                    <div class="sp-header-inputs">
                        <input type="text" class="sp-subject-input" value="${spName}" placeholder="과목명" oninput="App.updateSpName(${idx}, this.value)">
                        <span class="sp-sep">|</span>
                        <input type="text" class="sp-desc-input" value="${spDesc}" placeholder="한줄 설명(대상)" oninput="App.updateSpDesc(${idx}, this.value)">
                    </div>
                    <div class="sp-header-actions">
                        <div style="position:relative;">
                            <button class="sp-color-btn" onclick="App.toggleColorPicker(${idx})">🎨 색상</button>
                            <div id="sp-color-dropdown-${idx}" class="sp-color-dropdown card">
                                <div class="sp-dropdown-title">보드 배경색 선택</div>
                                <div class="sp-presets-grid">
                                    ${['#fecaca','#fed7aa','#fef08a','#dcfce7','#cffafe','#dbeafe','#ede9fe','#fce7f3','#e5e7eb','#ffffff'].map(c =>
                                        `<div class="sp-preset-item" style="background-color:${c}; border:1px solid #e5e7eb;" onclick="App.setSpColor(${idx}, '${c}')"></div>`
                                    ).join('')}
                                </div>
                            </div>
                        </div>
                        <button class="del-btn" onclick="App.deleteSp(${idx})">✕</button>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;padding:4px 10px;background:${isHidden ? '#ede9fe' : '#f8fafc'};border-bottom:1px solid #e5e7eb;flex-wrap:wrap;">
                    <button onclick="App.toggleSpHide(${idx})" style="padding:3px 12px;border-radius:6px;font-size:0.76rem;font-weight:700;border:1.5px solid ${isHidden ? '#6366f1' : '#cbd5e1'};background:${isHidden ? '#ddd6fe' : '#f1f5f9'};color:${isHidden ? '#4f46e5' : '#64748b'};cursor:pointer;">${isHidden ? '✓ 이번 주 숨김 (클릭 시 해제)' : '이번 주 숨기기'}</button>
                    <label style="display:flex;align-items:center;gap:6px;font-size:0.76rem;color:#64748b;font-weight:600;" title="한 반에 후보 칸을 여러 개 등록해둔 경우(예: 과학실처럼 겹치지 않게 돌아가며 쓰는 자원), 반마다 실제로 채울 횟수를 제한합니다. 비워두면 후보 칸을 전부 채웁니다.">
                        주당 실제 사용
                        <input type="number" min="0" class="login-input" style="width:56px; padding:3px 6px; font-size:0.8rem;" value="${sp.weeklyCount != null ? sp.weeklyCount : ''}" placeholder="전체" oninput="App.updateSpWeeklyCount(${idx}, this.value)">
                        회
                    </label>
                    <button onclick="App.reconcileSpecialistNow(${idx})" style="padding:3px 12px;border-radius:6px;font-size:0.76rem;font-weight:700;border:1.5px solid #6366f1;background:#ede9fe;color:#4f46e5;cursor:pointer;" title="지금 설정한 횟수에 맞춰 이번 주 시간표를 바로 정리합니다 (많으면 지우고 적으면 채움).">🔧 이번 주에 지금 설정 적용</button>
                </div>
                <table class="excel-table sp-table"><thead><tr><th>교시</th>${this.days.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>`;
            const maxP = Math.max(...Object.values(this.state.config.periods));
            for (let p=0; p<maxP; p++) {
                h += `<tr><td class="col-head">${p+1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        const val = sp.data[d] && sp.data[d][p] ? sp.data[d][p] : '', mk = sp.marks && sp.marks[`${d}_${p}`], style = mk ? `style="background-color:${mk}"` : '';
                        const isHelperTarget = sp.helperCells && sp.helperCells[`${d}_${p}`];
                        h += `<td class="sp-cell${isHelperTarget ? ' helper-target' : ''}" ${style} onclick="App.handleSpCellClick(event, ${idx}, '${d}', ${p})"><input type="text" class="cell-input" data-sp-d="${d}" data-sp-p="${p}" value="${val}" oninput="App.updateSpData(${idx}, '${d}', ${p}, this.value)"></td>`;
                    } else h += `<td class="cell-disabled"></td>`;
                });
                h += `</tr>`;
            }
            div.innerHTML = h + `</tbody></table>`; cont.appendChild(div);
        });
        this.renderSpecialistSummary();
        if(this.state.spPreviewOpen) this.renderSpecialistPreview();
        this.checkSpecialistConflicts();
    },

    /* --- 이번 주 전담과목 가져오기 (전체 시간표 상단) --- */
    /* --- 주간 공통 과목 고정 --- */
    renderFixedSlotsCard() {
        this.initWeekData(this.state.currentWeek);
        const wData = this.state.history[this.state.currentWeek];
        const rules = wData.fixedSlots || [];

        const daySel = document.getElementById('fs-day');
        const periodSel = document.getElementById('fs-period');
        const subSel = document.getElementById('fs-subject');
        if (daySel) daySel.innerHTML = this.days.map(d => `<option value="${d}">${d}요일</option>`).join('');
        if (periodSel) {
            const maxP = Math.max(...Object.values(this.state.config.periods));
            periodSel.innerHTML = Array.from({ length: maxP }, (_, i) => i + 1).map(p => `<option value="${p}">${p}교시</option>`).join('');
        }
        if (subSel) {
            subSel.innerHTML = `<option value="">과목 선택</option>` +
                this.state.config.subjects.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
        }

        const listEl = document.getElementById('fixed-slots-list');
        if (!listEl) return;
        if (rules.length === 0) {
            listEl.innerHTML = `<div style="font-size:0.8rem; color:#94a3b8; padding:4px 2px;">이번 주 적용된 고정 배정이 없습니다.</div>`;
            return;
        }
        listEl.innerHTML = rules.map((r, i) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:6px; background:#f8fafc;">
                <span style="font-size:0.83rem; color:#1e293b;"><b>${r.day} ${r.period + 1}교시</b> — ${r.subject}
                    ${r.repeat ? '<span style="color:#059669; font-size:0.75rem; margin-left:6px;">🔁 매주 반복</span>' : ''}
                </span>
                <button class="btn-icon" onclick="App.removeFixedSlot(${i})" title="해제">✕</button>
            </div>
        `).join('');
    },

    // 한 주차에 규칙을 실제로 적용: 모든 반의 해당 요일/교시를 채우고 전담 잠금 처리
    // 해당 주차에 반별 평균으로 이미 배정된 과목 차시 수(반올림)
    _avgFilledForSubject(week, sub) {
        const wData = this.state.history[week];
        if (!wData) return 0;
        let total = 0;
        for (let c = 1; c <= this.state.config.classCount; c++) {
            const cd = (wData.classes || {})[String(c)] || {};
            this.days.forEach(d => (cd[d] || []).forEach(v => { if (v === sub) total++; }));
        }
        return this.state.config.classCount > 0 ? Math.round(total / this.state.config.classCount) : 0;
    },

    // 전담/고정배정으로 실제 배정된 차시 수를 "이번 주 목표"에 반영(기존 목표보다 낮아지진 않게)
    _bumpTargetForSubject(week, sub) {
        const wData = this.state.history[week];
        if (!wData) return;
        if (!wData.targets) wData.targets = {};
        const avg = this._avgFilledForSubject(week, sub);
        if (avg > (wData.targets[sub] || 0)) wData.targets[sub] = avg;
    },

    _applyFixedSlotRule(week, rule) {
        this.initWeekData(week);
        const wData = this.state.history[week];
        if (!wData.fixedSlots) wData.fixedSlots = [];
        if (!wData.specialistCells) wData.specialistCells = {};

        // 같은 요일/교시에 이미 있던 고정 규칙은 새 규칙으로 교체
        const dupIdx = wData.fixedSlots.findIndex(r => r.day === rule.day && r.period === rule.period);
        if (dupIdx >= 0) wData.fixedSlots.splice(dupIdx, 1);

        const conflicts = [];
        let filled = 0;
        for (let c = 1; c <= this.state.config.classCount; c++) {
            const cStr = String(c);
            if (!wData.classes[cStr]) wData.classes[cStr] = { "월": [], "화": [], "수": [], "목": [], "금": [] };
            const cd = wData.classes[cStr];
            if (!cd[rule.day]) cd[rule.day] = [];
            const existing = cd[rule.day][rule.period];
            if (existing) {
                if (existing !== rule.subject) conflicts.push(c);
                continue;
            }
            cd[rule.day][rule.period] = rule.subject;
            if (!wData.specialistCells[cStr]) wData.specialistCells[cStr] = {};
            if (!wData.specialistCells[cStr][rule.day]) wData.specialistCells[cStr][rule.day] = {};
            wData.specialistCells[cStr][rule.day][rule.period] = true;
            filled++;
        }
        wData.fixedSlots.push(rule);
        this._bumpTargetForSubject(week, rule.subject);
        return { filled, conflicts };
    },

    addFixedSlot() {
        const daySel = document.getElementById('fs-day');
        const periodSel = document.getElementById('fs-period');
        const subSel = document.getElementById('fs-subject');
        const repeatChk = document.getElementById('fs-repeat');
        if (!subSel.value) { this.showToast('과목을 선택하세요.'); return; }

        const day = daySel.value;
        const period = parseInt(periodSel.value) - 1;
        const subject = subSel.value;
        const repeat = repeatChk.checked;
        const rule = { day, period, subject, repeat };

        // 반복 적용이면 현재 주차부터 이미 만들어진 마지막 주차까지 전부, 아니면 이번 주만
        const weeks = repeat
            ? Array.from({ length: this.state.maxWeek - this.state.currentWeek + 1 }, (_, i) => this.state.currentWeek + i)
            : [this.state.currentWeek];

        let totalFilled = 0;
        const allConflicts = [];
        weeks.forEach(w => {
            const { filled, conflicts } = this._applyFixedSlotRule(w, rule);
            totalFilled += filled;
            conflicts.forEach(c => allConflicts.push(`${w}주차 ${c}반`));
        });

        this.saveData();
        this.renderFixedSlotsCard();
        this.renderTimetableLayout();

        if (allConflicts.length > 0) {
            this.showAlert('일부 반은 건너뛰었습니다',
                `${totalFilled}개 교시에 <b>${subject}</b>를 고정 배정했습니다.<br><br>
                 <span style="color:#dc2626;">⚠️ 이미 다른 내용이 있어 건너뛴 곳:</span><br>${allConflicts.join(', ')}`);
        } else {
            this.showToast(`✅ ${day}요일 ${period + 1}교시 ${subject} 고정 배정 완료 (${totalFilled}개 교시)`);
        }
    },

    removeFixedSlot(idx) {
        const wData = this.state.history[this.state.currentWeek];
        const rule = (wData.fixedSlots || [])[idx];
        if (!rule) return;
        this.showConfirm('고정 배정 해제', `${rule.day}요일 ${rule.period + 1}교시 <b>${rule.subject}</b> 고정 배정을 해제할까요?<br>이번 주차에서 아직 값이 그대로인 반만 지워집니다.`).then(r => {
            if (!r) return;
            for (let c = 1; c <= this.state.config.classCount; c++) {
                const cStr = String(c);
                const cd = wData.classes[cStr];
                if (cd && cd[rule.day] && cd[rule.day][rule.period] === rule.subject) {
                    cd[rule.day][rule.period] = '';
                    if (wData.specialistCells?.[cStr]?.[rule.day]) delete wData.specialistCells[cStr][rule.day][rule.period];
                }
            }
            wData.fixedSlots.splice(idx, 1);
            this.saveData();
            this.renderFixedSlotsCard();
            this.renderTimetableLayout();
            this.showToast('고정 배정을 해제했습니다.');
        });
    },

    renderSpecialistTeacherView() {
        // 진입 시 주차 동기화 및 버튼 상태 초기화
        this.state.sptViewMode = 'specialist';
        this.state.sptWeek = this.state.currentWeek || 1;
        const weekLabel = document.getElementById('spt-week-label');
        if (weekLabel) weekLabel.textContent = `${this.state.sptWeek}주차`;
        const weekSel = document.getElementById('spt-week-selector');
        if (weekSel) weekSel.style.display = 'none';
        const btnSpec = document.getElementById('btn-spt-view-specialist');
        const btnWeek = document.getElementById('btn-spt-view-weekly');
        if (btnSpec) { btnSpec.className = 'btn-primary-small'; btnSpec.style.fontSize = '0.75rem'; }
        if (btnWeek) { btnWeek.className = 'btn-secondary btn-sm'; btnWeek.style.fontSize = '0.75rem'; }

        this._renderSptBoards();
        // 반별 미리보기
        this.renderSptPreviewContent();
    },

    _renderSptBoards() {
        const cont = document.getElementById('spt-boards-container');
        if (!cont) return;
        const week = this.state.sptWeek;
        const badge = document.getElementById('spt-board-week-badge');
        if (badge) badge.textContent = `${week}주차`;
        cont.innerHTML = '';
        this._sp(week).forEach((sp) => {
            const div = document.createElement('div'); div.className = 'specialist-table-wrapper';
            const spName = sp.subject || sp.name || '전담', spDesc = sp.desc || '';
            const isHidden = (sp.hiddenWeeks || []).includes(week);
            if (isHidden) div.style.cssText = 'opacity:0.45; position:relative;';
            let h = `
                ${isHidden ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:2;display:flex;align-items:center;justify-content:center;pointer-events:none;"><span style="background:rgba(0,0,0,0.55);color:#fff;padding:6px 18px;border-radius:20px;font-weight:700;font-size:0.9rem;">이번 주 숨김</span></div>` : ''}
                <div class="specialist-table-header" style="background-color:${sp.bg || '#f9fafb'};">
                    <div class="sp-header-inputs">
                        <span class="sp-subject-input" style="font-weight:800; font-size:1rem; color:#1e293b;">${spName}</span>
                        ${spDesc ? `<span class="sp-sep">|</span><span class="sp-desc-input" style="color:#475569;">${spDesc}</span>` : ''}
                    </div>
                </div>
                <table class="excel-table sp-table"><thead><tr><th>교시</th>${this.days.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>`;
            const maxP = Math.max(...Object.values(this.state.config.periods));
            for (let p = 0; p < maxP; p++) {
                h += `<tr><td class="col-head">${p+1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        const val = sp.data[d] && sp.data[d][p] ? sp.data[d][p] : '';
                        const mk = sp.marks && sp.marks[`${d}_${p}`];
                        const style = mk ? `background-color:${mk};` : '';
                        h += `<td class="sp-cell" style="${style} text-align:center; font-size:0.9rem; padding:8px;">${val}</td>`;
                    } else h += `<td class="cell-disabled"></td>`;
                });
                h += `</tr>`;
            }
            div.innerHTML = h + `</tbody></table>`;
            cont.appendChild(div);
        });
    },

    sptBoardChangeWeek(delta) {
        const newWeek = this.state.sptWeek + delta;
        if (newWeek < 1 || newWeek > this.state.maxWeek) return;
        this.state.sptWeek = newWeek;
        const label = document.getElementById('spt-week-label');
        if (label) label.textContent = `${newWeek}주차`;
        this._renderSptBoards();
        this.renderSptPreviewContent();
    },

    setSptView(mode) {
        this.state.sptViewMode = mode;
        const btnSpec = document.getElementById('btn-spt-view-specialist');
        const btnWeek = document.getElementById('btn-spt-view-weekly');
        if (btnSpec && btnWeek) {
            btnSpec.className = mode === 'specialist' ? 'btn-primary-small' : 'btn-secondary btn-sm';
            btnSpec.style.fontSize = '0.75rem';
            btnWeek.className = mode === 'weekly' ? 'btn-primary-small' : 'btn-secondary btn-sm';
            btnWeek.style.fontSize = '0.75rem';
        }
        const weekSel = document.getElementById('spt-week-selector');
        if (weekSel) weekSel.style.display = mode === 'weekly' ? 'flex' : 'none';
        this.renderSptPreviewContent();
    },

    sptChangeWeek(delta) {
        const newWeek = this.state.sptWeek + delta;
        if (newWeek < 1 || newWeek > this.state.maxWeek) return;
        this.state.sptWeek = newWeek;
        const label = document.getElementById('spt-week-label');
        if (label) label.textContent = `${newWeek}주차`;
        this._renderSptBoards();
        this.renderSptPreviewContent();
    },

    renderSptPreviewContent() {
        const previewCont = document.getElementById('spt-preview-content');
        if (!previewCont) return;
        const mode = this.state.sptViewMode || 'specialist';
        const maxP = Math.max(...Object.values(this.state.config.periods));
        let ph = '<div class="sp-preview-grid">';
        for (let c = 1; c <= this.state.config.classCount; c++) {
            ph += `<div class="sp-preview-class-card">
                <div class="sp-preview-class-title">${c}반</div>
                <table class="sp-preview-table">
                    <thead><tr><th>교시</th>${this.days.map(d=>`<th>${d}</th>`).join('')}</tr></thead>
                    <tbody>`;
            for (let p = 0; p < maxP; p++) {
                ph += `<tr><td>${p+1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        if (mode === 'weekly') {
                            const weekData = this.state.history[this.state.sptWeek];
                            const subj = weekData?.classes?.[c]?.[d]?.[p] || '';
                            if (subj) {
                                const sp = this._sp(this.state.sptWeek).find(s => (s.subject || s.name) === subj);
                                const bg = sp ? (sp.bg || '#e0f2fe') : '';
                                const styleStr = bg ? `background-color:${bg};` : '';
                                ph += `<td class="has-sub" style="${styleStr} font-size:0.7rem;">${subj}</td>`;
                            } else {
                                ph += `<td class="empty">-</td>`;
                            }
                        } else {
                            const hits = [];
                            this._sp(this.state.sptWeek).forEach(sp => {
                                if ((sp.hiddenWeeks || []).includes(this.state.sptWeek)) return;
                                if (sp.data[d] && sp.data[d][p]) {
                                    const classes = String(sp.data[d][p]).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
                                    if (classes.includes(String(c))) hits.push(sp);
                                }
                            });
                            if (hits.length === 0) ph += `<td class="empty">-</td>`;
                            else if (hits.length === 1) ph += `<td class="has-sub" style="background-color:${hits[0].bg||'#f9fafb'}; font-size:0.7rem;">${hits[0].subject||'전담'}</td>`;
                            else ph += `<td class="has-sub" style="background-color:#fee2e2; color:#b91c1c; font-size:0.7rem;">중복!</td>`;
                        }
                    } else ph += `<td style="background:#f1f5f9;"></td>`;
                });
                ph += `</tr>`;
            }
            ph += `</tbody></table></div>`;
        }
        ph += '</div>';
        previewCont.innerHTML = ph;
    },
    checkSpecialistConflicts() {
        const occ = {}; // { day_period_classNum: count }
        const maxP = Math.max(...Object.values(this.state.config.periods));
        this._sp().forEach(sp => {
            if (!sp.data) return;
            if ((sp.hiddenWeeks || []).includes(this.state.currentWeek)) return;
            this.days.forEach(d => {
                for (let p = 0; p < maxP; p++) {
                    const val = sp.data[d] ? sp.data[d][p] : undefined;
                    if (val && String(val).trim() !== '') {
                        const classes = String(val).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
                        classes.forEach(c => {
                            const key = `${d}_${p}_${c}`;
                            occ[key] = (occ[key] || 0) + 1;
                        });
                    }
                }
            });
        });

        document.querySelectorAll('.sp-table .cell-input').forEach(inp => {
            const d = inp.getAttribute('data-sp-d');
            const p = inp.getAttribute('data-sp-p');
            const v = inp.value.trim();
            if (v !== '') {
                const classes = v.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
                const hasConflict = classes.some(c => occ[`${d}_${p}_${c}`] > 1);
                if (hasConflict) {
                    inp.classList.add('duplicate-error');
                    inp.closest('td').classList.add('duplicate-error');
                } else {
                    inp.classList.remove('duplicate-error');
                    inp.closest('td').classList.remove('duplicate-error');
                }
            } else {
                inp.classList.remove('duplicate-error');
                inp.closest('td').classList.remove('duplicate-error');
            }
        });
    },
    updateSpName(i, v) { if(!this._sp()[i]) return; this._sp()[i].subject = v; this.saveData(); this._markSpDirty(); this.renderSpecialistSummary(); if(this.state.spPreviewOpen) this.renderSpecialistPreview(); },
    updateSpDesc(i, v) { if(!this._sp()[i]) return; this._sp()[i].desc = v; this.saveData(); this._markSpDirty(); },
    // v가 빈 문자열이면 "전체 채움"(기존 동작, weeklyCount 없음), 0 이상 숫자면 그 횟수로 제한(0도 유효한 값 — "이번 주엔 아예 안 씀")
    updateSpWeeklyCount(i, v) {
        if (!this._sp()[i]) return;
        const trimmed = String(v).trim();
        const n = parseInt(trimmed);
        this._sp()[i].weeklyCount = (trimmed !== '' && Number.isInteger(n) && n >= 0) ? n : null;
        this.saveData();
        this._markSpDirty();
    },
    updateSpData(i, d, p, v) {
        if(!this._sp()[i]) return;
        if(!this._sp()[i].data) this._sp()[i].data = {};
        if(!this._sp()[i].data[d]) this._sp()[i].data[d] = [];
        this._sp()[i].data[d][p] = v;
        this.saveData();
        this._markSpDirty();
        this.renderSpecialistSummary();
        if(this.state.spPreviewOpen) this.renderSpecialistPreview();
        this.checkSpecialistConflicts();
    },
    setSpColor(i, c) { this._sp()[i].bg = c; this.saveData(); this._markSpDirty(); this.renderSpecialistView(); },
    toggleColorPicker(i) {
        const el = document.getElementById(`sp-color-dropdown-${i}`); if (!el) return;
        const shown = el.classList.contains('show'); document.querySelectorAll('.sp-color-dropdown').forEach(d => d.classList.remove('show'));
        if(!shown) el.classList.add('show');
    },
    deleteSp(i) { this.showConfirm('전담 보드 삭제', '이 전담 보드를 삭제하면 입력된 모든 데이터가 사라집니다.<br>계속하시겠습니까?').then(r => { if(r){ this._sp().splice(i,1); this.saveData(); this._markSpDirty(); this.renderSpecialistView(); } }); },
    addSpecialistBoard() { this._sp().push({ subject: '', desc: '', data: {}, marks: {}, bg: '#ffffff' }); this.saveData(); this._markSpDirty(); this.renderSpecialistView(); },
    _markSpDirty() {
        this.state.isSpDirty = true;
        const btn = document.getElementById('btn-save-specialist');
        if (btn) { btn.style.background = '#f59e0b'; btn.style.borderColor = '#f59e0b'; btn.textContent = '저장'; }
    },
    _clearSpDirty() {
        this.state.isSpDirty = false;
        const btn = document.getElementById('btn-save-specialist');
        if (btn) { btn.style.background = ''; btn.style.borderColor = ''; btn.textContent = '저장'; }
    },
    async saveSpecialistToServer() {
        if (!this.state.roomCode) return this.showAlert('오류', '방 코드가 없습니다.');
        if (!this.state.isAdmin) return this.showAlert('오류', '관리자만 전담 데이터를 저장할 수 있습니다.');
        const btn = document.getElementById('btn-save-specialist');
        if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
        try {
            // 이번 주에 전담 배정을 아직 한 번도 반영한 적 없으면(주로 맨 처음 설정할 때) 지금 한 번만 채워 넣음.
            // 이후에는 다시 저장해도 이미 지운 칸을 되살리지 않도록 건너뜀.
            const wData = this.state.history[this.state.currentWeek];
            if (wData && !wData.specialistAutofilled) {
                this._autofillSpecialistsForWeek(this.state.currentWeek);
                this.renderTimetableLayout();
            }
            await FirebaseDB.saveAdmin(this.state.roomCode, this.state);
            this._clearSpDirty();
            this.showToast('✅ 전담 데이터를 서버에 저장했습니다.');
        } catch(e) {
            this.showToast('❌ 저장 실패: ' + e.message);
        } finally {
            if (btn) btn.disabled = false;
        }
    },
    
    toggleSpPreview() {
        this.state.spPreviewOpen = !this.state.spPreviewOpen;
        const rightPanel = document.getElementById('sp-right-panel');
        const summaryPanel = document.getElementById('specialist-summary-container');
        const btn = document.getElementById('btn-toggle-sp-preview');
        if(this.state.spPreviewOpen) {
            rightPanel.style.display = 'block';
            if(summaryPanel) summaryPanel.style.display = 'none';
            btn.innerHTML = '미리보기 닫기';
            btn.classList.replace('btn-secondary', 'btn-primary-small');
            this.renderSpecialistPreview();
        } else {
            rightPanel.style.display = 'none';
            if(summaryPanel) summaryPanel.style.display = 'block';
            btn.innerHTML = '반별 미리보기';
            btn.classList.replace('btn-primary-small', 'btn-secondary');
        }
    },
    renderSpecialistPreview() {
        const container = document.getElementById('sp-preview-content');
        if (!container) return;
        
        let h = '<div class="sp-preview-grid">';
        for (let c = 1; c <= this.state.config.classCount; c++) {
            h += `<div class="sp-preview-class-card">
                    <div class="sp-preview-class-title">${c}반</div>
                    <table class="sp-preview-table">
                        <thead><tr><th>교시</th>${this.days.map(d=>`<th>${d}</th>`).join('')}</tr></thead>
                        <tbody>`;
            const maxP = Math.max(...Object.values(this.state.config.periods));
            for(let p=0; p<maxP; p++) {
                h += `<tr><td>${p+1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        // Find if any specialist board targets this class for this day/period
                        const hits = [];
                        this._sp().forEach(sp => {
                            if ((sp.hiddenWeeks || []).includes(this.state.currentWeek)) return;
                            if (sp.data[d] && sp.data[d][p]) {
                                const classes = String(sp.data[d][p]).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
                                if (classes.includes(String(c))) {
                                    hits.push(sp);
                                }
                            }
                        });
                        if (hits.length === 0) {
                            h += `<td class="empty">-</td>`;
                        } else if (hits.length === 1) {
                            const sp = hits[0];
                            const sName = sp.subject || sp.name || '전담';
                            h += `<td class="has-sub" style="background-color:${sp.bg||'#f9fafb'};">${sName}</td>`;
                        } else {
                            // Collision detected
                            h += `<td class="has-sub" style="background-color:#fee2e2; color:#b91c1c; font-weight:bold; cursor:pointer; pointer-events:auto;" onclick="App.focusSpConflict('${d}', ${p}, '${c}')" title="해당 칸으로 이동 및 강조">중복!</td>`;
                        }
                    } else {
                        h += `<td style="background:#f9fafb;"></td>`;
                    }
                });
                h += `</tr>`;
            }
            h += `</tbody></table></div>`;
        }
        h += '</div>';
        container.innerHTML = h;
    },

    handleSpCellClick(e, i, d, p) {
        if (e.target.tagName === 'INPUT') return;
        if (App.state.isHelperMode) {
            e.preventDefault(); e.stopPropagation();
            const sp = App._sp()[i];
            if (!sp.helperCells) sp.helperCells = {};
            const k = `${d}_${p}`;
            const cell = e.target.closest('td');
            if (!cell) return;
            if (sp.helperCells[k]) { delete sp.helperCells[k]; cell.classList.remove('helper-target'); }
            else { sp.helperCells[k] = true; cell.classList.add('helper-target'); }
            App.saveData();
            return;
        }
        if(App.state.isMarkingMode) { e.preventDefault(); e.stopPropagation(); const sp = App._sp()[i]; if(!sp.marks) sp.marks = {}; const k = `${d}_${p}`; const cell = e.target.closest('td'); if(!cell) return; if(sp.marks[k]){ delete sp.marks[k]; cell.style.backgroundColor=''; } else { sp.marks[k]=App.state.markingColor; cell.style.backgroundColor=sp.marks[k]; } App.saveData(); }
    },
    
    focusSpConflict(day, period, classNum) {
        const inputs = document.querySelectorAll(`input[data-sp-d="${day}"][data-sp-p="${period}"]`);
        let firstFound = null;
        inputs.forEach(inp => {
            if (inp.value.trim() === String(classNum)) {
                if (!firstFound) firstFound = inp;
                // Highlight corresponding conflicting inputs temporarily
                inp.style.transition = 'background-color 0.3s, transform 0.2s';
                inp.style.backgroundColor = '#fca5a5';
                inp.style.transform = 'scale(1.1)';
                inp.style.position = 'relative';
                inp.style.zIndex = '10';
                setTimeout(() => {
                    inp.style.backgroundColor = '';
                    inp.style.transform = '';
                    inp.style.zIndex = '';
                }, 1200);
            }
        });
        if (firstFound) {
            firstFound.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            setTimeout(() => firstFound.focus(), 300);
        }
    },
    toggleMarkingMode() {
        this.state.isMarkingMode = !this.state.isMarkingMode; const btn = document.getElementById('btn-toggle-marking'), pkr = document.getElementById('marking-color-picker');
        if (this.state.isMarkingMode) { btn.textContent = '✍️ 마킹 중지'; btn.style.backgroundColor = this.state.markingColor; pkr.style.display = 'flex'; document.body.classList.add('marking-mode'); if (this.state.isHelperMode) this.toggleHelperMode(); }
        else { btn.textContent = '✍️ 마킹 시작'; btn.style.backgroundColor = ''; pkr.style.display = 'none'; document.body.classList.remove('marking-mode'); }
    },

    toggleHelperMode() {
        this.state.isHelperMode = !this.state.isHelperMode;
        const btn = document.getElementById('btn-toggle-helper');
        const runBtn = document.getElementById('btn-run-helper');
        if (this.state.isHelperMode) {
            btn.textContent = '🎯 도우미 모드 : ON';
            btn.classList.add('helper-btn-active');
            runBtn.style.display = 'inline-flex';
            document.body.classList.add('helper-mode');
            if (this.state.isMarkingMode) this.toggleMarkingMode();
        } else {
            btn.textContent = '🎯 배정 도우미';
            btn.classList.remove('helper-btn-active');
            runBtn.style.display = 'none';
            document.body.classList.remove('helper-mode');
        }
    },

    async openHelperAssignment() {
        const specialists = this._sp();
        const hasHelperCells = specialists.some(sp => sp.helperCells && Object.keys(sp.helperCells).length > 0);
        if (!hasHelperCells) {
            await this.showAlert('배정 도우미', '먼저 도우미 모드에서 배정할 셀을 선택해주세요.<br>셀을 클릭하면 보라색으로 표시됩니다.');
            return;
        }
        const classCount = this.state.config.classCount;
        let summaryHTML = '<div style="margin-bottom:14px; padding:10px 12px; background:#f8fafc; border-radius:8px; font-size:0.85rem; color:#475569;">';
        summaryHTML += '<div style="font-weight:700; margin-bottom:6px; color:#1e293b;">선택된 셀</div>';
        specialists.forEach(sp => {
            const count = sp.helperCells ? Object.keys(sp.helperCells).length : 0;
            if (count > 0) {
                const name = sp.subject || sp.name || '(이름없음)';
                summaryHTML += `<div>• <b>${name}</b>: ${count}개 셀</div>`;
            }
        });
        summaryHTML += '</div>';
        const classBtns = Array.from({ length: classCount }, (_, i) => i + 1).map(c =>
            `<button type="button" class="helper-class-btn helper-class-btn-on" data-cls="${c}" onclick="this.classList.toggle('helper-class-btn-on')">${c}반</button>`
        ).join('');
        const content = `
            ${summaryHTML}
            <div style="margin-bottom:8px; font-size:0.9rem; font-weight:600; color:#1e293b;">배정할 반 선택 <span style="font-size:0.78rem; font-weight:400; color:#94a3b8;">(클릭으로 켜기/끄기)</span></div>
            <div id="helper-class-picker" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">${classBtns}</div>
            <div style="font-size:0.78rem; color:#94a3b8;">같은 요일·교시에 동일한 반이 두 전담에 겹치지 않도록 자동 배정합니다.</div>
        `;
        this.dom.modalTitle.textContent = '배정 도우미';
        this.dom.modalContent.innerHTML = content;
        this.dom.modalCancel.classList.remove('hide');
        this.dom.modalConfirm.textContent = '배정 실행';
        this.dom.modalContainer.classList.remove('hide');
        const confirmed = await new Promise(resolve => { this.modalResolve = resolve; });
        if (!confirmed) return;
        const classes = [...document.querySelectorAll('.helper-class-btn-on')].map(b => parseInt(b.dataset.cls));
        if (classes.length === 0) {
            await this.showAlert('입력 오류', '배정할 반을 하나 이상 선택해주세요.');
            return;
        }
        const result = this._runHelperBacktrack(classes);
        if (!result) {
            await this.showAlert('배정 불가', `선택한 셀과 반(${classes.map(c=>c+'반').join(', ')})으로는<br>조건을 만족하는 배정이 불가능합니다.<br><br>셀 선택이나 반 선택을 조정해보세요.`);
            return;
        }
        result.forEach(({ boardIdx, d, p, cls }) => {
            const sp = this._sp()[boardIdx];
            if (!sp.data) sp.data = {};
            if (!sp.data[d]) sp.data[d] = [];
            sp.data[d][p] = String(cls);
        });
        this.saveData();
        this._markSpDirty();
        this.renderSpecialistView();
        this.showToast(`✅ 배정 완료! (${fromVal}반~${toVal}반)`);
    },

    _runHelperBacktrack(classes) {
        const specialists = this._sp();
        const rawCells = [];
        specialists.forEach((sp, boardIdx) => {
            if (!sp.helperCells) return;
            Object.keys(sp.helperCells).forEach(k => {
                const under = k.indexOf('_');
                const d = k.slice(0, under);
                const p = parseInt(k.slice(under + 1));
                rawCells.push({ boardIdx, d, p });
            });
        });
        if (rawCells.length === 0) return null;

        // 1. MRV 정렬: 같은 요일·교시를 공유하는 다른 보드 셀이 많을수록 먼저 처리
        const slotConflictCount = (cell) =>
            rawCells.filter(c => c.d === cell.d && c.p === cell.p && c.boardIdx !== cell.boardIdx).length;
        const cells = [...rawCells].sort((a, b) => slotConflictCount(b) - slotConflictCount(a));

        const assignment = new Array(cells.length).fill(null);

        const getAvailable = (idx) => {
            const { boardIdx, d, p } = cells[idx];
            const usedInBoard = new Set();
            const usedInSlot = new Set();
            for (let i = 0; i < idx; i++) {
                if (assignment[i] === null) continue;
                if (cells[i].boardIdx === boardIdx) usedInBoard.add(assignment[i]);
                if (cells[i].d === d && cells[i].p === p && cells[i].boardIdx !== boardIdx) usedInSlot.add(assignment[i]);
            }
            return classes.filter(cls => !usedInBoard.has(cls) && !usedInSlot.has(cls));
        };

        const backtrack = (idx) => {
            if (idx === cells.length) return true;

            // 2. 셀마다 독립적으로 섞어서 시도
            const candidates = getAvailable(idx).sort(() => Math.random() - 0.5);

            for (const cls of candidates) {
                assignment[idx] = cls;

                // 3. Forward Checking: 아직 처리 안 된 셀 중 가능한 반이 0개인 셀이 생기면 즉시 포기
                let feasible = true;
                for (let j = idx + 1; j < cells.length; j++) {
                    if (getAvailable(j).length === 0) { feasible = false; break; }
                }

                if (feasible && backtrack(idx + 1)) return true;
                assignment[idx] = null;
            }
            return false;
        };

        if (!backtrack(0)) return null;
        return cells.map((cell, i) => ({ ...cell, cls: assignment[i] }));
    },
    setMarkingColor(c, el) { this.state.markingColor = c; document.querySelectorAll('.mark-color-btn').forEach(b => b.classList.remove('active')); if(el) el.classList.add('active'); if(this.state.isMarkingMode) document.getElementById('btn-toggle-marking').style.backgroundColor = c; },
    
    setSidebarColor(c, el) {
        this.state.selectedSidebarColor = c;
        document.querySelectorAll('.color-chip').forEach(ch => ch.classList.remove('active'));
        if (el && c !== null) el.classList.add('active');
        // Visual indicator in sidebar
        const display = document.getElementById('selected-sub-display');
        if (display) {
            display.style.borderBottom = c ? `3px solid ${c}` : 'none';
        }
    },
    renderSpecialistSummary() {
        const el = this.dom.specialistSummary; if(!el) return;
        const visibleSps = this._sp().filter(sp => !(sp.hiddenWeeks || []).includes(this.state.currentWeek));
        const subs = [...new Set(visibleSps.map(sp => sp.subject || sp.name || '').filter(s => s))], classCount = this.state.config.classCount, sts = {};
        subs.forEach(s => { sts[s] = {}; for(let c=1; c<=classCount; c++) sts[s][c] = 0; });
        visibleSps.forEach(sp => { const sub = sp.subject || sp.name || ''; if(!sub || !sts[sub]) return; this.days.forEach(d => { for(let p=0; p<this.state.config.periods[d]; p++){ const raw = sp.data[d] && sp.data[d][p]; if(!raw) continue; String(raw).split(/[,\s]+/).map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n > 0).forEach(cN => { if(sts[sub][cN] !== undefined) sts[sub][cN]++; }); } }); });
        if (subs.length === 0) { el.innerHTML = '<div class="sp-sum-inner"><div class="sp-sum-title">배정 현황</div><p class="p-4 text-xs text-gray-400">전담 보드를 추가해주세요.</p></div>' + this.renderReferenceBoardsHTML(); return; }
        const tgts = this.state.history[this.state.currentWeek].specialistTargets || {};
        let h = `<div class="sp-sum-inner"><div class="sp-sum-title">학급별 전담 시수 집계</div><div class="table-responsive"><table class="sp-sum-table"><thead><tr><th>과목명</th><th>목표</th>`;
        for(let c=1; c<=this.state.config.classCount; c++) h += `<th>${c}</th>`;
        h += `</tr></thead><tbody>`;
        subs.forEach(s => { const t = tgts[s] || 0; h += `<tr><td class="sp-sub-name">${s}</td><td><input type="text" class="sp-target-input" value="${t}" oninput="App.updateSpecialistTarget('${s}', this.value)"></td>`; for(let c=1; c<=this.state.config.classCount; c++){ const count = sts[s][c], cls = t>0 ? (count === t ? 'sp-cell-done' : (count > t ? 'sp-cell-over' : 'sp-cell-miss')) : (count > 0 ? 'sp-cell-over' : ''); h += `<td class="${cls}">${count}</td>`; } h += `</tr>`; });
        el.innerHTML = h + `</tbody></table></div><div class="sp-memo-section"><div class="sp-memo-title">전담 협의 메모</div><textarea class="sp-memo-area" placeholder="메모" oninput="App.updateSpecialistMemo(this)">${this.state.history[this.state.currentWeek].specialistMemo || ''}</textarea></div></div>` + this.renderReferenceBoardsHTML();
    },
    updateSpecialistTarget(s, v){ this.state.history[this.state.currentWeek].specialistTargets[s] = parseInt(v)||0; this.saveData(); this.renderSpecialistSummary(); },
    updateSpecialistMemo(el){ this.state.history[this.state.currentWeek].specialistMemo = el.value; this.saveData(); el.style.height='auto'; el.style.height=el.scrollHeight+'px'; },

    renderReferenceBoardsHTML() {
        let h = '<div class="sp-ref-section">';
        h += '<div class="sp-ref-header"><div style="font-size:0.85rem;font-weight:700;color:var(--text-main);">참고용 전담 시간표</div><button class="btn-primary-small btn-sm" onclick="App.addRefBoard()" style="padding:4px 8px;font-size:0.7rem;">+ 추가</button></div>';
        h += '<div class="sp-ref-grid">';
        (this.state.referenceBoards || []).forEach((ref, idx) => {
            h += `<div class="sp-ref-board">
                <div class="sp-ref-title-bar" style="background-color:${ref.bg || '#ffffff'};">
                    <input type="text" class="sp-ref-title-input" value="${ref.title||''}" placeholder="과목/교사" oninput="App.updateRefTitle(${idx}, this.value)">
                    <div style="display:flex; gap:4px; position:relative;">
                        <button class="sp-ref-color-btn" onclick="App.toggleRefColorPicker(${idx})" title="색상 지정">🎨</button>
                        <div id="sp-ref-color-dropdown-${idx}" class="sp-color-dropdown card" style="right:0;">
                            <div class="sp-dropdown-title">색상 선택</div>
                            <div class="sp-presets-grid">
                                ${['#fecaca','#fed7aa','#fef08a','#dcfce7','#cffafe','#dbeafe','#ede9fe','#fce7f3','#e5e7eb','#ffffff'].map(c =>
                                    `<div class="sp-preset-item" style="background-color:${c}; border:1px solid #e5e7eb;" onclick="App.setRefColor(${idx}, '${c}')"></div>`
                                ).join('')}
                            </div>
                        </div>
                        <button class="sp-ref-del-btn" onclick="App.delRefBoard(${idx})" title="삭제">✕</button>
                    </div>
                </div>
                <table class="sp-ref-table">
                    <thead><tr><th>교시</th>${this.days.map(d=>`<th>${d}</th>`).join('')}</tr></thead>
                    <tbody>`;
            const maxP = Math.max(...Object.values(this.state.config.periods));
            for(let p=0; p<maxP; p++) {
                h += `<tr><td class="col-head">${p+1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        const val = ref.data[d] && ref.data[d][p] ? ref.data[d][p] : '', mk = ref.marks && ref.marks[`${d}_${p}`], style = mk ? `style="background-color:${mk}"` : '';
                        h += `<td class="sp-cell" ${style} onclick="App.handleRefCellClick(event, ${idx}, '${d}', ${p})"><input type="text" class="sp-ref-input" data-ref-d="${d}" data-ref-p="${p}" value="${val}" oninput="App.updateRefData(${idx}, '${d}', ${p}, this.value)"></td>`;
                    } else {
                        h += `<td class="cell-disabled"></td>`;
                    }
                });
                h += `</tr>`;
            }
            h += `</tbody></table></div>`;
        });
        h += '</div></div>';
        return h;
    },
    addRefBoard() {
        if (!this.state.referenceBoards) this.state.referenceBoards = [];
        this.state.referenceBoards.push({ title: '', bg: '#ffffff', data: {} });
        this.saveData(); this.renderSpecialistSummary();
    },
    delRefBoard(idx) {
        this.showConfirm('참고 표 삭제', '이 참고 시간표를 삭제하시겠습니까?<br>삭제 후 복구할 수 없습니다.').then(r => {
            if(r) { this.state.referenceBoards.splice(idx,1); this.saveData(); this.renderSpecialistSummary(); }
        });
    },
    updateRefTitle(i, v) { if(!this.state.referenceBoards[i]) return; this.state.referenceBoards[i].title = v; this.saveData(); },
    updateRefData(i, d, p, v) { 
        if(!this.state.referenceBoards[i]) return;
        if(!this.state.referenceBoards[i].data) this.state.referenceBoards[i].data = {};
        if(!this.state.referenceBoards[i].data[d]) this.state.referenceBoards[i].data[d] = [];
        this.state.referenceBoards[i].data[d][p] = v; 
        this.saveData(); 
    },
    toggleRefColorPicker(idx) {
        const el = document.getElementById(`sp-ref-color-dropdown-${idx}`); if (!el) return;
        const shown = el.classList.contains('show'); document.querySelectorAll('.sp-color-dropdown').forEach(d => d.classList.remove('show'));
        if(!shown) el.classList.add('show');
    },
    setRefColor(idx, c) { this.state.referenceBoards[idx].bg = c; this.saveData(); this.renderSpecialistSummary(); },
    handleRefCellClick(e, i, d, p) {
        if (e.target.tagName === 'INPUT') return;
        if(App.state.isMarkingMode) { e.preventDefault(); e.stopPropagation(); const ref = App.state.referenceBoards[i]; if(!ref.marks) ref.marks = {}; const k = `${d}_${p}`; const cell = e.target.closest('td'); if(!cell) return; if(ref.marks[k]){ delete ref.marks[k]; cell.style.backgroundColor=''; } else { ref.marks[k]=App.state.markingColor; cell.style.backgroundColor=ref.marks[k]; } App.saveData(); }
    },

    /* --- Settings --- */
    stepPeriod(day, delta) {
        const el = this.dom.periodInputs[day];
        if (el) el.value = Math.min(8, Math.max(1, (parseInt(el.value) || 1) + delta));
    },
    renderSettingsView() {
        this.dom.gradeInput.value = this.state.config.grade || '';
        this.dom.classCountInput.value = this.state.config.classCount;
        this.days.forEach(d => this.dom.periodInputs[d].value = this.state.config.periods[d]);
        this.dom.subjectList.innerHTML = '';
        this.state.config.subjects.forEach((s, idx) => this.addSubjectConfigItem(s.name, idx, s.preferredSlot || 0));
    },
    addSubjectConfigItem(name='', idx=0, preferredSlot=0) {
        const row = document.createElement('div');
        row.className = 'subject-row';
        row.draggable = true;
        row.innerHTML = `
            <div class="sub-row-num">${idx + 1}</div>
            <input type="text" placeholder="과목명" value="${name}" class="set-sub-name sub-row-name" onclick="event.stopPropagation()">
            <select class="pref-slot-select sub-row-pref" data-sub="${name}">
                <option value="0" ${preferredSlot === 0 ? 'selected' : ''}>자동</option>
                <option value="1" ${preferredSlot === 1 ? 'selected' : ''}>1-2교시</option>
                <option value="2" ${preferredSlot === 2 ? 'selected' : ''}>3-4교시</option>
                <option value="3" ${preferredSlot === 3 ? 'selected' : ''}>5-6교시</option>
            </select>
            <button class="sub-row-delete" onclick="this.closest('.subject-row').remove(); App.refreshSubjectBadges();">✕</button>`;
        row.querySelector('.set-sub-name').addEventListener('blur', () => this.sortSubjectRows());
        row.addEventListener('dragstart', (e) => { row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            this.dom.subjectList.querySelectorAll('.subject-row').forEach(r => r.classList.remove('drag-over'));
            this.refreshSubjectBadges();
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = this.dom.subjectList.querySelector('.dragging');
            if (dragging && dragging !== row) {
                row.classList.add('drag-over');
                const rows = [...this.dom.subjectList.querySelectorAll('.subject-row')];
                const di = rows.indexOf(dragging), ti = rows.indexOf(row);
                if (di < ti) this.dom.subjectList.insertBefore(dragging, row.nextSibling);
                else this.dom.subjectList.insertBefore(dragging, row);
            }
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drag-over'); });
        this.dom.subjectList.appendChild(row);
    },
    refreshSubjectBadges() {
        this.dom.subjectList.querySelectorAll('.subject-row').forEach((row, idx) => {
            const badge = row.querySelector('.sub-row-num');
            if (badge) badge.textContent = idx + 1;
        });
    },
    // 과목명 기준 가나다순 정렬(이름이 비어있는 입력 중인 행은 맨 뒤로)
    sortSubjectRows() {
        const rows = [...this.dom.subjectList.querySelectorAll('.subject-row')];
        rows.sort((a, b) => {
            const an = a.querySelector('.set-sub-name').value.trim();
            const bn = b.querySelector('.set-sub-name').value.trim();
            if (!an && !bn) return 0;
            if (!an) return 1;
            if (!bn) return -1;
            return an.localeCompare(bn, 'ko');
        });
        rows.forEach(r => this.dom.subjectList.appendChild(r));
        this.refreshSubjectBadges();
    },
    renderPreferredSlotTable() { /* 선호 배정 시간이 과목 행에 통합되어 별도 렌더 불필요 */ },
    copyClassTable(c, btn) {
        const wData = this.state.history[this.state.currentWeek];
        const cd = wData.classes[c] || {};
        const bgColors = wData.bgColors?.[c] || {};
        const spCells = wData.specialistCells?.[String(c)] || {};
        const maxP = Math.max(...Object.values(this.state.config.periods));
        const tdS = 'border:1px solid #000000;padding:3px 14px;text-align:center;font-size:10pt;background:#ffffff;';
        const thS = 'border:1px solid #000000;padding:3px 14px;text-align:center;font-size:10pt;background:#f3f4f6;font-weight:bold;color:#000000;';
        const hdS = 'border:1px solid #000000;padding:4px 8px;text-align:center;font-size:11pt;font-weight:bold;background:#ffffff;color:#000000;';
        const pdS = 'border:1px solid #000000;padding:3px 8px;text-align:center;font-size:9pt;color:#666;background:#f3f4f6;';

        let t = `<table align="center" border="1" style="border-collapse:collapse;width:auto;min-width:300px;">`;
        t += `<tr><th colspan="${this.days.length + 1}" style="${hdS}">${c}반 시간표</th></tr>`;
        t += `<tr><th style="${thS}">교시</th>${this.days.map(d => `<th style="${thS}">${d}</th>`).join('')}</tr>`;
        for (let p = 0; p < maxP; p++) {
            t += `<tr><td style="${pdS}">${p + 1}</td>`;
            this.days.forEach(d => {
                if (p < this.state.config.periods[d]) {
                    const sub = (cd[d] && cd[d][p]) || '';
                    const customBg = bgColors[d]?.[p] ?? null;
                    const isSpCell = !!(spCells[d]?.[p]);
                    const sp = isSpCell ? this._spForCell(c, d, p) : null;
                    const bg = customBg || (sp && sp.bg) || null;
                    const bgAttr = bg ? ` bgcolor="${bg}"` : '';
                    const bgStyle = bg ? `background:${bg};` : '';
                    t += `<td${bgAttr} style="${tdS}${bgStyle}">${sub}</td>`;
                } else {
                    t += `<td bgcolor="#e5e7eb" style="${tdS}background:#e5e7eb;"></td>`;
                }
            });
            t += `</tr>`;
        }
        t += `</table>`;

        const blob = new Blob([t], { type: 'text/html' });
        const textBlob = new Blob([t], { type: 'text/plain' });
        try {
            navigator.clipboard.write([
                new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
            ]).then(() => {
                const orig = btn.textContent;
                btn.textContent = '✓ 복사됨';
                btn.style.color = '#16a34a';
                setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
            });
        } catch(e) {
            this.showToast('복사 실패: 브라우저가 지원하지 않습니다.');
        }
    },
    // 이번 주 반별 시간표 전체를 엑셀(.xls) 파일로 내보내기 — 화면에 보이는 반별 표와 동일한 색상/배치
    exportWeekToExcel() {
        const wData = this.state.history[this.state.currentWeek];
        const classCount = this.state.config.classCount;
        const maxP = Math.max(...Object.values(this.state.config.periods));

        const tdS = 'border:1px solid #000000;padding:3px 10px;text-align:center;font-size:10pt;background:#ffffff;';
        const thS = 'border:1px solid #000000;padding:3px 10px;text-align:center;font-size:10pt;background:#dbeafe;font-weight:bold;color:#000000;';
        const hdS = 'border:1px solid #000000;padding:4px 8px;text-align:center;font-size:11pt;font-weight:bold;background:#ffffff;color:#1d4ed8;';
        const pdS = 'border:1px solid #000000;padding:3px 8px;text-align:center;font-size:9pt;color:#666;background:#f3f4f6;';
        const gapS = 'border:none;background:#ffffff;';

        // 한 반의 헤더/요일행/교시행들을 <tr> 배열로 생성
        const buildRows = (c) => {
            const rows = [];
            if (c === null) {
                // 빈 자리(홀수 반 개수일 때 마지막 칸)
                rows.push(`<tr><td colspan="${this.days.length + 1}" style="${gapS}"></td></tr>`);
                for (let p = 0; p < maxP + 1; p++) rows.push(`<tr><td colspan="${this.days.length + 1}" style="${gapS}"></td></tr>`);
                return rows;
            }
            const cd = wData.classes[c] || {};
            const bgColors = wData.bgColors?.[c] || {};
            const spCells = wData.specialistCells?.[String(c)] || {};
            rows.push(`<tr><th colspan="${this.days.length + 1}" style="${hdS}">${c}반</th></tr>`);
            rows.push(`<tr><th style="${thS}">교시</th>${this.days.map(d => `<th style="${thS}">${d}</th>`).join('')}</tr>`);
            for (let p = 0; p < maxP; p++) {
                let r = `<tr><td style="${pdS}">${p + 1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        const sub = (cd[d] && cd[d][p]) || '';
                        const customBg = bgColors[d]?.[p] ?? null;
                        const isSpCell = !!(spCells[d]?.[p]);
                        const sp = isSpCell ? this._spForCell(c, d, p) : null;
                        const bg = customBg || (sp && sp.bg) || null;
                        const bgAttr = bg ? ` bgcolor="${bg}"` : '';
                        const bgStyle = bg ? `background:${bg};` : '';
                        r += `<td${bgAttr} style="${tdS}${bgStyle}">${sub}</td>`;
                    } else {
                        r += `<td bgcolor="#e5e7eb" style="${tdS}background:#e5e7eb;"></td>`;
                    }
                });
                r += `</tr>`;
                rows.push(r);
            }
            return rows;
        };

        // 반을 2개씩 짝지어(왼쪽/오른쪽) 세로로 쌓기
        let bodyRows = [];
        for (let c = 1; c <= classCount; c += 2) {
            const leftRows = buildRows(c);
            const rightRows = buildRows(c + 1 <= classCount ? c + 1 : null);
            for (let i = 0; i < leftRows.length; i++) {
                const leftCells = leftRows[i].replace(/^<tr>|<\/tr>$/g, '');
                const rightCells = rightRows[i].replace(/^<tr>|<\/tr>$/g, '');
                bodyRows.push(`<tr>${leftCells}<td style="${gapS}width:20px;"></td>${rightCells}</tr>`);
            }
            bodyRows.push(`<tr><td colspan="13" style="${gapS}height:14px;"></td></tr>`);
        }

        const range = this.getWeekDateRange(this.state.currentWeek) || '';
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${this.state.currentWeek}주차 시간표</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head><body>
<p style="font-size:13pt; font-weight:bold; margin-bottom:8px;">${this.state.currentWeek}주차 시간표 ${range}</p>
<table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
${bodyRows.join('')}
</table>
</body></html>`;

        const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.state.currentWeek}주차_반별시간표.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast('✅ 엑셀 파일을 내려받았습니다.');
    },

    async saveSettings() {
        const cnt = parseInt(this.dom.classCountInput.value); if(cnt < 1) return;
        this.state.config = { ...this.state.config, grade: this.dom.gradeInput.value, classCount: cnt };
        this.days.forEach(d => this.state.config.periods[d] = parseInt(this.dom.periodInputs[d].value));

        // Collect subjects from rows (in DOM order = user-sorted order)
        const subs = [];
        this.dom.subjectList.querySelectorAll('.subject-row').forEach(item => {
            const name = item.querySelector('.set-sub-name').value.trim();
            if (name) {
                const existing = this.state.config.subjects.find(s => s.name === name);
                const slotSelect = item.querySelector('.pref-slot-select');
                const slot = slotSelect ? parseInt(slotSelect.value) : (existing ? (existing.preferredSlot || 0) : 0);
                subs.push({ name, blockSize: existing ? existing.blockSize : 1, preferredSlot: slot });
            }
        });
        this.state.config.subjects = subs;
        this.saveData();
        if (this.state.isAdmin && this.state.roomCode) {
            try {
                await FirebaseDB.saveAdmin(this.state.roomCode, this.state);
            } catch(e) {
                this.showToast('⚠️ 서버 저장 실패: ' + e.message);
                return;
            }
        }
        this.showAlert('설정 저장 완료', '변경된 설정이 저장되었습니다.');
    },
    
    // 전담·주간 공통 고정 배정(specialistCells로 잠긴 칸)은 건드리지 않고, 담임 과목 배정만 지움
    _clearNonSpecialistCells(cNum) {
        const wData = this.state.history[this.state.currentWeek];
        const sc = wData.specialistCells?.[cNum] || {};
        this.days.forEach(d => {
            const arr = wData.classes[cNum][d] || [];
            for (let p = 0; p < arr.length; p++) {
                if (!sc[d]?.[p]) arr[p] = '';
            }
        });
    },
    clearClass(cNum) { this.showConfirm('반 시간표 초기화', `${cNum}반의 담임 과목 배정을 모두 지웁니다.<br>전담·고정 배정은 그대로 남습니다.<br>계속하시겠습니까?`).then(async r => { if(r){ this._clearNonSpecialistCells(cNum); this.saveData(); this.renderTimetableLayout(); if (this.state.isAdmin && this.state.roomCode) { const btn = document.querySelector(`.btn-clear-class-admin[data-cls="${cNum}"]`); if (btn) { btn.disabled = true; btn.textContent = '삭제 중...'; } try { await FirebaseDB.saveAdmin(this.state.roomCode, this.state); this.showToast(`✅ ${cNum}반 시간표를 삭제했습니다.`); } catch(e) { this.showToast('❌ 서버 저장 실패: ' + e.message); } finally { if (btn) { btn.disabled = false; btn.textContent = '삭제'; } } } } }); },
    clearAllClasses() { this.showConfirm('전체 시간표 초기화', '모든 반의 담임 과목 배정을 전부 지웁니다.<br>전담·고정 배정은 그대로 남습니다.<br>이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?').then(r => { if(r){ for(let c=1; c<=this.state.config.classCount; c++) this._clearNonSpecialistCells(c); this.saveData(); this.renderTimetableLayout(); } }); },
    createNewWeek() {
        const prevWeek = this.state.currentWeek;
        this.state.maxWeek++;
        this.state.currentWeek = this.state.maxWeek;
        this.initWeekData(this.state.currentWeek);
        // 전담 목표·메모는 매주 동일하므로 이전 주차에서 복사
        const prev = this.state.history[prevWeek];
        const curr = this.state.history[this.state.currentWeek];
        if (prev) {
            curr.specialistTargets = JSON.parse(JSON.stringify(prev.specialistTargets || {}));
            curr.specialistMemo = prev.specialistMemo || '';
            curr.specialists = JSON.parse(JSON.stringify(prev.specialists || this.state.specialists || []));
            // 전담 배정을 새 주차 반별 시간표에 기본으로 채움 (필요 없는 칸은 시간표에서 직접 지우면 됨)
            this._autofillSpecialistsForWeek(this.state.currentWeek);
            // 매주 반복으로 설정된 고정 배정을 새 주차에도 자동 적용
            (prev.fixedSlots || []).filter(r => r.repeat).forEach(r => this._applyFixedSlotRule(this.state.currentWeek, r));
        }
        this.saveData();
        this.renderTimetableLayout();
    },
    changeWeek(step) { const nw = this.state.currentWeek + step; if (nw > 0 && nw <= this.state.maxWeek) { this.state.currentWeek = nw; this.renderTimetableLayout(); } },
    goToWeek(w) {
        if (w < 1 || w > this.state.maxWeek || w === this.state.currentWeek) return;
        this.state.currentWeek = w;
        this.renderTimetableLayout();
    },
    renderWeekBookmarks() {
        const bar = document.getElementById('week-bookmark-bar');
        if (!bar) return;
        let h = '';
        for (let w = 1; w <= this.state.maxWeek; w++) {
            const active = w === this.state.currentWeek;
            h += `<button onclick="App.goToWeek(${w})" title="${w}주차로 이동"
                style="flex:0 0 auto; min-width:32px; padding:6px 4px 7px; border-radius:8px 8px 0 0;
                border:1.5px solid ${active ? '#16a34a' : '#e2e8f0'}; border-bottom:${active ? '1.5px solid #fff' : '1.5px solid #e2e8f0'};
                background:${active ? '#fff' : '#f8fafc'}; color:${active ? '#166534' : '#64748b'};
                font-weight:${active ? '800' : '600'}; font-size:0.8rem; cursor:pointer;
                position:relative; z-index:${active ? '2' : '1'};">${w}</button>`;
        }
        bar.innerHTML = h;
        const activeBtn = bar.children[this.state.currentWeek - 1];
        if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest', inline: 'center' });
    },
    spChangeWeek(step) { const nw = this.state.currentWeek + step; if (nw > 0 && nw <= this.state.maxWeek) { this.state.currentWeek = nw; this.renderSpecialistView(); } },

    // ── 주차 날짜 계산 ──────────────────────────────────────────
    // anchor { week, startDate:'YYYY-MM-DD' } 기준으로 week번째 주의 월요일 반환
    getWeekMonday(week) {
        const anchor = this.state.config?.weekAnchor;
        if (!anchor || !anchor.startDate) return null;
        const base = new Date(anchor.startDate + 'T00:00:00');
        const diff = (week - anchor.week) * 7;
        const mon = new Date(base);
        mon.setDate(base.getDate() + diff);
        return mon;
    },
    // 주차의 "M월 D일(요일)" 형식 날짜 반환 (offset: 0=월, 4=금)
    _fmtDate(monday, offset) {
        const days = ['월','화','수','목','금'];
        const d = new Date(monday);
        d.setDate(monday.getDate() + offset);
        return `${d.getMonth() + 1}월 ${d.getDate()}일(${days[offset]})`;
    },
    // 주차 날짜 범위 문자열 반환. anchor 없으면 null
    getWeekDateRange(week) {
        const mon = this.getWeekMonday(week);
        if (!mon) return null;
        return `${this._fmtDate(mon, 0)} ~ ${this._fmtDate(mon, 4)}`;
    },
    // 주차 날짜 표시 업데이트
    updateWeekDateDisplay() {
        const rangeEl = document.getElementById('week-date-range');
        const editBtn = document.getElementById('btn-edit-week-date');
        if (!rangeEl) return;
        const range = this.getWeekDateRange(this.state.currentWeek);
        rangeEl.textContent = range || '';
        if (editBtn) editBtn.classList.toggle('hide', !this.state.isAdmin);
        // 반별 시간표(single)면 날짜를 제목 오른쪽 인라인으로, 전체(all)면 아래에
        const group = document.querySelector('.week-label-group');
        if (group) group.classList.toggle('inline-mode', this._timetableMode !== 'all');
    },
    // 날짜 수정 모달 열기
    openWeekDateModal() {
        const modal = document.getElementById('week-date-modal');
        const input = document.getElementById('week-date-input');
        const preview = document.getElementById('week-date-preview');
        const title = document.getElementById('week-date-modal-title');
        if (!modal || !input) return;
        title.textContent = `${this.state.currentWeek}주차 날짜 수정`;
        // 기존 anchor에서 이 주차 월요일 계산
        const mon = this.getWeekMonday(this.state.currentWeek);
        if (mon) {
            input.value = mon.toISOString().slice(0, 10);
        } else {
            input.value = '';
        }
        const updatePreview = () => {
            if (!input.value) { preview.textContent = ''; return; }
            const d = new Date(input.value + 'T00:00:00');
            if (d.getDay() !== 1) {
                preview.textContent = '⚠️ 월요일 날짜를 선택해주세요.';
                preview.style.color = '#ef4444';
            } else {
                const fri = new Date(d); fri.setDate(d.getDate() + 4);
                const fmtD = dt => `${dt.getMonth()+1}월 ${dt.getDate()}일`;
                preview.textContent = `${this.state.currentWeek}주차: ${fmtD(d)}(월) ~ ${fmtD(fri)}(금)`;
                preview.style.color = '#3b82f6';
            }
        };
        input.oninput = updatePreview;
        updatePreview();
        modal.classList.remove('hide');
    },
    // 날짜 저장 (새 anchor 설정)
    saveWeekDate() {
        const input = document.getElementById('week-date-input');
        if (!input || !input.value) return;
        const d = new Date(input.value + 'T00:00:00');
        if (d.getDay() !== 1) {
            this.showAlert('입력 오류', '월요일 날짜를 선택해주세요.');
            return;
        }
        this.state.config.weekAnchor = { week: this.state.currentWeek, startDate: input.value };
        this.saveData();
        document.getElementById('week-date-modal').classList.add('hide');
        this.updateWeekDateDisplay();
        this.showToast(`✅ ${this.state.currentWeek}주차 날짜가 저장되었습니다.`);
        if (this.state.isAdmin && this.state.roomCode) {
            FirebaseDB.saveAdmin(this.state.roomCode, this.state).catch(e => this.showToast('⚠️ 서버 저장 실패: ' + e.message));
        }
    },
    
    toggleSpHide(idx) {
        const sp = this._sp()[idx];
        if (!sp.hiddenWeeks) sp.hiddenWeeks = [];
        const week = this.state.currentWeek;
        const i = sp.hiddenWeeks.indexOf(week);
        if (i === -1) sp.hiddenWeeks.push(week);
        else sp.hiddenWeeks.splice(i, 1);
        this.saveData();
        this.renderSpecialistView();
    },

    // 전담 보드 하나만 골라서 전체 시간표에 반영 (해당 주차에 없는 과목/줄어든 과목을 건너뛸 수 있게)
    // 전담 배정을 반별 시간표에 자동으로 채워 넣음. 이미 값이 있는 칸은 절대 덮어쓰지 않으므로
    // (X로 지운 칸이 다시 채워지지 않도록) 몇 번을 호출해도 안전합니다.
    _autofillSpecialistsForWeek(week) {
        const wData = this.state.history[week];
        if (!wData) return;
        const boards = (wData.specialists || []).filter(sp => (sp.subject || sp.name) && !(sp.hiddenWeeks || []).includes(week));
        if (!wData.specialistCells) wData.specialistCells = {};
        const mark = (cStr, d, p, sub) => {
            wData.classes[cStr][d][p] = sub;
            if (!wData.specialistCells[cStr]) wData.specialistCells[cStr] = {};
            if (!wData.specialistCells[cStr][d]) wData.specialistCells[cStr][d] = {};
            wData.specialistCells[cStr][d][p] = true;
        };

        boards.forEach(sp => {
            const sub = sp.subject || sp.name;
            for (let c = 1; c <= this.state.config.classCount; c++) {
                const cStr = String(c);
                if (!wData.classes[cStr]) wData.classes[cStr] = { "월": [], "화": [], "수": [], "목": [], "금": [] };
                this.days.forEach(d => { if (!wData.classes[cStr][d]) wData.classes[cStr][d] = []; });
            }

            if (sp.weeklyCount == null) {
                // 반마다 후보 칸을 전부 채움 (기본 동작 — 후보가 반별로 1개씩만 등록된 보드용)
                for (let c = 1; c <= this.state.config.classCount; c++) {
                    const cStr = String(c), classData = wData.classes[cStr];
                    this.days.forEach(d => {
                        if (!sp.data[d]) return;
                        for (let p = 0; p < this.state.config.periods[d]; p++) {
                            if (!sp.data[d][p]) continue;
                            const classes = String(sp.data[d][p]).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
                            if (classes.includes(cStr) && !classData[d][p]) mark(cStr, d, p, sub);
                        }
                    });
                }
            } else {
                // 반마다 "주당 실제 사용" 횟수만큼만 골라 채우고, 같은 시간에 다른 반과 겹치지 않게 함
                // (과학실처럼 후보 칸이 여러 개 등록된 자원 — 실제로 쓰는 건 그중 일부뿐)
                const usedSlots = new Set();
                for (let c = 1; c <= this.state.config.classCount; c++) {
                    const cStr = String(c), classData = wData.classes[cStr];
                    const candidates = [];
                    this.days.forEach(d => {
                        if (!sp.data[d]) return;
                        for (let p = 0; p < this.state.config.periods[d]; p++) {
                            if (!sp.data[d][p]) continue;
                            const classes = String(sp.data[d][p]).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
                            if (classes.includes(cStr)) candidates.push([d, p]);
                        }
                    });
                    let filled = 0;
                    for (const [d, p] of candidates) {
                        if (filled >= sp.weeklyCount) break;
                        const key = `${d}-${p}`;
                        if (usedSlots.has(key) || classData[d][p]) continue;
                        mark(cStr, d, p, sub);
                        usedSlots.add(key);
                        filled++;
                    }
                }
            }
        });
        wData.specialistAutofilled = true;
        this._syncSpecialistTargets(week);
    },

    // "주당 실제 사용" 값을 바꾼 뒤, 이번 주에 지금 설정대로 맞춰 정리 (사람이 버튼을 눌러야만 실행됨).
    // 자동 채움과 달리 초과분은 지우고 부족분은 채워서 정확히 그 횟수에 맞춥니다.
    reconcileSpecialistNow(idx) {
        const sp = this._sp()[idx];
        if (!sp) return;
        const sub = sp.subject || sp.name;
        if (!sub) { this.showToast('과목명을 먼저 입력하세요.'); return; }
        if (sp.weeklyCount == null) { this.showToast('"주당 실제 사용" 횟수를 먼저 입력해주세요.'); return; }

        this.showConfirm('이번 주 정리', `<b>${sub}</b>을(를) 이번 주 시간표에서 반마다 <b>${sp.weeklyCount}회</b>에 맞춰 정리합니다.<br>많으면 지우고, 적으면 채웁니다.<br><br>계속하시겠습니까?`).then(r => {
            if (!r) return;
            const week = this.state.currentWeek;
            const wData = this.state.history[week];
            if (!wData.specialistCells) wData.specialistCells = {};
            const mark = (cStr, d, p) => {
                wData.classes[cStr][d][p] = sub;
                if (!wData.specialistCells[cStr]) wData.specialistCells[cStr] = {};
                if (!wData.specialistCells[cStr][d]) wData.specialistCells[cStr][d] = {};
                wData.specialistCells[cStr][d][p] = true;
            };
            const unmark = (cStr, d, p) => {
                wData.classes[cStr][d][p] = '';
                if (wData.specialistCells[cStr]?.[d]) delete wData.specialistCells[cStr][d][p];
            };

            // 1단계: 지금 이 과목이 채워진 칸을 전부 훑어서 반별 개수와 사용 중인 슬롯을 파악
            const usedSlots = new Set();
            const classCounts = {};
            for (let c = 1; c <= this.state.config.classCount; c++) {
                const cStr = String(c), classData = wData.classes[cStr] || {};
                let cnt = 0;
                this.days.forEach(d => {
                    const arr = classData[d] || [];
                    for (let p = 0; p < arr.length; p++) {
                        if (arr[p] === sub && wData.specialistCells[cStr]?.[d]?.[p]) { cnt++; usedSlots.add(`${d}-${p}`); }
                    }
                });
                classCounts[cStr] = cnt;
            }

            let removed = 0, added = 0;
            for (let c = 1; c <= this.state.config.classCount; c++) {
                const cStr = String(c), classData = wData.classes[cStr];
                let filled = classCounts[cStr];

                // 초과분 지우기 (요일 순서상 뒤에 있는 것부터)
                if (filled > sp.weeklyCount) {
                    let kept = 0;
                    for (const d of this.days) {
                        const arr = classData[d] || [];
                        for (let p = 0; p < arr.length; p++) {
                            if (arr[p] === sub && wData.specialistCells[cStr]?.[d]?.[p]) {
                                if (kept < sp.weeklyCount) kept++;
                                else { unmark(cStr, d, p); usedSlots.delete(`${d}-${p}`); filled--; removed++; }
                            }
                        }
                    }
                }

                // 부족분 채우기 (다른 반이 이미 쓰는 시간은 건너뜀)
                if (filled < sp.weeklyCount) {
                    const candidates = [];
                    this.days.forEach(d => {
                        if (!sp.data[d]) return;
                        for (let p = 0; p < this.state.config.periods[d]; p++) {
                            if (!sp.data[d][p]) continue;
                            const classes = String(sp.data[d][p]).split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
                            if (classes.includes(cStr)) candidates.push([d, p]);
                        }
                    });
                    for (const [d, p] of candidates) {
                        if (filled >= sp.weeklyCount) break;
                        const key = `${d}-${p}`;
                        if (usedSlots.has(key) || classData[d][p]) continue;
                        mark(cStr, d, p);
                        usedSlots.add(key);
                        filled++;
                        added++;
                    }
                }
            }

            this._syncSpecialistTargets(week);
            this.saveData();
            this.renderTimetableLayout();
            this.showToast(`✅ 정리 완료 — ${removed}칸 지움, ${added}칸 채움`);
        });
    },

    // 전담 과목의 "이번 주 목표"를 실제 시간표에 채워진 개수와 항상 일치하게 맞춤 (늘어도 줄어도 반영)
    _syncSpecialistTargets(week) {
        const wData = this.state.history[week];
        if (!wData) return;
        if (!wData.targets) wData.targets = {};
        const specialistSubs = new Set((wData.specialists || [])
            .filter(sp => !(sp.hiddenWeeks || []).includes(week))
            .map(sp => sp.subject || sp.name)
            .filter(Boolean));
        specialistSubs.forEach(sub => { wData.targets[sub] = this._avgFilledForSubject(week, sub); });
    },

    // 현재 주차에서 이 과목이 전담 배정으로 자동 집계되는 과목인지
    _isSpecialistManagedSubject(sub) {
        const boards = this._sp();
        return boards.some(sp => (sp.subject || sp.name) === sub && !(sp.hiddenWeeks || []).includes(this.state.currentWeek));
    },

    /* 반별 시간표 테이블 HTML — 헤더: [1반 | 월 | 화 | 수 | 목 | 금] 한 행 */
    _buildClassTableHtml(c, cls) {
        const wData = this.state.history[this.state.currentWeek];
        const cd = wData.classes[c] || {};
        const bgColors = wData.bgColors?.[c] || {};
        const spCells = wData.specialistCells?.[String(c)] || {};
        const maxP = Math.max(...Object.values(this.state.config.periods));
        const p = cls;
        const colgroup = `<colgroup><col class="${p}-col-pd">${this.days.map(() => `<col>`).join('')}</colgroup>`;
        let h = `<table class="${p}-table">${colgroup}
            <thead>
                <tr>
                    <th class="${p}-class-th">${c}반</th>
                    ${this.days.map(d => `<th class="${p}-day-th">${d}</th>`).join('')}
                </tr>
            </thead><tbody>`;
        for (let row = 0; row < maxP; row++) {
            h += `<tr><td class="${p}-pd-td">${row + 1}</td>`;
            this.days.forEach(d => {
                if (row < this.state.config.periods[d]) {
                    const sub = (cd[d] && cd[d][row]) || '';
                    const customBg = bgColors[d]?.[row] ?? null;
                    const isSpCell = !!(spCells[d]?.[row]);
                    const sp = isSpCell ? this._spForCell(c, d, row) : null;
                    const bg = customBg || (sp && sp.bg) || null;
                    const style = bg ? ` style="background-color:${bg};-webkit-print-color-adjust:exact;print-color-adjust:exact;"` : '';
                    h += `<td${style}>${sub}</td>`;
                } else {
                    h += `<td class="${p}-disabled-td"></td>`;
                }
            });
            h += `</tr>`;
        }
        return h + `</tbody></table>`;
    },

    /* 전담 시간표 테이블 HTML */
    _buildSpTableHtml(sp, cls) {
        const p = cls;
        const maxP = Math.max(...Object.values(this.state.config.periods));
        const bg = sp.bg || '#f1f5f9';
        const hex = bg.replace('#', '');
        const r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16);
        const brightness = (r*299 + g*587 + b*114) / 1000;
        const textColor = brightness > 150 ? '#1e293b' : '#ffffff';

        const colgroup = `<colgroup><col class="${p}-col-pd">${this.days.map(() => `<col>`).join('')}</colgroup>`;
        let h = `<table class="${p}-table">${colgroup}
            <thead>
                <tr>
                    <th class="${p}-sp-name-th" colspan="${this.days.length + 1}"
                        style="background-color:${bg};color:${textColor};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
                        ${sp.subject || '(미설정)'}${sp.desc ? `<span class="${p}-sp-desc">${sp.desc}</span>` : ''}
                    </th>
                </tr>
                <tr>
                    <th class="${p}-sp-day-th"></th>
                    ${this.days.map(d => `<th class="${p}-sp-day-th">${d}</th>`).join('')}
                </tr>
            </thead><tbody>`;
        for (let row = 0; row < maxP; row++) {
            h += `<tr><td class="${p}-pd-td">${row + 1}</td>`;
            this.days.forEach(d => {
                if (row < this.state.config.periods[d]) {
                    const val = (sp.data && sp.data[d] && sp.data[d][row]) ? sp.data[d][row] : '';
                    const markBg = sp.marks && sp.marks[`${d}_${row}`];
                    const markStyle = markBg ? ` style="background-color:${markBg};-webkit-print-color-adjust:exact;print-color-adjust:exact;"` : '';
                    h += `<td${markStyle}>${val}</td>`;
                } else {
                    h += `<td class="${p}-disabled-td"></td>`;
                }
            });
            h += `</tr>`;
        }
        return h + `</tbody></table>`;
    },

    /* 공통 HTML 빌드 (preview용 ppo / 인쇄용 pt 클래스 전환) */
    _buildFullPrintHtml(cls) {
        const gradeText = this.state.config.grade ? `${this.state.config.grade}학년 ` : '';
        const cc = this.state.config.classCount;
        const p = cls;
        const sps = this._sp().filter(s => (s.subject || s.name) && !(s.hiddenWeeks || []).includes(this.state.currentWeek));

        // ── 반 수에 따른 동적 레이아웃 ─────────────────────────
        // 3열 기준: 14반까지 5행(250mm)으로 A4에 충분히 들어감 → 최대 3열
        const cols = cc <= 4 ? 2 : 3;

        // 전담 시간표 열 수 (2장 분리 시 전담 수 기준으로 재계산)
        const spColsSeparate = sps.length <= 4 ? 2 : 3;

        // 1장 통합 여부: 반 행수 + 전담 행수가 페이지 높이(1060px)에 맞는지
        const rowHeightPx = { 2: 175, 3: 145 };
        const classRows = Math.ceil(cc / cols);
        const spRows    = Math.ceil(sps.length / cols);
        const combinePages = sps.length === 0 ||
            (classRows + spRows) * rowHeightPx[cols] + 40 <= 1060;

        const spCols = combinePages ? cols : spColsSeparate;

        // 열 수별 셀 크기 재정의 (기존 고정 CSS를 덮어씀)
        const sizeCSS = {
            2: `.${p}-table{font-size:11px}.${p}-table th,.${p}-table td{height:20px;padding:3px 2px;font-size:10.5px}.${p}-class-th{font-size:13px;padding:8px 4px}.${p}-col-pd{width:26px}`,
            3: `.${p}-table{font-size:10.5px}.${p}-table th,.${p}-table td{height:17px;padding:2px 1px;font-size:10px}.${p}-class-th{font-size:12px;padding:7px 4px}.${p}-col-pd{width:24px}`,
        }[cols];

        /* 1페이지: 반별 시간표 */
        let page1 = `<style>${sizeCSS}</style>`;
        page1 += `<div class="${p}-doc-title">${gradeText}${this.state.currentWeek}주차 주간학습안내</div>`;
        page1 += `<div class="${p}-grid ${p}-grid-${cols}">`;
        for (let c = 1; c <= cc; c++) page1 += this._buildClassTableHtml(c, cls);
        page1 += `</div>`;

        /* 전담 시간표 */
        let page2 = '';
        if (sps.length > 0) {
            const emptyCount = Math.ceil(sps.length / spCols) * spCols - sps.length;
            let spHtml = `<div class="${p}-doc-title" style="margin-top:0;">전담 시간표</div>`;
            spHtml += `<div class="${p}-grid ${p}-grid-${spCols}">`;
            sps.forEach(sp => { spHtml += this._buildSpTableHtml(sp, cls); });
            for (let i = 0; i < emptyCount; i++) spHtml += `<div style="visibility:hidden;"></div>`;
            spHtml += `</div>`;

            if (combinePages) {
                // 반 시간표 아래에 이어서 출력
                page1 += `<div style="margin-top:12px;border-top:1.5px solid #e2e8f0;padding-top:10px;">${spHtml}</div>`;
            } else {
                page2 = spHtml;
            }
        }

        return { page1, page2 };
    },

    showPrintPreview() {
        const overlay = document.getElementById('print-preview-overlay');
        const body = document.getElementById('ppo-content')?.parentElement;
        const ppoBody = document.querySelector('.ppo-body');
        if (!overlay || !ppoBody) return;

        // 기존 페이지 초기화
        ppoBody.innerHTML = '';

        const { page1, page2 } = this._buildFullPrintHtml('ppo');

        const mkPage = html => {
            const div = document.createElement('div');
            div.className = 'ppo-page';
            div.innerHTML = html;
            ppoBody.appendChild(div);
        };

        mkPage(page1);
        if (page2) mkPage(page2);

        overlay.classList.remove('hide');
    },

    async downloadPDF() {
        const btn = document.getElementById('btn-ppo-download');
        const origText = btn.textContent;
        btn.textContent = '생성 중...'; btn.disabled = true;
        try {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pages = document.querySelectorAll('.ppo-page');
            const a4W = 210, a4H = 297;

            for (let i = 0; i < pages.length; i++) {
                const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                if (i > 0) pdf.addPage();
                pdf.addImage(imgData, 'JPEG', 0, 0, a4W, a4H);
            }

            const gradeText = this.state.config.grade ? `${this.state.config.grade}학년_` : '';
            pdf.save(`${gradeText}${this.state.currentWeek}주차_주간학습안내.pdf`);
        } catch(e) {
            alert('PDF 생성 중 오류가 발생했습니다.');
        } finally {
            btn.textContent = origText; btn.disabled = false;
        }
    },

    printPDF() {
        const gradeText = this.state.config.grade ? `${this.state.config.grade}학년 ` : '';
        const { page1, page2 } = this._buildFullPrintHtml('pt');

        const css = `
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap');
            * { box-sizing: border-box; }
            body { margin:0; padding:0; font-family:'Noto Sans KR','Malgun Gothic',sans-serif; background:#fff; font-size:10.5px; }
            @page { size:A4 portrait; margin:14mm 12mm; }
            .pt-doc-title { text-align:center; font-size:1.15rem; font-weight:800; padding:9px 16px; margin-bottom:14px; border-bottom:2px solid #1e293b; letter-spacing:1.5px; color:#1e293b; }
            .pt-grid { display:grid; gap:10px; align-items:stretch; }
            .pt-grid-2 { grid-template-columns:repeat(2,1fr); }
            .pt-grid-3 { grid-template-columns:repeat(3,1fr); }
            .pt-grid-4 { grid-template-columns:repeat(4,1fr); }
            .pt-table { width:100%; height:100%; border-collapse:collapse; table-layout:fixed; font-size:10.5px; text-align:center; font-family:'Noto Sans KR','Malgun Gothic',sans-serif; font-weight:500; letter-spacing:-0.2px; border:1px solid #e2e8f0; page-break-inside:avoid; }
            .pt-col-pd { width:36px; }
            .pt-table th, .pt-table td { border:1px solid #e2e8f0; padding:6px 1px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; letter-spacing:-0.8px; }
            .pt-class-th { background:#1e293b !important; color:#fff; font-size:12px; font-weight:900; padding:8px 4px; letter-spacing:0.5px; white-space:nowrap; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .pt-day-th { background:#f1f5f9 !important; font-weight:700; font-size:10px; color:#475569; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .pt-pd-td { background:#f8fafc; font-weight:700; color:#94a3b8; font-size:9.5px; }
            .pt-disabled-td { background:#f1f5f9; }
            .pt-sp-name-th { font-size:9.5px; font-weight:800; padding:3px 6px; text-align:center; letter-spacing:0.3px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .pt-sp-day-th { background:#f1f5f9; font-weight:700; font-size:9px; color:#475569; padding:2px 1px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .pt-sp-desc { font-family:inherit; font-weight:600; font-size:9.5px; opacity:0.9; border-left:1.5px solid currentColor; margin-left:8px; padding-left:8px; }
            .pt-page-break { page-break-before:always; }
        `;

        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) { window.print(); return; }
        const p2Block = page2 ? `<div class="pt-page-break">${page2}</div>` : '';
        win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
            <title>${gradeText}${this.state.currentWeek}주차 주간학습안내</title>
            <style>${css}</style></head><body>${page1}${p2Block}</body></html>`);
        win.document.close();
        win.focus();
        setTimeout(() => { win.print(); win.close(); }, 400);
    },

    downloadWord() {


        const gradeText = this.state.config.grade ? `${this.state.config.grade}학년 ` : '';
        const cc = this.state.config.classCount;
        const maxP = Math.max(...Object.values(this.state.config.periods));

        const tdStyle = 'border:1px solid #aaa; padding:5px 8px; text-align:center; font-size:11pt;';
        const thStyle = 'border:1px solid #aaa; padding:5px 8px; text-align:center; font-size:11pt; background:#f3f4f6; font-weight:bold;';
        const classThStyle = 'border:1px solid #aaa; padding:5px 8px; text-align:center; font-size:12pt; font-weight:bold; background:#1e293b; color:#ffffff;';
        const pdStyle = 'border:1px solid #aaa; padding:5px 8px; text-align:center; font-size:10pt; color:#666; background:#f8fafc;';

        const buildClassTable = (c) => {
            const cd = this.state.history[this.state.currentWeek].classes[c] || {};
            let t = `<table style="border-collapse:collapse; width:100%; margin-bottom:12pt;">
                <tr><th style="${classThStyle}" colspan="${this.days.length + 1}">${c}반</th></tr>
                <tr><th style="${thStyle}"></th>${this.days.map(d => `<th style="${thStyle}">${d}</th>`).join('')}</tr>`;
            for (let p = 0; p < maxP; p++) {
                t += `<tr><td style="${pdStyle}">${p + 1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        const sub = (cd[d] && cd[d][p]) || '';
                        const sp = this._spForCell(c, d, p);
                        const bg = (sp && sp.bg) ? `background:${sp.bg};` : '';
                        t += `<td style="${tdStyle}${bg}">${sub}</td>`;
                    } else {
                        t += `<td style="${tdStyle}background:#e5e7eb;"></td>`;
                    }
                });
                t += `</tr>`;
            }
            return t + `</table>`;
        };

        const buildSpTable = (sp) => {
            const bg = sp.bg || '#f1f5f9';
            const desc = sp.desc ? ` | ${sp.desc}` : '';
            let t = `<table style="border-collapse:collapse; width:100%; margin-bottom:12pt;">
                <tr><th style="${thStyle}background:${bg}; color:#1e293b;" colspan="${this.days.length + 1}">${sp.subject || ''}${desc}</th></tr>
                <tr><th style="${thStyle}"></th>${this.days.map(d => `<th style="${thStyle}">${d}</th>`).join('')}</tr>`;
            for (let p = 0; p < maxP; p++) {
                t += `<tr><td style="${pdStyle}">${p + 1}</td>`;
                this.days.forEach(d => {
                    if (p < this.state.config.periods[d]) {
                        const val = (sp.data && sp.data[d] && sp.data[d][p]) || '';
                        t += `<td style="${tdStyle}">${val}</td>`;
                    } else {
                        t += `<td style="${tdStyle}background:#e5e7eb;"></td>`;
                    }
                });
                t += `</tr>`;
            }
            return t + `</table>`;
        };

        // 1페이지: 반별 시간표
        let body = `<h2 style="text-align:center; font-size:16pt; margin-bottom:16pt;">${gradeText}${this.state.currentWeek}주차 주간학습안내</h2>`;
        for (let c = 1; c <= cc; c++) body += buildClassTable(c);

        // 2페이지: 전담 시간표
        const sps = this._sp().filter(s => s.subject || s.name);
        if (sps.length > 0) {
            body += `<br style="page-break-before:always">`;
            body += `<h2 style="text-align:center; font-size:16pt; margin-bottom:16pt;">전담 시간표</h2>`;
            sps.forEach(sp => { body += buildSpTable(sp); });
        }

        const html = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office'
                  xmlns:w='urn:schemas-microsoft-com:office:word'
                  xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset="utf-8">
            <style>
                body { font-family: '맑은 고딕', sans-serif; margin: 20mm; }
                table { border-collapse: collapse; width: 100%; margin-bottom: 14pt; }
                td, th { border: 1px solid #aaa; padding: 5px 8px; text-align: center; font-size: 11pt; }
                @page { size: A4; margin: 15mm; }
            </style>
            </head><body>${body}</body></html>`;
        const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${gradeText}${this.state.currentWeek}주차_주간학습안내.doc`;
        a.click();
        URL.revokeObjectURL(url);
    },

    runFinalCheck() {
        const wData = this.state.history[this.state.currentWeek];
        if (!wData) return this.showAlert('점검 불가', '현재 주차 데이터가 없습니다.');
        const targets = wData.targets || {};
        const issues = [];

        // ① 전담 일치 확인
        this._sp().forEach(sp => {
            if ((sp.hiddenWeeks || []).includes(this.state.currentWeek)) return;
            const spName = sp.subject || '전담';
            this.days.forEach(d => {
                const maxP = this.state.config.periods[d] || 0;
                for (let p = 0; p < maxP; p++) {
                    const val = sp.data[d] && sp.data[d][p] ? String(sp.data[d][p]).trim() : '';
                    if (!val) continue;
                    const classes = val.split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
                    classes.forEach(c => {
                        const cNum = parseInt(c);
                        if (!cNum || cNum < 1 || cNum > this.state.config.classCount) return;
                        const cellVal = (wData.classes[cNum]?.[d]?.[p] || '').trim();
                        if (cellVal !== spName) {
                            issues.push({
                                type: 'sp',
                                msg: `${cNum}반 ${d}요일 ${p+1}교시 — 전담(${spName}) 미입력 (현재: "${cellVal || '빈칸'}")`
                            });
                        }
                    });
                }
            });
        });

        // ② 차시 목표 달성 확인
        for (let c = 1; c <= this.state.config.classCount; c++) {
            const classData = wData.classes[c] || {};
            const counts = {};
            this.state.config.subjects.forEach(s => { counts[s.name] = 0; });
            this.days.forEach(d => {
                const mp = this.state.config.periods[d] || 0;
                for (let p = 0; p < mp; p++) {
                    const v = (classData[d]?.[p] || '').trim();
                    if (v && counts[v] !== undefined) counts[v]++;
                }
            });
            this.state.config.subjects.forEach(s => {
                const target = targets[s.name] || 0;
                if (target === 0) return;
                const actual = counts[s.name] || 0;
                if (actual < target) {
                    issues.push({ type: 'short', msg: `${c}반 ${s.name} — 목표 ${target}차시 중 ${actual}차시만 입력 (${target - actual}차시 부족)` });
                } else if (actual > target) {
                    issues.push({ type: 'over', msg: `${c}반 ${s.name} — 목표 ${target}차시 초과 입력 (${actual}차시)` });
                }
            });
        }

        // 결과 표시 (print-preview-overlay 위에 전용 패널 사용)
        const fcOverlay = document.getElementById('final-check-overlay');
        const fcTitle = document.getElementById('fc-title');
        const fcContent = document.getElementById('fc-content');

        if (issues.length === 0) {
            fcTitle.textContent = '최종 점검 완료';
            fcContent.innerHTML = `<div style="text-align:center; font-size:1rem; color:#059669; padding:16px 0;">✅ 모든 반의 전담 배치와 차시가 정확합니다.</div>`;
        } else {
            const spIssues = issues.filter(i => i.type === 'sp');
            const shortIssues = issues.filter(i => i.type === 'short');
            const overIssues = issues.filter(i => i.type === 'over');
            fcTitle.textContent = `최종 점검 결과 — ${issues.length}건 발견`;
            let html = `<div style="font-size:0.85rem; text-align:left;">`;
            if (spIssues.length > 0) {
                html += `<div style="font-weight:700; color:#b91c1c; margin-bottom:6px;">⚠️ 전담 불일치 (${spIssues.length}건)</div>`;
                html += `<ul style="margin:0 0 14px 16px; padding:0; color:#b91c1c;">` + spIssues.map(i => `<li style="margin-bottom:4px;">${i.msg}</li>`).join('') + `</ul>`;
            }
            if (shortIssues.length > 0) {
                html += `<div style="font-weight:700; color:#92400e; margin-bottom:6px;">📉 차시 부족 (${shortIssues.length}건)</div>`;
                html += `<ul style="margin:0 0 14px 16px; padding:0; color:#92400e;">` + shortIssues.map(i => `<li style="margin-bottom:4px;">${i.msg}</li>`).join('') + `</ul>`;
            }
            if (overIssues.length > 0) {
                html += `<div style="font-weight:700; color:#1d4ed8; margin-bottom:6px;">📈 차시 초과 (${overIssues.length}건)</div>`;
                html += `<ul style="margin:0 0 14px 16px; padding:0; color:#1d4ed8;">` + overIssues.map(i => `<li style="margin-bottom:4px;">${i.msg}</li>`).join('') + `</ul>`;
            }
            html += `</div>`;
            fcContent.innerHTML = html;
        }
        fcOverlay.style.display = 'flex';
    },

    async printWeeklyGuide() {
        if (this.state.roomCode && this.state.isDirty) {
            const classNum = this.state.userProfile?.classNum;
            const confirmed = await this.showConfirm(
                '저장하지 않은 변경사항',
                `저장하지 않은 내용은 주간학습안내에 반영되지 않습니다.<br><b>${classNum}반 시간표를 저장 후 출력</b>하시겠습니까?`
            );
            if (confirmed) {
                await this.saveClassToServer(classNum);
            } else {
                return;
            }
        }
        this.showPrintPreview();
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
