/* =========================================================
   firebase-init.js  —  Firebase 연결 설정
   이 값들은 공개되어도 되는 값입니다(브라우저에 그대로 노출되는 것이 정상).
   실제 접근 제한은 Firestore 보안 규칙에서 겁니다.
   ========================================================= */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDlp9D56XvH0Z2iEKayEuo3eCKfMol6j7c",
  authDomain: "ver1-2cf47.firebaseapp.com",
  projectId: "ver1-2cf47",
  storageBucket: "ver1-2cf47.firebasestorage.app",
  messagingSenderId: "748258968819",
  appId: "1:748258968819:web:2ee4517599f203ff1da386"
};

firebase.initializeApp(FIREBASE_CONFIG);

// 오프라인에서도 열람/수정이 되도록 로컬 캐시를 켭니다.
// 탭을 여러 개 띄우면 한 탭에서만 켜지는데, 실패해도 앱은 정상 동작합니다.
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(() => {});
