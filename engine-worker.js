var Module = {
  noInitialRun: true,
  locateFile: function(path) {
    return path === "ai.wasm" ? "ai.wasm" : path;
  },
  print: function(text) {
    self.postMessage({ type: "log", level: "info", text: String(text) });
  },
  printErr: function(text) {
    self.postMessage({ type: "log", level: "error", text: String(text) });
  },
  onRuntimeInitialized: function() {
    initializeEngine();
  }
};

self.Module = Module;

var engineReady = false;

function heapOffset(pointer) {
  return pointer >> 2;
}

function initializeEngine() {
  try {
    var progressPointer = Module._malloc(4);
    var result = Module._init_ai(progressPointer);
    var progress = Module.HEAP32[heapOffset(progressPointer)];
    Module._free(progressPointer);

    if (result !== 0) {
      throw new Error("Egaroucid init returned " + result);
    }

    engineReady = true;
    self.postMessage({ type: "ready", progress: progress });
  } catch (error) {
    self.postMessage({ type: "error", message: error && error.message ? error.message : String(error) });
  }
}

function writeBoard(board) {
  var pointer = Module._malloc(64 * 4);
  Module.HEAP32.set(board, heapOffset(pointer));
  return pointer;
}

function decodeMove(encoded) {
  var row = Math.floor(encoded / 1000 / 8);
  var col = Math.floor((encoded - row * 1000 * 8) / 1000);
  var value = encoded - row * 1000 * 8 - col * 1000 - 100;
  return {
    row: row,
    col: col,
    index: row * 8 + col,
    value: value,
    encoded: encoded
  };
}

function searchBestMove(request) {
  var pointer = writeBoard(request.board);
  var startedAt = performance.now();
  var encoded = Module._ai_js(pointer, request.level, request.player);
  var elapsedMs = Math.round(performance.now() - startedAt);
  Module._free(pointer);
  var decoded = decodeMove(encoded);
  self.postMessage({
    type: "bestMove",
    id: request.id,
    result: decoded,
    elapsedMs: elapsedMs
  });
}

function calculateValues(request) {
  var boardPointer = writeBoard(request.board);
  var valuesPointer = Module._malloc(74 * 4);
  var startedAt = performance.now();
  Module._calc_value(boardPointer, valuesPointer, request.level, request.valuePerspective);
  var values = Array.prototype.slice.call(
    Module.HEAP32.subarray(heapOffset(valuesPointer), heapOffset(valuesPointer) + 74)
  );
  var elapsedMs = Math.round(performance.now() - startedAt);
  Module._free(boardPointer);
  Module._free(valuesPointer);
  self.postMessage({
    type: "values",
    id: request.id,
    values: values.slice(10, 74),
    elapsedMs: elapsedMs
  });
}

self.onmessage = function(event) {
  var request = event.data || {};

  if (request.type === "ping") {
    self.postMessage({ type: engineReady ? "ready" : "loading" });
    return;
  }

  if (!engineReady) {
    self.postMessage({ type: "busy", id: request.id, message: "Engine is not ready yet." });
    return;
  }

  try {
    if (request.type === "bestMove") {
      searchBestMove(request);
    } else if (request.type === "values") {
      calculateValues(request);
    } else if (request.type === "stop") {
      Module._stop();
      self.postMessage({ type: "stopped", id: request.id });
    } else if (request.type === "resume") {
      Module._resume();
      self.postMessage({ type: "resumed", id: request.id });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: request.id,
      message: error && error.message ? error.message : String(error)
    });
  }
};

importScripts("ai.js");
