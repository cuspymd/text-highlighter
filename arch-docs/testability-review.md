# 테스터빌리티 관점 구조 리뷰

작성일: 2026-08-30
대상 저장소: `text-highlighter` (`25c9b3b` 기준)

---

## 1) 측정

`npm test` — 17 suites, 216 tests, 5.7s, 전부 통과.

커버리지를 붙여 다시 돌린 결과:

```
Statements   : 28.22% ( 1191/4220 )
Branches     : 26.54% (  648/2441 )
Functions    : 29.65% (  180/607  )
Lines        : 28.60% ( 1130/3950 )
```

디렉터리별로 갈라 보면 전체 수치보다 훨씬 많은 게 보입니다.

| 영역 | Stmts | 로딩 방식 | 테스트 방식 |
| --- | ---: | --- | --- |
| `shared/` | **95.8%** | ESM 모듈 | `import` |
| `background/` | **50.7%** | ESM 모듈 | `import` |
| 페이지 스크립트 | 25.6% | ESM + `DOMContentLoaded` 클로저 | #116 하네스 |
| `content-scripts/` | **측정 불가** | manifest 나열, `window` 전역 | `window.eval(source)` |

파일 단위로 0%인 것들:

| 파일 | 줄 수 | 상태 |
| --- | ---: | --- |
| `content-scripts/controls.js` | 1,414 | eval — 측정 불가 |
| `content-scripts/content.js` | 1,144 | eval — 측정 불가 |
| `pages-list.js` | 725 | **테스트 없음** |
| `settings.js` | 603 | **테스트 없음** |
| `content-scripts/minimap.js` | 320 | **테스트 없음** |
| `worker/src/index.js` | 91 | **테스트 없음** |

---

## 2) 지금 구조가 세 갈래로 갈라져 있습니다

같은 레포 안에 성격이 다른 세 종류의 코드가 있고, 각각 테스트 방식이 다릅니다.

### (A) ESM 모듈 — `shared/`, `background/`

정상적으로 `import`해서 테스트합니다. `shared/`가 95.8%인 건 우연이 아니라 구조의 결과입니다:
브라우저 API를 거의 안 쓰는 순수 함수 모음이라 그냥 부르면 됩니다. `tab-broadcast.js`는 100%.

### (B) content scripts — manifest가 순서대로 로드하는 고전 스크립트

`manifest.json`이 다섯 파일을 순서대로 주입하고, 이들은 `window` 전역으로 서로를 찾습니다:

```
content-common.js → minimap.js → content-core.js → controls.js → content.js
```

`import`가 불가능하니 테스트는 소스를 텍스트로 읽어 `window.eval()` 합니다.

### (C) 페이지 스크립트 — `popup.js`, `pages-list.js`, `settings.js`

ESM이긴 한데 본문 전체가 `DOMContentLoaded` 콜백 하나 안에 들어 있고 `export`가 없습니다.
#116이 `tests/helpers/extension-page.js` 하네스를 만들어 `popup.js`를 76%까지 올렸습니다.
나머지 둘은 아직 0%.

---

## 3) 문제점

### 문제 1 — content script는 커버리지를 볼 수 없습니다

`window.eval(source)`로 로드하면 커버리지 계측기가 그 코드를 보지 못합니다.
그래서 `content.js`(1,144줄)와 `controls.js`(1,414줄)가 **0%로 보고되지만 실제로는 일부 실행되고 있습니다.**

즉 이 2,558줄에 대해 우리는 커버리지를 아는 게 아니라 **모릅니다.**
`restore-highlight-groups.test.js` 하나가 724줄짜리 본격적인 테스트인데,
그게 `content.js`의 어디를 덮고 어디를 안 덮는지 확인할 방법이 지금 없습니다.

전체 28%라는 숫자도 이 때문에 실제보다 낮게 나옵니다. 문제는 낮게 나온다는 게 아니라 **틀렸다**는 겁니다.

### 문제 2 — 목(mock)이 다섯 벌로 갈라져 있습니다

`mocks/chrome.js`가 공용 목인데, content script를 다루는 테스트 5개는 **전부 자기만의 `browserAPI`를 인라인으로 세웁니다.**

| 테스트 | 공용 목 사용 |
| --- | --- |
| `restore-highlight-groups.test.js` | ✗ 자체 |
| `content-navigation.test.js` | ✗ 자체 |
| `scroll-to-highlight.test.js` | ✗ 자체 |
| `controls-content-api.integration.test.js` | ✗ 자체 |
| `flash-highlight-group.test.js` | ✗ 자체 |

결과가 구체적으로 아픕니다. #116이 `mocks/chrome.js`에 "탭 메시지에 콜백을 넘기면 실패시킨다"는 가드를 넣었는데,
**이 다섯 테스트에는 그 가드가 닿지 않습니다.** 오히려 `restore-highlight-groups.test.js:38`의 인라인 목은
콜백을 친절하게 불러줍니다 — 가드가 막으려던 바로 그 형태를 승인하는 셈입니다.

공용 목에 무엇을 추가하든 content script 쪽은 사각지대로 남습니다.

### 문제 3 — 테스트가 실행 환경을 손으로 재현해야 합니다

`content.js` 하나를 돌리려고 `restore-highlight-groups.test.js`가 세우는 것들:

```js
window.debugLog = jest.fn();
window.hideHighlightControls = jest.fn();          // controls.js 소유
window.createHighlightControls = jest.fn();        // controls.js 소유
window.refreshHighlightControlsColors = jest.fn(); // controls.js 소유
window.setSelectionControlsVisibility = jest.fn(); // controls.js 소유
window.MinimapManager = jest.fn(...);              // minimap.js 소유
global.browserAPI = { runtime: {...}, storage: {...} };
```

테스트마다 `jest.fn()` 10~20개. 이건 테스트가 게을러서가 아니라
**`content.js`가 이웃 파일들과 `window` 전역으로 결합되어 있고 manifest 로드 순서에 의존하기 때문**입니다.
`controls.js`에 함수 하나 추가하면 `content.js` 테스트 네 개가 같이 깨질 수 있습니다.

### 문제 4 — 페이지 스크립트 두 개가 완전 무테스트

`pages-list.js` 725줄 + `settings.js` 603줄 = **1,328줄이 한 줄도 실행되지 않습니다.**
설정 화면과 페이지 목록 화면 전체입니다.

#116의 하네스는 주석에 이미 세 파일(`popup.js`, `pages-list.js`, `settings.js`)을 대상으로 적어두었습니다.
받침대는 만들어져 있는데 아직 안 쓴 상태입니다.

### 문제 5 — `message-router.js`의 핸들러 24개가 13% 커버

```
message-router.js | 13.47% | 376줄 중
```

`registerMessageRouter()`는 좋은 구조입니다 — 리스너 하나에 `ACTION_HANDLERS` 맵.
테스트도 라우팅 기계장치(등록, 미지의 action, 응답 전달)는 확인합니다.
하지만 **24개 핸들러 본문 대부분이 안 돌아갑니다.**

여기가 popup·content script·settings 모두가 background에 말을 거는 **단일 진입점**입니다.
구조는 이미 테스트하기 좋게 되어 있고, 테스트를 안 썼을 뿐입니다. 가장 아까운 자리입니다.

---

## 4) 이미 잘 되어 있는 것 — 이걸 확대하면 됩니다

문제만 나열하면 방향을 놓칩니다. 이 레포에는 **답이 이미 하나 들어 있습니다.**

### `content-scripts/content-core.js` (883줄, 73.5% 커버)

content script인데도 정상적으로 테스트됩니다. 이유:

- 브라우저 확장 API를 **하나도 안 씁니다** — DOM과 문자열만 다룹니다
- IIFE로 감싸고 `window.TextHighlighterCore`에 순수 함수 10개를 노출합니다
- 그래서 `tests/content-core.test.js`가 그냥 `import`해서 부릅니다 — eval도, 전역 스텁도 없습니다

```js
import '../content-scripts/content-core.js';
const core = window.TextHighlighterCore;
```

이 레포에서 **가장 어려운 로직**(텍스트 앵커링, 정규화 오프셋, quote selector 복원)이
**가장 잘 테스트된 부분**입니다. 우연이 아닙니다.

### `shared/tab-broadcast.js` (100% 커버)

탭 메시지를 창구 하나로 모아 호출 지점을 없앤 패턴. 47줄로 클래스의 버그를 구조적으로 제거했습니다.

### `background/message-router.js`의 핸들러 맵

리스너 하나 + 이름→함수 맵. 테스트가 리스너를 붙잡아 메시지를 넣기만 하면 되는 좋은 seam입니다.

---

## 5) 권고 구조

원칙 하나로 요약됩니다.

> **브라우저가 있어야 도는 코드와, 없어도 도는 코드를 파일 단위로 가른다.**

`content-core.js`가 이미 그렇게 하고 있습니다. 그걸 확대하는 게 전부입니다.

### 목표 모양

```
content-scripts/
  content-core.js      순수 로직  — import 가능, 계측됨          [이미 있음]
  restore-core.js      순수 로직  — 복원 결정/그룹 매칭/상태 전이  [content.js에서 추출]
  color-core.js        순수 로직  — HSV 변환, 색상 계산           [controls.js에서 추출]
  content.js           DOM 조작 + 메시지 송수신만 남김
  controls.js          DOM 조작 + 이벤트 바인딩만 남김
```

순수 로직이 모듈로 나오면 **문제 1(커버리지 측정 불가)이 자동으로 풀립니다.**
`import`로 로드되니 계측기가 봅니다. eval로 남는 부분은 얇은 DOM 껍데기뿐이고,
그건 원래 E2E가 볼 영역입니다.

### 목을 한 벌로

`tests/helpers/content-script.js`를 만들어 `extension-page.js`가 페이지 스크립트에 해준 일을
content script에 해줍니다 — `window` 전역 스텁과 `browserAPI` 주입을 한 곳에 모으고,
`mocks/chrome.js`를 쓰게 합니다.

그러면 문제 2와 문제 3이 같이 풀립니다. 가드를 공용 목에 한 번 넣으면 전 테스트에 닿고,
`controls.js`에 함수가 늘어도 헬퍼 한 곳만 고치면 됩니다.

---

## 6) 순서

비용 대비 이득 순입니다.

| 순서 | 작업 | 이득 | 비용 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | `pages-list.js` / `settings.js` 하네스 테스트 | 1,328줄이 0% → 커버 | 낮음 — 하네스 이미 있음 | **완료** |
| 2 | content script 부트스트랩 헬퍼로 목 통합 | 문제 2·3 해소, 가드가 실제로 닿음 | 낮음 — 기존 테스트 5개 정리 | **완료** |
| 3 | `message-router` 핸들러 테스트 확충 | 단일 진입점 13% → 대폭 상승 | 낮음 — seam 이미 좋음 | **완료** |
| 4 | `content.js`/`controls.js` 순수 로직 추출 | 문제 1 해소, 2,558줄이 보이게 됨 | **높음** — 마지막에 | **1차 완료** |

1~3은 **구조를 안 건드리고** 테스트만 쓰는 일이라 위험이 거의 없습니다.
4는 실제 리팩터링이라 1~3으로 안전망을 깐 뒤에 하는 게 맞습니다.

### 순서 1 결과

`tests/pages-list.test.js`(44개)와 `tests/settings.test.js`(39개)를 추가했습니다.
소스는 한 줄도 고치지 않았습니다.

| | 이전 | 이후 |
| --- | ---: | ---: |
| 테스트 수 | 216 | 299 |
| 전체 Stmts | 28.22% | **44.69%** |
| 페이지 스크립트 계층 | 25.6% | **86.4%** |
| `pages-list.js` | 0% | **94.41%** |
| `settings.js` | 0% | **87.86%** |

작업하며 확인한 것 두 가지:

- **`#no-pages`는 목록이 비었을 때만 문서에 있습니다.** `#pages-container` 안에 있어서
  페이지를 그릴 때 `innerHTML = ''`에 함께 지워지고, 빈 목록 분기가 다시 붙입니다.
  숨겨지는 게 아니라 떼어졌다 붙습니다.
- **색 이름 편집을 커밋하면 페이지 전체가 다시 로드됩니다.** 편집 입력의 blur가
  창 포커스를 되돌려 "포커스 시 재로딩" 핸들러를 깨웁니다. 실제 브라우저에서는 background가
  바뀐 이름을 돌려주므로 결과가 같지만, 이름 하나 고치는 데 `getColors`·`getShortcutColorMap`·
  `getCloudSyncStatus`가 다시 나가는 건 사실입니다. 동작 문제는 아니고, 4번 작업 때
  다듬을 후보입니다.

남은 미커버 구간은 `pages-list.js`의 클립보드/스키마 경고 분기와 `settings.js`의
클립보드 폴백(`document.execCommand`)입니다. 둘 다 jsdom에서 재현 가치가 낮습니다.

---

### 순서 2 결과

`tests/helpers/content-script.js`를 추가하고 content script 테스트 5개를 전부 그리로 옮겼습니다.
같이 `runtime.sendMessage` 11곳을 promise 형태로 정리했습니다.

- **목이 한 벌이 됐습니다.** 다섯 테스트가 세우던 인라인 `browserAPI`가 사라지고 모두
  `mocks/chrome.js`를 씁니다. `controls-content-api`만 쓰던 `global.browser`도 없어졌습니다.
- **가드가 실제로 닿습니다.** `mocks/chrome.js`의 `runtime.sendMessage`가 이제 콜백을 받으면
  던집니다. 예전엔 오히려 콜백을 불러주며 잘못된 형태를 승인했습니다.
  `tests/runtime-message-guard.test.js`가 가드 자체를 검증합니다.
- **이웃 전역 목록이 한 곳에 모였습니다.** `controls.js`에 함수를 추가할 때 테스트 네 개를
  같이 고칠 일이 없어졌습니다.

검증: `npm test` 305개 통과, `npx playwright test` 56개 통과(실제 Chromium).

문제 2와 3은 해소됐습니다. **문제 1(커버리지 측정 불가)은 그대로입니다** — 여전히 `window.eval`이라
`content.js`·`controls.js`는 0%로 보고됩니다. 그건 순서 4가 푸는 문제입니다.

남은 콜백은 `content.js:950`의 `storage.local.get` 하나입니다. 양쪽 브라우저에서 동작하고
하네스 스텁도 두 형태를 다 응대하지만, 유일하게 형태가 다른 자리입니다.

### 순서 3 결과

`tests/message-router.test.js`를 6개에서 57개로 늘려 핸들러 24개를 전부 덮었습니다.
소스는 고치지 않았습니다.

| | 이전 | 이후 |
| --- | ---: | ---: |
| `message-router.js` Stmts | 13.47% | **95.85%** (Lines·Funcs 100%) |
| `settings-service.js` | 65.69% | **90.37%** |
| `sync-service.js` | 40.28% | **56.11%** |
| `background/` 계층 | 50.65% | **79.30%** |
| 전체 Stmts | 44.66% | **50.92%** |
| 테스트 수 | 305 | 354 |

두 가지가 이걸 가능하게 했습니다.

- **`jest.resetModules()`가 ESM에서도 동작합니다.** `settings-service`는 불러온 커스텀 색을
  모듈 상태(`hasLoadedCustomColors`)에 캐시하고 sync 서비스들도 자기 상태를 듭니다. 테스트마다
  모듈 그래프를 새로 만들면 앞 테스트의 색이 다음 테스트에 남지 않고, 실행 순서가 결과를
  바꾸지 않습니다. `shared/browser-api.js`는 전역 `chrome`을 읽으므로 새 그래프도 같은 목을 봅니다.
- **저장소를 실제 객체로 받쳤습니다.** 기본 목은 모든 `get`에 `{}`를 돌려주는데, 그러면
  읽고-고쳐-쓰는 핸들러가 전부 "빈 프로필에서 동작하는" 것처럼 보입니다. 인메모리 스토어를
  깔아주니 `deleteHighlight`의 tombstone, `saveHighlights`의 메타 갱신,
  `deleteAllHighlightedPages`의 설정 키 보존 같은 것이 실제로 검증됩니다.

서비스 모듈을 목으로 막지 않고 실제로 돌렸습니다. 그래서 라우터 테스트가
`settings-service`와 `sync-service`까지 같이 끌어올렸습니다 — 라우터가 실제로
그 코드를 부르기 때문입니다.

### 순서 4 결과 (1차)

`content-core.js`가 이미 증명한 패턴 — 브라우저 API를 안 쓰는 순수 함수를 IIFE로 감싸
`window` 네임스페이스에 노출 — 을 두 군데로 넓혔습니다.

| 새 모듈 | 내용 | 커버리지 |
| --- | --- | ---: |
| `content-scripts/restore-core.js` (163줄) | `needsQuoteRestore`, `overlapsClaimedRegion`, `maskClaimedRegions`, `isRangeInDocument`, `resolveUnclaimedMatch`, `createRestorePendingState` | **100%** |
| `content-scripts/color-core.js` (115줄) | `hsvToRgb`, `hslToHex`, `rgbToHex` | **97.2%** (Lines 100%) |

`content.js`와 `controls.js`는 같은 이름의 얇은 위임 함수만 남겨서 호출부를 하나도 안 고쳤습니다.
두 파일 모두 manifest에 등록했고(Chrome·Firefox 양쪽), 빌드는 `content-scripts` 디렉터리를
통째로 복사하므로 배포 설정은 그대로입니다.

| | 순서 3 이후 | 순서 4 이후 |
| --- | ---: | ---: |
| 전체 Stmts | 50.92% | **53.23%** |
| 테스트 수 | 354 | **402** |
| `content.js` | 1,132줄 | 1,089줄 |
| `controls.js` | 1,423줄 | 1,347줄 |

**상태 기계가 진짜 이득이었습니다.** `restorePending`/`pendingRestoreDeadline` 모듈 변수가
`createRestorePendingState()` 팩토리가 되면서, "새 페이지에서는 항상 pending으로 시작한다",
"두 패스가 겹치면 늦은 쪽 마감을 지킨다", "마감이 지나면 recheck 간격으로 답한다" 같은 규칙이
전부 직접 검증됩니다. 예전에는 `content.js` 전체를 eval하고 타이머를 돌려야 간접적으로만
확인할 수 있었습니다.

검증: `npm test` 402개 통과(3회 연속), `npx playwright test` 56개 통과(실제 Chromium),
Chrome·Firefox 빌드 양쪽 생성 확인.

**남은 일.** `content.js`·`controls.js` 본문은 여전히 eval이라 0%로 보고됩니다. 이번에 뺀 것은
논쟁의 여지 없이 순수한 부분이고, 다음 후보는 DOM을 읽지만 확장 API는 안 쓰는 것들입니다 —
`collectRestorableTextNodes`, `calculateSelectionIconPosition`, `getFirstTextNodePosition`.
이들은 jsdom 픽스처가 필요해서 성격이 한 단계 다르니, 별도로 진행하는 게 맞습니다.

## 7) #117과의 관계

#117(콜백 형태 정적 검사)이 지목한 11곳의 `runtime.sendMessage` 콜백은
이 문서 기준으로 **버그가 아니라 스타일 편차**입니다. Firefox에서 정상 동작합니다.
(실제 버그였던 `tabs.sendMessage`는 #113에서 이미 해결됐습니다.)

다만 promise 형태로 일괄 정리하는 것 자체는 타당하고, **순서 2와 같이 하면 자연스럽습니다** —
목을 통합하면서 공용 목의 `runtime.sendMessage`도 조이면, 정적 검사도 화이트리스트도 필요 없어집니다.

`pages-list.js`의 5곳은 **순서 1을 먼저** 해야 안전합니다. 지금은 그 파일을 실행하는 테스트가 없어서
고쳐도 맞는지 확인할 방법이 없습니다.
