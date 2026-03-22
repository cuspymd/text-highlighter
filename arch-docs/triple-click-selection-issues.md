# Triple-Click Selection 이슈 정리

작성일: 2026-03-22  
대상 저장소: `text-highlighter`

---

## 1) 배경

이 확장은 사용자가 선택한 DOM `Range`를 기준으로 하이라이트를 생성한다.  
일반적인 드래그 선택은 시작/끝이 텍스트 노드 기준으로 잡히는 경우가 많아 처리하기 비교적 단순하다.

하지만 **triple-click(문단/블록 전체 선택)** 은 브라우저별 selection 모델이 다르고, 특히 pretty-printed HTML이나 단독 강조 텍스트(`<b>`, `<strong>`) 주변에서 **선택 문자열은 정상인데 `Range` 경계가 다른 블록까지 걸치는 형태**로 들어올 수 있다.

이 문서는 triple-click 관련 이슈와 대응 내역을 정리한 참고 문서다.

---

## 2) 실제 문제 현상

### 대표 재현 사이트

- `https://www.charlespetzold.com/blog/2026/02/The-Appalling-Stupidity-of-Spotifys-AI-DJ.html`

### 관찰된 증상

1. 일반 문단을 triple-click 후 하이라이트하면 다음 문단 첫부분 일부가 같이 하이라이트됨
2. 단독 강조 텍스트(예: `Play Beethoven’s 7th Symphony`)를 triple-click 후 하이라이트하면 다음 문단 첫부분 일부가 같이 하이라이트됨
3. 브라우저마다 같은 텍스트를 선택해도 `Selection`/`Range` 형태가 다름

---

## 3) 왜 이 사이트에서 잘 드러났는가

이 페이지는 다음 특징을 동시에 갖고 있었다.

1. HTML이 pretty-printed 되어 있어 `<p>` 텍스트 앞뒤에 개행/들여쓰기 텍스트 노드가 많음
2. 본문 중간에 `<p>` 사이에 단독 `<b>` 요소가 삽입되어 있음
3. 브라우저의 triple-click selection이 “텍스트 노드 내부”가 아니라 “상위 요소 child boundary” 기준으로 잡히는 경우가 있음

즉 사용자가 보는 선택 문자열은 정확해도, 내부 `Range`는 현재 블록의 마지막 텍스트가 아니라 **다음 형제 블록의 시작점**까지 포함된 상태로 들어올 수 있다.

---

## 4) 브라우저별로 확인된 selection shape

## Chrome 계열에서 확인된 형태

### 4-1. 일반 문단 triple-click

예시:

- `startContainer = #text<P>`
- `startOffset = 13`
- `endContainer = 다음 P 요소`
- `endOffset = 0`
- `commonAncestor = ARTICLE`

의미:

- 현재 문단 텍스트 시작은 텍스트 노드 안쪽
- 끝은 다음 문단의 “시작 경계”
- 문자열은 현재 문단만 선택된 것처럼 보이지만, DOM 경계상 다음 블록과 맞닿아 있음

### 4-2. 단독 강조 텍스트 triple-click

예시:

- `startContainer = #text<B>`
- `startOffset = 0`
- `endContainer = 다음 P 요소`
- `endOffset = 0`
- `commonAncestor = ARTICLE`

의미:

- `<b>` 자체는 정상 선택됐지만, 끝 경계가 다음 문단 시작에 걸쳐 있음

## Firefox에서 확인된 형태

### 4-3. 일반 문단 triple-click

Firefox에서는 문단 케이스가 element boundary 쪽으로 더 쉽게 잡힐 수 있었다.

예시:

- `startContainer = P 요소`
- `startOffset = 0`
- `endContainer = 다음 P 요소`
- `endOffset = 0`

### 4-4. 강조 텍스트 triple-click

실제 디버그 로그에서 확인된 케이스:

- `selectedText = "Play Beethoven’s 7th Symphony in its entirety"`
- `startContainer = ARTICLE`
- `startOffset = 34`
- `endContainer = ARTICLE`
- `endOffset = 37`
- `commonAncestor = ARTICLE`

의미:

- Firefox는 선택 문자열이 `<b>` 하나와 정확히 일치해도
- 실제 `Range`는 `ARTICLE`의 child boundary 구간으로 잡고 있었음
- 즉 `<b>` 텍스트 노드가 아니라, 상위 `ARTICLE`의 child index 범위로 selection을 표현함

이 케이스 때문에 단순히 “startContainer 부모를 따라 올라가며 text match 찾기”만으로는 부족했다.

---

## 5) 기존 코드에서 왜 문제가 생겼는가

핵심 경로:

- [content.js](/home/cuspymd/work/text-highlighter/content-scripts/content.js)
- [content-core.js](/home/cuspymd/work/text-highlighter/content-scripts/content-core.js)

### 기존 처리 방식

1. `highlightSelectedText()`가 `window.getSelection().getRangeAt(0)`을 그대로 가져옴
2. `convertSelectionRange()`에서 일부 특수 케이스만 보정
3. `processSelectionRange()`가 트리 순회 중 DOM을 직접 변경하며 span 삽입

### 문제 포인트

1. triple-click range가 다음 블록 시작점까지 걸쳐 있으면, 순회 기준이 현재 블록 내부에 고정되지 않음
2. 시작/끝 경계가 element boundary인 경우 기존 보정 로직이 충분히 대응하지 못함
3. 특히 Firefox의 `ARTICLE child boundary range`는 기존 분기와 충돌해, 앞쪽 공백 텍스트 노드를 시작점으로 잘못 변환할 수 있었음

---

## 6) 적용한 보정 전략

### 핵심 원칙

**선택 문자열과 정확히 일치하는 “선택 루트 요소”를 먼저 찾고, 그 요소의 첫 번째 실제 텍스트 노드부터 마지막 실제 텍스트 노드까지로 `Range`를 재구성한다.**

### 선택 루트 탐색 전략

`convertSelectionRange()`에서 아래 순서로 selection root를 찾도록 확장했다.

1. `startContainer`에서 부모 방향으로 올라가며 `textContent`가 `selectedText`와 정확히 일치하는 요소 찾기
2. `startContainer`가 element일 때 `startOffset`가 가리키는 child에서 시작해 동일 조건 요소 찾기
3. `startContainer === endContainer === ARTICLE` 같은 boundary range인 경우  
   `startOffset..endOffset` 사이 child subtree를 스캔해서 동일 조건 요소 찾기

### 최종 변환 방식

selection root를 찾으면:

1. `findFirstSelectableTextNode(root)`
2. `findLastSelectableTextNode(root)`
3. 위 두 노드로 새 `Range` 생성

즉 변환 결과는 항상 다음처럼 된다.

- 시작: 선택 루트 내부 첫 실제 텍스트 노드, offset `0`
- 끝: 선택 루트 내부 마지막 실제 텍스트 노드, offset `text.length`

이 방식은 문단과 standalone `<b>` 둘 다에 동일하게 적용된다.

---

## 7) 테스트로 고정한 케이스

## E2E fixture

- [test-page5.html](/home/cuspymd/work/text-highlighter/e2e-tests/test-page5.html)

포함된 구조:

1. pretty-printed `<p> -> <p>`
2. pretty-printed `<p> -> <b>`
3. standalone `<b> -> <p>`

## E2E 테스트

- [highlight.spec.js](/home/cuspymd/work/text-highlighter/e2e-tests/highlight.spec.js)

추가/강화된 케이스:

1. `Triple-click pretty-printed paragraph should not highlight the next paragraph prefix`
2. `Triple-click pretty-printed paragraph should not highlight the next standalone bold block`
3. `Triple-click standalone bold text should not highlight the next paragraph prefix`

## Unit 테스트

- [content-core.test.js](/home/cuspymd/work/text-highlighter/tests/content-core.test.js)

고정한 shape:

1. 문단 선택: `start = <p>, end = next <p>`
2. 강조 텍스트 선택: `start = <b>, end = next <p>`
3. Firefox형 강조 텍스트 선택: `start = article boundary`, `end = article boundary`

특히 마지막 케이스는 실제 Firefox 디버그 로그 shape를 바탕으로 추가했다.

---

## 8) 디버깅할 때 확인해야 할 로그 포인트

임시로 debug를 켜고 재현할 때는 다음 로그가 중요하다.

### `Highlight Selection Debug`

확인 포인트:

1. `selectedText`
2. `range.startContainer / startOffset`
3. `range.endContainer / endOffset`
4. `commonAncestorContainer`
5. `anchorNode / focusNode`

### `Converted Highlight Range Debug`

확인 포인트:

1. 변환 후 `startContainer`가 실제 텍스트 노드인지
2. 변환 후 `endContainer`가 선택 루트 내부 마지막 텍스트 노드인지
3. `text`가 기대 선택 문자열과 정확히 일치하는지

### 문제를 빠르게 판별하는 규칙

1. `selectedText`는 맞는데 `startContainer/endContainer`가 상위 `ARTICLE` 같은 요소면 브라우저 boundary range 케이스 가능성이 큼
2. `Converted Highlight Range Debug`에서 여전히 상위 요소 경계가 남아 있으면 변환 로직이 selection root를 제대로 못 찾은 것
3. 변환 후 `text`가 정확하면 이후 문제는 대개 `processSelectionRange()`가 아니라 복원/저장 경로를 의심해야 함

---

## 9) 앞으로 triple-click 관련 수정 시 주의사항

1. **드래그 선택과 triple-click 선택은 동일한 문제로 취급하면 안 된다**
2. **선택 문자열(`selection.toString()`)이 정상이라고 해서 DOM `Range`도 정상이라는 뜻은 아니다**
3. **브라우저별로 start/end가 텍스트 노드가 아닐 수 있다**
4. **pretty-printed HTML의 공백 텍스트 노드가 변환 로직을 흔들 수 있다**
5. **standalone `<b>`/`<strong>` 같은 inline 요소도 사실상 “문단처럼” 전체 선택될 수 있다**
6. triple-click 관련 수정은 반드시
   - unit test
   - pretty-printed fixture E2E
   - paragraph 케이스
   - emphasized text 케이스
   를 같이 확인해야 한다

---

## 10) 관련 파일

- [content-core.js](/home/cuspymd/work/text-highlighter/content-scripts/content-core.js)
- [content.js](/home/cuspymd/work/text-highlighter/content-scripts/content.js)
- [content-core.test.js](/home/cuspymd/work/text-highlighter/tests/content-core.test.js)
- [highlight.spec.js](/home/cuspymd/work/text-highlighter/e2e-tests/highlight.spec.js)
- [test-page5.html](/home/cuspymd/work/text-highlighter/e2e-tests/test-page5.html)

---

## 결론

triple-click 이슈의 본질은 “선택 텍스트” 문제가 아니라 **브라우저별 selection `Range` 표현 차이**다.

특히 다음 두 케이스를 기억해야 한다.

1. Chrome 계열: 현재 블록 텍스트 노드에서 시작하고 다음 블록 시작점에서 끝나는 range
2. Firefox: 상위 `ARTICLE` 등의 child boundary range로 선택 전체를 표현하는 range

따라서 triple-click 처리의 핵심은 raw `Range`를 바로 소비하는 것이 아니라,  
**선택 문자열과 일치하는 실제 선택 루트를 찾아 텍스트 노드 기준 `Range`로 재정규화한 뒤 처리하는 것**이다.
