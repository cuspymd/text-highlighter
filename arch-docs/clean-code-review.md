# 클린 코드 관점 전체 코드 리뷰 보고서

작성일: 2026-02-16  
대상 저장소: `text-highlighter`

---

## 1) 리뷰 범위와 기준

### 범위
- 실제 애플리케이션 로직 중심 파일을 리뷰했습니다.
  - `background.js`
  - `content.js`
  - `controls.js`
  - `popup.js`
  - `pages-list.js`
  - `minimap.js`
  - `tests/background.test.js`
- 서드파티/빌드 아티팩트 성격의 폴더(`node_modules`)는 제외했습니다.

### 평가 기준(클린 코드)
- **가독성**: 함수 길이, 의도 전달, 네이밍
- **응집도/결합도**: 모듈 경계, 책임 분리
- **중복 제거(DRY)**: 반복 로직/상수/유틸
- **오류 처리 일관성**: 예외 핸들링, 사용자 피드백
- **테스트 가능성**: 순수 함수 비율, 사이드이펙트 분리
- **유지보수성/확장성**: 기능 추가 시 수정 범위

---

## 2) 총평

현재 코드는 **기능 완성도와 제품 관점(동기화, 크로스 브라우저 대응, 다국어, 모바일 고려)**은 높습니다.  
다만 클린 코드 관점에서는 다음 구조적 부채가 누적되어 있습니다.

- `background.js`와 `content.js`에 **너무 많은 책임이 집중**되어 있습니다.
- 같은 패턴(브라우저 API 래퍼, 브로드캐스트, 모달/confirm 패턴)이 여러 파일에 **중복**됩니다.
- 대형 조건 분기(`if (message.action === ...)`) 중심 구조로 인해 **기능 추가 시 충돌 위험**이 커집니다.
- 오류 처리/로그 정책이 파일마다 달라 **운영 이슈 추적 일관성**이 낮습니다.

### 종합 점수(클린 코드 관점, 5점 만점)
- 가독성: **2.8 / 5**
- 구조/책임 분리: **2.3 / 5**
- 중복 제어: **2.5 / 5**
- 테스트 용이성: **2.6 / 5**
- 확장성: **2.7 / 5**
- **총평: 2.6 / 5 (기능은 좋으나 구조 리팩터링 필요)**

---

## 3) 잘 된 점 (Good Practices)

1. **도메인 규칙이 주석/상수로 잘 드러남**
   - Sync 쿼터, tombstone 보존 기간 등 정책 상수가 명확합니다.

2. **순수 함수 일부 분리**
   - `mergeHighlights`, `cleanupTombstones`, `normalizeSyncMeta` 같은 함수는 테스트 가능성이 좋습니다.

3. **보안/안전성 고려 흔적 존재**
   - `pages-list.js`에서 URL 안전성 검증, DOM 생성 시 `innerHTML` 남용 회피 등은 긍정적입니다.

4. **플랫폼/브라우저 차이 대응**
   - mobile/desktop 분기 및 `browser/chrome` 호환 래퍼가 전반적으로 적용되어 있습니다.

---

## 4) 핵심 개선 이슈 (우선순위 순)

## P0 (가장 먼저)

### 4-1. God File / God Function 문제
- `background.js`가 초기화, 스토리지, sync 정책, 메뉴, 단축키, 메시지 라우팅, 브로드캐스트까지 모두 담당합니다.
- `content.js` 역시 DOM 탐색/하이라이트 알고리즘/저장 연동/UI 연결을 함께 처리합니다.

**리스크**
- 변경 영향 범위 예측이 어렵고 회귀 버그 가능성이 큼.
- 신규 개발자가 진입하기 어려움.

**권장 리팩터링**
- `background.js`를 최소 다음 단위로 분리:
  - `services/sync-service.js`
  - `services/settings-service.js`
  - `handlers/message-handlers.js`
  - `ui/context-menu-service.js`
- 메시지 처리부를 **액션-핸들러 맵**으로 전환:
  - `const handlers = { getColors: handleGetColors, saveHighlights: handleSaveHighlights, ... }`
  - `if/else` 사슬 제거.

---

### 4-2. 중복 코드 다수 (DRY 위반)
- `browserAPI` 초기화 코드가 다수 파일에 반복됩니다.
- 탭 브로드캐스트(`tabs.query({}) -> sendMessage`) 패턴이 반복됩니다.
- `DEBUG_MODE`/`debugLog` 보일러플레이트가 파일마다 반복됩니다.
- popup/pages-list에서 모달/confirm 정책이 분산되어 UX 일관성이 떨어집니다.

**권장 리팩터링**
- 공통 유틸 모듈 도입:
  - `shared/browser-api.js`
  - `shared/logger.js`
  - `shared/tab-broadcast.js`
  - `shared/i18n.js`
- UI 정책 통일:
  - confirm/alert를 커스텀 모달로 통일하거나, 최소 래퍼 함수로 일관화.

---

### 4-3. 스토리지 키 문자열 하드코딩
- `'customColors'`, `'minimapVisible'`, `'selectionControlsVisible'`, `'_meta'` 등 문자열이 여러 파일에 흩어져 있습니다.

**리스크**
- 오타/키 변경 누락 시 런타임 버그 발생.

**권장 리팩터링**
- `constants/storage-keys.js`를 만들어 단일 소스로 관리.

---

## P1 (빠른 개선 추천)

### 4-4. 오류 처리/로그 정책 불일치
- 어떤 곳은 `debugLog`, 어떤 곳은 `console.error`, 어떤 곳은 무시(`catch {}`) 방식입니다.
- 사용자에게 알려야 할 오류와 내부 진단용 오류가 분리되지 않습니다.

**권장 리팩터링**
- `reportError(context, error, { userMessageKey })` 형태의 공통 에러 핸들러 도입.
- 실패 전략을 분류:
  - 조용한 실패(Non-blocking)
  - 사용자 통지 필요
  - 재시도 필요

---

### 4-5. 데이터 모델(하이라이트 그룹) 스키마 계약 약함
- `group`, `span` 객체 구조가 암묵적이며 파일별 가정이 다릅니다.
- import/export 시 스키마 검증이 제한적입니다.

**권장 리팩터링**
- JSDoc typedef 또는 런타임 validator(zod 등)로 계약 명세.
- import 시 URL 안전성 외에 `groupId`, `spans[].text`, `color` 형식 검증 강화.

---

### 4-6. 비동기 흐름 혼용으로 복잡도 증가
- callback 스타일과 async/await가 혼재되어 흐름 추적이 어렵습니다.

**권장 리팩터링**
- 가능한 범위에서 `async/await`로 통일.
- 메시지 응답 패턴(성공/실패 포맷) 표준화.

---

## P2 (점진 개선)

### 4-7. 함수 길이 및 추상화 레벨 혼합
- 특히 `processSelectionRange`, 메시지 핸들러 내부는 한 함수에서 추상화 레벨이 자주 바뀝니다.

**권장 리팩터링**
- “한 함수 = 한 단계 추상화” 원칙 적용.
- 알고리즘 함수와 DOM 조작 함수를 분리.

---

### 4-8. 테스트 전략 보강 필요
- 현재 단위 테스트가 `background.js` 일부 유틸 중심에 집중되어 있습니다.
- 핵심 리스크인 메시지 라우팅/스토리지 변환/selection 처리 경계 테스트가 부족합니다.

**권장 리팩터링**
- 테스트 피라미드 재정의:
  - Unit: merge/normalize/validation
  - Integration(jsdom): message handler + storage mock
  - E2E(playwright): 하이라이트 생성/삭제/동기화 대표 시나리오

---

## 5) 파일별 코멘트 요약

## `background.js`
- 장점: sync 충돌 해소 정책이 코드에 명시되어 있음.
- 개선: 책임 과다, 분기 과다, 반복 브로드캐스트 코드 다수.

## `content.js`
- 장점: 하이라이트 적용/복원 로직이 기능적으로 견고함.
- 개선: 텍스트 탐색/범위 처리/DOM 업데이트/UI 연동이 강결합.

## `controls.js`
- 장점: UI 생성 유틸이 함수 단위로 분리된 부분이 있음.
- 개선: 전역 상태 변수 다수, 이벤트 생명주기 관리 복잡.

## `popup.js`
- 장점: i18n, 테마 대응, 사용자 작업 흐름이 비교적 명확.
- 개선: 모달 로직 내 중복(Confirm/Alert), 저장/로드 흐름 분리 필요.

## `pages-list.js`
- 장점: 검색/정렬/가져오기-내보내기 기능이 잘 통합됨.
- 개선: 파일 크기 대비 책임이 넓고 `confirm/alert` UX 정책이 popup과 불일치.

## `minimap.js`
- 장점: `MinimapManager` 클래스로 응집도 높음.
- 개선: 이벤트 리스너 해제 관리(현재 `destroy`에서 일부 누락 가능) 및 throttle 단일 타이머 공유 설계 점검 필요.

---

## 6) 4주 개선 로드맵(권장)

### 1주차: 토대 정리
- 공통 모듈 도입(`browserAPI`, `logger`, `storage keys`, `tab broadcast`).
- 메시지 응답 공통 포맷 정의.

### 2주차: Background 분리
- sync/settings/menu/message handler 분리.
- 기존 동작 동일성 유지 회귀 테스트 추가.

### 3주차: Content/Controls 경계 재설계
- 하이라이트 알고리즘을 순수 로직 모듈로 분리.
- DOM 조작 어댑터 계층 추가.

### 4주차: 테스트 강화 + 문서화
- import/export 스키마 검증 테스트.
- 메시지 라우팅 매트릭스 문서화.
- 유지보수 가이드(신규 액션 추가 방법) 작성.

---

## 7) Quick Wins (즉시 적용 가능)

1. `browserAPI` 래퍼 단일 파일로 통합.
2. 스토리지 키 상수화.
3. `background.js` 메시지 핸들러를 action-map 구조로 1차 전환.
4. popup/pages-list confirm/alert UX 정책 통일.
5. 에러 로그 포맷 통일 (`[module] action - message`).

---

## 8) 결론

이 프로젝트는 사용자 가치가 큰 기능을 이미 많이 담고 있습니다.  
다음 단계의 핵심은 **기능 추가보다 구조 단순화(책임 분리/중복 제거/계약 명세화)** 입니다.  
위 P0~P1 개선만 진행해도 버그율, 리뷰 난이도, 신규 기능 개발 속도에서 체감 개선이 클 것으로 판단됩니다.

---

## 9) 추가 Q&A: 서비스워커 모듈(`background.js`) 분리 가능 여부

질문: **외부 빌드 툴 없이도 `background.js`를 여러 모듈로 분리할 수 있는가?**

### 결론
- **가능합니다.**
- 현재 `manifest.json`에 background가 `"type": "module"`로 선언되어 있어, ES Module의 `import/export`를 그대로 사용할 수 있습니다.

### 전제 조건
1. `manifest.json`의 background type이 `module`이어야 함 (현재 충족).
2. 서비스워커에서 사용하는 모듈은 **동일 확장 패키지 내의 상대 경로**로 import.
3. 동적 import/Top-level await 사용 시 브라우저 호환성은 최소 지원 버전 정책과 함께 검증.

### 권장 분리 방식(빌드 툴 없이)
- `background.js`를 얇은 엔트리 파일로 유지하고, 아래처럼 정적 import로 분해:
  - `background.js` (초기화, wiring만 담당)
  - `background/sync-service.js`
  - `background/settings-service.js`
  - `background/context-menu.js`
  - `background/message-router.js`

예시:
```js
// background.js
import { initSync } from './background/sync-service.js';
import { initContextMenus } from './background/context-menu.js';
import { registerMessageRouter } from './background/message-router.js';

initSync();
initContextMenus();
registerMessageRouter();
```

### 주의사항
- 브라우저 API 객체(`chrome`/`browser`) 접근 유틸은 공통 모듈로 1회만 정의해 중복 제거.
- 순환 참조(circular dependency) 방지: 서비스 계층 간 직접 참조 대신 “의존성 주입” 또는 “콜백 등록” 사용.
- 테스트 환경(Jest)에서 ESM 취급 방식이 기존과 다를 수 있으므로, 단위 테스트 대상은 순수 함수 모듈부터 분리하는 접근이 안전.

### 정리
- **이 저장소는 이미 모듈 서비스워커 설정이 되어 있으므로, 외부 툴 없이도 단계적 모듈 분리가 현실적으로 가능합니다.**
- 다만 대규모 일괄 분리보다, 메시지 라우터/스토리지 키/브로드캐스트 유틸부터 작게 쪼개는 방식이 리스크가 가장 낮습니다.


## 10) 문서 변경 이력

- 2026-02-16: 클린 코드 리뷰 초안 작성.
- 2026-02-16: 서비스워커 모듈 분리 가능 여부 Q&A 추가.
- 2026-02-16: PR 등록 누락 이슈 대응을 위해 문서 이력 섹션 추가.
