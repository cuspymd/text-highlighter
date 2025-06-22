// Highlight controller UI container
let highlightControlsContainer = null;
let activeHighlightElement = null;
// Flag to know when the native <input type="color"> picker is open
let colorPickerOpen = false;

// Create highlight controller UI
function createHighlightControls() {
  if (highlightControlsContainer) return;
  highlightControlsContainer = document.createElement('div');
  highlightControlsContainer.className = 'text-highlighter-controls';
  highlightControlsContainer.style.display = 'none';
  const deleteButton = document.createElement('div');
  deleteButton.className = 'text-highlighter-control-button delete-highlight';
  deleteButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="4" y1="4" x2="12" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
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
  // --- 젤리 애니메이션 효과: 클릭 시 트리거 ---
  const addJellyAnimation = (btn) => {
    btn.addEventListener('click', function () {
      btn.classList.remove('jelly-animate'); // 중복 방지
      // 강제로 reflow를 발생시켜 애니메이션 재적용
      void btn.offsetWidth;
      btn.classList.add('jelly-animate');
    });
    btn.addEventListener('animationend', function (e) {
      if (e.animationName === 'jelly-bounce') {
        btn.classList.remove('jelly-animate');
      }
    });
  };
  // color 버튼들만 젤리 애니메이션 적용
  colorButtonsContainer.querySelectorAll('.text-highlighter-control-button').forEach(addJellyAnimation);

  // -------------- '+' button (add new color) --------------
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.textContent = '+';
  addColorBtn.title = getMessage('addColor') || '+';
  addColorBtn.style.display = 'flex';
  addColorBtn.style.alignItems = 'center';
  addColorBtn.style.justifyContent = 'center';

  const hiddenColorInput = document.createElement('input');
  hiddenColorInput.type = 'color';
  hiddenColorInput.style.opacity = '0';
  hiddenColorInput.style.cursor = 'pointer';
  hiddenColorInput.style.position = 'absolute';
  hiddenColorInput.style.top = '0';
  hiddenColorInput.style.left = '0';
  hiddenColorInput.style.width = '100%';
  hiddenColorInput.style.height = '100%';

  // --- manage color picker open/close state ---
  hiddenColorInput.addEventListener('click', () => {
    colorPickerOpen = true;
  });

  // change 이벤트에서 실제 색상 추가 처리
  hiddenColorInput.addEventListener('change', (e) => {
    const newColor = e.target.value;
    if (!newColor) return;
    chrome.runtime.sendMessage({ action: 'addColor', color: newColor }, (response) => {
      if (response && response.colors) {
        currentColors = response.colors;
        refreshHighlightControlsColors();
      }
    });
  });

  // addColorBtn 내부에 input을 넣어 오버레이되도록 함
  addColorBtn.style.position = 'relative';
  addColorBtn.appendChild(hiddenColorInput);

  colorButtonsContainer.appendChild(addColorBtn);
  document.body.appendChild(highlightControlsContainer);
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

  // Helper to add jelly animation
  const addJellyAnimation = (btn) => {
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
  };

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
    colorButtonsContainer.appendChild(colorButton);
  });

  // Recreate + button
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.textContent = '+';
  addColorBtn.title = getMessage('addColor') || '+';
  addColorBtn.style.display = 'flex';
  addColorBtn.style.alignItems = 'center';
  addColorBtn.style.justifyContent = 'center';
  addColorBtn.style.position = 'relative';

  const hiddenColorInput = document.createElement('input');
  hiddenColorInput.type = 'color';
  hiddenColorInput.style.opacity = '0';
  hiddenColorInput.style.cursor = 'pointer';
  hiddenColorInput.style.position = 'absolute';
  hiddenColorInput.style.top = '0';
  hiddenColorInput.style.left = '0';
  hiddenColorInput.style.width = '100%';
  hiddenColorInput.style.height = '100%';

  // reuse existing picker logic
  hiddenColorInput.addEventListener('click', () => { colorPickerOpen = true; });
  hiddenColorInput.addEventListener('change', (e) => {
    const newColor = e.target.value;
    if (!newColor) return;
    chrome.runtime.sendMessage({ action: 'addColor', color: newColor });
  });

  addColorBtn.appendChild(hiddenColorInput);
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
