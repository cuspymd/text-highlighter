// Cross-browser compatibility - use chrome API in Chrome, browser API in Firefox
const browserAPI = (() => {
  if (typeof browser !== 'undefined') {
    return browser;
  }
  if (typeof chrome !== 'undefined') {
    return chrome;
  }
  throw new Error('Neither browser nor chrome API is available');
})();

// Highlight controller UI container
let highlightControlsContainer = null;
let activeHighlightElement = null;
// Flag to know when the native <input type="color"> picker is open
let colorPickerOpen = false;
// Track the last added color to apply animation only to new colors
let lastAddedColor = null;

// Selection controls feature
let selectionControlsEnabled = false;
let selectionIcon = null;
let selectionControlsContainer = null;
let currentSelection = null;

// Helper function for jelly animation
function addJellyAnimation(btn) {
  btn.addEventListener('click', function () {
    btn.classList.remove('jelly-animate');
    void btn.offsetWidth;
    btn.classList.add('jelly-animate');
  });
  btn.addEventListener('animationend', function (e) {
    if (e.animationName === 'jelly-bounce') {
      btn.classList.remove('jelly-animate');
    }
  });
}

// Create highlight controller UI
function createHighlightControls() {
  if (highlightControlsContainer) return;
  highlightControlsContainer = document.createElement('div');
  highlightControlsContainer.className = 'text-highlighter-controls';
  const deleteButton = document.createElement('div');
  deleteButton.className = 'text-highlighter-control-button delete-highlight';
  deleteButton.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="4" y1="4" x2="12" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
  deleteButton.title = getMessage('deleteHighlight');
  deleteButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      removeHighlight(activeHighlightElement);
    }
    e.stopPropagation();
  });
  const colorButtonsContainer = document.createElement('div');
  colorButtonsContainer.className = 'text-highlighter-color-buttons';
  currentColors.forEach((colorInfo, idx) => {
    // Insert a separator after the 5 default colors (only if custom colors exist)
    if (idx === 5 && currentColors.length > 5) {
      appendColorSeparator(colorButtonsContainer);
    }
    const colorButton = createColorButton(colorInfo);
    colorButtonsContainer.appendChild(colorButton);
  });
  highlightControlsContainer.appendChild(deleteButton);
  highlightControlsContainer.appendChild(colorButtonsContainer);
  highlightControlsContainer.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  // -------------- '+' button (add new color) --------------
  const addColorBtn = createAddColorButton();
  colorButtonsContainer.appendChild(addColorBtn);
  document.body.appendChild(highlightControlsContainer);
}

// colorButton 생성 (재사용 가능한 함수)
function createColorButton(colorInfo) {
  const colorButton = document.createElement('div');
  colorButton.className = 'text-highlighter-control-button color-button';
  colorButton.style.backgroundColor = colorInfo.color;
  colorButton.title = getMessage(colorInfo.nameKey);
  colorButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      changeHighlightColor(activeHighlightElement, colorInfo.color);
    }
    e.stopPropagation();
  });
  
  addJellyAnimation(colorButton);
  
  // 방금 추가된 색상에만 애니메이션 효과 추가
  if (lastAddedColor && colorInfo.color === lastAddedColor) {
    colorButton.classList.add('new-color-animate');
    // 애니메이션 완료 후 클래스 제거
    colorButton.addEventListener('animationend', function(e) {
      if (e.animationName === 'pop-in-new-color') {
        colorButton.classList.remove('new-color-animate');
        lastAddedColor = null; // 애니메이션 완료 후 초기화
      }
    });
  }
  
  return colorButton;
}

// addColorBtn 생성 (재사용 가능한 함수)
function createAddColorButton() {
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="8" y1="3" x2="8" y2="13" stroke="#999" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="8" x2="13" y2="8" stroke="#999" stroke-width="2" stroke-linecap="round"/></svg>`;
  addColorBtn.title = getMessage('addColor') || '+';

  // 커스텀 색상 선택기 이벤트 추가
  addColorBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 이미 열려있는 색상 선택기가 있으면 무시
    const existingPicker = document.querySelector('.custom-color-picker');
    if (existingPicker) {
      return;
    }
    
    colorPickerOpen = true;
    showCustomColorPicker(addColorBtn);
  });
  
  return addColorBtn;
}

// 현재 활성화된 closeHandler를 추적하기 위한 변수
let currentCloseHandler = null;

// 공통 색상 피커 UI 생성 함수
function createColorPickerUI() {
  // 색상 프리셋 배열
  const presetColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F39C12', '#E74C3C', '#9B59B6', '#3498DB', '#1ABC9C',
    '#2ECC71', '#F1C40F', '#E67E22', '#FF90A0', '#A8E6CF'
  ];
  
  // 커스텀 색상 선택기 생성
  const customColorPicker = document.createElement('div');
  customColorPicker.className = 'custom-color-picker';
  
  // 헤더 생성
  const header = document.createElement('div');
  header.className = 'color-picker-header';
  header.textContent = browserAPI.i18n.getMessage('selectColor');
  customColorPicker.appendChild(header);
  
  // 색상 프리셋 그리드 생성
  const presetGrid = document.createElement('div');
  presetGrid.className = 'color-preset-grid';
  
  presetColors.forEach(color => {
    const colorDiv = document.createElement('div');
    colorDiv.className = 'color-preset';
    colorDiv.style.backgroundColor = color;
    colorDiv.dataset.color = color;
    presetGrid.appendChild(colorDiv);
  });
  
  customColorPicker.appendChild(presetGrid);
  
  // 커스텀 색상 섹션 생성
  const customSection = document.createElement('div');
  customSection.className = 'custom-color-section';
  
  // Hue 슬라이더 컨테이너
  const hueContainer = document.createElement('div');
  hueContainer.className = 'hue-slider-container';
  
  const hueSlider = document.createElement('div');
  hueSlider.className = 'hue-slider';
  hueSlider.id = 'hueSlider';
  
  const hueHandle = document.createElement('div');
  hueHandle.className = 'hue-handle';
  hueHandle.id = 'hueHandle';
  
  hueSlider.appendChild(hueHandle);
  hueContainer.appendChild(hueSlider);
  customSection.appendChild(hueContainer);
  
  // Saturation-Value 피커
  const svPicker = document.createElement('div');
  svPicker.className = 'saturation-value-picker';
  svPicker.id = 'svPicker';
  
  const svHandle = document.createElement('div');
  svHandle.className = 'sv-handle';
  svHandle.id = 'svHandle';
  
  svPicker.appendChild(svHandle);
  customSection.appendChild(svPicker);
  
  // 색상 미리보기
  const colorPreview = document.createElement('div');
  colorPreview.className = 'color-preview';
  colorPreview.id = 'colorPreview';
  colorPreview.style.backgroundColor = '#FF6B6B';
  customSection.appendChild(colorPreview);
  
  customColorPicker.appendChild(customSection);
  
  // 버튼 섹션 생성
  const buttonsSection = document.createElement('div');
  buttonsSection.className = 'color-picker-buttons';
  
  const applyButton = document.createElement('button');
  applyButton.className = 'color-picker-apply';
  applyButton.id = 'applyColor';
  applyButton.textContent = browserAPI.i18n.getMessage('apply');
  
  const cancelButton = document.createElement('button');
  cancelButton.className = 'color-picker-close';
  cancelButton.textContent = browserAPI.i18n.getMessage('cancel');
  
  buttonsSection.appendChild(applyButton);
  buttonsSection.appendChild(cancelButton);
  customColorPicker.appendChild(buttonsSection);
  
  return customColorPicker;
}

// 색상 피커 공통 이벤트 처리 함수
function setupColorPickerEvents(customColorPicker, triggerButton, onColorSelect, onClose) {
  // 색상 선택 이벤트
  customColorPicker.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-preset')) {
      e.stopPropagation();
      const color = e.target.dataset.color;
      onColorSelect(color);
      onClose();
    } else if (e.target.classList.contains('color-picker-close')) {
      e.stopPropagation();
      onClose();
    } else if (e.target.classList.contains('color-picker-apply')) {
      e.stopPropagation();
      const preview = customColorPicker.querySelector('.color-preview');
      const color = rgbToHex(preview.style.backgroundColor);
      onColorSelect(color);
      onClose();
    }
  });
  
  // 외부 클릭 시 닫기
  setTimeout(() => {
    currentCloseHandler = function(e) {
      if (!customColorPicker.contains(e.target) && !triggerButton.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('click', currentCloseHandler);
  }, 10);
}

// 커스텀 색상 선택기 생성 및 표시 (재사용 가능한 함수)
function showCustomColorPicker(triggerButton) {
  // 기존 색상 선택기가 있으면 제거
  const existingPicker = document.querySelector('.custom-color-picker');
  if (existingPicker) {
    existingPicker.remove();
  }
  
  // 이전 closeHandler가 있으면 제거
  if (currentCloseHandler) {
    document.removeEventListener('click', currentCloseHandler);
    currentCloseHandler = null;
  }
  
  // 색상 피커 UI 생성
  const customColorPicker = createColorPickerUI();
  
  // 위치 설정 (only dynamic positioning)
  // triggerButton이 포함된 controls container를 찾아서 위치 설정
  const controlsContainer = triggerButton.closest('.text-highlighter-controls');
  const controlsRect = controlsContainer.getBoundingClientRect();
  customColorPicker.style.top = `${window.scrollY + controlsRect.bottom + 5}px`;
  customColorPicker.style.left = `${window.scrollX + controlsRect.left}px`;
  
  document.body.appendChild(customColorPicker);
  
  // HSV 슬라이더 초기화
  initHSVSliders(customColorPicker);
  
  // closeHandler 제거 및 피커 닫기 공통 함수
  const closeColorPicker = () => {
    customColorPicker.remove();
    colorPickerOpen = false;
    if (currentCloseHandler) {
      document.removeEventListener('click', currentCloseHandler);
      currentCloseHandler = null;
    }
  };

  // 이벤트 설정
  setupColorPickerEvents(customColorPicker, triggerButton, addCustomColor, closeColorPicker);
}

// 커스텀 색상 추가 함수
function addCustomColor(color) {
  lastAddedColor = color;
  browserAPI.runtime.sendMessage({ action: 'addColor', color: color }, (response) => {
    if (response && response.colors) {
      currentColors = response.colors;
      refreshHighlightControlsColors();
    }
  });
}

// HSV to RGB 변환 함수
function hsvToRgb(h, s, v) {
  h = h / 360;
  s = s / 100;
  v = v / 100;
  
  const c = v * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = v - c;
  
  let r, g, b;
  
  if (h >= 0 && h < 1/6) {
    r = c; g = x; b = 0;
  } else if (h >= 1/6 && h < 2/6) {
    r = x; g = c; b = 0;
  } else if (h >= 2/6 && h < 3/6) {
    r = 0; g = c; b = x;
  } else if (h >= 3/6 && h < 4/6) {
    r = 0; g = x; b = c;
  } else if (h >= 4/6 && h < 5/6) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

// HSV 슬라이더 초기화 (재사용 가능한 함수)
// RGB to Hex 변환 함수  
function rgbToHex(rgb) {
  if (rgb.startsWith('#')) return rgb;
  
  // HSL 형식 처리
  if (rgb.startsWith('hsl')) {
    return hslToHex(rgb);
  }
  
  const match = rgb.match(/\d+/g);
  if (!match) return '#FF6B6B';
  
  const r = parseInt(match[0]);
  const g = parseInt(match[1]);
  const b = parseInt(match[2]);
  
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// HSL to Hex 변환 함수
function hslToHex(hsl) {
  const match = hsl.match(/\d+/g);
  if (!match) return '#FF6B6B';
  
  const h = parseInt(match[0]) / 360;
  const s = parseInt(match[1]) / 100;
  const l = parseInt(match[2]) / 100;
  
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  
  let r, g, b;
  
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  const toHex = (c) => {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function initHSVSliders(picker) {
  // 요소들이 존재하는지 확인
  const hueSlider = picker.querySelector('#hueSlider');
  const hueHandle = picker.querySelector('#hueHandle');
  const svPicker = picker.querySelector('#svPicker');
  const svHandle = picker.querySelector('#svHandle');
  const colorPreview = picker.querySelector('#colorPreview');
  
  if (!hueSlider || !hueHandle || !svPicker || !svHandle || !colorPreview) {
    return; // 필요한 요소가 없으면 초기화하지 않음
  }
  
  let currentHue = 0;
  let currentSaturation = 100;
  let currentValue = 100;
  
  // Hue 슬라이더 이벤트
  let isDraggingHue = false;
  
  // 이벤트 핸들러 함수들을 미리 선언하여 removeEventListener에서 사용할 수 있도록 함
  const hueMouseMoveHandler = (e) => {
    if (isDraggingHue) {
      updateHue(e);
    }
  };
  
  const hueMouseUpHandler = () => {
    isDraggingHue = false;
    // 드래그 종료 시 이벤트 리스너 제거
    document.removeEventListener('mousemove', hueMouseMoveHandler);
    document.removeEventListener('mouseup', hueMouseUpHandler);
  };
  
  hueSlider.addEventListener('mousedown', (e) => {
    isDraggingHue = true;
    updateHue(e);
    // 드래그 시작 시에만 이벤트 리스너 추가
    document.addEventListener('mousemove', hueMouseMoveHandler);
    document.addEventListener('mouseup', hueMouseUpHandler);
  });
  
  function updateHue(e) {
    const rect = hueSlider.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const hue = (x / rect.width) * 360;
    
    currentHue = hue;
    hueHandle.style.left = `${x}px`;
    updateSVBackground();
    updateColorPreview();
  }
  
  // Saturation/Value 피커 이벤트
  let isDraggingSV = false;
  
  // SV 이벤트 핸들러 함수들도 미리 선언
  const svMouseMoveHandler = (e) => {
    if (isDraggingSV) {
      updateSV(e);
    }
  };
  
  const svMouseUpHandler = () => {
    isDraggingSV = false;
    // 드래그 종료 시 이벤트 리스너 제거
    document.removeEventListener('mousemove', svMouseMoveHandler);
    document.removeEventListener('mouseup', svMouseUpHandler);
  };
  
  svPicker.addEventListener('mousedown', (e) => {
    isDraggingSV = true;
    updateSV(e);
    // 드래그 시작 시에만 이벤트 리스너 추가
    document.addEventListener('mousemove', svMouseMoveHandler);
    document.addEventListener('mouseup', svMouseUpHandler);
  });
  
  function updateSV(e) {
    const rect = svPicker.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    
    // x축: 0 (왼쪽/낮은 채도) -> 100 (오른쪽/높은 채도)
    currentSaturation = (x / rect.width) * 100;
    // y축: 100 (위쪽/높은 명도) -> 0 (아래쪽/낮은 명도)
    currentValue = 100 - (y / rect.height) * 100;
    
    svHandle.style.left = `${x}px`;
    svHandle.style.top = `${y}px`;
    updateColorPreview();
  }
  
  function updateSVBackground() {
    svPicker.style.background = `
      linear-gradient(to bottom, transparent 0%, black 100%),
      linear-gradient(to right, white 0%, hsl(${currentHue}, 100%, 50%) 100%)`;
  }
  
  function updateColorPreview() {
    const rgb = hsvToRgb(currentHue, currentSaturation, currentValue);
    const color = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    colorPreview.style.backgroundColor = color;
  }
  
  // 초기 설정
  updateSVBackground();
  updateColorPreview();
  
  // 초기 핸들 위치 설정 (높은 채도, 높은 명도)
  setTimeout(() => {
    const svRect = svPicker.getBoundingClientRect();
    const initialX = svRect.width * 0.8;
    const initialY = svRect.height * 0.2;
    
    currentSaturation = 80;
    currentValue = 80;
    
    svHandle.style.left = `${initialX}px`;
    svHandle.style.top = `${initialY}px`;
    updateColorPreview();
  }, 10);
}

function appendColorSeparator(container) {
  const separator = document.createElement('div');
  separator.className = 'color-separator';
  container.appendChild(separator);
}

// -------- Helper: regenerate color buttons inside a container --------
function refreshHighlightControlsColors() {
  if (!highlightControlsContainer) return;
  const colorButtonsContainer = highlightControlsContainer.querySelector('.text-highlighter-color-buttons');
  if (!colorButtonsContainer) return;

  // Clear existing buttons
  colorButtonsContainer.innerHTML = '';


  // Re-create color buttons
  currentColors.forEach((colorInfo, idx) => {
    if (idx === 5 && currentColors.length > 5) {
      appendColorSeparator(colorButtonsContainer);
    }
    const colorButton = createColorButton(colorInfo);
    colorButtonsContainer.appendChild(colorButton);
  });

  // Recreate + button
  const addColorBtn = createAddColorButton();

  colorButtonsContainer.appendChild(addColorBtn);
}

// Display highlight controller UI
function showControlUi(highlightElement, e) {
  if (!highlightControlsContainer) createHighlightControls();

  activeHighlightElement = highlightElement;
  highlightControlsContainer.style.top = `${window.scrollY + e.clientY - 40}px`;
  highlightControlsContainer.style.left = `${window.scrollX + e.clientX - 40}px`;
  // pop 애니메이션이 항상 재생되도록 visible 클래스를 remove/add
  highlightControlsContainer.classList.remove('visible');
  void highlightControlsContainer.offsetWidth; // reflow로 강제 초기화
  setTimeout(() => {
    highlightControlsContainer.classList.add('visible');
  }, 10);
}

// Hide highlight controller UI
function hideHighlightControls() {
  if (highlightControlsContainer) {
    highlightControlsContainer.classList.remove('visible');
  }
  activeHighlightElement = null;
}

// ============ SELECTION CONTROLS FUNCTIONS ============

// Initialize selection controls feature
function initializeSelectionControls() {
  // Load selection controls setting from storage
  browserAPI.storage.local.get(['selectionControlsVisible'], (result) => {
    selectionControlsEnabled = result.selectionControlsVisible || false;
    debugLog('Selection controls enabled:', selectionControlsEnabled);
  });

  // Add mouseup event listener to detect text selection
  document.addEventListener('mouseup', handleSelectionMouseUp);
  document.addEventListener('selectionchange', handleSelectionChange);
}

// Handle mouse up event to detect text selection
function handleSelectionMouseUp(e) {
  if (!selectionControlsEnabled) return;
  
  // Check if the click was on an existing highlight or control
  if (e.target.classList.contains('text-highlighter-extension') || 
      e.target.closest('.text-highlighter-controls') ||
      e.target.closest('.text-highlighter-selection-controls') ||
      e.target.closest('.text-highlighter-selection-icon')) {
    return;
  }
  
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    if (selectedText && selectedText.length > 0 && selection.rangeCount > 0) {
      // Store a copy of the range to avoid issues with selection changes
      const range = selection.getRangeAt(0).cloneRange();
      currentSelection = {
        selection: selection,
        range: range,
        text: selectedText,
        mouseX: e.clientX,
        mouseY: e.clientY
      };
      showSelectionIcon(e.clientX, e.clientY);
    } else {
      hideSelectionIcon();
      hideSelectionControls();
    }
  }, 10);
}

// Handle selection change event
function handleSelectionChange() {
  if (!selectionControlsEnabled) return;
  
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  if (!selectedText || selectedText.length === 0) {
    hideSelectionIcon();
    hideSelectionControls();
    currentSelection = null;
  }
}

// Show selection icon near mouse position
function showSelectionIcon(mouseX, mouseY) {
  hideSelectionIcon(); // Remove any existing icon
  
  selectionIcon = document.createElement('div');
  selectionIcon.className = 'text-highlighter-selection-icon';
  selectionIcon.innerHTML = `<img src="${browserAPI.runtime.getURL('images/icon48.png')}" alt="Highlight" style="width: 19px; height: 19px;">`;
  selectionIcon.title = getMessage('highlightText');
  
  // Position the icon with viewport boundary checking
  const iconWidth = 19; // Width of the icon
  const iconHeight = 19; // Height of the icon
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Calculate horizontal position
  let leftPosition = window.scrollX + mouseX + 10;
  
  // Check if mouse is in the right 30% of the viewport (70% threshold)
  if (mouseX > viewportWidth * 0.7) {
    // Position to the left of mouse cursor instead
    leftPosition = window.scrollX + mouseX - iconWidth - 10;
    
    // If still beyond left edge, align to left edge with some padding
    if (leftPosition < window.scrollX + 10) {
      leftPosition = window.scrollX + 10;
    }
  }
  
  // Calculate vertical position
  let topPosition = window.scrollY + mouseY - 30;
  
  // Check if icon would go beyond top edge of viewport
  if (mouseY - 30 < 0) {
    // Position below mouse cursor instead
    topPosition = window.scrollY + mouseY + 10;
    
    // If still beyond bottom edge, align to bottom edge with some padding
    if (topPosition + iconHeight > window.scrollY + viewportHeight - 10) {
      topPosition = window.scrollY + viewportHeight - iconHeight - 10;
    }
  }
  
  selectionIcon.style.left = `${leftPosition}px`;
  selectionIcon.style.top = `${topPosition}px`;
  
  // Add click event to show controls
  selectionIcon.addEventListener('click', function(e) {
    e.stopPropagation();
    showSelectionControls(e.clientX, e.clientY);
  });
  
  document.body.appendChild(selectionIcon);
}

// Hide selection icon
function hideSelectionIcon() {
  if (selectionIcon) {
    selectionIcon.remove();
    selectionIcon = null;
  }
}

// Show selection controls (reusing existing controls.js UI without delete button)
function showSelectionControls(mouseX, mouseY) {
  if (!currentSelection) return;
  
  hideSelectionControls(); // Remove any existing controls
  
  // Create a modified version of the existing highlight controls
  if (!highlightControlsContainer) createHighlightControls();
  
  // Clone the existing controls container but modify it for selection mode
  selectionControlsContainer = highlightControlsContainer.cloneNode(true);
  selectionControlsContainer.className = 'text-highlighter-controls text-highlighter-selection-controls';
  
  // Remove the delete button from the cloned container
  const deleteButton = selectionControlsContainer.querySelector('.delete-highlight');
  if (deleteButton) {
    deleteButton.remove();
  }
  
  // Temporarily position off-screen to get dimensions
  selectionControlsContainer.style.left = '-9999px';
  selectionControlsContainer.style.top = '-9999px';
  selectionControlsContainer.style.visibility = 'hidden';
  document.body.appendChild(selectionControlsContainer);
  
  // Position the controls with viewport boundary checking
  const controlsRect = selectionControlsContainer.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Calculate horizontal position
  let leftPosition = window.scrollX + mouseX + 10;
  
  // Check if mouse is in the right 30% of the viewport (70% threshold)
  if (mouseX > viewportWidth * 0.7) {
    // Position to the left of mouse cursor instead
    leftPosition = window.scrollX + mouseX - controlsRect.width - 10;
    
    // If still beyond left edge, align to left edge with some padding
    if (leftPosition < window.scrollX + 10) {
      leftPosition = window.scrollX + 10;
    }
  }
  
  // Calculate vertical position
  let topPosition = window.scrollY + mouseY - 20;
  
  // Check if controls would go beyond bottom edge of viewport
  if (mouseY + controlsRect.height - 20 > viewportHeight) {
    // Position above mouse cursor instead
    topPosition = window.scrollY + mouseY - controlsRect.height - 10;
    
    // If still beyond top edge, align to top edge with some padding
    if (topPosition < window.scrollY + 10) {
      topPosition = window.scrollY + 10;
    }
  }
  
  // Set final position and make visible
  selectionControlsContainer.style.left = `${leftPosition}px`;
  selectionControlsContainer.style.top = `${topPosition}px`;
  selectionControlsContainer.style.visibility = 'visible';
  
  // Update event listeners for color buttons to create highlights instead of changing existing ones
  const colorButtons = selectionControlsContainer.querySelectorAll('.color-button');
  colorButtons.forEach((colorButton, idx) => {
    // Remove existing event listeners by cloning the node
    const newColorButton = colorButton.cloneNode(true);
    colorButton.parentNode.replaceChild(newColorButton, colorButton);
    
    // Add new event listener for creating highlights
    newColorButton.addEventListener('click', function(e) {
      e.stopPropagation();
      // Create highlight with selected color
      if (currentSelection && (currentSelection.range || currentSelection.selection)) {
        // Restore the selection using the stored range
        const selection = window.getSelection();
        selection.removeAllRanges();
        
        try {
          if (currentSelection.range) {
            selection.addRange(currentSelection.range);
          } else if (currentSelection.selection.getRangeAt) {
            selection.addRange(currentSelection.selection.getRangeAt(0));
          }
          
          // Get the color from the button's background color
          const colorInfo = currentColors[idx];
          if (colorInfo) {
            highlightSelectedText(colorInfo.color);
          }
          
          hideSelectionControls();
          hideSelectionIcon();
          currentSelection = null;
        } catch (error) {
          debugLog('Could not restore selection:', error);
          hideSelectionControls();
          hideSelectionIcon();
          currentSelection = null;
        }
      }
    });
  });
  
  // Remove the add color button from selection controls to prevent selection changes
  const addColorButton = selectionControlsContainer.querySelector('.add-color-button');
  if (addColorButton) {
    addColorButton.remove();
  }
  
  // Add click event to stop propagation
  selectionControlsContainer.addEventListener('click', function(e) {
    e.stopPropagation();
  });
  
  // Apply the visible animation
  selectionControlsContainer.classList.remove('visible');
  void selectionControlsContainer.offsetWidth; // reflow
  setTimeout(() => {
    selectionControlsContainer.classList.add('visible');
  }, 10);
  
  // Hide icon when controls are shown
  hideSelectionIcon();
}

// Hide selection controls
function hideSelectionControls() {
  if (selectionControlsContainer) {
    selectionControlsContainer.remove();
    selectionControlsContainer = null;
  }
}

// Set selection controls visibility
function setSelectionControlsVisibility(visible) {
  selectionControlsEnabled = visible;
  if (!selectionControlsEnabled) {
    hideSelectionIcon();
    hideSelectionControls();
  }
}


// Helper function to create highlight with selected color from color picker
function createHighlightWithColor(color) {
  if (currentSelection && (currentSelection.range || currentSelection.selection)) {
    // Restore the selection using the stored range
    const selection = window.getSelection();
    selection.removeAllRanges();
    
    try {
      if (currentSelection.range) {
        selection.addRange(currentSelection.range);
      } else if (currentSelection.selection.getRangeAt) {
        selection.addRange(currentSelection.selection.getRangeAt(0));
      }
      
      highlightSelectedText(color);
      hideSelectionControls();
      hideSelectionIcon();
      currentSelection = null;
    } catch (error) {
      debugLog('Could not restore selection:', error);
      hideSelectionControls();
      hideSelectionIcon();
      currentSelection = null;
    }
  }
}

// Global click event handler - only add once
let globalClickListenerAdded = false;

function addGlobalClickListener() {
  if (globalClickListenerAdded) return;
  
  document.addEventListener('click', function (e) {
    // Handle existing highlight controls
    if (highlightControlsContainer) {
      // While native color picker is open, keep the control UI visible
      if (colorPickerOpen) {
        return; 
      }

      const isClickOnHighlight = activeHighlightElement &&
        (activeHighlightElement.contains(e.target) || activeHighlightElement === e.target);
      const isClickOnControls = highlightControlsContainer.contains(e.target) ||
        highlightControlsContainer === e.target;

      if (!isClickOnHighlight && !isClickOnControls) {
        hideHighlightControls();
      }
    }

    // Handle selection controls
    if (!selectionControlsEnabled) return;
    
    if (selectionIcon && !selectionIcon.contains(e.target)) {
      hideSelectionIcon();
    }
    
    if (selectionControlsContainer && !selectionControlsContainer.contains(e.target)) {
      hideSelectionControls();
    }
  }, true); // Use capture phase to handle this before other handlers
  
  globalClickListenerAdded = true;
}

// Auto-initialize selection controls when the script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeSelectionControls();
    addGlobalClickListener();
  });
} else {
  // DOM is already ready
  initializeSelectionControls();
  addGlobalClickListener();
}
