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
  highlightControlsContainer.style.display = 'none';
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
    colorPickerOpen = true;
    showCustomColorPicker(addColorBtn);
  });
  
  return addColorBtn;
}

// 현재 활성화된 closeHandler를 추적하기 위한 변수
let currentCloseHandler = null;

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
  
  // 커스텀 색상 선택기 생성
  const customColorPicker = document.createElement('div');
  customColorPicker.className = 'custom-color-picker';
  customColorPicker.innerHTML = `
    <div class="color-picker-header">색상 선택</div>
    <div class="color-preset-grid">
      <div class="color-preset" style="background-color: #FF6B6B" data-color="#FF6B6B"></div>
      <div class="color-preset" style="background-color: #4ECDC4" data-color="#4ECDC4"></div>
      <div class="color-preset" style="background-color: #45B7D1" data-color="#45B7D1"></div>
      <div class="color-preset" style="background-color: #96CEB4" data-color="#96CEB4"></div>
      <div class="color-preset" style="background-color: #FFEAA7" data-color="#FFEAA7"></div>
      <div class="color-preset" style="background-color: #DDA0DD" data-color="#DDA0DD"></div>
      <div class="color-preset" style="background-color: #98D8C8" data-color="#98D8C8"></div>
      <div class="color-preset" style="background-color: #F7DC6F" data-color="#F7DC6F"></div>
      <div class="color-preset" style="background-color: #BB8FCE" data-color="#BB8FCE"></div>
      <div class="color-preset" style="background-color: #85C1E9" data-color="#85C1E9"></div>
      <div class="color-preset" style="background-color: #F39C12" data-color="#F39C12"></div>
      <div class="color-preset" style="background-color: #E74C3C" data-color="#E74C3C"></div>
      <div class="color-preset" style="background-color: #9B59B6" data-color="#9B59B6"></div>
      <div class="color-preset" style="background-color: #3498DB" data-color="#3498DB"></div>
      <div class="color-preset" style="background-color: #1ABC9C" data-color="#1ABC9C"></div>
      <div class="color-preset" style="background-color: #2ECC71" data-color="#2ECC71"></div>
      <div class="color-preset" style="background-color: #F1C40F" data-color="#F1C40F"></div>
      <div class="color-preset" style="background-color: #E67E22" data-color="#E67E22"></div>
      <div class="color-preset" style="background-color: #95A5A6" data-color="#95A5A6"></div>
      <div class="color-preset" style="background-color: #34495E" data-color="#34495E"></div>
    </div>
    <div class="custom-color-section">
      <div class="hue-slider-container">
        <div class="hue-slider" id="hueSlider">
          <div class="hue-handle" id="hueHandle"></div>
        </div>
      </div>
      <div class="saturation-value-picker" id="svPicker">
        <div class="sv-handle" id="svHandle"></div>
      </div>
      <div class="color-preview" id="colorPreview" style="background-color: #FF6B6B;"></div>
    </div>
    <div class="color-picker-buttons">
      <button class="color-picker-apply" id="applyColor">적용</button>
      <button class="color-picker-close">취소</button>
    </div>
  `;
  
  // 위치 설정
  const controlsRect = highlightControlsContainer.getBoundingClientRect();
  customColorPicker.style.position = 'fixed';
  customColorPicker.style.top = `${controlsRect.bottom + 5}px`;
  customColorPicker.style.left = `${controlsRect.left}px`;
  customColorPicker.style.zIndex = '10000';
  
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

  // 색상 선택 이벤트
  customColorPicker.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-preset')) {
      e.stopPropagation();
      const color = e.target.dataset.color;
      addCustomColor(color);
      closeColorPicker();
    } else if (e.target.classList.contains('color-picker-close')) {
      e.stopPropagation();
      closeColorPicker();
    } else if (e.target.id === 'applyColor') {
      e.stopPropagation();
      const preview = customColorPicker.querySelector('#colorPreview');
      const color = rgbToHex(preview.style.backgroundColor);
      addCustomColor(color);
      closeColorPicker();
    }
  });
  
  // 외부 클릭 시 닫기
  setTimeout(() => {
    currentCloseHandler = function(e) {
      if (!customColorPicker.contains(e.target) && !triggerButton.contains(e.target)) {
        closeColorPicker();
      }
    };
    document.addEventListener('click', currentCloseHandler);
  }, 10);
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
  const hueSlider = picker.querySelector('[id^="hueSlider"]');
  const hueHandle = picker.querySelector('[id^="hueHandle"]');
  const svPicker = picker.querySelector('[id^="svPicker"]');
  const svHandle = picker.querySelector('[id^="svHandle"]');
  const colorPreview = picker.querySelector('[id^="colorPreview"]');
  
  if (!hueSlider || !hueHandle || !svPicker || !svHandle || !colorPreview) {
    return; // 필요한 요소가 없으면 초기화하지 않음
  }
  
  let currentHue = 0;
  let currentSaturation = 100;
  let currentValue = 100;
  
  // Hue 슬라이더 이벤트
  let isDraggingHue = false;
  
  hueSlider.addEventListener('mousedown', (e) => {
    isDraggingHue = true;
    updateHue(e);
  });
  
  document.addEventListener('mousemove', (e) => {
    if (isDraggingHue) {
      updateHue(e);
    }
  });
  
  document.addEventListener('mouseup', () => {
    isDraggingHue = false;
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
  
  svPicker.addEventListener('mousedown', (e) => {
    isDraggingSV = true;
    updateSV(e);
  });
  
  document.addEventListener('mousemove', (e) => {
    if (isDraggingSV) {
      updateSV(e);
    }
  });
  
  document.addEventListener('mouseup', () => {
    isDraggingSV = false;
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
  separator.style.width = '1px';
  separator.style.height = '22px'; 
  separator.style.backgroundColor = '#ccc'; 
  separator.style.margin = '0 3px';
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
  highlightControlsContainer.style.display = 'flex';
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
    // 트랜지션이 끝난 뒤 display를 none으로 변경
    setTimeout(() => {
      if (!highlightControlsContainer.classList.contains('visible')) {
        highlightControlsContainer.style.display = 'none';
      }
    }, 350); // CSS 트랜지션과 동일하게 맞춤
  }
  activeHighlightElement = null;
}
