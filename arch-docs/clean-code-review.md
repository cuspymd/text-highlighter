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

#### 분리 모듈별 역할 상세 명세

아래는 `background.js`에서 추출할 각 모듈의 책임 범위를 정리한 것입니다.

##### `services/sync-service.js` — 동기화 엔진

- **책임**: 로컬 ↔ sync 스토리지 간 하이라이트 데이터의 동기화, 충돌 해소, 용량 관리, tombstone 수명 관리를 전담합니다.
- **범위**: sync 관련 상수(키 접두사, 쿼터, tombstone 보존 기간, 재시도 정책) 및 sync 전용 상태(삭제 의도 확인 대기 큐 등)를 소유합니다. tombstone 정리, sync_meta 정규화, URL→sync 키 변환, 양방향 하이라이트 병합 같은 **순수 함수**와, sync 스토리지 읽기/쓰기/삭제, 로컬→sync 마이그레이션 같은 **비동기 서비스 함수**, 그리고 다른 기기에서의 변경을 수신하는 `storage.onChanged` 리스너 로직을 포함합니다.
- **의존성**: `shared/browser-api.js`, `shared/logger.js`

---

##### `services/settings-service.js` — 설정 및 색상 관리

- **책임**: 기본/커스텀 색상 목록 관리, 사용자 설정(미니맵 가시성, 선택 컨트롤 가시성) CRUD, 설정 변경 시 전체 탭 브로드캐스트를 전담합니다.
- **범위**: 기본 색상 정의, 런타임 색상 목록 상태, 플랫폼 감지(Firefox Android 대응)를 소유합니다. 플랫폼 초기화, 커스텀 색상 로드(sync → local 순), 설정 변경 브로드캐스트, 그리고 색상 추가/초기화/설정 저장에 대한 서비스 로직을 포함합니다.
- **의존성**: `shared/browser-api.js`, `shared/logger.js`, `shared/tab-broadcast.js`, `services/sync-service.js`

---

##### `handlers/message-router.js` — 메시지 라우팅 허브

- **책임**: `runtime.onMessage` 리스너를 등록하고, 수신된 `message.action`에 따라 적절한 서비스 함수로 **디스패치만** 수행합니다. 비즈니스 로직 자체를 포함하지 않습니다.
- **범위**: 현재 `background.js`에서 12개 액션을 if/else로 분기하는 메시지 핸들러 전체를 이관합니다. 액션-핸들러 맵 구조로 전환하여, 새로운 액션 추가 시 맵에 한 줄만 추가하면 되도록 합니다. 에러 처리를 한 곳에서 일관되게 수행합니다.
- **의존성**: `services/sync-service.js`, `services/settings-service.js`, `shared/browser-api.js`, `shared/logger.js`

---

##### `ui/context-menu-service.js` — 컨텍스트 메뉴 & 단축키

- **책임**: 우클릭 컨텍스트 메뉴 생성/갱신, 키보드 단축키 변경 감지, 메뉴/단축키 클릭 시 content script로 하이라이트 명령 전달을 전담합니다.
- **범위**: 단축키 정보 캐시 상태를 소유합니다. 단축키 조회, 컨텍스트 메뉴 재생성(모바일 제외), 메뉴 클릭/단축키 입력/탭 전환 이벤트 리스너를 포함합니다.
- **의존성**: `services/settings-service.js`, `shared/browser-api.js`, `shared/logger.js`, `shared/i18n.js`

---

##### `background.js` (엔트리 포인트) — 초기화 & 와이어링

- **책임**: 리팩터링 후 **얇은 엔트리 파일**로만 유지합니다. 비즈니스 로직 없이 각 모듈의 import와 초기화 호출만 수행합니다.
- **범위**: 리스너 등록(메시지 라우터, 컨텍스트 메뉴, sync 스토리지)을 최상위 레벨에서 동기적으로 수행하고, 비동기 초기화(플랫폼 감지, 색상 로드, 메뉴 생성, 마이그레이션)를 순차적으로 실행합니다.
- **핵심 원칙**: 전체 모듈 간 의존 관계를 한눈에 파악할 수 있어야 하며, 리스너 등록은 최상위 레벨에서 수행하여 서비스워커 재시작 시 이벤트 누락을 방지합니다.

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

#### 공통 유틸 모듈별 역할 상세 명세

아래는 현재 여러 파일에 중복된 코드를 추출하여 단일 모듈로 통합할 때의 책임 범위를 정리한 것입니다.

##### `shared/browser-api.js` — 브라우저 API 호환 레이어

- **책임**: Chrome/Firefox 런타임 API 객체를 감지하여 단일 `browserAPI` 참조를 제공합니다. 확장 프로그램 전체에서 이 모듈만 참조하면 브라우저 분기를 신경 쓸 필요가 없습니다.
- **현재 중복**: 동일한 감지 IIFE가 `background.js`, `controls.js`, `popup.js`, `pages-list.js` 4개 파일에 반복되고, `minimap.js`는 content.js 전역에 암묵적으로 의존합니다.

---

##### `shared/logger.js` — 통합 디버그 로거

- **책임**: `DEBUG_MODE` 플래그에 따라 로깅을 활성/비활성화하며, `[모듈명]` 접두사를 포함한 통일된 로그 포맷을 제공합니다. `DEBUG_MODE`를 단일 지점에서 관리하여 배포 시 한 번만 변경하면 됩니다.
- **현재 중복**: `DEBUG_MODE` + `debugLog` 동일 패턴이 `background.js`, `popup.js`, `pages-list.js`, `minimap.js` 4개 파일에 반복 선언되고, `controls.js`는 content.js 전역의 `debugLog`에 암묵적으로 의존합니다.
- **확장 가능성**: 향후 `reportError(context, error, { userMessageKey })` 패턴(4-4 참조)으로 확장할 기반이 됩니다.

---

##### `shared/tab-broadcast.js` — 탭 메시지 브로드캐스트 유틸

- **책임**: "모든 탭에 메시지 전송" 및 "특정 URL의 탭에 메시지 전송" 패턴을 캡슐화합니다. content script가 주입되지 않은 탭에 대한 에러 무시 처리도 내부에서 일관되게 수행합니다.
- **현재 중복**: `background.js` 내에서 `tabs.query → sendMessage` 루프가 최소 7회 이상 인라인으로 반복됩니다 — `notifyTabHighlightsRefresh`, `broadcastSettingsToTabs`, `addColor` 핸들러, `clearCustomColors` 핸들러, `storage.onChanged` 내 설정 처리(×3), `applyUserDeletionFromSync` 등.

---

##### `shared/i18n.js` — 다국어 메시지 유틸

- **책임**: `browserAPI.i18n.getMessage` 호출을 래핑하여 키 누락 시 fallback 처리를 표준화하고, HTML 요소 자동 로컬라이징(`data-i18n`, `data-i18n-title`, `data-i18n-placeholder`)을 통합 제공합니다.
- **현재 중복 및 불일치**: `getMessage` 함수가 `background.js`, `content.js`, `pages-list.js`에 각각 다른 시그니처로 존재합니다(특히 `pages-list.js`만 `defaultValue` 파라미터를 가짐). DOM 로컬라이징 로직도 `popup.js`의 `initializeI18n()`과 `pages-list.js`의 `localizeStaticElements()`가 유사하지만 지원 속성 범위가 다릅니다.

---

#### Content Script 모듈 적용 시 주의사항

content script(`content.js`, `controls.js`, `minimap.js`)는 현재 Chrome Manifest V3 기준 ES Module을 지원하지 않습니다. 따라서 위 shared 모듈 적용 시 다음 제약을 고려해야 합니다:

- **서비스워커(`background.js`)**: ES Module import 사용 가능 (manifest의 `"type": "module"` 설정).
- **content script**: ES Module 미지원이므로, `content_scripts[].js` 배열 순서를 활용한 전역 변수 공유 또는 IIFE 래핑 등 별도 전략이 필요합니다.
- **popup/pages-list 같은 HTML 페이지**: `<script type="module">` 태그로 직접 import 가능합니다.

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
- 2026-02-17: 4-1, 4-2 권장 리팩터링 섹션에 모듈별 역할 상세 명세 추가 (함수/상수 매핑, export 인터페이스, 의존성, 구현 패턴 예시 포함).
