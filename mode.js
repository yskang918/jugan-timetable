/* =========================================================
   mode.js  —  서버 모드 초기화 (방 코드 없이 바로 진입)
   링크를 여는 모든 사람이 자동으로 같은 방("주간학습안내반별시간표배정")에
   들어가고, 로그인 화면 없이 바로 전체 시간표가 보입니다.
   ========================================================= */

const ROOM_CODE = '주간학습안내반별시간표배정';

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
            this.state.roomCode = ROOM_CODE;
            this.state.isAdmin = true;
            if (this.dom.loginOverlay) this.dom.loginOverlay.classList.add('hide');
            if (this.dom.userBadge) this.dom.userBadge.classList.add('hide');
            this._setServerBtns(true);
            this.updateNavForRole();
            if (fromInit) this.loadFromServer().then(() => {
                // 첫 화면은 시간표 저장소 — 지금까지 만든 주차를 고르거나 새로 만든다
                if (this.state.maxWeek > 0) this.state.currentWeek = this.state.maxWeek;
                this.initWeekData(this.state.currentWeek);
                this.openLibrary();
            });
        };
    } catch (e) {}
});
