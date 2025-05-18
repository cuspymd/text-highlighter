class MinimapManager {
  constructor() {
    this.container = null;
    this.markers = [];
    this.resizeObserver = null;
    this.throttleTimer = null;
    this.visible = true;
  }

  // 미니맵 초기화
  init() {
    if (this.container) return;

    this.createContainer();
    this.setupObservers();
  }

  // 미니맵 컨테이너 생성
  createContainer() {
    this.container = document.createElement('div');
    this.container.className = 'text-highlighter-minimap';
    this.container.style.pointerEvents = 'none';
    document.body.appendChild(this.container);
  }

  // 옵저버들 설정
  setupObservers() {
    // ResizeObserver로 페이지 크기 변경 감지
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.throttle(() => {
        this.updateMarkers();
      }, 100));
      this.resizeObserver.observe(document.body);
    }

    // 스크롤 이벤트 리스너
    window.addEventListener('scroll', this.throttle(() => {
      this.updateMarkerVisibility();
    }, 100));

    // 창 크기 변경 이벤트 리스너
    window.addEventListener('resize', this.throttle(() => {
      this.updateMarkers();
    }, 200));
  }

  // 미니맵 마커 업데이트
  updateMarkers() {
    if (!this.container) return;

    this.clearMarkers();

    const highlightElements = document.querySelectorAll('.text-highlighter-extension');

    if (highlightElements.length === 0) {
      this.container.style.display = 'none';
      return;
    }

    this.updateVisibility();

    const documentHeight = this.getDocumentHeight();
    const minimapHeight = this.container.clientHeight;

    highlightElements.forEach(element => {
      this.createMarker(element, documentHeight, minimapHeight);
    });

    this.updateMarkerVisibility();
  }

  // 기존 마커들 제거
  clearMarkers() {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.markers = [];
  }

  // 개별 마커 생성
  createMarker(highlightElement, documentHeight, minimapHeight) {
    const rect = highlightElement.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const absoluteTop = rect.top + scrollTop;

    // 위치 비율 계산
    const relativePosition = absoluteTop / documentHeight;
    const markerPosition = relativePosition * minimapHeight;

    // 마커 요소 생성
    const marker = document.createElement('div');
    marker.className = 'text-highlighter-minimap-marker';
    marker.style.backgroundColor = highlightElement.style.backgroundColor;
    marker.style.top = `${markerPosition}px`;
    marker.dataset.highlightId = highlightElement.dataset.highlightId;

    // 마커 클릭 이벤트
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      this.scrollToHighlight(highlightElement);
      this.highlightTemporarily(highlightElement);
    });

    this.container.appendChild(marker);
    this.markers.push({
      element: marker,
      highlightElement: highlightElement,
      position: absoluteTop
    });
  }

  // 문서 높이 계산
  getDocumentHeight() {
    return Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
  }

  // 마커 가시성 업데이트 (현재 화면에 보이는 하이라이트 표시)
  updateMarkerVisibility() {
    if (!this.container || this.markers.length === 0) return;

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const visibleRange = {
      top: scrollTop,
      bottom: scrollTop + windowHeight
    };

    this.markers.forEach(marker => {
      const highlightRect = marker.highlightElement.getBoundingClientRect();
      const highlightAbsoluteTop = highlightRect.top + scrollTop;
      const highlightAbsoluteBottom = highlightRect.bottom + scrollTop;

      // 현재 화면에 보이는지 확인
      const isVisible = (
        (highlightAbsoluteTop >= visibleRange.top && highlightAbsoluteTop <= visibleRange.bottom) ||
        (highlightAbsoluteBottom >= visibleRange.top && highlightAbsoluteBottom <= visibleRange.bottom) ||
        (highlightAbsoluteTop <= visibleRange.top && highlightAbsoluteBottom >= visibleRange.bottom)
      );

      // 현재 화면에 보이는 하이라이트는 마커에 테두리 효과
      if (isVisible) {
        marker.element.classList.add('visible');
      } else {
        marker.element.classList.remove('visible');
      }
    });
  }

  // 하이라이트로 스크롤
  scrollToHighlight(highlightElement) {
    if (!highlightElement) return;

    const rect = highlightElement.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const absoluteTop = rect.top + scrollTop;

    // 스크롤 위치 조정 (약간 위에 위치하도록)
    const scrollToPosition = absoluteTop - 100;

    // 부드러운 스크롤
    window.scrollTo({
      top: scrollToPosition,
      behavior: 'smooth'
    });
  }

  // 하이라이트 일시적 강조 효과
  highlightTemporarily(highlightElement) {
    if (!highlightElement) return;

    // 원래 스타일 저장
    const originalBoxShadow = highlightElement.style.boxShadow;
    const originalTransition = highlightElement.style.transition;

    // 강조 스타일 적용
    highlightElement.style.boxShadow = '0 0 0 3px rgba(255, 255, 255, 0.7), 0 0 0 6px rgba(0, 0, 0, 0.3)';
    highlightElement.style.transition = 'box-shadow 0.3s';

    // 일정 시간 후 원래 스타일로 복원
    setTimeout(() => {
      highlightElement.style.boxShadow = originalBoxShadow;
      highlightElement.style.transition = originalTransition;
    }, 1500);
  }

  // 미니맵 가시성 설정
  setVisibility(visible) {
    this.visible = visible;
    this.updateVisibility();
  }

  // 미니맵 가시성 업데이트
  updateVisibility() {
    if (!this.container) return;

    // 하이라이트가 있을 때만 미니맵 표시
    const highlightElements = document.querySelectorAll('.text-highlighter-extension');
    const hasHighlights = highlightElements.length > 0;

    if (hasHighlights && this.visible) {
      this.container.style.display = 'flex';
      this.container.style.pointerEvents = 'auto';
    } else {
      this.container.style.display = 'none';
    }
  }

  // 쓰로틀링 헬퍼 함수 (성능 최적화)
  throttle(callback, delay) {
    return (...args) => {
      if (this.throttleTimer) return;

      this.throttleTimer = setTimeout(() => {
        callback.apply(this, args);
        this.throttleTimer = null;
      }, delay);
    };
  }

  // 리소스 정리
  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }

    this.markers = [];

    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }
}

// 전역으로 내보내기
window.MinimapManager = MinimapManager;
