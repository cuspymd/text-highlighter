const DEBUG_MODE = false;

var debugLog = (
  typeof window !== 'undefined' && typeof window.TextHighlighterDebugLog === 'function'
)
  ? window.TextHighlighterDebugLog
  : (DEBUG_MODE ? console.log.bind(console) : () => {});

if (typeof window !== 'undefined' && !window.TextHighlighterDebugLog) {
  window.TextHighlighterDebugLog = debugLog;
}
