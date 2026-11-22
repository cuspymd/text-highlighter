import { jest } from '@jest/globals';
import fs from 'fs';

// The minimap throttles three listeners: the body ResizeObserver, scroll and
// window resize. They used to share one timer, so whichever fired first
// swallowed the others until it ran, and a resize right after a scroll never
// moved the markers.
function loadMinimapManager() {
  const source = fs.readFileSync(new URL('../content-scripts/minimap.js', import.meta.url), 'utf8');
  return window.eval(`${source}\n;MinimapManager`);
}

describe('MinimapManager.throttle', () => {
  let manager;

  beforeEach(() => {
    jest.useFakeTimers();
    const MinimapManager = loadMinimapManager();
    manager = new MinimapManager();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs each throttled function even when another one is waiting', () => {
    const onScroll = jest.fn();
    const onResize = jest.fn();
    const scroll = manager.throttle(onScroll, 100);
    const resize = manager.throttle(onResize, 200);

    scroll();
    resize();
    jest.advanceTimersByTime(200);

    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst into one call at the end of the window', () => {
    const callback = jest.fn();
    const throttled = manager.throttle(callback, 100);

    throttled();
    throttled();
    throttled();
    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('runs again for a call after the window has closed', () => {
    const callback = jest.fn();
    const throttled = manager.throttle(callback, 100);

    throttled();
    jest.advanceTimersByTime(100);
    throttled();
    jest.advanceTimersByTime(100);

    expect(callback).toHaveBeenCalledTimes(2);
  });
});
