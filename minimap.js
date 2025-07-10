const DEBUG_MODE = false;
const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

class MinimapManager {
  constructor() {
    this.container = null;
    this.markers = [];
    this.resizeObserver = null;
    this.throttleTimer = null;
    this.visible = true;
    // Map to store highlight timers for each highlight element
    this.highlightTimers = new Map();
    // Default minimap height (used when container is hidden)
    this.defaultMinimapHeight = 300;
  }

  // Initialize minimap
  init() {
    if (this.container) return;

    this.createContainer();
    this.setupObservers();
  }

  // Create minimap container
  createContainer() {
    this.container = document.createElement('div');
    this.container.className = 'text-highlighter-minimap';
    this.container.style.pointerEvents = 'none';
    document.body.appendChild(this.container);
  }

  // Set up observers
  setupObservers() {
    // Detect page size changes with ResizeObserver
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.throttle(() => {
        this.updateMarkers();
      }, 100));
      this.resizeObserver.observe(document.body);
    }

    // Scroll event listener
    window.addEventListener('scroll', this.throttle(() => {
      this.updateMarkerVisibility();
    }, 100));

    // Window resize event listener
    window.addEventListener('resize', this.throttle(() => {
      this.updateMarkers();
    }, 200));
  }

  // Update minimap markers
  updateMarkers() {
    if (!this.container) return;
    this.clearMarkers();
    // 그룹별로 대표 span만 마커로 표시
    const highlightElements = document.querySelectorAll('.text-highlighter-extension');
    if (highlightElements.length === 0) {
      this.container.style.display = 'none';
      return;
    }
    this.updateVisibility();
    const documentHeight = this.getDocumentHeight();
    let minimapHeight = this.container.clientHeight;
    if (minimapHeight === 0 && this.visible) {
      const originalDisplay = this.container.style.display;
      const originalVisibility = this.container.style.visibility;
      this.container.style.display = 'flex';
      this.container.style.visibility = 'hidden';
      this.container.style.pointerEvents = 'none';
      minimapHeight = this.container.clientHeight;
      this.container.style.display = originalDisplay;
      this.container.style.visibility = originalVisibility;
    }
    if (minimapHeight === 0) {
      minimapHeight = this.defaultMinimapHeight;
    }
    // groupId별로 대표 span만 마커로 표시
    const groupMap = new Map();
    highlightElements.forEach(element => {
      const groupId = element.dataset.groupId;
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, element);
      }
    });
    groupMap.forEach(element => {
      this.createMarker(element, documentHeight, minimapHeight);
    });
    this.updateMarkerVisibility();
  }

  // Remove existing markers
  clearMarkers() {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.markers = [];
  }

  // Create individual marker
  createMarker(highlightElement, documentHeight, minimapHeight) {
    const rect = highlightElement.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const absoluteTop = rect.top + scrollTop;

    // Calculate position ratio
    const relativePosition = absoluteTop / documentHeight;
    const markerPosition = relativePosition * minimapHeight;

    // Create marker element
    const marker = document.createElement('div');
    marker.className = 'text-highlighter-minimap-marker';
    marker.style.backgroundColor = highlightElement.style.backgroundColor;
    marker.style.top = `${markerPosition}px`;
    marker.dataset.highlightId = highlightElement.dataset.highlightId;

    // Marker click event
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

  // Calculate document height
  getDocumentHeight() {
    return Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
  }

  // Update marker visibility (indicate highlights currently visible on screen)
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

      // Check if visible on current screen
      const isVisible = (
        (highlightAbsoluteTop >= visibleRange.top && highlightAbsoluteTop <= visibleRange.bottom) ||
        (highlightAbsoluteBottom >= visibleRange.top && highlightAbsoluteBottom <= visibleRange.bottom) ||
        (highlightAbsoluteTop <= visibleRange.top && highlightAbsoluteBottom >= visibleRange.bottom)
      );

      // Add border effect to markers for highlights visible on screen
      if (isVisible) {
        marker.element.classList.add('visible');
      } else {
        marker.element.classList.remove('visible');
      }
    });
  }

  // Scroll to highlight
  scrollToHighlight(highlightElement) {
    if (!highlightElement) return;

    const rect = highlightElement.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const absoluteTop = rect.top + scrollTop;

    // Adjust scroll position (to position slightly above)
    const scrollToPosition = absoluteTop - 100;

    // Smooth scroll
    window.scrollTo({
      top: scrollToPosition,
      behavior: 'smooth'
    });
  }

  // Temporary emphasis effect for highlight
  highlightTemporarily(highlightElement) {
    if (!highlightElement) return;

    const elementKey = highlightElement;

    if (this.highlightTimers.has(elementKey)) {
      clearTimeout(this.highlightTimers.get(elementKey));
      this.highlightTimers.delete(elementKey);
    }

    const isAlreadyHighlighted = highlightElement.hasAttribute('data-highlighted');

    if (!isAlreadyHighlighted) {
      const originalStyles = {
        boxShadow: highlightElement.style.boxShadow,
        transition: highlightElement.style.transition,
        zIndex: highlightElement.style.zIndex
      };

      highlightElement.dataset.originalBoxShadow = originalStyles.boxShadow;
      highlightElement.dataset.originalTransition = originalStyles.transition;
      highlightElement.dataset.originalZIndex = originalStyles.zIndex;

      highlightElement.setAttribute('data-highlighted', 'true');
    }

    highlightElement.style.boxShadow = '0 0 0 3px rgba(255, 255, 255, 0.7), 0 0 0 6px rgba(0, 0, 0, 0.3)';
    highlightElement.style.transition = 'box-shadow 0.3s';
    highlightElement.style.zIndex = '10000'; // Display above other elements

    const timerId = setTimeout(() => {
      if (highlightElement.hasAttribute('data-highlighted')) {
        highlightElement.style.boxShadow = highlightElement.dataset.originalBoxShadow || '';
        highlightElement.style.transition = highlightElement.dataset.originalTransition || '';
        highlightElement.style.zIndex = highlightElement.dataset.originalZIndex || '';

        highlightElement.removeAttribute('data-highlighted');
        delete highlightElement.dataset.originalBoxShadow;
        delete highlightElement.dataset.originalTransition;
        delete highlightElement.dataset.originalZIndex;
      }

      this.highlightTimers.delete(elementKey);
    }, 1500);

    this.highlightTimers.set(elementKey, timerId);
  }

  // Set minimap visibility
  setVisibility(visible) {
    this.visible = visible;
    this.updateVisibility();
    
    // Update marker positions when visibility changes
    if (visible) {
      // Short delay to update markers (time needed for DOM to update)
      setTimeout(() => this.updateMarkers(), 50);
    }
  }

  // Update minimap visibility
  updateVisibility() {
    if (!this.container) return;

    // Only show minimap when highlights exist
    const highlightElements = document.querySelectorAll('.text-highlighter-extension');
    const hasHighlights = highlightElements.length > 0;

    if (hasHighlights && this.visible) {
      this.container.style.display = 'flex';
      this.container.style.pointerEvents = 'auto';
    } else {
      this.container.style.display = 'none';
    }
  }

  // Throttling helper function (performance optimization)
  throttle(callback, delay) {
    return (...args) => {
      if (this.throttleTimer) return;

      this.throttleTimer = setTimeout(() => {
        callback.apply(this, args);
        this.throttleTimer = null;
      }, delay);
    };
  }

  // Clean up resources
  destroy() {
    this.highlightTimers.forEach(timerId => {
      clearTimeout(timerId);
    });
    this.highlightTimers.clear();

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

    // Clean up remaining highlight effects
    const highlightedElements = document.querySelectorAll('[data-highlighted="true"]');
    highlightedElements.forEach(element => {
      element.style.boxShadow = element.dataset.originalBoxShadow || '';
      element.style.transition = element.dataset.originalTransition || '';
      element.style.zIndex = element.dataset.originalZIndex || '';
      element.removeAttribute('data-highlighted');
      delete element.dataset.originalBoxShadow;
      delete element.dataset.originalTransition;
      delete element.dataset.originalZIndex;
    });
  }
}
