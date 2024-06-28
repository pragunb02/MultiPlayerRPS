$(document).ready(function () {
  var gameHasStarted = false;
  var board = null;
  var game = new Chess();
  var $status = $("#status");
  var $pgn = $("#pgn");
  var gameOver = false;
  var timerWhite, timerBlack;
  var initialTime = 300; // 5 minutes for each player
  var timeRemainingWhite = initialTime;
  var timeRemainingBlack = initialTime;

  function startTimer() {
    if (game.turn() === "w") {
      clearInterval(timerBlack);
      timerWhite = setInterval(function () {
        timeRemainingWhite--;
        $("#timerWhite").text(formatTime(timeRemainingWhite));
        if (timeRemainingWhite <= 0) {
          clearInterval(timerWhite);
          gameOver = true;
          updateStatus("Time out, Black wins!");
        }
      }, 1000);
    } else {
      clearInterval(timerWhite);
      timerBlack = setInterval(function () {
        timeRemainingBlack--;
        $("#timerBlack").text(formatTime(timeRemainingBlack));
        if (timeRemainingBlack <= 0) {
          clearInterval(timerBlack);
          gameOver = true;
          updateStatus("Time out, White wins!");
        }
      }, 1000);
    }
  }

  function formatTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var seconds = seconds % 60;
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

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
    var theMove = {
      from: source,
      to: target,
      promotion: "q", // always promote to a queen for simplicity
    };

    var move = game.move(theMove);

    if (move === null) return "snapback";

    socket.emit("move", theMove);
    updateStatus();
    startTimer();
  }

  socket.on("newMove", function (move) {
    game.move(move);
    board.position(game.fen());
    updateStatus();
    startTimer();
  });

  function onSnapEnd() {
    board.position(game.fen());
  }

  function updateStatus(customStatus) {
    var status = customStatus || "";

    var moveColor = "White";
    if (game.turn() === "b") {
      moveColor = "Black";
    }

    if (game.in_checkmate()) {
      status = "Game over, " + moveColor + " is in checkmate.";
      gameOver = true;
      clearInterval(timerWhite);
      clearInterval(timerBlack);
      console.log("Checkmate detected: " + status);
    } else if (game.in_draw()) {
      status = "Game over, drawn position";
      gameOver = true;
      clearInterval(timerWhite);
      clearInterval(timerBlack);
      console.log("Draw detected: " + status);
    } else if (gameOver) {
      console.log("Game over detected: " + status);
    } else if (!gameHasStarted) {
      status = "Waiting for black to join";
      console.log("Waiting for game to start: " + status);
    } else {
      status = moveColor + " to move";
      if (game.in_check()) {
        status += ", " + moveColor + " is in check";
        console.log("Check detected: " + status);
      }
    }

    console.log("Setting status: " + status);
    $status.html(status);
    $pgn.html(game.pgn());
  }

  var config = {
    draggable: true,
    position: "start",
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: "/public/img/chesspieces/wikipedia/{piece}.png",
    responsive: true, // Make the chessboard responsive
  };

  board = Chessboard("myBoard", config);

  if (playerColor == "black") {
    board.flip();
  }

  updateStatus();

  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("code")) {
    socket.emit("joinGame", {
      code: urlParams.get("code"),
    });
  }

  socket.on("startGame", function () {
    gameHasStarted = true;
    updateStatus();
    startTimer();
  });

  socket.on("gameOverDisconnect", function () {
    gameOver = true;
    updateStatus("Opponent disconnected, you win!");
  });

  $(window).resize(function () {
    board.resize();
  });

  // Initialize timers display
  $("#timerWhite").text(formatTime(timeRemainingWhite));
  $("#timerBlack").text(formatTime(timeRemainingBlack));
});
