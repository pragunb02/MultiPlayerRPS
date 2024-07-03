let timer = 1;
let moveObj = {};
let currentMoveIndex = 0; // Track the current move index
const originalGame = new Chess();
const navigationGame = new Chess(); // Separate instance for navigation

document.addEventListener("DOMContentLoaded", function () {
  let gameHasStarted = false;
  let board = null;
  let game = new Chess(originalGame.fen()); // To use Chess.js, create a new instance of the Chess class
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

  if (playerColor == "Black") timer = 2;
  moveObj = {};

  function startTimer() {
    console.log("func");
    console.log(game.turn());
    if (playerColor == "black") {
      if (originalGame.turn() === "w") {
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
      if (originalGame.turn() === "w") {
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

  function onDragStart(source, piece, position, orientation) {
    console.log("Drag started:", { source, piece, position, orientation });

    if (originalGame.game_over()) {
      console.log("Game is over");
      return false;
    }

    if (!gameHasStarted) {
      console.log("Game has not started");
      return false;
    }

    if (gameOver) {
      console.log("Game is marked as over");
      return false;
    }

    // if (
    //   (playerColor === "black" && piece.search(/^w/) !== -1) ||
    //   (playerColor === "white" && piece.search(/^b/) !== -1)
    // ) {
    //   console.log("Player tried to move the opponent's piece");
    //   return false;
    // }
    // // if (timer - 1 != currentMoveIndex) {
    // //   if (
    // //     (originalGame.turn() === "w" && piece.search(/^b/) !== -1) ||
    // //     (originalGame.turn() === "b" && piece.search(/^w/) !== -1)
    // //   ) {
    // //     console.log("Player tried to move out of turn");
    // //     console.log(originalGame.turn());
    // //     return true;
    // //   }
    // // }
    // if (
    //   ((originalGame.turn() === "w" && piece.search(/^b/) !== -1) ||
    //     (originalGame.turn() === "b" && piece.search(/^w/) !== -1)) &&
    //   timer - 1 == currentMoveIndex
    // ) {
    //   console.log("Player tried to move out of turn");
    //   console.log(originalGame.turn());
    //   return false;
    // }

    console.log("Drag start allowed");
    return true;
  }

  function onDrop(source, target, piece, newPos, oldPos, orientation) {
    console.log("inisw");
    const theMove = {
      from: source,
      to: target,
      promotion: "q", // always promote to a queen for simplicity
    };

    if (
      (playerColor === "black" && piece.search(/^w/) !== -1) ||
      (playerColor === "white" && piece.search(/^b/) !== -1)
    ) {
      console.log("Player tried to move the opponent's piece");
      return "snapback";
    }
    // if (timer - 1 != currentMoveIndex) {
    //   if (
    //     (originalGame.turn() === "w" && piece.search(/^b/) !== -1) ||
    //     (originalGame.turn() === "b" && piece.search(/^w/) !== -1)
    //   ) {
    //     console.log("Player tried to move out of turn");
    //     console.log(originalGame.turn());
    //     return true;
    //   }
    // }
    if (
      ((originalGame.turn() === "w" && piece.search(/^b/) !== -1) ||
        (originalGame.turn() === "b" && piece.search(/^w/) !== -1)) &&
      timer - 1 == currentMoveIndex
    ) {
      console.log("Player tried to move out of turn");
      console.log(originalGame.turn());
      return "snapback";
    }
    const move = originalGame.move(theMove);
    if (move === null) return "snapback";
    console.log("currentMoveIndex ", currentMoveIndex);
    console.log("timer ", timer);
    if (currentMoveIndex != timer - 1) {
      currentMoveIndex = timer - 1;
      originalGame.undo();
      board.position(originalGame.fen());
      // game = originalGame;
      console.log("bechi");
      return "snapback";
    }
    console.log("helloji");
    // const move = originalGame.move(theMove);
    game = originalGame;
    moveObj[timer] = theMove;
    timer++;
    currentMoveIndex = timer - 1;
    const data = { theMove, timer, moveObj };
    socket.emit("move", data);
  }

  socket.on("newMove", function (data) {
    const move = data.theMove;
    timer = data.timer;
    currentMoveIndex = timer - 1;
    moveObj = data.moveObj;
    originalGame.move(move);
    game = originalGame;
    board.position(originalGame.fen());
    updateStatus();
    startTimer();
  });

  function onSnapEnd() {
    board.position(originalGame.fen());
  }

  // Function to update the board to the current move
  function updateBoardToMove(index) {
    const moves = Object.values(moveObj).slice(0, index);
    console.log(moves);
    navigationGame.reset(); // Reset the navigation game state
    moves.forEach((move) => navigationGame.move(move));
    board.position(navigationGame.fen());
    console.log(originalGame.fen());
    console.log(navigationGame.fen());
  }

  // Event listener for the 'click-left' button
  document.getElementById("click-left").addEventListener("click", function () {
    console.log("yea  ", currentMoveIndex);
    if (currentMoveIndex > 0) {
      currentMoveIndex--;
      updateBoardToMove(currentMoveIndex);
      const blackMoveList = document.getElementById("black-moves");
      const whiteMovesList = document.getElementById("white-moves");
      Array.from(blackMoveList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      // Select the specific move and add 'font-weight-bold' and 'fadein' classes
      const moveElement = document.getElementById(`move${currentMoveIndex}`);

      Array.from(whiteMovesList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      if (moveElement) {
        moveElement.classList.add("font-weight-bold", "fadein");
      }
      console.log("inside ", currentMoveIndex);
    }
    console.log("outside ", currentMoveIndex);
  });

  // Event listener for the 'click-right' button
  document.getElementById("click-right").addEventListener("click", function () {
    console.log("yea  ", currentMoveIndex);
    if (currentMoveIndex < Object.keys(moveObj).length) {
      currentMoveIndex++;
      updateBoardToMove(currentMoveIndex);
      const blackMoveList = document.getElementById("black-moves");
      const whiteMovesList = document.getElementById("white-moves");
      Array.from(blackMoveList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      // Select the specific move and add 'font-weight-bold' and 'fadein' classes
      const moveElement = document.getElementById(`move${currentMoveIndex}`);

      Array.from(whiteMovesList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      if (moveElement) {
        moveElement.classList.add("font-weight-bold", "fadein");
      }

      console.log("inside2   ", currentMoveIndex);
    }
    console.log("outside2   ", currentMoveIndex);
  });

  // Function to reset the board and move list
  document.getElementById("reset-board").addEventListener("click", function () {
    originalGame.reset();
    game.reset();
    navigationGame.reset();
    board.position(originalGame.fen());
    moveObj = {};
    timer = 1;
    currentMoveIndex = 0;
    updateStatus("Game reset!");
  });

  function updateStatus(customStatus) {
    let status = customStatus || "";
    const moveColor = originalGame.turn() === "w" ? "White" : "Black";
    if (originalGame.in_checkmate()) {
      status = `Game over, ${moveColor} is in checkmate.`;
      gameOver = true;
      clearInterval(timerWhite);
      clearInterval(timerBlack);
      console.log(`Checkmate detected: ${status}`);
    } else if (originalGame.in_draw()) {
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
      if (originalGame.in_check()) {
        status += `, ${moveColor} is in check`;
        console.log(`Check detected: ${status}`);
      }
    }
    console.log(`Setting status: ${status}`);
    statusElement.textContent = status;
    // pgnElement.textContent = originalGame.pgn();
    const pgn = originalGame.pgn();
    const moves = pgn.split(/\d+\./);
    const lastMove = moves[moves.length - 1].trim();
    console.log("lastmove", lastMove);
    if (timer % 2 != 0 && timer >= 2) {
      console.log("terellllllllllllll");
      const newListItem = document.createElement("li");
      const mv = timer - 1;
      newListItem.id = `move${mv}`;
      let id = mv + 1;
      id = id / 2;
      id = id - 0.5;
      newListItem.textContent = `${id}...${lastMove[3]}${lastMove[4]}`;
      const blackMoveList = document.getElementById("black-moves");
      blackMoveList.style.display = "block";
      blackMoveList.appendChild(newListItem);
      console.log("dding ", lastMove);
      console.log("dding ", lastMove[3]);
      console.log("dding ", lastMove[4]);

      // const blackMoveList = document.getElementById("black-moves");
      const whiteMovesList = document.getElementById("white-moves");
      Array.from(blackMoveList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      // Select the specific move and add 'font-weight-bold' and 'fadein' classes
      const moveElement = document.getElementById(`move${currentMoveIndex}`);

      Array.from(whiteMovesList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      if (moveElement) {
        moveElement.classList.add("font-weight-bold", "fadein");
      }
      // var elem = document.getElementById("notation-inner");
      // //AUTO-SCROLL
      pgnElement.scrollTop = pgnElement.scrollHeight;
    } else if (timer % 2 == 0 && timer >= 2) {
      console.log("terellllllllllllll2");
      const newListItem = document.createElement("li");
      const mv = timer - 1;
      newListItem.id = `move${mv}`;
      let id = mv + 1;
      id = id / 2;
      newListItem.textContent = `${id}.${lastMove}`;
      const whiteMovesList = document.getElementById("white-moves");
      whiteMovesList.style.display = "block";
      whiteMovesList.appendChild(newListItem);
      console.log("aaadding ", lastMove);
      console.log("adaaading ", lastMove[0]);
      console.log("adading ", lastMove[1]);
      pgnElement.scrollTop = pgnElement.scrollHeight;

      const blackMoveList = document.getElementById("black-moves");
      // const whiteMovesList = document.getElementById("white-moves");
      Array.from(blackMoveList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      // Select the specific move and add 'font-weight-bold' and 'fadein' classes
      const moveElement = document.getElementById(`move${currentMoveIndex}`);

      Array.from(whiteMovesList.children).forEach((child) => {
        child.classList.remove("font-weight-bold");
      });
      if (moveElement) {
        moveElement.classList.add("font-weight-bold", "fadein");
      }
    }
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
