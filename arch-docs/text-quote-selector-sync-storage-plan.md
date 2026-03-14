# TextQuoteSelector 스타일 복원 + sync/local 저장 포맷 개편안

작성일: 2026-03-15  
대상 파일: `content-scripts/content.js`, `content-scripts/content-core.js`, `background/message-router.js`, `background/sync-service.js`, `shared/import-export-schema.js`, `tests/*`

## 문서 목적

동적 콘텐츠에서 하이라이트 복원 성공률을 높이기 위해 TextQuoteSelector 스타일의 문맥 기반 앵커를 도입하되, 현재 `storage.sync`의 강한 용량 제약을 넘지 않도록 저장 포맷을 재구성하는 구체적인 설계와 수정 계획을 정리한다.

현재 구현은 하이라이트 그룹마다 `spans[].text`와 `spans[].position`에 크게 의존해 복원한다. 이 방식은 정적 문서에서는 잘 동작하지만, DOM 구조가 바뀌거나 비동기 렌더링으로 텍스트 노드가 재구성되는 페이지에서는 복원 실패 가능성이 높다. 반면 단순히 `exact/prefix/suffix`를 추가로 더 저장하면 `storage.sync`의 항목당 8KB 제한과 총 예산 90KB 제한에 빠르게 닿을 수 있다.  
따라서 본 설계의 핵심은 다음 두 가지다.

1. **복원 앵커는 강화한다.** (`text` + `quote context` + `text position`)
2. **sync payload는 오히려 더 가볍게 만든다.** (legacy span 상세는 local 우선)

---

## 1) 현재 제약 요약

### sync 저장소 제약
`background/sync-service.js` 기준:

- 항목당 제한: `8192 bytes`
- 하이라이트 총 예산: `90000 bytes`
- tombstone 보존 기간: `30일`

즉 페이지 하나의 sync payload가 너무 커지면 아예 sync가 skip 되고, 전체 예산을 넘기면 오래된 페이지부터 eviction 된다.

### 현재 하이라이트 저장 포맷의 특징
현재 highlight group은 사실상 아래 구조를 따른다.

```json
{
  "groupId": "g1",
  "color": "#ffeb3b",
  "text": "brown fox jumps",
  "updatedAt": 1710000000000,
  "spans": [
    {
      "spanId": "g1_0",
      "text": "brown fox jumps",
      "position": 1240
    }
  ]
}
```

문제는 다음과 같다.

1. `group.text`와 `spans[].text` 사이에 문자열 중복이 생긴다.
2. 멀티노드 하이라이트일수록 `spans[]`가 길어져 sync payload가 커진다.
3. 복원은 DOM 구조와 span 순차 매칭에 크게 의존해 동적 페이지에 약하다.

---

## 2) 목표

### 기능 목표
- DOM 재구성 이후에도 하이라이트 복원 성공률을 높인다.
- SPA, 댓글 영역, 늦게 렌더링되는 본문 같은 동적 콘텐츠에 대해 지연 재시도 기반 복원을 지원한다.
- 기존 저장 데이터와의 호환성을 유지한다.

### 저장소 목표
- `storage.sync`에는 **복원 가능한 최소 앵커 정보만** 저장한다.
- `storage.local`에는 **기존 span 상세와 렌더링 보조 정보**를 유지한다.
- 기존 대비 sync payload 순증을 작게 만들거나, 가능하면 페이지별 평균 크기를 줄인다.

---

## 3) 제안하는 저장 전략 요약

핵심 아이디어는 다음과 같다.

### local 저장소
빠른 동일 기기 복원과 기존 렌더링 로직 호환을 위해 기존 상세 구조를 유지한다.

- `groupId`
- `color`
- `text`
- `updatedAt`
- `spans[]` (`spanId`, `text`, `position`)
- 새 selector 정보 (`quote`, `textPosition`) 추가 가능

### sync 저장소
다른 기기 복원과 동적 콘텐츠 대응에 필요한 최소 앵커만 저장한다.

- `groupId`
- `color`
- `text` (`exact` 재사용)
- `updatedAt`
- `quote.prefix`
- `quote.suffix`
- `textPosition.start`, `textPosition.end`

즉 sync는 **앵커 저장소**, local은 **렌더링 캐시**로 역할을 나눈다.

---

## 4) 저장 포맷 제안

## 4.1 Local highlight group 포맷 (상세형)

```json
{
  "groupId": "g1",
  "color": "#ffeb3b",
  "text": "brown fox jumps",
  "updatedAt": 1710000000000,
  "spans": [
    {
      "spanId": "g1_0",
      "text": "brown fox jumps",
      "position": 1240
    }
  ],
  "selectors": {
    "quote": {
      "prefix": "The quick ",
      "suffix": " over the lazy dog"
    },
    "textPosition": {
      "start": 10524,
      "end": 10540
    }
  }
}
```

### 포인트
- `group.text`를 `exact`로 재사용한다. 별도 `exact` 필드는 두지 않는다.
- 기존 `spans[]`는 유지해 같은 기기 내 빠른 재복원과 레거시 fallback에 사용한다.
- selector 필드는 선택적으로 존재하도록 설계해 구데이터와 호환한다.

---

## 4.2 Sync highlight group 포맷 (경량형)

```json
{
  "groupId": "g1",
  "color": "#ffeb3b",
  "text": "brown fox jumps",
  "updatedAt": 1710000000000,
  "selectors": {
    "quote": {
      "prefix": "The quick ",
      "suffix": " over the lazy dog"
    },
    "textPosition": {
      "start": 10524,
      "end": 10540
    }
  }
}
```

### 포인트
- `spans[]`를 sync에서 제거한다.
- 문자열 증가분은 사실상 `prefix + suffix`뿐이고, `start/end` 숫자 2개는 비용이 작다.
- 결과적으로 복원력은 올라가지만 sync payload 폭증은 피할 수 있다.

---

## 4.3 페이지 단위 sync payload 예시

```json
{
  "url": "https://example.com/article",
  "title": "Example Article",
  "lastUpdated": "2026-03-15T00:00:00.000Z",
  "highlights": [
    {
      "groupId": "g1",
      "color": "#ffeb3b",
      "text": "brown fox jumps",
      "updatedAt": 1710000000000,
      "selectors": {
        "quote": {
          "prefix": "The quick ",
          "suffix": " over the lazy dog"
        },
        "textPosition": {
          "start": 10524,
          "end": 10540
        }
      }
    }
  ],
  "deletedGroupIds": {
    "g0": 1709999999000
  }
}
```

기존 payload와 비교했을 때 `highlights` 내부에서 가장 비싼 `spans[]` 배열이 사라진다. 따라서 대부분의 경우 `prefix/suffix`가 추가되더라도 총량은 유지되거나 오히려 줄어들 가능성이 있다.

---

## 5) selector 생성 규칙

## 5.1 Quote selector
하이라이트 저장 시 문서의 정규화된 전체 텍스트 모델에서 아래 값을 추출한다.

- `exact` = `group.text` 재사용
- `prefix` = 선택 직전 문맥
- `suffix` = 선택 직후 문맥

### 권장 길이
- 기본: 각 24자
- 선택 텍스트가 매우 짧고 흔한 경우: 각 32~48자
- 긴 선택일 경우: 각 16~24자

초기 구현에서는 단순하게 `24자 고정`으로 시작해도 충분하다.

## 5.2 Text position selector
정규화된 문서 텍스트 기준으로:

- `start`
- `end`

오프셋을 저장한다.

이 값은 텍스트가 문서 앞쪽에서 크게 삽입/삭제되면 밀릴 수 있으므로, **단독 기준**이 아니라 quote 후보 tie-break 및 근접 탐색 보정에 사용한다.

---

## 6) 복원 알고리즘 설계

복원 우선순위는 아래와 같다.

1. `selectors.quote` 기반 복원
2. `selectors.textPosition` 보정 복원
3. local `spans[]` 기반 레거시 복원
4. 실패 시 MutationObserver 기반 지연 재시도

## 6.1 Quote 기반 복원
1. 문서에서 정규화된 전체 텍스트 모델 생성
2. `group.text`와 일치하는 모든 후보 위치 검색
3. 각 후보에 대해 `prefix`, `suffix` 일치 점수 계산
4. 최고 점수 후보를 선택
5. 해당 텍스트 오프셋을 DOM Range로 역변환
6. Range를 기준으로 하이라이트 적용

## 6.2 Position 기반 보정
quote 후보가 여러 개이거나 점수 차가 작으면:

- `textPosition.start/end` 근처를 우선 후보로 보정
- 필요하면 `saved top position` 대신 text offset 기반 근접 탐색 사용

## 6.3 Legacy fallback
quote/position으로 복원하지 못했을 경우에만 기존 `highlightTextInDocument(document.body, group.spans, ...)` 로직을 fallback으로 사용한다.

## 6.4 지연 재시도
동적 페이지는 첫 로드 시 본문이 아직 없을 수 있으므로:

- 초기 1회 복원 시도
- 실패 그룹만 pending queue에 보관
- `MutationObserver`로 본문 변경 감시
- debounce 후 재시도
- 최대 10초 또는 10회 정도에서 종료

---

## 7) 텍스트 정규화 모델 설계

quote/position 복원은 저장 시와 복원 시가 **같은 텍스트 모델**을 사용해야 한다.

### 제외 대상
- `SCRIPT`
- `STYLE`
- `NOSCRIPT`
- `TEXTAREA`
- `INPUT`
- `display:none` 영역
- 현재 하이라이트 wrapper 내부의 구조적 노이즈

### 정규화 규칙
- 연속 공백은 하나의 공백으로 축약
- 줄바꿈/탭은 공백으로 취급
- 노드별 raw offset ↔ normalized offset 매핑 유지

### 필요한 구조

```js
{
  text: 'The quick brown fox jumps over the lazy dog',
  segments: [
    {
      node: Text,
      normalizedStart: 0,
      normalizedEnd: 10,
      normalizedToRaw: [0,1,2,3,4,5,6,7,8,9]
    }
  ]
}
```

이 모델이 있어야 quote 매칭 결과를 DOM Range로 되돌릴 수 있다.

---

## 8) 단계별 수정 계획

## 8.1 Phase 1 — 저장 포맷 분리 및 selector 도입

목표: 기능 리스크를 낮추면서 저장 포맷 기반을 먼저 깐다.

### 변경 사항
1. `content-scripts/content-core.js`
   - `buildNormalizedTextModel(root)` 추가
   - `rangeToTextPosition(model, range)` 추가
   - `buildQuoteSelector(model, range)` 추가
2. `content-scripts/content.js`
   - 하이라이트 생성 시 `selectors.quote`, `selectors.textPosition` 생성
   - local 저장 group에 selector 포함
3. `background/message-router.js`
   - `saveHighlights` 경로는 local 구조 유지
4. `background/sync-service.js`
   - sync 저장 직전 highlight를 경량 포맷으로 serialize
   - `spans[]`는 sync payload에서 제거
5. `shared/import-export-schema.js`
   - selector 필드를 선택적으로 허용하도록 normalize 확장

### 산출물
- local 상세 포맷 + sync 경량 포맷 공존
- 기존 데이터와 하위 호환 유지

---

## 8.2 Phase 2 — 복원 우선순위 교체

목표: 기존 레거시 복원 앞에 quote 기반 복원을 넣는다.

### 변경 사항
1. `content-scripts/content-core.js`
   - `resolveQuoteSelector(model, selector, text)` 추가
   - `normalizedOffsetsToRange(model, start, end)` 추가
2. `content-scripts/content.js`
   - `tryRestoreHighlightGroup(group, model)` 추가
   - `applyHighlights()`가 각 group에 대해 quote → position → legacy 순으로 시도하도록 변경
   - `applyHighlightFromRange(range, color, groupId)` helper 추가

### 산출물
- DOM 재구성 후에도 텍스트 문맥 기반 복원 가능
- local 구데이터는 여전히 legacy 경로로 복원 가능

---

## 8.3 Phase 3 — 동적 콘텐츠 재시도 및 관찰 가능성 개선

목표: 비동기 렌더링 페이지의 체감 복원률을 높인다.

### 변경 사항
1. `content-scripts/content.js`
   - pending restore queue 추가
   - `MutationObserver` 기반 재시도 추가
2. 선택 사항
   - 복원 실패/대기 상태를 popup/pages-list에서 노출
   - quote 후보 ambiguity가 큰 경우 실패 처리

### 산출물
- 늦게 렌더링되는 댓글/본문에서 재시도 복원 지원
- 잘못된 위치 오복원보다 보수적 실패를 선택 가능

---

## 9) 파일별 구체 수정 포인트

## `content-scripts/content-core.js`
추가 함수 후보:

- `buildNormalizedTextModel(root)`
- `rangeToTextPosition(model, range)`
- `normalizedOffsetToDomPoint(model, offset)`
- `normalizedOffsetsToRange(model, start, end)`
- `buildQuoteSelector(model, range, options)`
- `resolveQuoteSelector(model, quoteSelector, exactText, hints)`

역할: 텍스트 앵커 생성/해석의 순수 함수 집합

## `content-scripts/content.js`
변경 포인트:

- `highlightSelectedText()` 내부에서 selector 생성
- `buildHighlightGroup()` 결과에 `selectors` 병합
- `applyHighlights()`가 `tryRestoreHighlightGroup()`을 사용하도록 변경
- 기존 `highlightTextInDocument()`는 fallback 용도로 유지
- MutationObserver 기반 retry 오케스트레이션 추가

## `background/sync-service.js`
변경 포인트:

- sync 저장용 serializer 추가
  - 예: `toSyncHighlightGroup(group)`
- sync merge 시 group 구조가 `spans[]` 없이도 동작하도록 `mergeHighlights()`는 group 단위 공통 필드만 사용
- 로그에 sync payload 크기 변화를 남겨 회귀 감시 가능하게 개선

## `shared/import-export-schema.js`
변경 포인트:

- `selectors.quote.prefix/suffix` 허용
- `selectors.textPosition.start/end` 허용
- 기존 payload는 그대로 valid 하도록 optional 처리

## 테스트
추가/수정 대상:

- `tests/import-export-schema.test.js`
- `tests/sync-service.test.js`
- `tests/message-router.test.js`
- 신규: quote selector normalize/restore 유닛 테스트
- 가능하면 e2e 1개: 비동기 렌더링 후 재시도 복원

---

## 10) 마이그레이션 전략

강제 일괄 마이그레이션 대신 **lazy migration**을 권장한다.

### 원칙
- 기존 데이터는 그대로 읽힌다.
- 새로 생성되는 highlight부터 selector 필드를 포함한다.
- 기존 highlight는 수정/재저장 시 selector가 채워진다.

### 이유
- 대규모 일괄 변환은 로컬/원격 저장소 모두 부담이 크다.
- sync payload 재계산 중 quota 위험이 있다.
- 점진적 전환이면 사용자 데이터 손상 위험이 낮다.

---

## 11) 용량 영향 분석

### 추가되는 것
- `selectors.quote.prefix`
- `selectors.quote.suffix`
- `selectors.textPosition.start/end`

### 제거되는 것(sync 기준)
- `spans[]`
  - 각 span의 `text`
  - 각 span의 `position`
  - 각 span의 `spanId`

### 결론
sync payload에서 가장 비싼 항목은 숫자가 아니라 문자열이며, 특히 멀티노드 하이라이트의 `spans[].text` 중복이 크다. 따라서 sync에서 `spans[]`를 제거하면:

- 짧은 하이라이트: 기존 대비 소폭 증가 또는 비슷함
- 긴 멀티노드 하이라이트: 기존 대비 감소 가능성이 높음

즉 TextQuoteSelector 스타일 앵커 도입이 곧바로 sync 용량 폭증으로 이어지지는 않는다. 오히려 **저장 계층 분리**를 하면 복원력 개선과 용량 관리 두 마리 토끼를 같이 잡을 수 있다.

---

## 12) 권장 구현 순서

1. sync/local 포맷 분리
2. selector 생성 저장
3. quote 기반 복원 추가
4. legacy fallback 유지
5. MutationObserver 재시도 추가
6. 필요 시 UI 상태 노출

이 순서가 가장 안전하다. 먼저 저장 구조를 안정화한 뒤 복원 경로를 교체해야, 문제 발생 시 원인 분리가 쉽다.

---

## 결론

동적 콘텐츠 복원 문제는 단순히 “이 요소가 동적인가”를 판별하는 것보다, **DOM보다 텍스트 문맥을 더 신뢰하는 복원 전략**으로 가는 편이 훨씬 효과적이다. 다만 현재 `storage.sync` 제약을 고려하면 selector를 무조건 덧붙이는 방식은 위험하다.

따라서 본 문서는 아래 방향을 최종안으로 제안한다.

- local 저장소: 기존 상세 구조 + selector 추가
- sync 저장소: `text + quote context + textPosition`만 저장하는 경량 포맷
- 복원 순서: quote → position 보정 → legacy spans → 지연 재시도
- 전환 방식: lazy migration

이 방식이면 기존 기능을 크게 깨지 않으면서도, 동적 페이지에서의 하이라이트 복원률을 현실적으로 끌어올릴 수 있다.
