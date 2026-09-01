# 주간학습 프로그램

초등학교 주간학습안내(주간 시간표) 자동 편성 웹앱입니다.

## 주소

같은 데이터를 보는 두 개의 주소가 있습니다. 어느 쪽으로 들어가도 내용은 같습니다.

| 주소 | 비고 |
|---|---|
| https://ver1-2cf47.web.app | **권장.** Firebase Hosting — 학교망에서 GitHub이 막혀도 접속됩니다 |
| https://yskang918.github.io/jugan-timetable/ | GitHub Pages — 기존 주소, 그대로 유지 |

## 사용법

**시간표 저장소**(첫 화면)에서 시간표를 고르거나 새로 만든 뒤, 1 → 2 → 3단계로 진행합니다.

1. **1단계** — 이번 주에 쓸 전담 과목을 토글로 켜고, 자리를 확인·조정합니다
2. **2단계** — 과목별 이번 주 차시를 정합니다 (전담은 자동 계산)
3. **3단계** — `과목 배정`으로 나머지를 채우고, PDF·이미지로 저장하거나 인쇄합니다

작업 내용은 자동 저장되므로 따로 저장 버튼을 누를 필요가 없습니다.
처음 쓰신다면 첫 화면의 **🎓 튜토리얼**을 눌러보세요.

## 배포

수정 후 두 곳 모두에 반영하려면:

```bash
# 1) index.html의 ?v= 값을 새 값으로 바꾼다 (캐시 때문에 필수)
# 2) GitHub Pages
git add -A && git commit -m "..." && git push
# 3) Firebase Hosting
firebase deploy --only hosting
```

`firebase deploy`는 `firebase login`이 되어 있어야 합니다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 구조 |
| `app.js` | 전체 로직 (저장소 · 1~3단계 · 설정 · 튜토리얼) |
| `style.css` | 스타일 |
| `firebase-init.js` | Firebase 프로젝트 연결 설정 |
| `db.js` | 데이터 저장 계층 — 로컬(LocalDB) / 서버(FirestoreDB) provider 교체 구조 |
| `mode.js` | 서버 모드 초기화 · 방 코드 |
| `vendor/` | html2canvas · jsPDF — 외부 CDN이 막힌 망에서도 PDF·이미지 저장이 되도록 직접 포함 |
| `firebase.json` | Firebase Hosting 설정 (index.html 캐시 안 함, 나머지는 ?v=로 구분) |

## 보안 참고

Firestore 규칙은 `rooms` 컬렉션만 열어두고 나머지는 차단합니다. 방 코드를 아는 사람만 그 방의 데이터를 읽고 쓸 수 있습니다. 학생 개인정보는 저장하지 않는 시간표 데이터라 이 정도로 열어두었습니다 — 학생 이름이 들어가는 기능은 추가하지 마세요.
