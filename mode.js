/* =========================================================
   mode.js  —  서버 모드 초기화 (학년별 방)

   학년마다 완전히 분리된 방을 쓴다. 3학년에서 설정을 바꿔도
   다른 학년 데이터에는 영향이 없다.

   들어갈 학년을 정하는 순서:
     1) 주소에 ?grade=3 이 있으면 그 학년 (담당자별 링크용)
     2) 전에 고른 학년이 이 브라우저에 기억되어 있으면 그 학년
     3) 둘 다 없으면 학년 선택 화면을 띄운다
   ========================================================= */

const ROOM_PREFIX = '주간학습_';
const GRADE_KEY = 'jugan-grade';        // 이 브라우저가 마지막으로 고른 학년
const LAST_ROOM_KEY = 'jugan-last-room'; // 마지막으로 연 방 (학년이 바뀌면 남은 데이터를 비우는 판단에 씀)

function _validGrade(v) {
    const n = parseInt(v, 10);
    return (Number.isInteger(n) && n >= 1 && n <= 6) ? n : null;
}
function _gradeFromUrl() {
    try { return _validGrade(new URLSearchParams(location.search).get('grade')); }
    catch (e) { return null; }
}
function _gradeFromStorage() {
    try { return _validGrade(localStorage.getItem(GRADE_KEY)); }
    catch (e) { return null; }
}

window._appMode = 'server';

(function initMode() {
    document.body.classList.add('server-mode');
    DB.setServer();
})();

document.addEventListener('DOMContentLoaded', function () {
    try {
        // 로그인 화면을 건너뛰고 곧바로 관리자로 입장합니다.
        App.checkLogin = function (fromInit = false) {
            if (!this.state.userProfile) {
                this.state.userProfile = { name: '선생님', classNum: 1, isSpecialist: false };
            }
            this.state.isAdmin = true;
            if (this.dom.loginOverlay) this.dom.loginOverlay.classList.add('hide');
            if (this.dom.userBadge) this.dom.userBadge.classList.add('hide');
            this._setServerBtns(true);
            this.updateNavForRole();
            if (!fromInit) return;

            const grade = _gradeFromUrl() || _gradeFromStorage();
            if (grade) this.enterGrade(grade);
            else this.openGradePicker();
        };
    } catch (e) {}
});
