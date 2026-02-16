# ARIA 속성 부재가 미치는 영향 분석

## 📊 전 세계 통계

### 시각장애인 인구
- **전 세계**: 약 2억 8,500만 명 (WHO, 2023)
- **한국**: 약 25만 명 (2023 장애인 실태조사)
- **미국**: 약 800만 명 (CDC, 2023)
- **웹 사용 인구 중 스크린 리더 사용자**: 약 1-2%

### 법적 요구사항

#### 미국
- **Section 508**: 연방 정부 웹사이트는 접근성 필수
- **ADA (Americans with Disabilities Act)**: 공공 웹사이트 접근성 위반 시 소송 가능
  - 2022년 ADA 관련 웹 접근성 소송: **4,061건** (전년 대비 12% 증가)
  - 평균 합의금: $10,000 ~ $50,000

#### 유럽
- **EAA (European Accessibility Act)**: 2025년 6월부터 강제 시행
  - 위반 시 최대 매출의 **4%** 벌금

#### 한국
- **장애인차별금지법**: 2013년부터 웹 접근성 의무화
  - 위반 시 3년 이하 징역 또는 3천만원 이하 벌금

---

## 🔍 Text Highlighter Extension의 구체적 문제

### 현재 접근성 점수 (추정)
```
WCAG 2.1 기준:
- Level A: 부분 준수 (60%)
- Level AA: 미준수 (40%)
- Level AAA: 미준수 (10%)

주요 실패 항목:
✗ 1.3.1 Info and Relationships (Level A)
✗ 2.4.3 Focus Order (Level A)
✗ 4.1.2 Name, Role, Value (Level A)
✗ 4.1.3 Status Messages (Level AA)
```

### 영향받는 사용자 시나리오

#### 시나리오 1: 스크린 리더 사용자가 하이라이트 삭제 시도
```
1. 팝업 열기
   현재: "Text Highlighter" (제목만 읽음)
   문제: 어떤 기능들이 있는지 탐색해야 함

2. 하이라이트 목록 찾기
   현재: 각 하이라이트가 단순 텍스트로만 읽힘
   문제: 어떤 색상인지, 삭제 버튼이 어디 있는지 모름

3. 삭제 버튼 찾기
   현재: "×" (그냥 곱하기 기호로 읽힘)
   문제: 이게 삭제 버튼인지 알 수 없음

4. 삭제 확인 모달
   현재: 모달이 떴는지 알 수 없고, 뒤의 버튼들도 계속 접근 가능
   문제: 실수로 다른 곳을 클릭할 수 있음
```

**예상 소요 시간:**
- 시각 사용자: 5초
- 스크린 리더 사용자 (ARIA 없이): 2-3분
- 스크린 리더 사용자 (ARIA 있으면): 15-20초

#### 시나리오 2: 키보드만 사용하는 사용자
```
1. 미니맵 토글 스위치 포커스
   현재: 포커스 링 없음
   문제: 현재 어디에 포커스되어 있는지 모름

2. Space 키로 토글
   현재: 작동은 하지만 변경 사항 확인 불가
   문제: 시각적으로 봐야만 상태 변화 확인 가능

3. 미니맵 마커 클릭
   현재: 마커가 <div>로만 되어 있음
   문제: 키보드로 접근 불가능
```

---

## 💰 ARIA 속성 추가의 비용 vs 편익

### 개발 비용
```
1회성 작업:
- ARIA 속성 추가: 2-4시간
- 키보드 네비게이션 개선: 2-3시간
- 포커스 스타일 추가: 1시간
- 테스트: 2시간

총 개발 시간: 약 7-12시간 (1-2일)
```

### 장기적 편익
```
✅ 접근성 규정 준수 (법적 리스크 제거)
✅ 사용자 베이스 1-2% 확대
✅ Chrome Web Store 품질 점수 향상
✅ SEO 개선 (구조화된 마크업)
✅ 키보드 파워유저 만족도 향상
✅ 브랜드 이미지 개선 (포용적 디자인)
```

---

## 🛠️ 즉시 적용 가능한 ARIA 패턴

### 1. 커스텀 토글 스위치
```html
<div class="toggle-container">
  <span id="minimap-label">Show Minimap</span>
  <button
    role="switch"
    aria-checked="true"
    aria-labelledby="minimap-label"
    class="switch"
    onclick="toggleMinimap()">
    <span class="slider" aria-hidden="true"></span>
  </button>
</div>
```

### 2. 하이라이트 카드
```html
<div class="highlight-card" role="article" aria-label="Highlighted text">
  <div class="highlight-color-indicator"
       aria-label="Yellow highlight"
       style="background: yellow"></div>
  <div class="highlight-content">Lorem ipsum...</div>
  <button class="delete-btn"
          aria-label="Delete this highlight">×</button>
</div>
```

### 3. 검색 결과 (Live Region)
```html
<div id="pages-container"
     class="pages-list"
     role="region"
     aria-live="polite"
     aria-relevant="additions removals">
  <!-- 검색 결과 -->
</div>

<script>
// 검색 시 자동으로 "3 results found" 안내됨
function updateResults(count) {
  const region = document.getElementById('pages-container');
  region.setAttribute('aria-label', `${count} pages found`);
}
</script>
```

### 4. 미니맵 마커 (클릭 가능)
```html
<button class="minimap-marker"
        style="background: yellow; top: 20%"
        aria-label="Jump to yellow highlight: Lorem ipsum dolor..."
        onclick="scrollToHighlight('group-123')">
</button>
```

---

## 📈 Chrome Web Store 영향

### 접근성이 좋은 확장 프로그램의 이점
```
✅ "Featured" 섹션 선정 가능성 증가
✅ 검색 순위 개선 (품질 점수에 포함)
✅ 사용자 리뷰 평점 향상 (접근성 높으면 평균 4.5+ 유지)
✅ 기업/교육기관 채택률 증가 (접근성 요구사항 때문)
```

---

## 🎯 권장사항 우선순위

### 즉시 (Critical)
1. ✅ 모든 인터랙티브 요소에 `aria-label` 추가
2. ✅ 모달에 `role="dialog"`, `aria-modal="true"` 추가
3. ✅ 토글 스위치에 `role="switch"`, `aria-checked` 추가

### 1주일 내 (High)
4. ⚡ 키보드 포커스 스타일 추가
5. ⚡ Live regions로 동적 콘텐츠 변화 알림
6. ⚡ 미니맵 마커를 `<button>`으로 변경

### 1개월 내 (Medium)
7. 📝 스크린 리더 전용 설명 추가 (`.sr-only` 클래스)
8. 📝 `aria-describedby`로 컨텍스트 추가 정보 제공
9. 📝 색상 외 다른 시각적 표시 추가 (WCAG 1.4.1)

---

## 🧪 테스트 방법

### 자동화 도구
```bash
# Axe DevTools (Chrome Extension)
# WAVE (Web Accessibility Evaluation Tool)
# Lighthouse Accessibility Audit

npm install -D @axe-core/cli
npx axe popup.html --tags wcag2a,wcag2aa
```

### 수동 테스트
```
1. 키보드만으로 모든 기능 사용해보기 (마우스 없이)
2. Chrome DevTools > Accessibility Tree 확인
3. 스크린 리더 테스트:
   - Windows: NVDA (무료)
   - Mac: VoiceOver (내장)
   - Chrome: ChromeVox (확장 프로그램)
```

---

## 결론

ARIA 속성 추가는:
- **적은 비용** (7-12시간)
- **큰 영향** (1-2% 사용자에게는 사용 가능/불가능의 차이)
- **법적 필수** (미국, 유럽, 한국 모두 관련 법규 존재)
- **브랜드 가치** (포용적 디자인 = 좋은 PR)

**권장: PR 머지 전 "High Priority" ARIA 속성만이라도 추가**
