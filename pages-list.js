document.addEventListener('DOMContentLoaded', function () {
  const pagesContainer = document.getElementById('pages-container');
  const noPages = document.getElementById('no-pages');

  // 디버그 모드 설정 - 개발 시 true로 변경
  const DEBUG_MODE = false;

  // 디버그용 로그 함수
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log(...args);
    }
  }

  // 다국어 지원을 위한 메시지 가져오기 함수
  function getMessage(key, defaultValue = '') {
    if (typeof chrome !== 'undefined' && chrome.i18n) {
      return chrome.i18n.getMessage(key) || defaultValue;
    }
    return defaultValue;
  }

  // HTML 요소의 텍스트를 다국어로 변경
  function localizeStaticElements() {
    const elementsToLocalize = document.querySelectorAll('[data-i18n]');
    elementsToLocalize.forEach(element => {
      const key = element.getAttribute('data-i18n');
      element.textContent = getMessage(key, element.textContent);
    });
  }

  // 모든 하이라이트된 페이지 데이터 불러오기
  function loadAllHighlightedPages() {
    chrome.storage.local.get(null, (result) => {
      const pages = [];

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

      // 최신 업데이트 순으로 페이지 정렬
      pages.sort((a, b) => {
        // lastUpdated가 없는 경우 가장 오래된 것으로 취급
        if (!a.lastUpdated) return 1;
        if (!b.lastUpdated) return -1;

        // 내림차순 정렬 (최신 날짜가 먼저 오도록)
        return new Date(b.lastUpdated) - new Date(a.lastUpdated);
      });

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
        let pageTitle = page.title || getMessage('noTitle', '(No title)');
        if (!pageTitle || pageTitle === '' || pageTitle === getMessage('noTitle', '(No title)')) {
          try {
            const urlObj = new URL(page.url);
            pageTitle = urlObj.hostname + urlObj.pathname;
          } catch (e) {
            pageTitle = page.url;
          }
        }

        // 마지막 업데이트 날짜 형식화
        let lastUpdated = getMessage('unknown', 'Unknown');
        if (page.lastUpdated) {
          try {
            const date = new Date(page.lastUpdated);
            // 현재 언어에 따라 날짜 형식 결정
            const locale = chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : 'en';
            lastUpdated = date.toLocaleString(locale);
          } catch (e) {
            lastUpdated = page.lastUpdated;
          }
        }

        const pageContent = `
          <div class="page-info-container">
            <div class="page-title">${pageTitle}</div>
            <div class="page-url">${page.url}</div>
            <div class="page-info">${getMessage('highlightCount', 'Highlights')}: ${page.highlightCount} | ${getMessage('lastUpdated', 'Last Updated')}: ${lastUpdated}</div>
          </div>
          <div class="page-actions">
            <button class="btn btn-details">${getMessage('showDetails', 'Show Details')}</button>
            <button class="btn btn-view">${getMessage('openPage', 'Open Page')}</button>
            <button class="btn btn-delete">${getMessage('deletePage', 'Delete')}</button>
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
            this.textContent = getMessage('showDetails', 'Show Details');
          } else {
            // 하이라이트 데이터 표시
            highlightsContainer.innerHTML = '';
            highlightsContainer.style.display = 'block';
            this.textContent = getMessage('hideDetails', 'Hide');

            page.highlights.sort((a, b) => (a.position || 0) - (b.position || 0));

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
          const confirmMessage = getMessage('confirmDeletePage', 'Delete all highlights for this page?');
          if (confirm(confirmMessage)) {
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
  localizeStaticElements();  // 정적 요소들 다국어 처리
  loadAllHighlightedPages();
});
