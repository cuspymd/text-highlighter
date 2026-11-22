export const DEBUG_MODE = false;
export const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};
// Failures stay visible in release builds, in the background's own console, so
// a sync that keeps failing leaves a trace. console.warn rather than
// console.error: Chrome lists errors on chrome://extensions as the extension's
// fault, and the common failures here - storage.sync's write-rate limit, a
// network that is down - are not bugs.
export const errorLog = DEBUG_MODE ? console.error.bind(console) : console.warn.bind(console);
