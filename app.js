(function() {
  "use strict";

  var EMPTY = -1;
  var BLACK = 0;
  var WHITE = 1;
  var SIZE = 8;
  var STORAGE_KEY = "egaroucid-othello-web-state-v1";
  var DIRECTIONS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ];

  var elements = {};
  var worker = null;
  var requestId = 0;
  var engineReady = false;
  var engineError = "";
  var pendingKind = "";
  var autoAiPaused = false;
  var audioContext = null;
  var aiThinkTimer = null;
  var aiThinkStartedAt = 0;

  var state = {
    board: createInitialBoard(),
    currentPlayer: BLACK,
    humanPlayer: BLACK,
    aiPlayer: WHITE,
    firstMover: "human",
    level: 7,
    gameStarted: false,
    gameOver: false,
    lastMove: null,
    lastMoves: [],
    moveLog: [],
    history: [],
    values: null,
    engineValue: null,
    status: "Bấm \"Ván mới\" để bắt đầu."
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    buildBoard();
    attachEvents();
    startWorker();
    loadSavedState();
    render();
  }

  function bindElements() {
    elements.board = document.getElementById("board");
    elements.engineState = document.getElementById("engineState");
    elements.engineText = document.getElementById("engineText");
    elements.blackScore = document.getElementById("blackScore");
    elements.whiteScore = document.getElementById("whiteScore");
    elements.turnBox = document.getElementById("turnBox");
    elements.newGameBtn = document.getElementById("newGameBtn");
    elements.undoBtn = document.getElementById("undoBtn");
    elements.analyzeBtn = document.getElementById("analyzeBtn");
    elements.resumeAiBtn = document.getElementById("resumeAiBtn");
    elements.copyBtn = document.getElementById("copyBtn");
    elements.levelRange = document.getElementById("levelRange");
    elements.levelText = document.getElementById("levelText");
    elements.showLegal = document.getElementById("showLegal");
    elements.showHints = document.getElementById("showHints");
    elements.soundToggle = document.getElementById("soundToggle");
    elements.autoSaveToggle = document.getElementById("autoSaveToggle");
    elements.plyCount = document.getElementById("plyCount");
    elements.legalCount = document.getElementById("legalCount");
    elements.lastMove = document.getElementById("lastMove");
    elements.engineValue = document.getElementById("engineValue");
    elements.statusLine = document.getElementById("statusLine");
    elements.moveList = document.getElementById("moveList");
    elements.clearSavedBtn = document.getElementById("clearSavedBtn");
    elements.humanSideInputs = Array.prototype.slice.call(document.querySelectorAll("input[name='humanSide']"));
    elements.firstMoverInputs = Array.prototype.slice.call(document.querySelectorAll("input[name='firstMover']"));
    elements.setupPreview = document.getElementById("setupPreview");
  }

  function attachEvents() {
    elements.newGameBtn.addEventListener("click", newGame);
    elements.undoBtn.addEventListener("click", undoOneMove);
    elements.analyzeBtn.addEventListener("click", requestAnalysis);
    elements.resumeAiBtn.addEventListener("click", resumeAiAfterUndo);
    elements.copyBtn.addEventListener("click", copyTranscript);
    elements.clearSavedBtn.addEventListener("click", clearSavedGame);

    elements.humanSideInputs.forEach(function(input) {
      input.addEventListener("change", updateSetupPreview);
    });
    elements.firstMoverInputs.forEach(function(input) {
      input.addEventListener("change", updateSetupPreview);
    });

    elements.levelRange.addEventListener("input", function(event) {
      state.level = Number(event.target.value);
      elements.levelText.textContent = "Level " + state.level;
      saveIfNeeded();
    });

    elements.showLegal.addEventListener("change", render);
    elements.showHints.addEventListener("change", function() {
      if (elements.showHints.checked && state.gameStarted && !state.gameOver) {
        requestAnalysis();
      } else {
        state.values = null;
        render();
      }
    });

    elements.autoSaveToggle.addEventListener("change", function() {
      if (elements.autoSaveToggle.checked) {
        saveIfNeeded();
      }
    });
  }

  function buildBoard() {
    var template = document.getElementById("cellTemplate");
    elements.board.innerHTML = "";
    for (var index = 0; index < 64; index += 1) {
      var row = Math.floor(index / SIZE);
      var col = index % SIZE;
      var cell = template.content.firstElementChild.cloneNode(true);
      cell.dataset.index = String(index);
      cell.setAttribute("aria-label", coord(index));
      cell.addEventListener("click", function(event) {
        handleCellClick(Number(event.currentTarget.dataset.index));
      });
      cell.style.gridColumn = String(col + 1);
      cell.style.gridRow = String(row + 1);
      elements.board.appendChild(cell);
    }
  }

  function startWorker() {
    engineReady = false;
    engineError = "";
    updateEngineState("Đang nạp engine...");

    if (worker) {
      worker.terminate();
    }

    worker = new Worker("engine-worker.js");
    worker.onmessage = handleWorkerMessage;
    worker.onerror = function(event) {
      engineReady = false;
      engineError = event.message || "Không nạp được engine.";
      pendingKind = "";
      stopAiThinkTimer();
      updateEngineState("Lỗi engine", true);
      state.status = engineError;
      render();
    };
  }

  function restartWorkerAfterCancel() {
    pendingKind = "";
    stopAiThinkTimer();
    startWorker();
  }

  function startAiThinkTimer() {
    stopAiThinkTimer();
    aiThinkStartedAt = Date.now();
    aiThinkTimer = setInterval(render, 1000);
  }

  function stopAiThinkTimer() {
    if (aiThinkTimer) {
      clearInterval(aiThinkTimer);
      aiThinkTimer = null;
    }
    aiThinkStartedAt = 0;
  }

  function handleWorkerMessage(event) {
    var message = event.data || {};

    if (message.type === "ready") {
      engineReady = true;
      pendingKind = "";
      stopAiThinkTimer();
      updateEngineState("Engine sẵn sàng");
      render();
      maybeQueueAi();
      if (elements.showHints.checked && state.gameStarted && state.currentPlayer === state.humanPlayer) {
        requestAnalysis();
      }
      return;
    }

    if (message.type === "bestMove") {
      if (message.id !== requestId || pendingKind !== "bestMove") {
        return;
      }
      pendingKind = "";
      stopAiThinkTimer();
      handleAiMove(message.result, message.elapsedMs);
      return;
    }

    if (message.type === "values") {
      if (message.id !== requestId || pendingKind !== "values") {
        return;
      }
      pendingKind = "";
      if (elements.showHints.checked) {
        state.values = message.values;
        state.status = "Đã phân tích xong trong " + formatTime(message.elapsedMs) + ".";
      } else {
        state.values = null;
      }
      render();
      saveIfNeeded();
      return;
    }

    if (message.type === "error") {
      pendingKind = "";
      stopAiThinkTimer();
      engineError = message.message || "Engine bị lỗi.";
      updateEngineState("Lỗi engine", true);
      state.status = engineError;
      render();
    }
  }

  function updateEngineState(text, isError) {
    elements.engineText.textContent = text;
    elements.engineState.classList.toggle("engine-ready", engineReady && !isError);
    elements.engineState.classList.toggle("engine-error", Boolean(isError));
  }

  function newGame() {
    var sideInput = document.querySelector("input[name='humanSide']:checked");
    var humanPlayer = sideInput ? Number(sideInput.value) : BLACK;
    var firstInput = document.querySelector("input[name='firstMover']:checked");
    var firstMover = firstInput ? firstInput.value : "human";
    var aiPlayer = 1 - humanPlayer;
    var startingPlayer = firstMover === "ai" ? aiPlayer : humanPlayer;

    if (pendingKind) {
      requestId += 1;
      restartWorkerAfterCancel();
    }

    state = {
      board: createInitialBoard(),
      currentPlayer: startingPlayer,
      humanPlayer: humanPlayer,
      aiPlayer: aiPlayer,
      firstMover: firstMover,
      level: Number(elements.levelRange.value),
      gameStarted: true,
      gameOver: false,
      lastMove: null,
      lastMoves: [],
      moveLog: [],
      history: [],
      values: null,
      engineValue: null,
      status: buildStartStatus(humanPlayer, firstMover)
    };
    autoAiPaused = false;
    playTone(420, 0.05);
    render();
    saveIfNeeded();
    maybeQueueAi();
    if (elements.showHints.checked && state.currentPlayer === state.humanPlayer) {
      requestAnalysis();
    }
  }

  function buildStartStatus(humanPlayer, firstMover) {
    var mine = sideName(humanPlayer).toLowerCase();
    var aiColor = sideName(1 - humanPlayer);
    if (firstMover === "human") {
      return "Bạn cầm " + mine + " và đi trước.";
    }
    return "Bạn cầm " + mine + ". AI (" + aiColor + ") đi nước đầu.";
  }

  function createInitialBoard() {
    var board = new Array(64);
    for (var i = 0; i < board.length; i += 1) {
      board[i] = EMPTY;
    }
    board[3 * SIZE + 3] = WHITE;
    board[3 * SIZE + 4] = BLACK;
    board[4 * SIZE + 3] = BLACK;
    board[4 * SIZE + 4] = WHITE;
    return board;
  }

  function handleCellClick(index) {
    if (!state.gameStarted || state.gameOver || pendingKind === "bestMove") {
      return;
    }
    if (state.currentPlayer !== state.humanPlayer) {
      state.status = "Đang là lượt AI. Bấm \"Cho AI đi\" nếu bạn vừa lùi nước.";
      render();
      return;
    }
    tryHumanMove(index);
  }

  function tryHumanMove(index) {
    var flips = getFlips(state.board, state.currentPlayer, index);
    if (!flips.length) {
      state.status = "Ô " + coord(index) + " không hợp lệ.";
      render();
      return;
    }
    applyMoveWithHistory(index, flips, "human");
    playTone(520, 0.045);
    afterMove();
  }

  function handleAiMove(result, elapsedMs) {
    if (!state.gameStarted || state.gameOver || state.currentPlayer !== state.aiPlayer) {
      render();
      return;
    }

    var index = result && Number.isInteger(result.index) ? result.index : -1;
    var flips = index >= 0 && index < 64 ? getFlips(state.board, state.currentPlayer, index) : [];
    if (!flips.length) {
      var legal = getLegalMoves(state.board, state.currentPlayer);
      if (legal.length) {
        index = legal[0].index;
        flips = legal[0].flips;
        state.status = "Engine trả về nước không hợp lệ, app dùng nước hợp lệ đầu tiên.";
      } else {
        passTurn("ai");
        afterMove();
        return;
      }
    }

    state.engineValue = typeof result.value === "number" ? result.value : null;
    applyMoveWithHistory(index, flips, "ai", elapsedMs);
    playTone(320, 0.045);
    afterMove();
  }

  function applyMoveWithHistory(index, flips, actor, elapsedMs) {
    pushHistory();
    var player = state.currentPlayer;
    state.board[index] = player;
    for (var i = 0; i < flips.length; i += 1) {
      state.board[flips[i]] = player;
    }
    state.lastMove = { index: index, player: player, actor: actor };
    if (state.lastMoves.length && state.lastMoves[0].player === player) {
      state.lastMoves = [state.lastMove].concat(state.lastMoves);
    } else {
      state.lastMoves = [state.lastMove];
    }
    state.moveLog.push({
      type: "move",
      index: index,
      player: player,
      actor: actor,
      value: state.engineValue,
      elapsedMs: elapsedMs || 0
    });
    state.values = null;
    state.currentPlayer = 1 - state.currentPlayer;
  }

  function afterMove() {
    normalizeTurn();
    render();
    saveIfNeeded();
    maybeQueueAi();
    if (elements.showHints.checked && state.gameStarted && !state.gameOver && state.currentPlayer === state.humanPlayer) {
      requestAnalysis();
    }
  }

  function normalizeTurn() {
    if (state.gameOver) {
      return;
    }

    var legal = getLegalMoves(state.board, state.currentPlayer);
    if (legal.length) {
      state.status = state.currentPlayer === state.humanPlayer ? "Đến lượt bạn." : "AI đang cân nhắc.";
      return;
    }

    var waitingPlayer = state.currentPlayer;
    var otherPlayer = 1 - waitingPlayer;
    var otherLegal = getLegalMoves(state.board, otherPlayer);
    if (otherLegal.length) {
      pushHistory();
      state.moveLog.push({ type: "pass", player: waitingPlayer });
      state.currentPlayer = otherPlayer;
      state.values = null;
      state.status = sideName(waitingPlayer) + " không có nước, tự động pass.";
      return;
    }

    state.gameOver = true;
    state.status = resultText();
  }

  function passTurn(actor) {
    pushHistory();
    state.moveLog.push({ type: "pass", player: state.currentPlayer, actor: actor || "system" });
    state.currentPlayer = 1 - state.currentPlayer;
    state.values = null;
  }

  function maybeQueueAi() {
    if (!state.gameStarted || state.gameOver || !engineReady || pendingKind) {
      return;
    }
    if (state.currentPlayer !== state.aiPlayer || autoAiPaused) {
      return;
    }
    var legal = getLegalMoves(state.board, state.currentPlayer);
    if (!legal.length) {
      normalizeTurn();
      render();
      return;
    }
    requestId += 1;
    pendingKind = "bestMove";
    startAiThinkTimer();
    state.status = "AI đang tính level " + state.level + "...";
    render();
    worker.postMessage({
      type: "bestMove",
      id: requestId,
      board: state.board.slice(),
      level: state.level,
      player: state.currentPlayer
    });
  }

  function requestAnalysis() {
    if (!state.gameStarted || state.gameOver || !engineReady || pendingKind) {
      render();
      return;
    }
    var legal = getLegalMoves(state.board, state.currentPlayer);
    if (!legal.length) {
      return;
    }
    requestId += 1;
    pendingKind = "values";
    var hintLevel = Math.max(0, Math.min(7, state.level - 1));
    state.status = "Đang phân tích các nước hợp lệ...";
    render();
    worker.postMessage({
      type: "values",
      id: requestId,
      board: state.board.slice(),
      level: hintLevel,
      valuePerspective: 1 - state.currentPlayer
    });
  }

  function resumeAiAfterUndo() {
    autoAiPaused = false;
    state.status = "Cho AI đi lại từ vị trí hiện tại.";
    render();
    maybeQueueAi();
  }

  function undoOneMove() {
    if (!state.history.length) {
      return;
    }
    if (pendingKind) {
      requestId += 1;
      restartWorkerAfterCancel();
    }
    var snapshot = state.history.pop();
    state.board = snapshot.board;
    state.currentPlayer = snapshot.currentPlayer;
    state.humanPlayer = snapshot.humanPlayer;
    state.aiPlayer = snapshot.aiPlayer;
    state.firstMover = snapshot.firstMover;
    state.level = snapshot.level;
    state.gameStarted = snapshot.gameStarted;
    state.gameOver = snapshot.gameOver;
    state.lastMove = snapshot.lastMove;
    state.lastMoves = snapshot.lastMoves;
    if (!Array.isArray(state.lastMoves)) {
      state.lastMoves = state.lastMove ? [state.lastMove] : [];
    }
    if (state.firstMover !== "human" && state.firstMover !== "ai") {
      state.firstMover = "human";
    }
    state.moveLog = snapshot.moveLog;
    state.values = null;
    state.engineValue = snapshot.engineValue;
    state.status = "Đã lùi đúng 1 nước.";
    autoAiPaused = state.gameStarted && !state.gameOver && state.currentPlayer === state.aiPlayer;
    playTone(260, 0.04);
    render();
    saveIfNeeded();
  }

  function pushHistory() {
    state.history.push({
      board: state.board.slice(),
      currentPlayer: state.currentPlayer,
      humanPlayer: state.humanPlayer,
      aiPlayer: state.aiPlayer,
      firstMover: state.firstMover,
      level: state.level,
      gameStarted: state.gameStarted,
      gameOver: state.gameOver,
      lastMove: state.lastMove ? Object.assign({}, state.lastMove) : null,
      lastMoves: state.lastMoves.map(function(move) { return Object.assign({}, move); }),
      moveLog: state.moveLog.map(function(move) { return Object.assign({}, move); }),
      engineValue: state.engineValue,
      status: state.status
    });
  }

  function getLegalMoves(board, player) {
    var moves = [];
    for (var i = 0; i < 64; i += 1) {
      var flips = getFlips(board, player, i);
      if (flips.length) {
        moves.push({ index: i, flips: flips });
      }
    }
    return moves;
  }

  function getFlips(board, player, index) {
    if (board[index] !== EMPTY) {
      return [];
    }
    var row = Math.floor(index / SIZE);
    var col = index % SIZE;
    var opponent = 1 - player;
    var flips = [];

    for (var d = 0; d < DIRECTIONS.length; d += 1) {
      var dir = DIRECTIONS[d];
      var r = row + dir[0];
      var c = col + dir[1];
      var line = [];

      while (inside(r, c) && board[r * SIZE + c] === opponent) {
        line.push(r * SIZE + c);
        r += dir[0];
        c += dir[1];
      }

      if (line.length && inside(r, c) && board[r * SIZE + c] === player) {
        flips = flips.concat(line);
      }
    }

    return flips;
  }

  function inside(row, col) {
    return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
  }

  function render() {
    var counts = countDiscs(state.board);
    var legalMoves = state.gameStarted && !state.gameOver ? getLegalMoves(state.board, state.currentPlayer) : [];
    var legalSet = {};
    for (var i = 0; i < legalMoves.length; i += 1) {
      legalSet[legalMoves[i].index] = true;
    }
    var streakSet = {};
    for (var s = 1; s < state.lastMoves.length; s += 1) {
      streakSet[state.lastMoves[s].index] = true;
    }

    elements.blackScore.textContent = String(counts.black);
    elements.whiteScore.textContent = String(counts.white);
    elements.levelText.textContent = "Level " + state.level;
    elements.levelRange.value = String(state.level);
    elements.plyCount.textContent = String(state.moveLog.filter(function(move) { return move.type === "move"; }).length);
    elements.legalCount.textContent = String(legalMoves.length);
    elements.lastMove.textContent = state.lastMove ? coord(state.lastMove.index) : "-";
    elements.engineValue.textContent = state.engineValue === null || state.engineValue === undefined ? "-" : signed(state.engineValue);
    elements.statusLine.textContent = state.status;
    elements.turnBox.textContent = turnText(counts);

    var cells = Array.prototype.slice.call(elements.board.children);
    for (var index = 0; index < cells.length; index += 1) {
      var cell = cells[index];
      var value = state.board[index];
      var hint = cell.querySelector(".hint-value");
      cell.className = "cell";
      cell.disabled = true;
      cell.setAttribute("aria-disabled", "true");
      hint.textContent = "";

      if (value === BLACK) {
        cell.classList.add("black");
      } else if (value === WHITE) {
        cell.classList.add("white");
      } else if (state.gameStarted && !state.gameOver && legalSet[index] && elements.showLegal.checked) {
        cell.classList.add("legal");
      }

      if (state.lastMove && state.lastMove.index === index) {
        cell.classList.add("last");
      } else if (streakSet[index]) {
        cell.classList.add("streak");
      }

      if (
        state.gameStarted &&
        !state.gameOver &&
        state.currentPlayer === state.humanPlayer &&
        legalSet[index] &&
        state.board[index] === EMPTY &&
        !pendingKind
      ) {
        cell.disabled = false;
        cell.setAttribute("aria-disabled", "false");
      }

      if (
        elements.showHints.checked &&
        state.values &&
        legalSet[index] &&
        Number.isFinite(state.values[index]) &&
        state.values[index] >= -64 &&
        state.values[index] <= 64
      ) {
        cell.classList.add("has-hint");
        hint.textContent = signed(state.values[index]);
      }
    }

    elements.undoBtn.disabled = !state.history.length;
    elements.analyzeBtn.disabled = !state.gameStarted || state.gameOver || !engineReady || Boolean(pendingKind);
    elements.copyBtn.disabled = !state.moveLog.length;
    elements.resumeAiBtn.hidden = !(autoAiPaused && state.gameStarted && !state.gameOver && state.currentPlayer === state.aiPlayer);

    updateSetupPreview();

    renderMoveList();
  }

  function updateSetupPreview() {
    if (!elements.setupPreview) {
      return;
    }
    var sideInput = document.querySelector("input[name='humanSide']:checked");
    var humanPlayer = sideInput ? Number(sideInput.value) : state.humanPlayer;
    var firstInput = document.querySelector("input[name='firstMover']:checked");
    var firstMover = firstInput ? firstInput.value : "human";
    var aiPlayer = 1 - humanPlayer;
    var startingPlayer = firstMover === "ai" ? aiPlayer : humanPlayer;
    var secondPlayer = 1 - startingPlayer;
    var startWho = startingPlayer === humanPlayer ? "Bạn" : "AI";
    var secondWho = secondPlayer === humanPlayer ? "Bạn" : "AI";
    var prefix = state.gameStarted && !state.gameOver ? "Ván tiếp theo: " : "";
    elements.setupPreview.textContent =
      prefix + sideName(startingPlayer) + " (" + startWho + ") đi trước → " +
      sideName(secondPlayer) + " (" + secondWho + ") đi sau.";
  }

  function renderMoveList() {
    elements.moveList.innerHTML = "";
    for (var i = 0; i < state.moveLog.length; i += 1) {
      var move = state.moveLog[i];
      var item = document.createElement("li");
      if (move.type === "pass") {
        item.textContent = sideName(move.player) + " pass";
      } else {
        var actorLabel = move.actor === "ai" ? "AI" : "Bạn";
        var detail = sideName(move.player) + " " + coord(move.index);
        if (move.actor === "ai" && Number.isFinite(move.elapsedMs)) {
          detail += " (" + formatTime(move.elapsedMs) + ")";
        }
        item.textContent = actorLabel + ": " + detail;
      }
      elements.moveList.appendChild(item);
    }
    elements.moveList.scrollTop = elements.moveList.scrollHeight;
  }

  function countDiscs(board) {
    var black = 0;
    var white = 0;
    for (var i = 0; i < board.length; i += 1) {
      if (board[i] === BLACK) {
        black += 1;
      } else if (board[i] === WHITE) {
        white += 1;
      }
    }
    return { black: black, white: white };
  }

  function turnText(counts) {
    if (!state.gameStarted) {
      return "Chưa bắt đầu";
    }
    if (state.gameOver) {
      if (counts.black === counts.white) {
        return "Hòa cờ";
      }
      return (counts.black > counts.white ? "Đen" : "Trắng") + " thắng";
    }
    var streakSuffix = state.lastMoves.length >= 2 ? " · 🔁×" + state.lastMoves.length : "";
    if (pendingKind === "bestMove") {
      var elapsedSec = aiThinkStartedAt ? Math.floor((Date.now() - aiThinkStartedAt) / 1000) : 0;
      return "AI đang tính" + (elapsedSec > 0 ? " (" + elapsedSec + "s)" : "") + streakSuffix;
    }
    if (pendingKind === "values") {
      return "Đang phân tích";
    }
    return "Lượt " + sideName(state.currentPlayer) + streakSuffix;
  }

  function resultText() {
    var counts = countDiscs(state.board);
    var empty = 64 - counts.black - counts.white;
    if (counts.black > counts.white) {
      counts.black += empty;
    } else if (counts.white > counts.black) {
      counts.white += empty;
    }
    var winner = counts.black === counts.white ? "Hòa" : (counts.black > counts.white ? "Đen thắng" : "Trắng thắng");
    var humanWon = (state.humanPlayer === BLACK && counts.black > counts.white) || (state.humanPlayer === WHITE && counts.white > counts.black);
    var suffix = counts.black === counts.white ? "" : humanWon ? " Bạn thắng." : " AI thắng.";
    return "Hết cờ: " + winner + " " + counts.black + "-" + counts.white + "." + suffix;
  }

  function sideName(player) {
    return player === BLACK ? "Đen" : "Trắng";
  }

  function coord(index) {
    var row = Math.floor(index / SIZE);
    var col = index % SIZE;
    return "abcdefgh".charAt(col) + String(row + 1);
  }

  function signed(value) {
    return value > 0 ? "+" + value : String(value);
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms)) {
      return "-";
    }
    if (ms < 1000) {
      return ms + "ms";
    }
    return (ms / 1000).toFixed(1) + "s";
  }

  function copyTranscript() {
    var transcript = state.moveLog.map(function(move) {
      return move.type === "pass" ? "--" : coord(move.index);
    }).join(" ");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(transcript).then(function() {
        state.status = "Đã copy biên bản.";
        render();
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      window.prompt("Copy biên bản:", transcript);
    }
  }

  function saveIfNeeded() {
    if (!elements.autoSaveToggle || !elements.autoSaveToggle.checked) {
      return;
    }
    try {
      var payload = {
        state: state,
        controls: {
          showLegal: elements.showLegal.checked,
          showHints: elements.showHints.checked,
          sound: elements.soundToggle.checked,
          autoSave: elements.autoSaveToggle.checked
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      state.status = "Không lưu được vào trình duyệt.";
    }
  }

  function loadSavedState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        syncControlsFromState();
        return;
      }
      var payload = JSON.parse(raw);
      if (!payload || !payload.state || !Array.isArray(payload.state.board) || payload.state.board.length !== 64) {
        syncControlsFromState();
        return;
      }
      state = Object.assign(state, payload.state);
      if (!Array.isArray(state.lastMoves)) {
        state.lastMoves = state.lastMove ? [state.lastMove] : [];
      }
      if (state.firstMover !== "human" && state.firstMover !== "ai") {
        if (state.moveLog && state.moveLog.length && state.moveLog[0] && state.moveLog[0].actor) {
          state.firstMover = state.moveLog[0].actor === "ai" ? "ai" : "human";
        } else {
          state.firstMover = state.currentPlayer === state.humanPlayer ? "human" : "ai";
        }
      }
      state.values = null;
      state.status = state.gameStarted && !state.gameOver ? "Đã khôi phục ván đã lưu." : state.status;
      if (payload.controls) {
        elements.showLegal.checked = payload.controls.showLegal !== false;
        elements.showHints.checked = payload.controls.showHints !== false;
        elements.soundToggle.checked = payload.controls.sound !== false;
        elements.autoSaveToggle.checked = payload.controls.autoSave !== false;
      }
      syncControlsFromState();
    } catch (error) {
      syncControlsFromState();
    }
  }

  function syncControlsFromState() {
    syncLevelControl();
    elements.humanSideInputs.forEach(function(input) {
      input.checked = Number(input.value) === state.humanPlayer;
    });
    elements.firstMoverInputs.forEach(function(input) {
      input.checked = input.value === state.firstMover;
    });
  }

  function syncLevelControl() {
    elements.levelRange.value = String(state.level);
    elements.levelText.textContent = "Level " + state.level;
  }

  function clearSavedGame() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      state.status = "Đã xóa ván lưu trong trình duyệt.";
      render();
    } catch (error) {
      state.status = "Không xóa được dữ liệu lưu.";
      render();
    }
  }

  function playTone(frequency, duration) {
    if (!elements.soundToggle || !elements.soundToggle.checked) {
      return;
    }
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.value = 0.035;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      elements.soundToggle.checked = false;
    }
  }
})();
