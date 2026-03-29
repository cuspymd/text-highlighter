(() => {
  const SOURCE = 'text-highlighter-navigation-bridge';
  const notifyLocationChange = (trigger) => {
    window.postMessage({
      source: SOURCE,
      type: 'location-changed',
      href: window.location.href,
      trigger,
    }, window.location.origin);
  };

  const patchHistoryMethod = (methodName) => {
    const originalMethod = window.history[methodName];
    if (typeof originalMethod !== 'function') return;

    window.history[methodName] = function (...args) {
      const result = originalMethod.apply(this, args);
      notifyLocationChange(`history.${methodName}`);
      return result;
    };
  };

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', () => notifyLocationChange('popstate'));
  window.addEventListener('hashchange', () => notifyLocationChange('hashchange'));
})();
