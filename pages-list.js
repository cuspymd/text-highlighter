document.addEventListener('DOMContentLoaded', function () {
  const pagesContainer = document.getElementById('pages-container');
  const noPages = document.getElementById('no-pages');
  const backBtn = document.getElementById('back-btn');

  // 디버그 모드 설정 - 개발 시 true로 변경
  const DEBUG_MODE = false;

  // 디버그용 로그 함수
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log(...args);
    }
  }

  // 백버튼 처리
  backBtn.addEventListener('click', function () {
    window.close();
  });

  // 모든 하이라이트된 페이지 데이터 불러오기
  function loadAllHighlightedPages() {
    chrome.storage.local.get(null, (result) => {
      const pages = [];
      const metaDataPromises = [];

      // storage에서 URL을 키로 가진 항목들만 필터링 (메타데이터는 제외)
      for (const key in result) {
        if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith('_meta')) {
          const url = key;
          const metaKey = `${url}_meta`;
          const metadata = result[metaKey] || {};

          pages.push({
            url: url,
            highlights: result[url],
            highlightCount: result[url].length,
            title: metadata.title || '',
            lastUpdated: metadata.lastUpdated || ''
          });
        }
      }

      debugLog('Loaded all highlighted pages:', pages);

      // 페이지 리스트 표시
      displayPages(pages);
    });
  }

  // 페이지 목록 표시
  function displayPages(pages) {
    if (pages.length > 0) {
      noPages.style.display = 'none';
      pagesContainer.innerHTML = '';

      pages.forEach(page => {
        const pageItem = document.createElement('div');
        pageItem.className = 'page-item';
        pageItem.dataset.url = page.url;

        // 저장된 제목 사용 또는 URL에서 제목 추출 시도
        let pageTitle = page.title || '(제목 없음)';
        if (!pageTitle || pageTitle === '') {
          try {
            const urlObj = new URL(page.url);
            pageTitle = urlObj.hostname + urlObj.pathname;
          } catch (e) {
            pageTitle = page.url;
          }
        }

        // 마지막 업데이트 날짜 형식화
        let lastUpdated = '알 수 없음';
        if (page.lastUpdated) {
          try {
            const date = new Date(page.lastUpdated);
            lastUpdated = date.toLocaleString('ko-KR');
          } catch (e) {
            lastUpdated = page.lastUpdated;
          }
        }

        const pageContent = `
          <div class="page-info-container">
            <div class="page-title">${pageTitle}</div>
            <div class="page-url">${page.url}</div>
            <div class="page-info">하이라이트 수: ${page.highlightCount} | 마지막 업데이트: ${lastUpdated}</div>
          </div>
          <div class="page-actions">
            <button class="btn btn-details">상세 보기</button>
            <button class="btn btn-view">페이지 열기</button>
            <button class="btn btn-delete">삭제</button>
          </div>
          <div class="page-highlights"></div>
        `;

        pageItem.innerHTML = pageContent;
        pagesContainer.appendChild(pageItem);

        // 페이지 상세 보기 버튼 이벤트
        pageItem.querySelector('.btn-details').addEventListener('click', function () {
          const highlightsContainer = pageItem.querySelector('.page-highlights');

          if (highlightsContainer.style.display === 'block') {
            highlightsContainer.style.display = 'none';
            this.textContent = '상세 보기';
          } else {
            // 하이라이트 데이터 표시
            highlightsContainer.innerHTML = '';
            highlightsContainer.style.display = 'block';
            this.textContent = '접기';

            page.highlights.forEach(highlight => {
              const highlightItem = document.createElement('div');
              highlightItem.className = 'highlight-item';
              highlightItem.style.backgroundColor = highlight.color;

              // 텍스트가 너무 길면 자르기
              let displayText = highlight.text;
              if (displayText.length > 100) {
                displayText = displayText.substring(0, 97) + '...';
              }

              highlightItem.innerHTML = `<span class="highlight-text">${displayText}</span>`;
              highlightsContainer.appendChild(highlightItem);
            });
          }
        });

        // 페이지 열기 버튼 이벤트
        pageItem.querySelector('.btn-view').addEventListener('click', function () {
          chrome.tabs.create({ url: page.url });
        });

        // 페이지 삭제 버튼 이벤트
        pageItem.querySelector('.btn-delete').addEventListener('click', function () {
          if (confirm('이 페이지의 모든 하이라이트를 삭제하시겠습니까?')) {
            deletePageHighlights(page.url);
          }
        });
      });
    } else {
      noPages.style.display = 'block';
      pagesContainer.innerHTML = '';
      pagesContainer.appendChild(noPages);
    }
  }

  // 페이지의 모든 하이라이트 삭제
  function deletePageHighlights(url) {
    // 하이라이트 데이터와 메타데이터 모두 삭제
    chrome.storage.local.remove([url, `${url}_meta`], () => {
      debugLog('Deleted highlights and metadata for page:', url);
      loadAllHighlightedPages();
    });
  }

  // 초기화
  loadAllHighlightedPages();
});
