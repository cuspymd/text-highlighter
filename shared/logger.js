export const DEBUG_MODE = false;
export const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};
export const errorLog = DEBUG_MODE ? console.error.bind(console) : () => {};
