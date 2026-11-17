# 코드 리뷰: 개선 후보 정리 (2026-11)

작성일: 2026-11-17
기준 커밋: `2449e5a` (v2.14.0)
범위: `background/`, `shared/`, `constants/`, `content-scripts/`, 확장 페이지(`popup`, `pages-list`, `settings`, `onboarding`), 테스트·CI

## 문서 목적

전체 코드를 세 영역으로 나눠 검토한 결과를 정리한다. 여기 있는 항목은 아래 문서에 이미 있는 것과 겹치지 않게 골랐다.

- `arch-docs/clean-code-review.md`
- `arch-docs/sync-review-issues-and-fixes.md`
- `arch-docs/ux-usability-review.md`
- `arch-docs/testability-review.md`
- `arch-docs/triple-click-selection-issues.md`

일부러 그렇게 둔 동작도 뺐다. 복원 재시도/옵저버 제거와 overlap #9/#43이 그렇다.

각 항목의 "확인" 칸은 다음 뜻이다.

- **코드 확인**: 해당 줄을 직접 읽고 문제의 경로를 따라가 보았다.
- **추정**: 코드로 보아 그럴 것으로 판단했지만 재현해 보지는 않았다.

검토 시점의 단위 테스트는 43개 스위트, 701개 테스트가 모두 통과했다.

---

## 1순위: 데이터 손실·동기화

### 1. 클라우드 동기화가 진행 중에 들어온 로컬 변경을 덮어씀

- 위치: `background/cloud-sync-service.js:372-432` (`runCloudSync`), `:239-266` (`applyMergedPagesToLocal`), `:397`
- 확인: 코드 확인
- 상태: 수정 (브랜치 `fix/cloud-sync-write-race`). 아래 수정안 1~5를 적용했다. 남은 한계: 그 사이 변경이 반영되지 않은 blob이 한 번 push될 수 있다. 로컬에는 변경과 tombstone이 남아 있으므로 다음 동기화에서 바로잡힌다.
- 영향: 클라우드 동기화를 켠 사용자에게만 해당한다. 하이라이트 추가가 사라지거나, 삭제한 하이라이트·페이지가 되살아나 모든 기기로 퍼진다.

**흐름**

```
runCloudSync()
  ① buildLocalBlob()        // storage.local 전체를 읽어 스냅샷을 만든다
  ② fetchRemoteBlob()       // 네트워크 GET + 복호화 (수백 ms ~ 수 초)
  ③ mergeBlobs(스냅샷, 원격)
  ④ applyMergedPagesToLocal // merge 결과의 모든 페이지를 storage.local.set
  ⑤ storage.local.set({ cloudSyncDeletedUrls: merged.deletedUrls })   // 397행
  ⑥ pushRemoteBlob()        // 필요하면 PUT
```

①과 ④ 사이에 storage.local에 생긴 변경은 ③의 입력에 없다. 그런데 ④는 변경 여부를 가리지 않고 merge된 **모든** 페이지(하이라이트 배열과 `_meta`)를 다시 쓰고, ⑤는 페이지 tombstone 맵을 통째로 교체한다. 그래서 그 사이에 들어온 쓰기는 덮어써진다.

**시나리오**

| 사용자 동작 (①~④ 사이) | 결과 |
| --- | --- |
| 페이지 P에 하이라이트 G 추가 | ④가 G가 없는 배열로 P를 덮어쓴다. 원격에 변화가 없으면 탭에 refresh도 가지 않는다. 화면에는 G가 보이지만 저장소에는 없어서, 새로고침하면 G가 사라진다. 같은 페이지에서 다시 저장하면 탭이 가진 전체 배열을 보내므로 복구된다. |
| 하이라이트 G 삭제 | ④가 G가 있는 배열과 tombstone이 없는 `_meta`로 덮어쓴다. G와 그 tombstone이 함께 사라진다. ⑥은 G를 담은 blob을 push하고, 다음 새로고침에 G가 다시 나타난다. 다른 기기에서도 G가 유지된다. |
| 페이지 P의 하이라이트 전체 삭제 | `syncRemoveHighlights`가 `cloudSyncDeletedUrls[P]`를 기록하고 P의 키를 지운다. 그런데 ④가 P를 다시 쓰고, ⑤가 스냅샷 기준 맵으로 tombstone을 지운다. P는 살아난 채 push된다. 삭제가 영구히 무효가 되고 모든 기기에 전파된다. |

`syncRemoveHighlights`(`sync-service.js:324-330`)의 주석은 이 경쟁의 한쪽만 다룬다. 스냅샷을 삭제 *도중에* 찍는 경우를 위해 tombstone을 먼저 기록해 둔 것이다. 스냅샷을 삭제 *전에* 찍고 쓰기를 삭제 *후에* 하는 경우는 막지 않는다.

**경쟁 창이 실제로 열리는 빈도**

- 아래 5번 이슈 때문에 `runCloudSync`는 15분 알람보다 서비스 워커가 깨어날 때마다(`background.js:72`) 더 자주 돈다.
- 서비스 워커는 페이지 로드(`getColors`)나 탭 전환에도 깨어난다. 즉 사용자가 페이지를 열고 막 하이라이트하려는 순간에 동기화가 돌고 있을 가능성이 높다.
- 모바일이나 느린 망에서는 ②가 수 초까지 걸린다.

**동시 실행**

실행을 하나로 직렬화하는 장치(single-flight)가 없다. 알람이 서비스 워커를 깨우면 top-level IIFE(`background.js:72`)와 `onAlarm`(`cloud-sync-service.js:491`)이 각각 `runCloudSync`를 호출한다. 설정 화면의 "지금 동기화"(`triggerCloudSync`)도 겹칠 수 있다. 두 실행이 서로의 ④·⑤를 다시 덮어써 창이 더 넓어지고 PUT도 중복된다.

**수정안**

1. **single-flight**: 모듈 수준의 `inFlight` promise로 실행을 하나로 합친다. 진행 중에 호출이 들어오면 그 promise를 돌려주거나, 끝난 뒤 한 번 더 돌도록 표시한다.
2. **바뀐 페이지만 쓰기**: merge 결과가 스냅샷과 같은 페이지는 쓰지 않는다. `isSameHighlightState`와 `deletedGroupIds` 비교를 쓴다. 이것만으로도 대부분의 경쟁이 사라진다. 원격에서 바뀐 페이지만 쓰게 되기 때문이다.
3. **쓰기 직전 재병합**: 써야 하는 페이지는 ④ 직전에 storage.local을 다시 읽는다. 스냅샷과 다르면 `mergeHighlights(현재 로컬, merged)`로 한 번 더 합친 결과를 쓴다. tombstone 기반 merge라서 재적용해도 안전하다.
4. **tombstone 맵 병합**: ⑤는 최신 `cloudSyncDeletedUrls`를 다시 읽어 `mergeTombstonesByMax`로 합친 뒤 저장한다. ④에서 페이지를 쓸 때도 최신 맵에 tombstone이 있고 그것이 페이지보다 새로우면 쓰지 않는다.
5. 테스트: `tests/cloud-sync-service.test.js`에 `fetch`를 지연시키는 mock을 두고, 그 사이에 저장·삭제·전체 삭제를 끼워 넣는 케이스 세 개를 추가한다.

### 2. 가져오기(import)가 background를 거치지 않음

- 위치: `pages-list.js:768-782`
- 확인: 코드 확인
- 문제: `storage.local.set(ops)`를 직접 호출한다. 그래서 다음이 모두 빠진다.
  - `syncSaveHighlights`
  - 교체되는 그룹의 tombstone 기록
  - `cloudSyncDeletedUrls`·`sync_meta.deletedUrls`에서 해당 URL 제거
  - 열린 탭 갱신
- 또 `_meta`를 `{title, lastUpdated}`로 통째로 교체해 기존 `deletedGroupIds`를 버리고, `_meta` 키를 손으로 조립한다(`STORAGE_KEYS.META_SUFFIX`를 쓰지 않음).
- 시나리오:
  - 덮어쓴 기존 그룹이 storage.sync나 클라우드 사본과 merge되면서 되살아난다.
  - 30일 안에 삭제한 페이지를 백업에서 가져오면 다음 클라우드 동기화 때 다시 지워진다. 파일의 `lastUpdated`가 삭제 시각보다 오래되었기 때문이다(`mergeBlobs` 157행).
- 수정안:
  - background에 `importPages` 액션을 만든다. 이 액션은 다음을 한 번에 처리한다.
    - `lastUpdated`를 지금 시각으로 찍는다.
    - 두 tombstone 맵에서 해당 URL을 지운다.
    - 교체되는 groupId의 tombstone을 기록한다.
    - `syncSaveHighlights`를 호출한다.
    - 해당 탭에 broadcast한다.
  - pages-list는 `sendToBackground`로 이 액션만 호출한다.

### 3. 서비스 워커가 시작될 때마다 storage.sync 색상이 로컬 색상을 덮어씀

- 위치: `background/settings-service.js:283-296`
- 확인: 코드 확인. 시나리오는 추정.
- 문제: sync의 `customColors`가 비어 있지 않으면 무조건 local을 덮어쓴다. 그런데 클라우드 동기화 경로(`applySettingsFromSync`)는 local만 쓰고 storage.sync는 갱신하지 않는다.
- 시나리오: 클라우드로 받은 색상이 다음 서비스 워커 재시작 때 storage.sync의 옛 값으로 되돌아간다. `sync.set`이 쓰기 빈도 한도에 걸려 실패했을 때도 마찬가지다.
- 수정안: local을 우선한다. local에 값이 없을 때만 sync 값을 쓴다.

### 4. storage.sync 축출 계산 오류와 `sync_meta` 크기 한도

- 위치: `background/sync-service.js:286`, `:298-312`, `:345-346`
- 확인: 이중 계산은 코드 확인. 8KB 초과는 추정(계산 기반).
- **이중 계산**: 루프 조건 `totalSize + dataSize`에 갱신 중인 페이지의 기존 `size`가 아직 들어 있다. 기존 크기는 303행에서야 빠진다. 그래서 기존 페이지를 갱신할 때마다 다른 페이지가 불필요하게 축출된다.
- **`sync_meta` 크기**: `meta.pages` 항목 하나는 약 140B다. 그래서 약 55개 페이지에서 `QUOTA_BYTES_PER_ITEM`(8192B)을 넘을 수 있다. 이때 meta set이 throw하는데 catch가 삼키므로, 장부와 실제 데이터가 어긋난다. 삭제 경로에서는 meta set이 먼저 실패해 `remove`까지 가지 못한다.
- 수정안:
  - 루프 전에 기존 항목의 size를 빼고, 자기 자신은 축출 후보에서 제외한다.
  - meta 직렬화 크기를 축출 조건에 넣는다.
  - meta 항목에서 `url`을 뺀다(`hl_*` 항목 안에 이미 있다).

### 5. 서비스 워커가 깨어날 때마다 15분 알람이 리셋됨

- 위치: `background/cloud-sync-service.js:488`, `background.js:72`
- 확인: 코드 확인
- 문제: 같은 이름으로 `alarms.create`를 호출하면 기존 알람이 교체된다. 자주 쓰는 사용자에게는 알람이 사실상 울리지 않는다. 대신 깨어날 때마다 시작 시점 `runCloudSync`(GET, 경우에 따라 PUT)가 돈다.
- 수정안:
  - `if (!(await alarms.get(NAME))) alarms.create(...)`로 바꾼다.
  - 시작 시점 동기화는 `lastSyncedAt`이 주기보다 오래됐을 때만 돌린다.

---

## 2순위: 수정이 쉽고 효과가 큰 것

### 6. groupId를 CSS 선택자 문자열에 그대로 넣음

- 위치: `content-scripts/content.js:424, 480, 982, 990`, `content-scripts/minimap.js:122`
- 확인: 코드 확인
- 문제: `[data-group-id='${groupId}']` 형태다. import로 들어온 id에 `'`나 `\`가 있으면 `querySelectorAll`이 SyntaxError를 던진다. 그러면 삭제, 색 변경, 미니맵 그리기가 멈춘다. import 스키마(`shared/import-export-schema.js:88`)는 비어 있지 않은 문자열이면 어떤 id든 받는다.
- 수정안: 이미 있는 `findHighlightElementsByGroupId()`(`content-common.js:28`)를 쓴다.

### 7. 확장 페이지가 `runtime.sendMessage`를 그대로 씀

- 위치: `settings.js` 16곳, `popup.js` 3곳(`:310`, `:332` 등)
- 확인: 코드 확인
- 문제: AGENTS.md의 `sendToBackground` 규칙을 어긴다. 일부는 null 검사 없이 `response.success`를 읽는다. 그래서 background가 응답하지 않으면 설정 화면 초기화가 중단되거나(focus 재로딩 리스너가 등록되지 않음) 클릭이 조용히 무시된다.
- 수정안:
  - `sendToBackground`로 바꾸고 `response?.success`로 검사한다.
  - `tests/runtime-message-guard.test.js`에 확장 페이지 소스를 스캔해 이 사용을 금지하는 가드를 추가한다.

### 8. 번역 키 누락과 `lang` 속성

- 확인: 코드 확인
- `importError`, `exportError`, `noHighlightsToExport`가 7개 로케일 어디에도 없다. 그래서 모든 언어에서 영어 fallback이 나온다(`pages-list.js:755, 863, 869`).
- 네 HTML 모두 `<html lang>`이 없다.
- 수정안:
  - 키를 추가한다.
  - `document.documentElement.lang`을 UI 언어로 설정한다.
  - 페이지가 쓰는 키와 로케일을 대조하는 Jest 테스트를 추가한다.

### 9. 미니맵 throttle 3개가 타이머 하나를 공유함

- 위치: `content-scripts/minimap.js:6, 270-278`
- 확인: 코드 확인
- 문제: ResizeObserver, scroll, resize가 `this.throttleTimer` 하나를 쓴다. 먼저 온 호출이 나머지를 버리므로 마커 위치나 visible 표시가 갱신되지 않은 채 남는다.
- 수정안: throttle 클로저마다 타이머를 따로 두고 trailing 호출을 보장한다.

### 10. 정리 대상

- `activeTab` 권한을 쓰는 곳이 없다. 두 manifest 모두에서 뺄 수 있다.
- "어떤 local 키가 페이지 키인가"를 판정하는 코드가 4곳에 따로 있고 서로 다르다(`message-router.js:257, 296`, `sync-service.js:505`, `cloud-sync-service.js:15`). `constants/storage-keys.js`의 `isPageKey()` 하나로 모은다.
- 죽은 코드:
  - `content.js`: `overlapsClaimedRegion`/`maskClaimedRegions` 래퍼, `getFirstTextNodePosition`
  - `content-core.js`: `convertSelectionRange` 안의 `isBlockElement`
  - `minimap.js`: `destroy()`
  - `message-router.js`: `getDebugMode` 핸들러
- `content.js:955`의 `style.display !== 'none'` 검사는 항상 참이다. 가시성은 `visible` 클래스로 관리된다.
- `minimap.js:136`의 `marker.dataset.highlightId`에는 항상 `"undefined"`가 들어간다.
- `controls.js:669`는 색상 적용(Apply) 시 `preview.style.backgroundColor`를 다시 hex로 바꿔 읽는다. 그래서 입력한 hex가 그대로 유지되지 않을 수 있다. `getColor()`를 쓴다.
- 텍스트 노드 필터(SCRIPT/STYLE/… 제외)가 4곳에 복제되어 있다.
- `errorLog`가 릴리스 빌드에서 아무 일도 하지 않아서 sync 실패가 전혀 남지 않는다.

---

## 3순위: 제품 판단이 필요한 것

### 11. 페이지 안 앵커를 누르면 하이라이트가 사라짐

- 위치: `content-scripts/navigation-bridge.js:26`, `content-scripts/content.js:101-134`
- 확인: 코드 확인
- 문제: `hashchange`를 페이지 이동으로 처리한다. 저장 키는 일반 프래그먼트를 포함한 전체 URL이다. 그래서 목차 링크(`#chapter-2`)를 누르면 `clearAllHighlights()`가 실행되고, 새 키로 로드해도 데이터가 없다.
- 해시 라우팅 SPA를 지원하려는 의도일 수 있다. 그래서 다음 중에서 결정이 필요하다.
  - 해시가 `#/`나 `#!`일 때만 페이지 이동으로 본다.
  - 저장 키에서 프래그먼트를 뺀다(마이그레이션 필요).
- 관련 문제: `broadcastToTabsByUrl`(`shared/tab-broadcast.js:42`)은 `tabs.query({url})`을 쓰는데, match pattern은 프래그먼트를 매칭하지 않는다. 그래서 해시 URL 탭에는 refresh가 가지 않는다.

### 12. 페이지 목록의 파비콘이 Google을 거침

- 위치: `pages-list.js:106`
- 문제: 하이라이트한 모든 호스트명(사내 인트라넷 포함)이 Google로 전송된다.
- 수정안: Chrome은 `favicon` 권한과 `_favicon/` URL을 쓴다. Firefox는 로컬 기본 아이콘을 쓰거나 설정으로 켜게 한다.

### 13. 접두사 없는 CSS 클래스가 호스트 페이지와 충돌함

- 위치: `styles.css`(`.color-button`, `.color-separator`, `.custom-color-picker` 등), `content-scripts/color-picker.css` 전체
- 문제: 이 파일들은 `<all_urls>`에 주입된다. 그래서 같은 클래스명을 쓰는 페이지 요소에 스타일이 붙는다. `controls.js:392`의 `document.querySelector('.custom-color-picker')`는 페이지 요소를 잡을 수도 있다.
- 수정안: `text-highlighter-` 접두사를 붙인다. 장기적으로는 UI 루트를 Shadow DOM으로 옮긴다.

### 14. 메시지 라우터가 sender를 검증하지 않음 (심층 방어)

- 위치: `background/message-router.js:396-413`
- 문제: 임의 사이트에서 도는 content script도 `getCloudSyncStatus`(sync 코드 반환), `pairCloudSync`, `deleteAllHighlightedPages` 등을 호출할 수 있다. renderer가 탈취된 경우를 가정한 위협이다.
- 수정안: 권한이 필요한 액션은 `sender.url`이 `runtime.getURL('')`로 시작할 때만 허용한다. Android에서는 확장 페이지에도 `sender.tab`이 있으므로, `sender.tab` 유무로 판단하면 안 된다.

### 15. 접근성

- 설정 화면:
  - 색 이름 편집은 `<span>`의 click으로만 열린다(`settings.js:232`).
  - 단축키 `<select>`에 라벨이 없다(`:796`).
  - Edit/Remove 버튼 이름이 모든 행에서 같다(`:306, 313`).
- 페이지 목록:
  - "more" 메뉴는 `role="menu"`를 선언했지만 포커스 이동과 화살표 키 탐색이 없다(`pages-list.js:664`).
  - "Show Details" 버튼에 `aria-expanded`가 없다.

---

## 성능 (낮은 우선순위)

- `minimap.js`의 `createMarker`는 그룹마다 rect 읽기와 DOM 쓰기를 번갈아 해서 강제 레이아웃이 N번 일어난다. 읽기와 쓰기를 분리하고 DocumentFragment로 한 번에 붙인다.
- `content-core.js`의 `convertSelectionRange`는 큰 선택에서 요소마다 `textContent`를 정규화한다. 텍스트 길이로 가지치기를 한다.
- `controls.js:1184`의 selectionchange 핸들러는 이벤트마다 `selection.toString()`을 호출한다. `isCollapsed`로 먼저 거른다.
- `content.js:395`의 `unwrapHighlightSpans`는 스팬마다 `parent.normalize()`를 호출한다. 고유한 부모만 한 번씩 normalize한다.

## 테스트·CI

- CI는 Firefox 빌드(`deploy:firefox`)를 실행하지 않는다. 두 manifest의 `content_scripts` 목록이 같은지 확인하는 테스트도 없다. 현재는 일치한다.
- 워크플로가 `push`(모든 브랜치)와 `pull_request`에 함께 걸려 있어 PR 브랜치에서 두 번 돈다. `concurrency`와 `timeout-minutes`도 없다.
- lint 단계가 없다. 7번 같은 규칙 위반은 ESLint `no-restricted-syntax`로 잡을 수 있다.
