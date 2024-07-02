let timer = 1;
let moveObj = {};

document.addEventListener("DOMContentLoaded", function () {
  let gameHasStarted = false;
  let board = null;
  const game = new Chess(); // To use Chess.js, create a new instance of the Chess class
  console.log(game.fen());
  const statusElement = document.getElementById("status");
  const pgnElement = document.getElementById("pgn");
  let gameOver = false;
  let timerWhite, timerBlack;
  const initialTime = 300; // 5 minutes for each player
  let timeRemainingWhite = initialTime;
  let timeRemainingBlack = initialTime;

  let playerColor = "";
  const urlParams = new URLSearchParams(window.location.search);
  const pathName = window.location.pathname;
  if (pathName.includes("black")) {
    playerColor = "black";
  } else {
    playerColor = "white";
  }

  const roomuniqueID = urlParams.get("code");
  if (roomuniqueID) {
    socket.emit("joinGame", { code: roomuniqueID });
  }

  // let timer = 1;
  if (playerColor == "Black") timer = 2;
  moveObj = {};

  function startTimer() {
    console.log("func");
    console.log(game.turn());
    if (playerColor == "black") {
      if (game.turn() === "w") {
        clearInterval(timerBlack);
        timerWhite = setInterval(function () {
          timeRemainingWhite--;
          document.getElementById("timerWhite").textContent =
            formatTime(timeRemainingWhite);
          if (timeRemainingWhite <= 0) {
            clearInterval(timerWhite);
            clearInterval(timerBlack);
            gameOver = true;
            updateStatus("Time out, Black wins!");
          }
        }, 1000);
      } else {
        clearInterval(timerWhite);
        timerBlack = setInterval(function () {
          timeRemainingBlack--;
          document.getElementById("timerBlack").textContent =
            formatTime(timeRemainingBlack);
          if (timeRemainingBlack <= 0) {
            clearInterval(timerBlack);
            clearInterval(timerWhite);
            gameOver = true;
            updateStatus("Time out, White wins!");
          }
        }, 1000);
      }
    } else {
      if (game.turn() === "w") {
        clearInterval(timerBlack);
        timerWhite = setInterval(function () {
          timeRemainingWhite--;
          document.getElementById("timerBlack").textContent =
            formatTime(timeRemainingWhite);
          if (timeRemainingWhite <= 0) {
            clearInterval(timerWhite);
            clearInterval(timerBlack);
            gameOver = true;
            updateStatus("Time out, Black wins!");
          }
        }, 1000);
      } else {
        clearInterval(timerWhite);
        timerBlack = setInterval(function () {
          timeRemainingBlack--;
          document.getElementById("timerWhite").textContent =
            formatTime(timeRemainingBlack);
          if (timeRemainingBlack <= 0) {
            clearInterval(timerBlack);
            clearInterval(timerWhite);
            gameOver = true;
            updateStatus("Time out, White wins!");
          }
        }, 1000);
      }
    }
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`;
  }
  // inbuilt
  function onDragStart(source, piece, position, orientation) {
    if (game.game_over() || !gameHasStarted || gameOver) return false;
    if (
      (playerColor === "black" && piece.search(/^w/) !== -1) ||
      (playerColor === "white" && piece.search(/^b/) !== -1)
    ) {
      return false;
    }

    if (
      (game.turn() === "w" && piece.search(/^b/) !== -1) ||
      (game.turn() === "b" && piece.search(/^w/) !== -1)
    ) {
      return false;
    }
  }

  function onDrop(source, target) {
    const theMove = {
      from: source,
      to: target,
      promotion: "q", // always promote to a queen for simplicity
    };
    const move = game.move(theMove);
    if (move === null) return "snapback";
    moveObj[timer] = theMove;
    timer++;
    // console.log("object");
    // console.log(moveObj);
    const data = { theMove, timer, moveObj };
    socket.emit("move", data);
    // console.log(theMove);
    // console.log(timer);
    // console.log("objec2t");
    // console.log(moveObj);
  }

  socket.on("newMove", function (data) {
    const move = data.theMove;
    timer = data.timer;
    moveObj = data.moveObj;
    game.move(move);
    board.position(game.fen());
    updateStatus();
    startTimer();
  });

  function onSnapEnd() {
    board.position(game.fen());
  }

  function updateStatus(customStatus) {
    let status = customStatus || "";
    const moveColor = game.turn() === "w" ? "White" : "Black";
    if (game.in_checkmate()) {
      status = `Game over, ${moveColor} is in checkmate.`;
      gameOver = true;
      clearInterval(timerWhite);
      clearInterval(timerBlack);
      console.log(`Checkmate detected: ${status}`);
    } else if (game.in_draw()) {
      status = "Game over, drawn position";
      gameOver = true;
      clearInterval(timerWhite);
      clearInterval(timerBlack);
      console.log(`Draw detected: ${status}`);
    } else if (gameOver) {
      console.log(`Game over detected: ${status}`);
    } else if (!gameHasStarted) {
      status = "Waiting for black to join";
      console.log(`Waiting for game to start: ${status}`);
    } else {
      status = `${moveColor} to move`;
      if (game.in_check()) {
        status += `, ${moveColor} is in check`;
        console.log(`Check detected: ${status}`);
      }
    }
    console.log(`Setting status: ${status}`);
    statusElement.textContent = status;
    pgnElement.textContent = game.pgn();
    const pgn = game.pgn();
    const moves = pgn.split(/\d+\./);
    const lastMove = moves[moves.length - 1].trim();
    console.log("lastmove", lastMove);
  }

  const config = {
    draggable: true,
    position: "start",
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: "/public/img/chesspieces/wikipedia/{piece}.png",
    responsive: true,
  };

  // borad is of chessboard.js
  // game is of chess.js

  board = Chessboard("myBoard", config);
  if (playerColor === "black") {
    board.flip();

    timeRemainingBlack = timeRemainingBlack ^ timeRemainingWhite;
    timeRemainingWhite = timeRemainingBlack ^ timeRemainingWhite;
    timeRemainingBlack = timeRemainingBlack ^ timeRemainingWhite;
  }

  console.log("Open to all");
  updateStatus();

  console.log(roomuniqueID);
  socket.on("startGame", () => {
    gameHasStarted = true;
    alert("Game starting, timer will also get started.");
    updateStatus();
  });

  socket.on("gameOverDisconnect", function () {
    gameOver = true;
    updateStatus("Opponent disconnected, you win!");
  });

  window.addEventListener("resize", function () {
    board.resize();
  });

  document.getElementById("timerWhite").textContent =
    formatTime(timeRemainingWhite);
  document.getElementById("timerBlack").textContent =
    formatTime(timeRemainingBlack);
});
