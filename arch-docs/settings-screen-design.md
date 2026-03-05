# 설정 화면 디자인 설계

## 1. 개요

현재 팝업에 혼재된 설정 항목들을 별도 설정 화면으로 분리한다. 팝업은 핵심 기능(현재 페이지 하이라이트 목록, 페이지 이동)에 집중하고, 설정 아이콘(⚙️)을 통해 설정 화면으로 진입할 수 있도록 한다.

### 변경 범위

- 팝업 헤더에 설정 아이콘 버튼 추가
- 팝업에서 설정 관련 항목 제거 (사용자 정의 색상 삭제, 미니맵 토글, 컨트롤 UI 토글)
- 설정 화면 신규 구현 (`settings.html` + `settings.js`)
- 설정 화면은 세 개의 섹션으로 구성: 일반, 사용자 정의 색상, 단축키

---

## 2. 팝업 변경 (`popup.html`)

### 헤더 레이아웃 변경

```
┌─────────────────────────────────────────┐
│  [아이콘] Text Highlighter          [⚙] │
└─────────────────────────────────────────┘
```

- 헤더 우측에 설정 아이콘 버튼(⚙) 추가
- 설정 아이콘 클릭 시 `settings.html`을 새 팝업 창으로 열기
- 팝업 바디에서 아래 항목 제거:
  - "사용자 정의 색상 삭제" 버튼
  - 미니맵 표시 토글
  - 컨트롤 UI 표시 토글

### 변경 후 팝업 구조

```
┌─────────────────────────────────────────┐
│  [아이콘] Text Highlighter          [⚙] │
│  Select text on web pages...            │
├─────────────────────────────────────────┤
│  CURRENT PAGE HIGHLIGHTS                │
│  ┌───────────────────────────────────┐  │
│  │ ■ highlighted text 1          [x] │  │
│  │ ■ highlighted text 2          [x] │  │
│  │ ■ highlighted text 3          [x] │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  [      Highlighted Pages List      ]   │
│  [      Delete All Highlights       ]   │
└─────────────────────────────────────────┘
```

---

## 3. 설정 화면 (`settings.html`)

### 열기 방식

- `browserAPI.windows.create()`로 독립 팝업 창으로 열기
- 창 크기: 400×600px (팝업보다 넓고 높음)
- URL: `settings.html`

### 전체 레이아웃

```
┌─────────────────────────────────────────┐
│  ← 설정                                 │
├─────────────────────────────────────────┤
│                                         │
│  ── GENERAL ──────────────────────────  │
│  ┌──────────────────────────────────┐   │
│  │ Show Minimap               [■■] │   │
│  ├──────────────────────────────────┤   │
│  │ Show Control UI on Selection[■■] │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ── CUSTOM COLORS ─────────────────── │
│  ┌──────────────────────────────────┐   │
│  │ 🟡  Custom 1     [변경] [삭제]  │   │
│  │ 🔵  Custom 2     [변경] [삭제]  │   │
│  │  (비어있으면 "No custom colors") │   │
│  │ [+ Add Custom Color]             │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ── KEYBOARD SHORTCUTS ──────────────  │
│  ┌──────────────────────────────────┐   │
│  │ 🟡 Yellow    Ctrl+Shift+1  [변경]│   │
│  │ 🟢 Green     Ctrl+Shift+2  [변경]│   │
│  │ 🔵 Blue      Ctrl+Shift+3  [변경]│   │
│  │ 🩷 Pink      Ctrl+Shift+4  [변경]│   │
│  │ 🟠 Orange    (없음)        [변경]│   │
│  │ 🟣 Custom 1  (없음)        [변경]│   │
│  └──────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 4. 섹션별 상세 설계

### 4.1 일반 (General)

기존 팝업의 토글 항목을 이동.

| 설정 항목 | 타입 | 기본값 | 저장 키 |
|-----------|------|--------|---------|
| Show Minimap | 토글 스위치 | true | `minimapVisible` |
| Show Control UI on Selection | 토글 스위치 | true | `selectionControlsVisible` |

- 변경 즉시 저장 및 모든 탭에 브로드캐스트 (기존 동작과 동일)
- 모바일(Android)에서는 "Show Control UI" 항목 숨김 (기존 동작과 동일)

---

### 4.2 사용자 정의 색상 (Custom Colors)

#### 목록 뷰

```
┌──────────────────────────────────────────┐
│  CUSTOM COLORS                           │
│ ┌────────────────────────────────────┐   │
│ │ [●] Custom 1   #FF6B6B  [변경][✕] │   │
│ │ [●] Custom 2   #4ECDC4  [변경][✕] │   │
│ └────────────────────────────────────┘   │
│  (색상 없을 때: "No custom colors yet")   │
│                                          │
│  [+ Add Custom Color]                    │
└──────────────────────────────────────────┘
```

#### 색상 추가

- "[+ Add Custom Color]" 버튼 클릭 시 색상 피커(native `<input type="color">`) 인라인 표시
- 선택 후 "추가" 확인 → 목록에 즉시 반영
- 이미 존재하는 색상이면 "이미 추가된 색상입니다." 알림

#### 색상 변경

- "[변경]" 버튼 클릭 → 해당 행에서 색상 피커 열림
- 선택 후 즉시 해당 항목 색상 업데이트
- 해당 색상으로 적용된 기존 하이라이트는 변경 **불포함** (새 하이라이트부터 적용)
  - 이 점을 안내 문구로 표시: "기존 하이라이트에는 영향을 주지 않습니다."

#### 색상 삭제

- "[✕]" 버튼 클릭 → 확인 모달 없이 즉시 삭제 (단, 실수 방지를 위해 삭제 취소 토스트 표시 가능하면 옵션)
- 삭제 후 해당 색상으로 표시된 기존 하이라이트는 컬러 그대로 유지 (색상 정보는 하이라이트에 직접 저장됨)

#### 데이터 구조

기존 `customColors` 스토리지 구조를 그대로 사용:

```js
{
  id: 'custom_1234567890',
  nameKey: 'customColor',
  colorNumber: 1,
  color: '#FF6B6B'
}
```

색상 변경 시 `color` 필드만 업데이트하고 `id`/`colorNumber`는 유지.

---

### 4.3 단축키 (Keyboard Shortcuts)

#### 표시 방식

현재 등록된 명령어(`browserAPI.commands.getAll()`)를 기반으로 색상별 단축키를 나열.

```
┌──────────────────────────────────────────┐
│  KEYBOARD SHORTCUTS                      │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ [🟡] Yellow      Ctrl+Shift+1  ↗  │  │
│  │ [🟢] Green       Ctrl+Shift+2  ↗  │  │
│  │ [🔵] Blue        Ctrl+Shift+3  ↗  │  │
│  │ [🩷] Pink        Ctrl+Shift+4  ↗  │  │
│  │ [🟠] Orange      (미설정)      ↗  │  │
│  │ [🟣] Custom 1    (미설정)      ↗  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ℹ 단축키 변경은 브라우저 단축키 설정  │
│    페이지에서 가능합니다.               │
│  [브라우저 단축키 설정 열기 ↗]          │
└──────────────────────────────────────────┘
```

#### 단축키 변경 제약 사항

브라우저 확장 API(`browserAPI.commands`)는 단축키 **읽기**만 지원하고 **프로그래매틱 변경**은 지원하지 않는다 (Chrome/Firefox 공통 제약). 따라서:

- **색상↔단축키 매핑 변경**: 설정 화면 내에서 "어떤 색상에 어떤 단축키 슬롯(highlight_1~5)을 배정할지"를 앱 레벨에서 재매핑
- **단축키 키 조합 변경**: 브라우저 단축키 설정 페이지로 링크 안내

#### 색상↔단축키 슬롯 매핑 설계

확장의 명령어 이름(`highlight_yellow`, `highlight_green` 등)은 고정이지만, "어떤 색상이 어떤 슬롯에 반응할지"는 앱 레벨 매핑으로 관리한다.

**현재 (고정):**
```
Ctrl+Shift+1 → highlight_yellow → 노란색
Ctrl+Shift+2 → highlight_green  → 초록색
Ctrl+Shift+3 → highlight_blue   → 파란색
Ctrl+Shift+4 → highlight_pink   → 분홍색
```

**변경 후 (매핑 테이블 도입):**
```js
// storage: shortcutColorMap
{
  "highlight_1": "yellow",   // Ctrl+Shift+1에 배정된 색상 id
  "highlight_2": "green",
  "highlight_3": "blue",
  "highlight_4": "pink",
  "highlight_5": null        // 미배정
}
```

#### 단축키 슬롯 매핑 UI

```
KEYBOARD SHORTCUTS

슬롯        단축키            배정된 색상
─────────────────────────────────────────
슬롯 1   Ctrl+Shift+1   [🟡 Yellow      ▾]
슬롯 2   Ctrl+Shift+2   [🟢 Green       ▾]
슬롯 3   Ctrl+Shift+3   [🔵 Blue        ▾]
슬롯 4   Ctrl+Shift+4   [🩷 Pink        ▾]
슬롯 5   (미설정)        [🟠 Orange      ▾]

[브라우저에서 단축키 키 조합 변경하기 ↗]
```

- 각 슬롯의 "배정된 색상" 셀은 드롭다운 선택
- 드롭다운 옵션: 기본 5색 + 사용자 정의 색상 + "(없음)"
- 변경 즉시 `shortcutColorMap` 스토리지에 저장
- 저장 후 컨텍스트 메뉴 재생성 트리거 (`createOrUpdateContextMenus`)

#### `shortcutColorMap` 스토리지 키

- `STORAGE_KEYS`에 `SHORTCUT_COLOR_MAP: 'shortcutColorMap'` 추가
- `SYNC_KEYS`의 `settings` 오브젝트에 포함하여 기기 간 동기화

---

## 5. 화면 전환 흐름

```
[팝업]
  │
  └─[⚙ 설정 아이콘 클릭]──→ [settings.html 팝업 창]
                               │
                               ├─ [일반 섹션]
                               │    └─ 토글 변경 → 즉시 저장 + 브로드캐스트
                               │
                               ├─ [사용자 정의 색상 섹션]
                               │    ├─ [+ 추가] → 색상 피커 → 저장 + 컨텍스트 메뉴 갱신
                               │    ├─ [변경]   → 색상 피커 → 저장 + 컨텍스트 메뉴 갱신
                               │    └─ [✕ 삭제] → 즉시 삭제 + 컨텍스트 메뉴 갱신
                               │
                               └─ [단축키 섹션]
                                    ├─ 슬롯↔색상 드롭다운 변경 → 저장 + 컨텍스트 메뉴 갱신
                                    └─ [브라우저 단축키 설정] → chrome://extensions/shortcuts 열기
```

---

## 6. 파일 구성

| 파일 | 역할 |
|------|------|
| `settings.html` | 설정 화면 HTML |
| `settings.js` | 설정 화면 로직 |
| `popup.html` | 헤더에 설정 아이콘 추가, 설정 관련 항목 제거 |
| `popup.js` | 설정 아이콘 클릭 핸들러 추가 |
| `background/settings-service.js` | `updateCustomColor()`, `shortcutColorMap` 로직 추가 |
| `constants/storage-keys.js` | `SHORTCUT_COLOR_MAP` 키 추가 |
| `background/message-router.js` | 새 메시지 액션 라우팅 추가 |

---

## 7. 구현 시 고려 사항

### 브라우저 호환성

- `browserAPI.commands.getAll()`: Chrome과 Firefox 모두 지원
- `chrome://extensions/shortcuts` 링크: Chrome 전용. Firefox는 `about:addons` 참고 안내
- `browserAPI.windows`: 모바일(Firefox Android) 미지원 → 설정 화면을 탭으로 열기로 폴백

### 사용자 정의 색상 변경 vs 삭제-후-추가

"색상 변경" 기능은 `id`와 `colorNumber`를 유지한 채 `color`만 바꾸는 PATCH 방식으로 구현. 이를 통해 단축키 슬롯 매핑이 `id` 기반이면 색상이 바뀌어도 매핑이 유지된다.

### 단축키 슬롯이 5개인 이유

Chrome 확장은 manifest `commands`에 정의된 명령어만 사용 가능하며 동적으로 추가 불가. 현재 `highlight_yellow`~`highlight_orange` 5개가 정의되어 있다. 설정 화면에서는 이 5개 슬롯을 임의의 색상(기본 5색 + 사용자 정의 색상)에 자유롭게 배정하도록 한다.

### 단축키 슬롯 명칭 변경

현재 명령어 이름이 `highlight_yellow`, `highlight_green` 등 색상 이름을 포함하고 있어 혼란의 여지가 있다. 설정 UI에서는 명령어 이름 대신 "슬롯 1 (Ctrl+Shift+1)" 형식으로 표시하여 색상 이름과 분리한다.
