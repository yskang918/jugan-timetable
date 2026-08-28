/* =========================================================
   mode.js  —  서버 모드 초기화
   데이터는 Firebase에 저장되고, 같은 학년 선생님들이 같은 화면을 봅니다.
   ========================================================= */

window._appMode = 'server';

(function initMode() {
  document.body.classList.add('server-mode');
  DB.setServer();
})();
