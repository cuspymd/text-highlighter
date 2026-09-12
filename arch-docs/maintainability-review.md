# 유지보수 관점 전체 코드 리뷰

작성일: 2026-09-12
대상 저장소: `text-highlighter` (`29d8fb7` 기준)
대상 범위: `background.js`, `background/`, `shared/`, `constants/`, `content-scripts/`, 페이지 스크립트 3종, `scripts/`, `worker/`, 매니페스트, `_locales/`

관련 문서: [클린 코드 리뷰](clean-code-review.md)

이 리뷰는 유지보수성만 다룹니다. 테스트 커버리지는 범위 밖이고, 수치나 목표를 제시하지 않습니다. 테스트를 언급하는 곳이 있다면 그것은 "변경이 잘못됐을 때 알려 주는 장치가 있는가"라는 뜻이지 커버리지를 올리라는 뜻이 아닙니다.

---

## 1) 규모

| 영역 | 파일 | 줄 수 |
| --- | ---: | ---: |
| `content-scripts/` | 8 | 4,587 |
| `background/` + `background.js` | 7 | 2,189 |
| 페이지 스크립트 3종 | 3 | 1,939 |
| `shared/` | 11 | 821 |
| `scripts/` | 3 | 306 |
| `worker/src/` | 1 | 91 |

가장 큰 파일 다섯 개가 `controls.js` 1,595줄, `content.js` 1,224줄, `content-core.js` 974줄, `pages-list.js` 897줄, `styles.css` 895줄입니다. 확장 페이지 네 개의 인라인 CSS를 합치면 1,660줄이 더 있습니다.

`npm test`는 37 suites, 552 tests가 전부 통과합니다.

---

## 2) 총평

구조적으로 잘 되어 있는 것부터 적습니다. 아래 개선 항목들은 이 토대 위에서 읽어야 합니다.

- `background.js`의 서비스 분리가 끝났고, `message-router.js`의 액션 핸들러 맵은 라우팅을 데이터로 만들어 `message-routing-matrix.md`와 동일 이름의 테스트로 검증까지 이어집니다.
- `AGENTS.md`가 코드가 말하지 않는 것만 적는다는 원칙을 지키고 있고, `tabs.sendMessage` 콜백 함정처럼 실제로 조용히 죽는 실수를 정확히 짚습니다.
- `shared/crypto-utils.js`는 HKDF 분리 도출, AES-GCM, 서버가 평문을 볼 수 없는 구조까지 설계가 단정합니다.
- `restore-core.js`의 주석은 왜 그렇게 했는지를 남기는 좋은 예입니다. 특히 `maskClaimedRegions`가 `split('')`을 쓰는 이유를 적어 둔 부분.
- TODO/FIXME 주석이 한 개도 없습니다.

유지보수 부담은 거의 전부 **하나의 규칙이 여러 곳에 복제되어 있고, 그 복제를 지켜 줄 장치가 없다**는 한 가지 패턴에서 나옵니다. 아래 항목 대부분이 이 패턴의 변주입니다.

---

## 3) P0 — 먼저 고칠 것

### 3-1. "어떤 스토리지 키가 페이지인가" 판정이 네 곳에 흩어져 있다

하이라이트는 URL을 키로 `storage.local` 최상위에 저장되고, 설정도 같은 네임스페이스에 있습니다. 그래서 "이 키가 페이지인가"를 판정하는 코드가 네 벌 존재하며 내용이 서로 다릅니다.

| 위치 | 이름 | 빠진 키 |
| --- | --- | --- |
| `background/message-router.js:246` | `skipKeys` | 클라우드 싱크 키 전부, `lastUsedColor`, `oneClickHighlightEnabled` |
| `background/message-router.js:275` | `skipKeys` | 위와 동일 |
| `background/sync-service.js:428` | `skipKeys` | 클라우드 싱크 키 전부 |
| `background/cloud-sync-service.js:15` | `LOCAL_ONLY_KEYS` | 없음 |

지금 사고가 나지 않는 이유는 네 곳 모두 최종 판정을 `Array.isArray(value)`에 의존하기 때문입니다. 설정 키들이 마침 배열이 아니라서 걸러집니다.

배열 값을 갖는 설정 키를 하나라도 추가하는 순간, 그 키는 하이라이트 페이지로 잡혀 `getAllHighlightedPages` 목록에 뜨고 `deleteAllHighlightedPages`에 지워지고 클라우드 블롭에 페이지로 실려 나갑니다. 네 곳을 동시에 고쳐야 한다는 것을 기억해야만 안전한 구조입니다.

**권고.** 판정을 한 곳으로 모읍니다.

```js
// constants/storage-keys.js
export function isHighlightPageKey(key, value) {
  return Array.isArray(value)
    && !key.endsWith(STORAGE_KEYS.META_SUFFIX)
    && !RESERVED_KEYS.has(key);
}
```

더 근본적으로는 페이지 키에 접두사를 두어 네임스페이스를 나누는 쪽이 낫습니다. 다만 기존 데이터 마이그레이션이 필요하므로 별도 과제로 둡니다.

### 3-2. 페이지 스크립트가 `AGENTS.md`가 경고한 함정을 그대로 밟고 있다

`AGENTS.md`는 페이지 스크립트가 `shared/runtime-message.js`의 `sendToBackground`를 쓰라고 못박습니다. 잠든 service worker가 `runtime.sendMessage`를 reject하고, `await`에 `catch`가 없으면 unhandled rejection으로 끝나 클릭이 아무 일도 하지 않기 때문입니다.

실제 사용 현황:

| 파일 | `sendToBackground` | 직접 `runtime.sendMessage` |
| --- | ---: | ---: |
| `pages-list.js` | 5 | 0 |
| `settings.js` | 4 | 16 |
| `popup.js` | 0 | 2 |
| **합계** | **9** | **18** |

마이그레이션 대상은 직접 호출 열여덟 곳입니다. 그중 다섯 곳은 응답을 널 체크 없이 읽기까지 합니다.

```js
// settings.js:136-143, 235, 253, 291, 409-411
const response = await browserAPI.runtime.sendMessage({ ... });
if (response.success) { ... }
```

**실패 경로를 정확히 적어 둡니다.** 잠든 워커가 reject하면 실행은 `await`에서 멈춥니다. `response`에 `undefined`가 들어간 뒤 `response.success`에서 `TypeError`가 나는 것이 아니라, 그 줄에 도달하지 못한 채 async 핸들러가 unhandled rejection으로 끝납니다. 사용자가 보는 것은 오류 없이 아무 일도 일어나지 않는 화면입니다.

구분이 중요한 이유는 재현 테스트의 모양이 달라지기 때문입니다. 응답을 `undefined`로 모킹하면 통과해 버리고, reject로 모킹해야 실패합니다. 그리고 널 체크를 넣는 것으로는 고쳐지지 않습니다. 필요한 것은 rejection 처리이고, 응답을 역참조하는지 여부와 무관하게 직접 호출 전부가 대상입니다.

`AGENTS.md`의 "Extension API calls" 절이 이 경로를 그대로 설명합니다. 콜백 형태였을 때는 같은 상황이 `undefined` 응답으로 도착해 `if (!response || !response.success)` 분기가 받아 줬고, promise 형태로 오면서 그 안전망이 사라졌습니다.

색 이름 편집은 사용자가 입력 필드에 머무는 동안 워커가 잠들 시간이 충분합니다. blur 시점에 reject가 나면 이름이 저장되지 않고 오류 표시도 없습니다.

**권고.** 페이지 스크립트의 `browserAPI.runtime.sendMessage` 호출을 전부 `sendToBackground`로 바꾸고, `tests/runtime-message-guard.test.js`처럼 직접 호출을 금지하는 가드 테스트를 추가합니다. 가드가 없으면 다음 기능에서 같은 일이 반복됩니다.

### 3-3. import 경로가 배경을 우회해 스토리지에 직접 쓴다

`pages-list.js:740-760`이 import 결과를 `storage.local`에 직접 씁니다. 세 가지 문제가 겹쳐 있습니다.

```js
ops[url] = null;                 // 먼저 삭제하려는 의도
ops[`${url}_meta`] = null;
// ...
ops[page.url] = page.highlights || [];      // 같은 키를 덮어씀
ops[`${page.url}_meta`] = { ... };
```

1. `${url}_meta`를 손으로 조립합니다. `constants/storage-keys.js`를 읽으라는 규칙의 레포 내 유일한 위반입니다.
2. `ops[url] = null` 뒤에 같은 객체 리터럴에서 같은 키를 실제 값으로 덮으므로 "기존 것 삭제" 단계가 아무 일도 하지 않습니다. 설령 남아 있었더라도 `storage.local.set`에 `null`을 넣는 것은 삭제가 아닙니다.
3. 배경을 거치지 않으므로 `syncSaveHighlights`도 `recordCloudSyncTombstones`도 타지 않습니다. import한 페이지의 기존 `deletedGroupIds`가 사라진 채로 덮이므로, 다른 기기에서 지운 그룹이 되살아날 수 있습니다.

**권고.** `importHighlightPages` 액션을 `message-router.js`에 추가하고 저장 경로를 하나로 만듭니다. 스토리지 쓰기는 배경만 한다는 경계를 지키면 앞의 세 문제가 없어집니다.

**경로를 옮기는 것만으로는 부족하고, tombstone을 어떻게 다룰지가 본론입니다.** 여기가 이 리뷰에서 가장 까다로운 지점이라 따로 적습니다.

import는 "쓰기"가 아니라 "치환"입니다. 동기화가 있는 시스템에서 치환은 두 가지를 동시에 뜻합니다. **파일에 없는 것은 지운다**, 그리고 **파일에 있는 것은 되살린다**. 둘 중 하나만 처리하면 반대쪽이 깨지고, 두 요구는 tombstone을 정반대 방향으로 밀어붙입니다.

**지우는 쪽.** `mergeHighlights`는 tombstone에 걸리지 않은 원격 그룹을 전부 살려 둡니다. 그러니 파일에 없는 그룹에는 tombstone을 찍어야 합니다. 대상은 로컬 목록이 아닙니다. `storage.sync`나 클라우드 블롭에만 있고 이 기기가 아직 당겨오지 않은 그룹은 로컬에 없으므로 빠지고, 첫 동기화에서 되돌아옵니다. 원격을 먼저 당겨와 합친 뒤 그 합집합을 기준으로 찍어야 합니다.

**되살리는 쪽.** 그런데 기존 tombstone을 그대로 보존하면 import의 본래 목적인 백업 복원이 깨집니다. `shared/import-export-schema.js`의 `toTimestampOrNow`와 `toIsoStringOrNow`가 파일의 `updatedAt`과 `lastUpdated`를 그대로 살리기 때문입니다.

```
어제  그룹 X 삭제           → deletedGroupIds[X] = 어제
오늘  지난주 백업을 import  → X.updatedAt = 지난주
동기화: !deletedAt || groupTime > deletedAt
        지난주 > 어제 = false  → X가 조용히 사라짐
```

페이지 단위도 같습니다. `mergeBlobs`가 `deletedAt > max(localTime, remoteTime)`이면 페이지를 통째로 건너뛰므로, 지운 적 있는 URL을 오래된 백업으로 복원하면 페이지가 통째로 안 돌아옵니다. 여기에는 `sync_meta.deletedUrls`와 `cloudSyncDeletedUrls` 두 곳이 걸립니다.

**규칙.** 따라서 보존과 삭제가 아니라 **파일에 있는가 없는가**로 갈라야 합니다.

| 대상 | tombstone 처리 |
| --- | --- |
| import 파일에 **있는** 그룹과 URL | 기존 tombstone을 지웁니다. 또는 파일의 타임스탬프를 권위 있는 것으로 올려 tombstone을 이기게 합니다 |
| import 파일에 **없는** 그룹과 URL | tombstone을 보존하거나 새로 찍습니다. 기준은 로컬과 원격의 합집합입니다 |

두 번째 열의 "또는"은 취향 차이가 아닙니다. 타임스탬프를 올리면 다른 기기의 최신 편집을 덮을 수 있고, tombstone을 지우면 그 기기의 삭제 의도가 사라집니다. 어느 쪽이 맞는지는 "import는 이 기기의 선언인가, 모든 기기에 대한 선언인가"라는 제품 결정이므로, 구현 전에 `sync-requirements.md`에 한 줄로 정해 두는 편이 낫습니다.

### 3-4. `groupId`가 `Date.now()` 하나뿐이다

```js
// content-scripts/content.js:1148
const groupId = Date.now().toString();
```

같은 밀리초에 만들어진 두 그룹은 같은 id를 갖습니다. `mergeHighlights`는 `groupId`로 Map을 만들어 중복을 제거하므로 병합에서 한쪽이 사라지고, tombstone도 id로 걸리므로 삭제가 엉뚱한 그룹에 전이될 수 있습니다.

한 탭 안에서는 드물지만, 동기화하는 제품에서는 서로 다른 기기가 같은 페이지에 같은 밀리초에 하이라이트할 가능성까지 감안해야 합니다. 병합 규칙이 `updatedAt` 비교인데 그 값도 `Date.now()`라 동률이 되면 나중에 처리된 쪽이 조용히 이깁니다.

**권고.** `` `${Date.now()}_${crypto.randomUUID().slice(0, 8)}` `` 정도로 충분합니다. 기존 id는 그대로 두어도 되고, 문자열 비교만 하므로 형식 변경에 따르는 마이그레이션이 없습니다.

---

## 4) P1 — 구조적 중복

### 4-1. 매니페스트 두 벌

`manifest.json` 97줄 중 `manifest-firefox.json`과 다른 곳은 두 군데뿐입니다.

| 항목 | Chrome | Firefox |
| --- | --- | --- |
| `background` | `service_worker` | `scripts` 배열 |
| `browser_specific_settings` | 없음 | gecko 블록 |

나머지 95줄, 즉 `permissions`, `host_permissions`, `commands` 5개, `content_scripts` 목록 전체, `web_accessible_resources`가 그대로 복제되어 있습니다.

`AGENTS.md`가 "새 코어 파일은 **양쪽** 매니페스트의 `content_scripts`에, 그것을 읽는 스크립트보다 앞에 추가하라"고 굵게 경고하는 것 자체가 이 중복의 유지비입니다. 그리고 주 E2E 스위트는 Chromium만 돌기 때문에, Firefox 매니페스트에 빠뜨린 파일은 CI가 초록인 채로 통과합니다.

**권고.** `manifest.base.json`을 두고 `scripts/deploy.cjs`가 브라우저별 패치를 합성해 `dist/manifest.json`을 만들게 합니다. 패치는 위 표의 두 항목뿐이라 20줄 안쪽입니다.

### 4-2. 테마 토큰 네 벌

확장 페이지 네 개가 각자 인라인 `<style>`에 동일한 디자인 토큰을 라이트/다크로 정의합니다. 값까지 전부 같습니다.

| 파일 | 전체 줄 | `<style>` 줄 |
| --- | ---: | ---: |
| `settings.html` | 629 | 485 |
| `pages-list.html` | 606 | 537 |
| `popup.html` | 533 | 471 |
| `onboarding.html` | 338 | 167 |

공통 토큰은 `--bg`, `--surface`, `--surface-strong`, `--text`, `--muted`, `--border`, `--accent` 일곱 개입니다. 그런데 값이 전부 같지는 않습니다. `pages-list.html`만 세 토큰에서 다섯 개 값이 어긋나 있습니다.

| 토큰 | 나머지 세 페이지 | `pages-list.html` |
| --- | --- | --- |
| `--muted` 라이트 | `#64646b` | `#666772` |
| `--muted` 다크 | `#ababba` | `#a9a9b4` |
| `--border` 라이트 | `#e1e1e6` | `#e1e1e8` |
| `--border` 다크 | `#36363c` | `#383842` |
| `--surface-strong` 다크 | `#222226` | `#242428` |

이 차이는 중복이라는 진단을 약화시키지 않습니다. 오히려 예고된 드리프트가 이미 일어났다는 증거입니다. 다만 통합 방식에는 영향을 줍니다. 일곱 토큰을 그대로 `shared/tokens.css`로 옮기면 `pages-list`의 외관이 바뀝니다.

**권고.** `shared/modal.css` 옆에 `shared/tokens.css`를 만들어 네 페이지가 `<link>`로 참조하되, 위 다섯 값은 먼저 의도적인 것인지 판단해야 합니다. 의도였다면 `pages-list.html`에 오버라이드로 남기고, 아니라면 한쪽으로 맞춘 뒤 옮깁니다. `deploy.cjs`가 `shared/` 디렉터리를 통째로 복사하므로 빌드 변경은 필요 없습니다.

### 4-3. 색 이름 생성이 세 벌

| 위치 | 함수 |
| --- | --- |
| `content-scripts/controls.js` | `colorDisplayName` |
| `background/settings-service.js` | `getColorDisplayName` |
| `settings.js` | `buildColorLabel` |

셋 다 "커스텀 이름 → 커스텀 색 번호 → nameKey 번역" 순서로 같은 일을 합니다. 그런데 `settings.js`만 기본색에도 `colorNumber`를 붙이는 분기를 갖고 있어 이미 미묘하게 다릅니다. 이름 규칙을 바꾸려면 세 곳을 고쳐야 하고, 한 곳을 빠뜨려도 테스트는 통과합니다.

**권고.** `shared/color-label.js`로 한 벌만 남깁니다. `controls.js`는 ESM을 쓸 수 없으므로 `color-core.js`에 두고 shared 쪽에서 재사용하거나, 반대로 두 진입점을 만드는 방식이 필요합니다. 이 제약 자체가 4-6 항목과 연결됩니다.

### 4-4. 확장 네임스페이스 선택이 두 벌

`shared/browser-api.js`와 `content-scripts/content-common.js`가 각각 `browser` / `chrome` 분기를 구현합니다. 내용은 같고 모듈 시스템만 다릅니다. `AGENTS.md`가 이 객체의 성격을 길게 설명하는 만큼, 정의가 두 곳인 것은 위험합니다.

### 4-5. `MAX_BODY_BYTES`가 두 배포 단위에 독립 정의

| 위치 | 값 |
| --- | --- |
| `constants/cloud-sync-config.js` | `1_000_000` |
| `worker/src/index.js` | `1_000_000` |

확장과 워커는 서로 다른 시점에 배포됩니다. 한쪽만 올리면 클라이언트가 통과시킨 페이로드를 워커가 413으로 거절하고, 사용자는 `cloudSyncLastError`에 숫자만 적힌 메시지를 봅니다. 워커에는 테스트도 CI 단계도 없어서 이 드리프트를 잡을 지점이 없습니다.

**권고.** 워커가 값을 응답 헤더나 `GET /limits`로 알리고 클라이언트가 그것을 쓰게 하거나, 최소한 양쪽 파일에 서로를 가리키는 주석을 답니다. 워커 테스트는 `wrangler` 없이도 `fetch` 핸들러를 직접 호출해 붙일 수 있습니다.

### 4-6. 모듈 시스템이 세 갈래인 데서 오는 재사용 불가

`shared/`와 `background/`는 ESM, content script는 `window` 전역, 페이지 스크립트는 ESM이지만 `DOMContentLoaded` 클로저 하나입니다. 4-3과 4-4의 중복은 취향 문제가 아니라 이 구조가 강제하는 것입니다. content script가 `shared/`를 import할 수 없기 때문입니다.

세 갈래로 갈라져 있다는 진단 자체는 `testability-review.md`에도 있습니다. 다만 거기서는 테스트 관점의 근거였고, 여기서는 코드를 한 벌로 유지할 수 없다는 것이 문제입니다. 번들러 없이 해결하려면 코어 파일이 UMD 형태로 양쪽을 지원하는 방법이 있습니다.

```js
// shared/color-label.js 하단
if (typeof window !== 'undefined') window.TextHighlighterColorLabel = api;
export default api;  // manifest 주입 시 이 줄이 문제
```

`export`가 섞이면 classic script로 로드되지 않으므로, 실제로는 코어 파일을 IIFE로 두고 `shared/` 쪽에서 얇게 감싸 re-export하는 편이 현실적입니다. 어느 쪽이든 결정을 한 번 내려서 문서화해 두는 것이 매번 중복을 늘리는 것보다 낫습니다.

---

## 5) P1 — 안전망의 빈틈

### 5-1. `deploy.cjs`가 누락을 경고만 하고 성공한다

```js
// scripts/deploy.cjs
if (fs.existsSync(src)) {
  copyFile(src, dest);
} else {
  console.warn(`Warning: ${file} not found`);   // 그리고 계속 진행
}
```

`filesToCopy`는 루트 파일 열 개를 나열한 화이트리스트이고, 실패 양상이 두 가지로 갈립니다.

그런데 이 분기는 세 종류의 입력 중 하나에만 해당합니다. `deploy.cjs`는 매니페스트, 루트 파일 목록, 디렉터리 목록을 각각 따로 처리하고 **세 곳 모두 경고 후 계속 진행합니다.**

| 입력 | 누락 시 |
| --- | --- |
| 선택된 매니페스트 | 경고, 계속 진행. 매니페스트 없는 패키지가 나옴 |
| `filesToCopy`에 있는 파일 | 경고, 계속 진행 |
| `directoriesToCopy`에 있는 디렉터리 | 경고, 계속 진행. `_locales`나 `shared`가 빠져도 성공 |
| 루트에 있는데 `filesToCopy`에 없는 파일 | **경고조차 없음.** 루프가 쳐다보지 않음 |

마지막 줄이 가장 위험하고, 위 코드로는 잡히지 않습니다. 루프는 `filesToCopy`만 순회하므로 목록에 없는 파일은 존재 여부를 검사받지도 않습니다. `version-deploy.cjs`는 네 경우 모두 결과를 그대로 zip으로 묶습니다.

**권고.** 두 가지인데, 두 번째가 본론입니다.

**1. 세 경고 분기를 모두 `process.exit(1)`로 바꿉니다.** 매니페스트나 `_locales`가 없는 패키지가 성공으로 끝나는 것에는 정당한 사유가 없습니다. 몇 줄이고 부작용이 없습니다.

**2. 패키지를 목록이 아니라 참조 관계에서 도출합니다.** "목록에 없는 파일이 있으면 실패"라는 반대 방향의 검사는 쓸 수 없습니다. 루트에 추적되는 파일 스무 개 중 패키지에 들어가는 것은 열 개뿐이고, 나머지는 빠지는 것이 맞기 때문입니다.

| 루트 파일 | 패키지 포함 | 비고 |
| --- | --- | --- |
| `filesToCopy`의 열 개 | O | |
| `manifest.json` 또는 `manifest-firefox.json` | 하나만 | 선택되지 않은 쪽은 제외가 정상 |
| `package.json`, `package-lock.json` | X | |
| `playwright.config.cjs` | X | |
| `.gitignore`, `LICENSE`, `*.md` | X | |

즉 미포함이 정상인 파일이 절반이므로, 어떤 형태든 "무엇이 자산인가"를 사람이 선언해야 하고 그 선언이 곧 잊히는 대상입니다. 이 순환을 끊는 방법은 선언을 없애고 이미 존재하는 참조를 따라가는 것뿐입니다. 매니페스트의 `background`, `action.default_popup`, `content_scripts`의 `js`와 `css`, `web_accessible_resources`, `icons`, `default_locale`에서 시작해 각 HTML의 `<link href>`와 `<script src>`, 각 모듈의 `import`를 따라가면 됩니다.

**다만 도출만으로는 빠지는 것이 두 부류 있습니다.**

첫째, 매니페스트가 가리키지 않는 페이지입니다. `pages-list.html`, `settings.html`, `onboarding.html`은 `popup.js:348`, `popup.js:396`, `background/onboarding.js:23`이 `runtime.getURL()` 문자열로 엽니다. `content-scripts/navigation-bridge.js`와 `images/icon48.png`도 문자열로만 참조됩니다.

둘째, 번역입니다. 두 매니페스트 모두 `default_locale`이 `en`이라 참조를 따라가면 `_locales/en/messages.json` 하나만 찾습니다. 나머지 다섯 로케일은 브라우저가 관례로 읽을 뿐 어떤 HTML도 `import`도 `getURL()`도 가리키지 않습니다. 도출이 `directoriesToCopy`를 대체하면 **영어만 남고 번역 전체가 조용히 빠진 릴리스**가 나옵니다. 5-2의 로케일 불변식 테스트는 소스의 `_locales`를 읽으므로 이것을 잡지 못합니다.

따라서 도출식 빌드는 `_locales/*/messages.json` 전부를 명시적 루트로 두고, 진입점 세 개도 함께 선언한 뒤 나머지를 도출해야 합니다. 그래도 손으로 유지할 목록이 열 개에서 네 줄로 줄고, 그 네 줄은 성격상 자주 늘지 않습니다.

1번은 지금 하고, 2번은 별도 과제로 잡을 만합니다.

### 5-2. i18n 키 드리프트가 실제로 발생해 있다

여섯 로케일 모두 151개 키로 개수는 맞지만, 코드와 대조하면 양쪽으로 어긋나 있습니다.

코드가 쓰는데 어느 로케일에도 없는 키:

| 키 | 사용처 |
| --- | --- |
| `importError` | `pages-list.js:736` |
| `exportError` | `pages-list.js:844` |
| `noHighlightsToExport` | `pages-list.js:850` |

셋 다 `getMessage(key, '영문 기본값')` 형태라 예외는 나지 않고, 대신 비영어 사용자가 import/export 오류 상황에서만 영어를 봅니다. 눈에 띄기 어려운 종류의 결함입니다.

반대로 아무도 쓰지 않는 키가 다섯 개입니다: `searchTooltip`, `colorChangeWarning`, `deleteCustomColors`, `deletedCustomColors`, `noCustomColorsToDelete`. 여섯 로케일이므로 죽은 번역 30줄입니다.

이 드리프트를 잡지 못하는 이유는 검사가 특정 기능에 묶여 있기 때문입니다.

```js
// tests/copy-locales.test.js
const copyKeys = [
  'copyPageHighlightsLabel',
  'copyPageHighlightsSuccess',
  // ... 복사 기능 키 5개만 하드코딩
];
```

**권고.** 기능별 목록 대신 불변식 두 개로 바꿉니다. "모든 로케일의 키 집합이 동일하다"와 "코드가 쓰는 모든 키가 모든 로케일에 있다"입니다. 앞의 것은 단순하지만 뒤의 것은 추출 범위를 정확히 잡아야 하고, 여기에 함정이 둘 있습니다.

**첫째, `data-i18n` 계열 속성이 네 종류입니다.** `data-i18n` 59개, `data-i18n-title` 8개, `data-i18n-placeholder` 1개, 그리고 `onboarding.html`에 `data-i18n-href` 1개입니다. `data-i18n[a-z-]*=`로 접미사를 열어 두지 않으면 `onboardingGuideUrl`처럼 마지막 종류에만 쓰이는 키를 놓칩니다. 이 리뷰를 작성할 때 쓴 초안 스크립트가 정확히 그 실수를 해서 `onboardingGuideUrl`을 미사용으로 분류했습니다.

**둘째, 키가 변수로 들어오는 호출이 있습니다.** 지금 확인된 것만 세 곳입니다.

| 위치 | 가리키는 키 |
| --- | --- |
| `settings.js:330` | `getMessage(colorObj.nameKey)` — 기본색 이름 다섯 개 |
| `pages-list.js:380` | `getMessage(titleKey, ...)` — `expandAllHighlights`, `collapseAllHighlights` |
| `pages-list.js:47-50` | `getMessage(key)` — `highlightNavigation`으로 시작하는 네 개 |

정규식은 이것들을 볼 수 없습니다. 명시적인 허용 목록으로 따로 선언해 두지 않으면 `yellowColor`나 `highlightNavigationCancelled` 같은 키가 미사용으로 보고되고, 누군가 지우고, 테스트는 초록으로 남습니다. 그리고 이 표가 완전하다는 보장이 없다는 점이 더 중요합니다. 목록을 새로 만드는 대신 동적 호출 자체를 없애는 편이 낫습니다. 위 세 곳 모두 키 후보가 유한하므로, 상수 객체에 리터럴로 적어 두면 정규식이 볼 수 있는 형태가 됩니다.

따라서 위에 적은 미사용 키 다섯 개는 정규식 출력이 아니라 레포 전체 문자열 검색으로 따로 확인한 결과입니다. 테스트를 쓸 때도 같은 구분이 필요합니다. "없는 키"는 실패로, "안 쓰는 키"는 경고로 두는 편이 안전합니다.

---

## 6) P2 — 점진 개선

### 6-1. 긴 함수

| 파일 | 함수 | 줄 수 | 비고 |
| --- | --- | ---: | --- |
| `content-core.js` | `convertSelectionRange` | 235 | 중첩 함수 11개 |
| `content-core.js` | `processSelectionRange` | 195 | 중첩 함수 6개 |
| `controls.js` | `showSelectionControls` | 154 | 복제, 위치 계산, 리스너 재바인딩이 한 몸 |
| `controls.js` | `initHSVSliders` | 145 | 마우스/터치 핸들러 4쌍 |
| `controls.js` | `enableTouchDragForControls` | 110 | |
| `content.js` | `highlightTextInDocument` | 107 | |

`convertSelectionRange`의 중첩 함수 11개는 각각 이름이 있고 순수합니다. 밖으로 꺼내면 함수 하나가 235줄에서 스무 줄 남짓으로 줄고, 꺼낸 것들은 이름만으로 무엇을 하는지 읽힙니다.

`showSelectionControls`는 성격이 다릅니다. `highlightControlsContainer`를 `cloneNode`한 뒤 리스너가 사라진 것을 하나씩 되살리는 구조라서, 하이라이트 바에 버튼을 추가할 때마다 이 함수에서 대응하는 복원 코드를 잊지 않아야 합니다. 실제로 `+` 버튼과 스크롤 리스너에 대해 각각 그런 주석이 달려 있습니다. 복제 대신 팩토리 함수로 두 바를 같은 코드에서 만드는 편이 이 부류의 버그를 없앱니다.

### 6-2. 페이지 스크립트가 통짜 클로저

`settings.js` 617줄과 `pages-list.js` 880줄이 각각 `DOMContentLoaded` 콜백 하나입니다. 내보내는 것이 없으므로 안의 함수는 밖에서 부를 수도, 다른 페이지에서 재사용할 수도 없습니다. 4-3의 색 이름 로직이 세 벌로 갈라진 이유 중 하나가 이것입니다. `settings.js` 안의 `buildColorLabel`은 그 클로저를 벗어날 방법이 없습니다.

순수 부분부터 `shared/`로 내보내면 됩니다. `highlight-copy.js`가 `pages-list.js`에서 이 방식으로 빠져나온 좋은 선례입니다.

### 6-3. `urlToSyncKey`가 32비트 해시

```js
// background/sync-service.js
hash = ((hash << 5) - hash) + ch;
hash |= 0;
return SYNC_HIGHLIGHT_PREFIX + Math.abs(hash).toString(36);
```

서로 다른 URL이 충돌하면 한쪽 페이지의 하이라이트가 sync에서 덮입니다. 로컬은 무사하므로 사용자는 다른 기기에서만 데이터가 사라진 것을 보게 되고, 원인을 추적할 단서가 없습니다. `storage.sync` 키 길이 제한이 있으므로 해시 자체는 유지하되, 저장 데이터에 `url`이 이미 들어 있으니 읽을 때 불일치를 감지해 로그를 남기는 정도면 진단 가능해집니다.

### 6-4. 파비콘을 외부에서 가져온다

```js
// pages-list.js:86
src: `https://www.google.com/s2/favicons?sz=64&domain_url=${...}`
```

목록을 열 때마다 사용자가 하이라이트한 호스트명이 구글로 나갑니다. `manifest-firefox.json`이 `data_collection_permissions: ["none"]`을 선언하고 있어 스토어 심사 관점에서도 검토할 만합니다. 대안은 이미 코드 안에 있습니다. `fallbackWebFavicon`이 SVG data URI로 들어 있으므로 그것을 기본값으로 쓰면 외부 요청이 사라집니다.

### 6-5. 주석 언어 혼재

`shared/tab-broadcast.js`와 `shared/runtime-message.js`만 한국어 주석이고 나머지 소스는 영어입니다. 둘 다 `AGENTS.md`가 영어로 길게 설명한 것과 같은 내용을 한국어로 다시 적고 있어, 한쪽을 고칠 때 다른 쪽이 남습니다.

### 6-6. 버전과 도구 체인

- `package.json`은 `1.0.0`, 매니페스트는 `2.11.0`입니다. 릴리스 버전의 단일 출처가 어디인지 코드에서 읽히지 않습니다.
- `version-deploy.cjs`는 인자로 받은 브라우저의 매니페스트만 올립니다. 크롬만 릴리스하면 두 매니페스트 버전이 갈리고, 다음 파이어폭스 릴리스에서 그 사실을 알아차릴 지점이 없습니다.
- `version-deploy.cjs`가 `shared/logger.js`와 `content-scripts/content-common.js`를 정규식으로 직접 수정하고 되돌리지 않습니다. 릴리스 후 워킹 트리에 소스 변경이 남습니다.
- 린터와 포매터가 없습니다. `content.js`에 `let range = document.createRange()`처럼 `const`여도 되는 곳, 파일별로 다른 들여쓰기와 따옴표가 남아 있는 이유입니다.

---

## 7) 권장 순서

비용 대비 효과 순입니다. 1~4는 각각 하루 안쪽이고 회귀 위험이 낮으면서 한 부류의 실수를 영구히 막습니다.

1. **로케일 불변식 테스트** — 5-2. 지금 있는 결함 세 개가 바로 드러나고, 이후 모든 기능에 자동 적용됩니다. `data-i18n` 접미사 네 종류와 동적 키 허용 목록을 빠뜨리면 안 됩니다.
2. **`deploy.cjs` 경고 분기를 실패로** — 5-1. 매니페스트와 디렉터리까지 세 곳입니다. 목록에 없는 루트 파일을 거부하는 반대 방향 검사는 쓸 수 없으니, 자산 목록을 참조 관계에서 도출하는 쪽은 별도 과제로 잡습니다.
3. **페이지 키 판정 통일** — 3-1. 네 곳을 `constants/`의 함수 하나로.
4. **`groupId`에 랜덤 접미사** — 3-4. 한 줄, 마이그레이션 없음.
5. **매니페스트 합성** — 4-1. `AGENTS.md`의 경고 한 문단이 필요 없어집니다.
6. **`sendToBackground` 일원화 + 가드 테스트** — 3-2. 테스트는 rejection으로 모킹해야 합니다.
7. **import 경로를 배경으로 + tombstone 규칙** — 3-3. 가장 까다롭습니다. 경로만 옮기면 동기화가 삭제를 되돌리고, tombstone을 보존하기만 하면 백업 복원이 깨집니다. 구현 전에 제품 결정이 하나 필요합니다.
8. **`controls.js`의 순수 로직을 코어 파일로** — 6-1. `showSelectionControls`의 `cloneNode` 복원을 팩토리로 바꾸는 것이 가장 값이 큽니다.
9. **테마 토큰 공용 CSS** — 4-2. 먼저 `pages-list`의 다섯 값이 의도인지 판단합니다.

3, 5, 6, 7을 마치면 `clean-code-review.md`가 2026-02에 P0로 올린 세 항목 중 중복과 스토리지 키 하드코딩이 닫힙니다. god 파일 항목은 8번이 그 시작입니다.
