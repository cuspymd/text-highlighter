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
    colorButtonsContainer.appendChild(colorButton);
  });
  highlightControlsContainer.appendChild(deleteButton);
  highlightControlsContainer.appendChild(colorButtonsContainer);
  highlightControlsContainer.addEventListener('click', function (e) {
    e.stopPropagation();
  });
  // color 버튼들만 젤리 애니메이션 적용
  colorButtonsContainer.querySelectorAll('.text-highlighter-control-button').forEach(addJellyAnimation);

  // -------------- '+' button (add new color) --------------
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="8" y1="3" x2="8" y2="13" stroke="#999" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="8" x2="13" y2="8" stroke="#999" stroke-width="2" stroke-linecap="round"/></svg>`;
  addColorBtn.title = getMessage('addColor') || '+';

  // --- manage color picker open/close state ---
  let customColorPicker = null;
  
  // 모든 브라우저에서 add 버튼에 직접 이벤트 연결
  addColorBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    colorPickerOpen = true;
    showCustomColorPicker();
  });
  
  function showCustomColorPicker() {
    // 기존 색상 선택기가 있으면 제거
    if (customColorPicker) {
      customColorPicker.remove();
    }
    
    // 커스텀 색상 선택기 생성
    customColorPicker = document.createElement('div');
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
        <div class="saturation-lightness-picker" id="slPicker">
          <div class="sl-handle" id="slHandle"></div>
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
    
    // 이벤트 리스너 추가
    customColorPicker.addEventListener('click', (e) => {
      if (e.target.classList.contains('color-preset')) {
        const color = e.target.dataset.color;
        addCustomColor(color);
        hideCustomColorPicker();
      } else if (e.target.classList.contains('color-picker-close')) {
        hideCustomColorPicker();
      } else if (e.target.id === 'applyColor') {
        const preview = customColorPicker.querySelector('#colorPreview');
        const color = rgbToHex(preview.style.backgroundColor);
        addCustomColor(color);
        hideCustomColorPicker();
      }
    });
    
    // 커스텀 색상 선택기 초기화
    initHSLSliders(customColorPicker);
    
    // 외부 클릭 시 닫기
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 10);
    
    function handleOutsideClick(e) {
      if (customColorPicker && !customColorPicker.contains(e.target) && !addColorBtn.contains(e.target)) {
        hideCustomColorPicker();
        document.removeEventListener('click', handleOutsideClick);
      }
    }
  }
  
  function hideCustomColorPicker() {
    if (customColorPicker) {
      customColorPicker.remove();
      customColorPicker = null;
    }
  }
  
  function addCustomColor(color) {
    lastAddedColor = color;
    browserAPI.runtime.sendMessage({ action: 'addColor', color: color }, (response) => {
      if (response && response.colors) {
        currentColors = response.colors;
        refreshHighlightControlsColors();
      }
    });
  }
  
  
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


  colorButtonsContainer.appendChild(addColorBtn);
  document.body.appendChild(highlightControlsContainer);
}

// HSL 슬라이더 초기화 (재사용 가능한 함수)
function initHSLSliders(picker) {
  // 요소들이 존재하는지 확인
  const hueSlider = picker.querySelector('[id^="hueSlider"]');
  const hueHandle = picker.querySelector('[id^="hueHandle"]');
  const slPicker = picker.querySelector('[id^="slPicker"]');
  const slHandle = picker.querySelector('[id^="slHandle"]');
  const colorPreview = picker.querySelector('[id^="colorPreview"]');
  
  if (!hueSlider || !hueHandle || !slPicker || !slHandle || !colorPreview) {
    return; // 필요한 요소가 없으면 초기화하지 않음
  }
  
  let currentHue = 0;
  let currentSaturation = 100;
  let currentLightness = 50;
  
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
    updateSLBackground();
    updateColorPreview();
  }
  
  // Saturation/Lightness 피커 이벤트
  let isDraggingSL = false;
  
  slPicker.addEventListener('mousedown', (e) => {
    isDraggingSL = true;
    updateSL(e);
  });
  
  document.addEventListener('mousemove', (e) => {
    if (isDraggingSL) {
      updateSL(e);
    }
  });
  
  document.addEventListener('mouseup', () => {
    isDraggingSL = false;
  });
  
  function updateSL(e) {
    const rect = slPicker.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    
    currentSaturation = (x / rect.width) * 100;
    currentLightness = 100 - (y / rect.height) * 100;
    
    slHandle.style.left = `${x}px`;
    slHandle.style.top = `${y}px`;
    updateColorPreview();
  }
  
  function updateSLBackground() {
    slPicker.style.background = `linear-gradient(to bottom, 
      hsl(${currentHue}, 100%, 50%) 0%, 
      hsl(${currentHue}, 100%, 50%) 50%, 
      hsl(${currentHue}, 0%, 50%) 100%),
      linear-gradient(to right, 
      hsl(${currentHue}, 0%, 100%) 0%, 
      hsl(${currentHue}, 100%, 50%) 100%)`;
  }
  
  function updateColorPreview() {
    const color = `hsl(${currentHue}, ${currentSaturation}%, ${currentLightness}%)`;
    colorPreview.style.backgroundColor = color;
  }
  
  // 초기 설정
  updateSLBackground();
  updateColorPreview();
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
    
    colorButtonsContainer.appendChild(colorButton);
  });

  // Recreate + button
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="8" y1="3" x2="8" y2="13" stroke="#999" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="8" x2="13" y2="8" stroke="#999" stroke-width="2" stroke-linecap="round"/></svg>`;
  addColorBtn.title = getMessage('addColor') || '+';

  // 커스텀 색상 선택기 이벤트 추가 (인라인으로 처리)
  addColorBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 기존 색상 선택기가 있으면 제거
    const existingPicker = document.querySelector('.custom-color-picker');
    if (existingPicker) {
      existingPicker.remove();
    }
    
    // 완전한 커스텀 색상 선택기 생성
    const simpleColorPicker = document.createElement('div');
    simpleColorPicker.className = 'custom-color-picker';
    simpleColorPicker.innerHTML = `
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
          <div class="hue-slider" id="hueSlider2">
            <div class="hue-handle" id="hueHandle2"></div>
          </div>
        </div>
        <div class="saturation-lightness-picker" id="slPicker2">
          <div class="sl-handle" id="slHandle2"></div>
        </div>
        <div class="color-preview" id="colorPreview2" style="background-color: #FF6B6B;"></div>
      </div>
      <div class="color-picker-buttons">
        <button class="color-picker-apply" id="applyColor2">적용</button>
        <button class="color-picker-close">취소</button>
      </div>
    `;
    
    // 위치 설정
    const controlsRect = highlightControlsContainer.getBoundingClientRect();
    simpleColorPicker.style.position = 'fixed';
    simpleColorPicker.style.top = `${controlsRect.bottom + 5}px`;
    simpleColorPicker.style.left = `${controlsRect.left}px`;
    simpleColorPicker.style.zIndex = '10000';
    
    document.body.appendChild(simpleColorPicker);
    
    // HSL 슬라이더 초기화
    initHSLSliders(simpleColorPicker);
    
    // 색상 선택 이벤트
    simpleColorPicker.addEventListener('click', (e) => {
      if (e.target.classList.contains('color-preset')) {
        const color = e.target.dataset.color;
        lastAddedColor = color;
        browserAPI.runtime.sendMessage({ action: 'addColor', color: color }, (response) => {
          if (response && response.colors) {
            currentColors = response.colors;
            refreshHighlightControlsColors();
          }
        });
        simpleColorPicker.remove();
      } else if (e.target.classList.contains('color-picker-close')) {
        simpleColorPicker.remove();
      } else if (e.target.id === 'applyColor2') {
        const preview = simpleColorPicker.querySelector('#colorPreview2');
        const color = hslToHex(preview.style.backgroundColor);
        lastAddedColor = color;
        browserAPI.runtime.sendMessage({ action: 'addColor', color: color }, (response) => {
          if (response && response.colors) {
            currentColors = response.colors;
            refreshHighlightControlsColors();
          }
        });
        simpleColorPicker.remove();
      }
    });
    
    // 외부 클릭 시 닫기
    setTimeout(() => {
      document.addEventListener('click', function closeHandler(e) {
        if (!simpleColorPicker.contains(e.target) && !addColorBtn.contains(e.target)) {
          simpleColorPicker.remove();
          document.removeEventListener('click', closeHandler);
        }
      });
    }, 10);
  });

  colorButtonsContainer.appendChild(addColorBtn);
}

// Display highlight controller UI
function showControlUi(highlightElement, e) {
  if (!highlightControlsContainer) createHighlightControls();

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
