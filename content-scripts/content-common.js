const DEBUG_MODE = false;

var debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};
