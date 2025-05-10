document.addEventListener('DOMContentLoaded', function () {
  const highlightsContainer = document.getElementById('highlights-container');
  const noHighlights = document.getElementById('no-highlights');
  const clearAllBtn = document.getElementById('clear-all');
  const exportDataBtn = document.getElementById('export-data');

  // 디버그 모드 설정 - 개발 시 true로 변경
  const DEBUG_MODE = false;

  // 디버그용 로그 함수
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log(...args);
    }
  }

  // 현재 활성화된 탭에서 하이라이트 정보 불러오기
  function loadHighlights() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs[0].url;

      chrome.storage.local.get([currentUrl], (result) => {
        const highlights = result[currentUrl] || [];
        debugLog('Loaded highlights for popup:', highlights);

        // 하이라이트 목록 표시
        if (highlights.length > 0) {
          noHighlights.style.display = 'none';
          highlightsContainer.innerHTML = '';

          highlights.forEach(highlight => {
            const highlightItem = document.createElement('div');
            highlightItem.className = 'highlight-item';
            highlightItem.style.backgroundColor = highlight.color;
            highlightItem.dataset.id = highlight.id;

            // 텍스트가 너무 길면 자르기
            let displayText = highlight.text;
            if (displayText.length > 50) {
              displayText = displayText.substring(0, 47) + '...';
            }

            highlightItem.textContent = displayText;

            // 삭제 버튼 추가
            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              deleteHighlight(highlight.id, currentUrl);
            });

            highlightItem.appendChild(deleteBtn);
            highlightsContainer.appendChild(highlightItem);
          });
        } else {
          noHighlights.style.display = 'block';
          highlightsContainer.innerHTML = '';
          highlightsContainer.appendChild(noHighlights);
        }
      });
    });
  }

  // 하이라이트 삭제
  function deleteHighlight(id, url) {
    chrome.storage.local.get([url], (result) => {
      const highlights = result[url] || [];
      const updatedHighlights = highlights.filter(h => h.id !== id);

      const saveData = {};
      saveData[url] = updatedHighlights;

      chrome.storage.local.set(saveData, () => {
        debugLog('Highlight deleted:', id);
        // 현재 페이지의 하이라이트 업데이트
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'refreshHighlights',
            highlights: updatedHighlights
          });
        });

        loadHighlights();
      });
    });
  }

  // 모든 하이라이트 삭제
  clearAllBtn.addEventListener('click', function () {
    if (confirm('정말 현재 페이지의 모든 하이라이트를 삭제하시겠습니까?')) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0].url;

        const saveData = {};
        saveData[currentUrl] = [];

        chrome.storage.local.set(saveData, () => {
          debugLog('All highlights cleared');
          // 현재 페이지의 하이라이트 업데이트
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'refreshHighlights',
            highlights: []
          });

          loadHighlights();
        });
      });
    }
  });

  // 하이라이트 데이터 내보내기
  exportDataBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs[0].url;

      chrome.storage.local.get([currentUrl], (result) => {
        const highlights = result[currentUrl] || [];

        // 내보낼 데이터 생성
        const exportData = {
          url: currentUrl,
          title: tabs[0].title,
          date: new Date().toISOString(),
          highlights: highlights
        };

        debugLog('Exporting highlights data:', exportData);

        // 파일로 다운로드
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'highlights-' + new Date().getTime() + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    });
  });

  // 초기화
  loadHighlights();
});
