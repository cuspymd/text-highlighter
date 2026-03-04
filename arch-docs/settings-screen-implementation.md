# 설정 화면 구현 설계

디자인 설계 문서: `arch-docs/settings-screen-design.md`

---

## 1. 변경 파일 목록

| 파일 | 변경 종류 | 주요 내용 |
|------|-----------|-----------|
| `constants/storage-keys.js` | 수정 | `SHORTCUT_COLOR_MAP` 키 추가 |
| `background/settings-service.js` | 수정 | `updateCustomColor`, `removeCustomColor`, shortcutColorMap 로드/저장 추가 |
| `background/sync-service.js` | 수정 | `shortcutColorMap`을 sync 대상에 포함 |
| `background/message-router.js` | 수정 | 신규 액션 핸들러 추가, skipKeys 갱신 |
| `background/context-menu.js` | 수정 | 단축키 커맨드 핸들러를 `shortcutColorMap` 기반으로 변경 |
| `popup.html` | 수정 | 설정 아이콘 버튼 추가, 설정 관련 항목 제거 |
| `popup.js` | 수정 | 설정 아이콘 클릭 핸들러 추가, 설정 관련 핸들러 제거 |
| `settings.html` | 신규 | 설정 화면 HTML |
| `settings.js` | 신규 | 설정 화면 로직 |
| `scripts/deploy.cjs` | 수정 | `settings.html`, `settings.js` 빌드 복사 목록 추가 |
| `_locales/en/messages.json` | 수정 | 신규 i18n 키 추가 |
| `_locales/ko/messages.json` | 수정 | 신규 i18n 키 추가 |
| `_locales/ja/messages.json` | 수정 | 신규 i18n 키 추가 |
| `_locales/es/messages.json` | 수정 | 신규 i18n 키 추가 |
| `_locales/zh/messages.json` | 수정 | 신규 i18n 키 추가 |

---

## 2. 스토리지 구조 변경

### 2.1 신규 스토리지 키: `shortcutColorMap`

```js
// 기본값 (현재 고정 매핑과 동일)
{
  highlight_yellow: 'yellow',
  highlight_green:  'green',
  highlight_blue:   'blue',
  highlight_pink:   'pink',
  highlight_orange: 'orange',
}
```

- 키: manifest `commands`의 명령어 이름 (`highlight_yellow` 등)
- 값: 색상 `id` (`'yellow'`, `'custom_1234567890'` 등), 또는 `null` (미배정)
- 저장 위치: `storage.local` (기존 설정들과 동일)
- sync 대상: `SYNC_KEYS.SETTINGS` 오브젝트에 `shortcutColorMap` 필드로 포함

### 2.2 `constants/storage-keys.js` 변경

```js
export const STORAGE_KEYS = {
  CUSTOM_COLORS: 'customColors',
  MINIMAP_VISIBLE: 'minimapVisible',
  SELECTION_CONTROLS_VISIBLE: 'selectionControlsVisible',
  SYNC_MIGRATION_DONE: 'syncMigrationDone',
  META_SUFFIX: '_meta',
  SHORTCUT_COLOR_MAP: 'shortcutColorMap',   // 신규
};
```

---

## 3. `background/settings-service.js` 변경

### 3.1 신규 내부 상수 및 상태

```js
const DEFAULT_SHORTCUT_COLOR_MAP = {
  highlight_yellow: 'yellow',
  highlight_green:  'green',
  highlight_blue:   'blue',
  highlight_pink:   'pink',
  highlight_orange: 'orange',
};

let shortcutColorMap = { ...DEFAULT_SHORTCUT_COLOR_MAP };
```

### 3.2 신규 export 함수

#### `getShortcutColorMap()`

```js
export function getShortcutColorMap() {
  return shortcutColorMap;
}
```

#### `loadShortcutColorMap()`

초기화 시(`loadCustomColors` 내부에서) 호출. `storage.local`에서 읽어 `shortcutColorMap`을 채움.
없으면 `DEFAULT_SHORTCUT_COLOR_MAP` 사용.

```js
async function loadShortcutColorMap() {
  const result = await browserAPI.storage.local.get([STORAGE_KEYS.SHORTCUT_COLOR_MAP]);
  shortcutColorMap = result[STORAGE_KEYS.SHORTCUT_COLOR_MAP] || { ...DEFAULT_SHORTCUT_COLOR_MAP };
}
```

#### `saveShortcutColorMap(newMap)`

```js
export async function saveShortcutColorMap(newMap) {
  shortcutColorMap = { ...newMap };
  await browserAPI.storage.local.set({ [STORAGE_KEYS.SHORTCUT_COLOR_MAP]: shortcutColorMap });
  await saveSettingsToSync();
}
```

#### `updateCustomColor(id, newColorValue)`

`id`로 기존 사용자 정의 색상을 찾아 `color` 필드만 변경. `id`와 `colorNumber`는 유지.

```js
export async function updateCustomColor(id, newColorValue) {
  const stored = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
  const customColors = stored.customColors || [];

  const idx = customColors.findIndex(c => c.id === id);
  if (idx === -1) return { notFound: true, colors: currentColors };

  // 이미 존재하는 다른 색상과 중복 체크
  const duplicate = [...COLORS, ...customColors].some(
    (c, i) => c.color.toLowerCase() === newColorValue.toLowerCase() && c.id !== id
  );
  if (duplicate) return { exists: true, colors: currentColors };

  customColors[idx] = { ...customColors[idx], color: newColorValue };
  await browserAPI.storage.local.set({ customColors });

  // currentColors 인메모리 갱신
  const globalIdx = currentColors.findIndex(c => c.id === id);
  if (globalIdx !== -1) currentColors[globalIdx] = { ...currentColors[globalIdx], color: newColorValue };

  await saveSettingsToSync();
  return { exists: false, colors: currentColors };
}
```

#### `removeCustomColor(id)`

단일 사용자 정의 색상 삭제.

```js
export async function removeCustomColor(id) {
  const stored = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
  let customColors = stored.customColors || [];

  const before = customColors.length;
  customColors = customColors.filter(c => c.id !== id);
  if (customColors.length === before) return { notFound: true, colors: currentColors };

  await browserAPI.storage.local.set({ customColors });
  currentColors = currentColors.filter(c => c.id !== id);

  await saveSettingsToSync();
  return { colors: currentColors };
}
```

### 3.3 기존 함수 변경

#### `loadCustomColors()`

기존 로직 유지, 마지막에 `await loadShortcutColorMap()` 호출 추가.

#### `applySettingsFromSync(newSettings)`

`shortcutColorMap` 필드 처리 추가:

```js
if (newSettings.shortcutColorMap) {
  await browserAPI.storage.local.set({ [STORAGE_KEYS.SHORTCUT_COLOR_MAP]: newSettings.shortcutColorMap });
  shortcutColorMap = newSettings.shortcutColorMap;
}
```

---

## 4. `background/sync-service.js` 변경

### 4.1 `saveSettingsToSync()`

`shortcutColorMap`을 sync 페이로드에 포함:

```js
export async function saveSettingsToSync() {
  const result = await browserAPI.storage.local.get([
    STORAGE_KEYS.CUSTOM_COLORS,
    STORAGE_KEYS.MINIMAP_VISIBLE,
    STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
    STORAGE_KEYS.SHORTCUT_COLOR_MAP,    // 신규
  ]);
  const settings = {
    customColors: result.customColors || [],
    minimapVisible: result.minimapVisible !== undefined ? result.minimapVisible : true,
    selectionControlsVisible: result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true,
    shortcutColorMap: result.shortcutColorMap || null,   // 신규
  };
  // ... 기존 sync.set 코드
}
```

### 4.2 `migrateLocalToSync()`

skipKeys 배열에 `STORAGE_KEYS.SHORTCUT_COLOR_MAP` 추가 (하이라이트 URL 목록 탐색 시 건너뜀):

```js
const skipKeys = [
  STORAGE_KEYS.CUSTOM_COLORS,
  STORAGE_KEYS.SYNC_MIGRATION_DONE,
  STORAGE_KEYS.MINIMAP_VISIBLE,
  STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
  STORAGE_KEYS.SHORTCUT_COLOR_MAP,   // 신규
  'settings',
];
```

---

## 5. `background/message-router.js` 변경

### 5.1 import 추가

```js
import {
  // 기존...
  updateCustomColor,
  removeCustomColor,
  getShortcutColorMap,
  saveShortcutColorMap,
} from './settings-service.js';
```

### 5.2 신규 핸들러

```js
async function handleUpdateCustomColor(message) {
  if (!message.id || !message.color) return errorResponse('Missing id or color');
  const result = await updateCustomColor(message.id, message.color);
  if (result.notFound) return errorResponse('Color not found');
  if (result.exists) return successResponse({ exists: true, colors: result.colors });
  await createOrUpdateContextMenus();
  await broadcastToAllTabs({ action: 'colorsUpdated', colors: result.colors });
  return successResponse({ colors: result.colors });
}

async function handleRemoveCustomColor(message) {
  if (!message.id) return errorResponse('Missing id');
  const result = await removeCustomColor(message.id);
  if (result.notFound) return errorResponse('Color not found');
  await createOrUpdateContextMenus();
  await broadcastToAllTabs({ action: 'colorsUpdated', colors: result.colors });
  return successResponse({ colors: result.colors });
}

async function handleGetShortcutColorMap(_message) {
  return successResponse({ shortcutColorMap: getShortcutColorMap() });
}

async function handleSaveShortcutColorMap(message) {
  if (!message.shortcutColorMap) return errorResponse('Missing shortcutColorMap');
  await saveShortcutColorMap(message.shortcutColorMap);
  await createOrUpdateContextMenus();
  return successResponse();
}
```

### 5.3 `ACTION_HANDLERS` 맵에 추가

```js
updateCustomColor:      handleUpdateCustomColor,
removeCustomColor:      handleRemoveCustomColor,
getShortcutColorMap:    handleGetShortcutColorMap,
saveShortcutColorMap:   handleSaveShortcutColorMap,
```

### 5.4 skipKeys 갱신

`handleGetAllHighlightedPages`와 `handleDeleteAllHighlightedPages` 내부 skipKeys에 `STORAGE_KEYS.SHORTCUT_COLOR_MAP` 추가.

---

## 6. `background/context-menu.js` 변경

### 6.1 import 추가

```js
import { getShortcutColorMap } from './settings-service.js';
```

### 6.2 단축키 커맨드 핸들러 변경

기존: `command.replace('highlight_', '')` → colorId 직접 추출
변경: `shortcutColorMap[command]` → colorId 조회

```js
// 변경 전
const colorId = command.replace('highlight_', '');
targetColor = getCurrentColors().find(c => c.id === colorId)?.color;

// 변경 후
const colorMap = getShortcutColorMap();
const colorId = colorMap[command] ?? null;
targetColor = colorId ? getCurrentColors().find(c => c.id === colorId)?.color : null;
```

---

## 7. `popup.html` 변경

### 7.1 헤더에 설정 아이콘 버튼 추가

```html
<header class="popup-header">
  <div class="brand">
    <img class="brand-icon" src="images/icon48.png" alt="" aria-hidden="true" />
    <h1 data-i18n="popupTitle">Text Highlighter</h1>
  </div>
  <button id="open-settings" class="icon-btn" data-i18n-title="settingsIconLabel" title="Settings">
    <!-- SVG gear icon -->
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
    </svg>
  </button>
</header>
```

`.icon-btn` 스타일: 투명 배경, 호버 시 accent 색상.

### 7.2 제거 항목

`<section class="section-card actions">` 에서 아래 제거:
- `<button id="delete-custom-colors" ...>`
- 미니맵 토글 `.toggle-container`
- 컨트롤 UI 토글 `.toggle-container`

---

## 8. `popup.js` 변경

### 8.1 제거

- `deleteCustomColorsBtn` 참조 및 이벤트 핸들러
- `minimapToggle`, `selectionControlsToggle` 참조 및 이벤트 핸들러
- `loadMinimapSetting()`, `loadSelectionControlsSetting()` 함수
- 초기화 코드에서 위 함수 호출 제거

### 8.2 추가

```js
const openSettingsBtn = document.getElementById('open-settings');

openSettingsBtn.addEventListener('click', () => {
  const settingsUrl = browserAPI.runtime.getURL('settings.html');
  if (browserAPI.windows) {
    browserAPI.windows.create({
      url: settingsUrl,
      type: 'popup',
      width: 440,
      height: 620,
    });
  } else {
    // 모바일 폴백
    browserAPI.tabs.create({ url: settingsUrl });
    window.close();
  }
});
```

---

## 9. `settings.html` (신규)

### 전체 구조

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title data-i18n="settingsTitle">Settings</title>
    <link rel="stylesheet" href="shared/modal.css" />
    <style>
      /* popup.html의 CSS 변수 및 기본 스타일 공유 */
      /* 추가: .settings-shell, .section-card, .settings-row 등 */
    </style>
  </head>
  <body>
    <div class="settings-shell">
      <header class="settings-header">
        <h1 data-i18n="settingsTitle">Settings</h1>
      </header>

      <!-- 일반 섹션 -->
      <section class="section-card">
        <h2 class="section-title" data-i18n="generalSection">General</h2>
        <div class="toggle-container">
          <label for="minimap-toggle" data-i18n="showMinimap">Show Minimap</label>
          <label class="toggle-switch">
            <input type="checkbox" id="minimap-toggle" checked />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-container" id="selection-controls-row">
          <label for="selection-controls-toggle" data-i18n="showControlsOnSelection">Show Control UI on Text Selection</label>
          <label class="toggle-switch">
            <input type="checkbox" id="selection-controls-toggle" checked />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </section>

      <!-- 사용자 정의 색상 섹션 -->
      <section class="section-card">
        <h2 class="section-title" data-i18n="customColorsSection">Custom Colors</h2>
        <div id="custom-colors-list"></div>
        <button id="add-custom-color-btn" class="btn btn-primary" data-i18n="addCustomColor">+ Add Custom Color</button>
        <input type="color" id="color-picker-hidden" style="display:none" />
      </section>

      <!-- 단축키 섹션 -->
      <section class="section-card">
        <h2 class="section-title" data-i18n="shortcutsSection">Keyboard Shortcuts</h2>
        <div id="shortcuts-list"></div>
        <p class="hint-text" data-i18n="shortcutHint">
          Key combinations can be changed in browser shortcut settings.
        </p>
        <button id="open-browser-shortcuts" class="btn" data-i18n="openBrowserShortcuts">
          Open Browser Shortcut Settings ↗
        </button>
      </section>
    </div>
    <script type="module" src="settings.js"></script>
  </body>
</html>
```

---

## 10. `settings.js` (신규)

### 10.1 초기화 흐름

```
DOMContentLoaded
  ├── initializeI18n()          // popup.js와 동일 패턴
  ├── initializeThemeWatcher()
  ├── loadGeneralSettings()     // 미니맵, 컨트롤 UI 토글
  ├── loadCustomColors()        // 사용자 정의 색상 목록 렌더
  └── loadShortcuts()           // 단축키 슬롯 렌더
```

### 10.2 일반 섹션 로직

`popup.js`의 `loadMinimapSetting`, `loadSelectionControlsSetting` 및 토글 이벤트 핸들러를 이동. 코드 그대로 재사용.

### 10.3 사용자 정의 색상 섹션 로직

#### 색상 목록 렌더 (`renderCustomColorsList`)

```js
function renderCustomColorsList(customColors) {
  const list = document.getElementById('custom-colors-list');
  list.innerHTML = '';

  if (customColors.length === 0) {
    // "No custom colors yet" 안내 문구
    return;
  }

  customColors.forEach(colorObj => {
    // 행: [색상 스와치] [hex 코드] [변경 버튼] [삭제 버튼]
    const row = buildColorRow(colorObj);
    list.appendChild(row);
  });
}
```

#### 색상 추가 (`handleAddColor`)

```js
addBtn.addEventListener('click', () => {
  // hidden color picker 열기
  picker.value = '#ff0000';
  picker.click();
  picker.onchange = async () => {
    const response = await browserAPI.runtime.sendMessage({
      action: 'addColor',
      color: picker.value,
    });
    if (response.success) {
      const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
      renderCustomColorsList(customColors);
    } else if (response.exists) {
      await showAlertModal(browserAPI.i18n.getMessage('colorAlreadyExists'));
    }
  };
});
```

#### 색상 변경 (`handleUpdateColor`)

```js
async function handleUpdateColor(colorObj) {
  picker.value = colorObj.color;
  picker.click();
  picker.onchange = async () => {
    const response = await browserAPI.runtime.sendMessage({
      action: 'updateCustomColor',
      id: colorObj.id,
      color: picker.value,
    });
    if (response.success) {
      const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
      renderCustomColorsList(customColors);
      await reloadShortcuts(); // 단축키 섹션도 색상명 갱신
    } else if (response.exists) {
      await showAlertModal(browserAPI.i18n.getMessage('colorAlreadyExists'));
    }
  };
}
```

#### 색상 삭제 (`handleRemoveColor`)

```js
async function handleRemoveColor(colorObj) {
  const response = await browserAPI.runtime.sendMessage({
    action: 'removeCustomColor',
    id: colorObj.id,
  });
  if (response.success) {
    const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
    renderCustomColorsList(customColors);
    await reloadShortcuts(); // 단축키 섹션에서 해당 색상 제거 반영
  }
}
```

### 10.4 단축키 섹션 로직

#### 슬롯 목록 렌더 (`renderShortcutsList`)

- `browserAPI.commands.getAll()`로 현재 키 조합 조회
- `browserAPI.runtime.sendMessage({ action: 'getShortcutColorMap' })`로 현재 매핑 조회
- `browserAPI.runtime.sendMessage({ action: 'getColors' })`로 전체 색상 목록 조회
- 각 슬롯(manifest command 5개)에 대해:
  - 슬롯명 (사람이 읽기 좋게: "Slot 1", "슬롯 1" 등)
  - 현재 키 조합 (`command.shortcut` 또는 "(미설정)")
  - 배정된 색상 드롭다운 (`<select>`)

```js
function renderShortcutsList(commands, colorMap, allColors) {
  const list = document.getElementById('shortcuts-list');
  list.innerHTML = '';

  const SLOT_COMMANDS = [
    'highlight_yellow', 'highlight_green', 'highlight_blue',
    'highlight_pink', 'highlight_orange',
  ];

  SLOT_COMMANDS.forEach((cmdName, idx) => {
    const cmd = commands.find(c => c.name === cmdName);
    const shortcutLabel = cmd?.shortcut || browserAPI.i18n.getMessage('notAssigned');
    const assignedColorId = colorMap[cmdName] ?? null;

    const row = document.createElement('div');
    row.className = 'shortcut-row';

    // 슬롯 번호
    const slotLabel = document.createElement('span');
    slotLabel.textContent = `${browserAPI.i18n.getMessage('shortcutSlot')} ${idx + 1}`;

    // 키 조합 표시
    const keyLabel = document.createElement('span');
    keyLabel.className = 'key-badge';
    keyLabel.textContent = shortcutLabel;

    // 색상 드롭다운
    const select = document.createElement('select');
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = browserAPI.i18n.getMessage('notAssigned');
    select.appendChild(noneOption);

    allColors.forEach(color => {
      const option = document.createElement('option');
      option.value = color.id;
      option.textContent = buildColorLabel(color); // "노란색", "사용자 정의 색상 1" 등
      if (color.id === assignedColorId) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', async () => {
      const newColorId = select.value || null;
      const updatedMap = { ...colorMap, [cmdName]: newColorId };
      await browserAPI.runtime.sendMessage({
        action: 'saveShortcutColorMap',
        shortcutColorMap: updatedMap,
      });
      colorMap[cmdName] = newColorId; // 로컬 상태 갱신
    });

    row.append(slotLabel, keyLabel, select);
    list.appendChild(row);
  });
}
```

#### 브라우저 단축키 설정 열기

```js
document.getElementById('open-browser-shortcuts').addEventListener('click', () => {
  // Chrome: chrome://extensions/shortcuts
  // Firefox: about:addons (직접 열기 불가하여 탭 생성 시도)
  if (navigator.userAgent.includes('Firefox')) {
    browserAPI.tabs.create({ url: 'about:addons' });
  } else {
    browserAPI.tabs.create({ url: 'chrome://extensions/shortcuts' });
  }
});
```

---

## 11. 신규 i18n 키

모든 5개 로케일(`en`, `ko`, `ja`, `es`, `zh`)에 추가.

| 키 | en | ko |
|----|----|----|
| `settingsTitle` | Settings | 설정 |
| `settingsIconLabel` | Open Settings | 설정 열기 |
| `generalSection` | General | 일반 |
| `customColorsSection` | Custom Colors | 사용자 정의 색상 |
| `shortcutsSection` | Keyboard Shortcuts | 단축키 |
| `addCustomColor` | + Add Custom Color | + 색상 추가 |
| `editColor` | Change | 변경 |
| `removeColor` | Remove | 삭제 |
| `noCustomColors` | No custom colors yet. | 사용자 정의 색상이 없습니다. |
| `colorAlreadyExists` | This color already exists. | 이미 추가된 색상입니다. |
| `shortcutSlot` | Slot | 슬롯 |
| `notAssigned` | (Not assigned) | (미배정) |
| `shortcutHint` | Key combinations can be changed in browser shortcut settings. | 키 조합은 브라우저 단축키 설정에서 변경할 수 있습니다. |
| `openBrowserShortcuts` | Open Browser Shortcut Settings ↗ | 브라우저 단축키 설정 열기 ↗ |
| `colorChangeWarning` | Changes do not affect existing highlights. | 기존 하이라이트에는 영향을 주지 않습니다. |

---

## 12. `scripts/deploy.cjs` 변경

```js
const filesToCopy = [
  'background.js',
  'popup.html',
  'popup.js',
  'settings.html',   // 신규
  'settings.js',     // 신규
  'styles.css',
  'pages-list.html',
  'pages-list.js',
];
```

---

## 13. 구현 순서 및 Todo List

### Phase 1: 데이터 레이어

- [ ] **1-1** `constants/storage-keys.js`에 `SHORTCUT_COLOR_MAP` 추가
- [ ] **1-2** `background/settings-service.js`에 `DEFAULT_SHORTCUT_COLOR_MAP` 상수 및 `shortcutColorMap` 상태 추가
- [ ] **1-3** `settings-service.js`에 `loadShortcutColorMap()` 내부 함수 구현 및 `loadCustomColors()` 끝에서 호출
- [ ] **1-4** `settings-service.js`에 `getShortcutColorMap()` export 추가
- [ ] **1-5** `settings-service.js`에 `saveShortcutColorMap(newMap)` export 구현
- [ ] **1-6** `settings-service.js`에 `updateCustomColor(id, newColorValue)` export 구현
- [ ] **1-7** `settings-service.js`에 `removeCustomColor(id)` export 구현
- [ ] **1-8** `settings-service.js`의 `applySettingsFromSync()`에 `shortcutColorMap` 처리 추가
- [ ] **1-9** `background/sync-service.js`의 `saveSettingsToSync()`에 `shortcutColorMap` 포함
- [ ] **1-10** `background/sync-service.js`의 `migrateLocalToSync()` skipKeys에 `SHORTCUT_COLOR_MAP` 추가

### Phase 2: 메시지 라우팅

- [ ] **2-1** `message-router.js`에 `handleUpdateCustomColor` 핸들러 구현
- [ ] **2-2** `message-router.js`에 `handleRemoveCustomColor` 핸들러 구현
- [ ] **2-3** `message-router.js`에 `handleGetShortcutColorMap` 핸들러 구현
- [ ] **2-4** `message-router.js`에 `handleSaveShortcutColorMap` 핸들러 구현
- [ ] **2-5** `message-router.js`의 `ACTION_HANDLERS`에 4개 핸들러 등록
- [ ] **2-6** `message-router.js`의 skipKeys(getAllHighlightedPages, deleteAllHighlightedPages)에 `SHORTCUT_COLOR_MAP` 추가

### Phase 3: 단축키 커맨드 동작 변경

- [ ] **3-1** `context-menu.js`에 `getShortcutColorMap` import 추가
- [ ] **3-2** `context-menu.js` 커맨드 핸들러를 `shortcutColorMap` 기반 색상 조회로 변경

### Phase 4: 팝업 수정

- [ ] **4-1** `popup.html`에서 설정 관련 항목 제거 (사용자 정의 색상 삭제 버튼, 토글 2개)
- [ ] **4-2** `popup.html` 헤더에 설정 아이콘 버튼 및 `.icon-btn` 스타일 추가
- [ ] **4-3** `popup.js`에서 제거된 항목의 핸들러/참조 제거
- [ ] **4-4** `popup.js`에 설정 아이콘 클릭 → `settings.html` 팝업 창 열기 구현

### Phase 5: 설정 화면 신규 구현

- [ ] **5-1** `settings.html` 기본 구조 작성 (CSS 변수, 레이아웃, 3개 섹션 골격)
- [ ] **5-2** `settings.js` 기본 초기화 구조 작성 (i18n, theme, DOMContentLoaded)
- [ ] **5-3** `settings.js` 일반 섹션: 미니맵·컨트롤 UI 토글 로드/저장 구현
- [ ] **5-4** `settings.js` 사용자 정의 색상 섹션: 목록 렌더(`renderCustomColorsList`) 구현
- [ ] **5-5** `settings.js` 사용자 정의 색상 섹션: 색상 추가 기능 구현
- [ ] **5-6** `settings.js` 사용자 정의 색상 섹션: 색상 변경 기능 구현
- [ ] **5-7** `settings.js` 사용자 정의 색상 섹션: 색상 삭제 기능 구현
- [ ] **5-8** `settings.js` 단축키 섹션: 슬롯 목록 렌더(`renderShortcutsList`) 구현
- [ ] **5-9** `settings.js` 단축키 섹션: 드롭다운 변경 → `saveShortcutColorMap` 전송 구현
- [ ] **5-10** `settings.js` 단축키 섹션: 브라우저 단축키 설정 열기 구현

### Phase 6: i18n 및 빌드

- [ ] **6-1** `_locales/en/messages.json`에 신규 키 추가
- [ ] **6-2** `_locales/ko/messages.json`에 신규 키 추가
- [ ] **6-3** `_locales/ja/messages.json`에 신규 키 추가
- [ ] **6-4** `_locales/es/messages.json`에 신규 키 추가
- [ ] **6-5** `_locales/zh/messages.json`에 신규 키 추가
- [ ] **6-6** `scripts/deploy.cjs`에 `settings.html`, `settings.js` 추가

### Phase 7: 검증

- [ ] **7-1** `npm test` 실행 및 통과 확인
- [ ] **7-2** `npm run deploy` 빌드 후 Chrome에서 로드 테스트
  - 팝업 설정 아이콘 → 설정 화면 열기
  - 미니맵/컨트롤 UI 토글 동작
  - 사용자 정의 색상 추가/변경/삭제
  - 단축키 슬롯 매핑 변경 후 단축키 동작 확인
- [ ] **7-3** Firefox에서 동일 항목 테스트 (모바일 폴백 포함)

---

## 14. 주의 사항

### `clearCustomColors` 액션 유지

기존 `clearCustomColors` 메시지 액션은 테스트 코드에서 참조될 수 있으므로 제거하지 않는다. 설정 화면에서는 개별 삭제(`removeCustomColor`)를 사용하고, `clearCustomColors`는 레거시로 유지.

### 단축키 슬롯 매핑과 컨텍스트 메뉴 일관성

`createOrUpdateContextMenus()`는 `currentColors` 기반으로 메뉴를 생성하므로 사용자 정의 색상 추가/변경/삭제 후 반드시 재호출한다. 매핑 변경(`saveShortcutColorMap`) 시에도 컨텍스트 메뉴 타이틀에 표시되는 단축키가 올바른지 확인이 필요하다.

### `chrome://extensions/shortcuts` 탭 생성

Chrome에서 `chrome://` URL을 `tabs.create()`로 열 수 없다. 대신 아래 접근:

```js
// chrome://extensions/shortcuts 직접 열기는 불가
// 대안: 확장의 단축키 설정 페이지 링크를 안내 텍스트로만 표시
// 또는 browserAPI.tabs.create({ url: 'chrome://extensions/shortcuts' }) 시도 후 실패 시 안내
```

실제로는 `chrome://extensions/shortcuts` 직접 열기가 불가하므로, 버튼 클릭 시 해당 URL을 클립보드에 복사하고 "주소창에 붙여넣어 이동하세요" 안내를 표시하는 방식 또는 단순히 안내 텍스트로 처리하는 것을 권장한다.
