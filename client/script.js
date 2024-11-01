console.log("Running Tic Tac Toe Script");


const socket = io();

let roomUniqueId;
let isPlayer1 = false;
let playerName;
let player1Name = "SAMPLE";
let player2Name = "SAMPLE";
let isPlayer1Turn = true;
let count = 0;
let ok = false;

const boxes = document.querySelectorAll(".box");
const resetButton = document.querySelector("#reset-btn");
const newGameButton = document.querySelector("#new-game");
const messageContainer = document.querySelector(".msg-container");
const message = document.querySelector("#msg");

// Reset Confirmation Modal
const resetModal = document.getElementById("resetConfirmationModal");
const resetSpan = resetModal.getElementsByClassName("close")[0];
const resetConfirmBtn = document.getElementById("resetConfirmBtn");
const resetCancelBtn = document.getElementById("resetCancelBtn");
const resetConfirmationText = document.getElementById("resetConfirmationText");

// New Game Confirmation Modal
const newGameModal = document.getElementById("newGameConfirmationModal");
const newGameSpan = newGameModal.getElementsByClassName("close")[0];
const newGameConfirmBtn = document.getElementById("newGameConfirmBtn");
const newGameCancelBtn = document.getElementById("newGameCancelBtn");
const newGameConfirmationText = document.getElementById(
  "newGameConfirmationText"
);

// Close the modals
resetSpan.onclick = function () {
  resetModal.style.display = "none";
};

newGameSpan.onclick = function () {
  newGameModal.style.display = "none";
};

window.onclick = function (event) {
  if (event.target == resetModal) {
    resetModal.style.display = "none";
  } else if (event.target == newGameModal) {
    newGameModal.style.display = "none";
  }
};

const winningPatterns = [
  [0, 1, 2],
  [0, 3, 6],
  [0, 4, 8],
  [1, 4, 7],
  [2, 5, 8],
  [2, 4, 6],
  [3, 4, 5],
  [6, 7, 8],
];

function updateBoxes(boxesState) {
  boxesState.forEach((symbol, index) => {
    let box = boxes[index];
    box.innerText = symbol;
    box.disabled = symbol !== ""; // Disable box if it has a symbol
    box.classList.toggle("box0", symbol === "O");
    box.classList.toggle("box1", symbol === "X");
  });
}

function ResetScreen() {
  if (isPlayer1) {
    document.getElementById("ch1").innerText = "You: O";
    document.getElementById("ch2").innerText = "Opponent: X";
    document.getElementById("opponentStateD1").innerText = "Your Turn...";
    document.getElementById("opponentStateD2").innerText = "";
  } else {
    document.getElementById("ch1").innerText = "You: X";
    document.getElementById("ch2").innerText = "Opponent: O";
    document.getElementById("opponentStateD1").innerText = "";
    document.getElementById("opponentStateD2").innerText =
      "Waiting For Opponent Move";
  }
}

const NewGamePermission = () => {
  socket.emit("requestNewGameTicTacToe", {
    roomUniqueId,
    isPlayer1,
  });
};

const newGameBtn = () => {
  isPlayer1Turn = true;
  enabledBtn();
  messageContainer.classList.add("hide");
  document.getElementById("gameAreaD").style.display = "block";
  document.getElementById("btnreset").style.display = "block";
  ResetScreen();
};

var NewGameRequestedBy = "SAMPLE";
socket.on("ConfirmNewGameTicTacToe", (data) => {
  NewGameRequestedBy = isPlayer1 === true ? player2Name : player1Name;
  newGameModal.style.display = "block";
  newGameConfirmationText.innerText = `${NewGameRequestedBy} wants to play again. Yes/No?`;
  newGameConfirmBtn.onclick = function () {
    socket.emit("NewGameResponseTicTacToe", {
      response: true,
      roomUniqueId: roomUniqueId,
    });
    newGameModal.style.display = "none";
    alert("Starting New Game..");
    newGameBtn();
  };

  newGameCancelBtn.onclick = function () {
    socket.emit("NewGameResponseTicTacToe", {
      response: false,
      roomUniqueId: roomUniqueId,
    });
    newGameModal.style.display = "none";
    setTimeout(() => {
      window.location.href = "/";
    }, 3000);
  };
});

socket.on("NewGameTicTacToe", () => {
  alert("Starting New Game..");
  newGameBtn();
});

function cancelingNewGameRequest() {
  NewGameRequestedBy = isPlayer1 === true ? player2Name : player1Name;
  alert(`${NewGameRequestedBy} denied for New Game`);
  socket.emit("CancelTicTacToe", { roomUniqueId });
  setTimeout(() => {
    window.location.href = "/";
  }, 2000);
}

socket.on("CancelingRequestNewGameTicTacToc", () => {
  cancelingNewGameRequest();
});

const ResetBtn = () => {
  isPlayer1Turn = true;
  enabledBtn();
  messageContainer.classList.add("hide");
  ResetScreen();
};

const ResetBtnPermission = () => {
  socket.emit("requestResetGameTicTacToe", {
    roomUniqueId,
    isPlayer1,
  });
};

var ResetGameRequestedBy = "SAMPLE";
socket.on("ConfirmResetGameTicTacToe", (data) => {
  ResetGameRequestedBy = isPlayer1 === true ? player2Name : player1Name;
  resetModal.style.display = "block";
  resetConfirmationText.innerText = `${ResetGameRequestedBy} want to Reset the game. Yes/NO? `;
  resetConfirmBtn.onclick = function () {
    socket.emit("resetResponseTicTacToe", {
      response: true,
      roomUniqueId: roomUniqueId,
    });
    resetModal.style.display = "none";
    ResetBtn();
    isPlayer1Turn = true;
    ok = false;
    count = 0;
  };

  resetCancelBtn.onclick = function () {
    socket.emit("resetResponseTicTacToe", {
      response: false,
      roomUniqueId: roomUniqueId,
    });
    resetModal.style.display = "none";
  };
});

socket.on("resetingTicTacToe", () => {
  isPlayer1Turn = true;
  ok = false;
  count = 0;
  enabledBtn();
  messageContainer.classList.add("hide");
  ResetScreen();
});

socket.on("CancelingRequestResetGameTicTacToc", () => {
  cancelingResetRequest();
});

function cancelingResetRequest() {
  ResetGameRequestedBy = isPlayer1 === true ? player2Name : player1Name;
  alert(`${ResetGameRequestedBy} denied for Reset Game`);
}

const enabledBtn = () => {
  for (let box of boxes) {
    box.disabled = false;
    box.innerText = "";
  }
};

const getBoxesState = () => {
  return Array.from(boxes).map((box) => ({
    text: box.innerText,
    disabled: box.disabled,
  }));
};

const disableBoxes = () => {
  boxes.forEach((box) => (box.disabled = true));
};

function createGame() {
  isPlayer1 = true;
  isPlayer1Turn = true;
  playerName = document.getElementById("playerName").value;
  if (!playerName) {
    alert("Please enter your name");
    return;
  }
  socket.emit("createTicTacToeGame", { playerName });
}

function joinGame() {
  roomUniqueId = document.getElementById("roomUniqueId").value;
  playerName = document.getElementById("playerName").value;
  if (!roomUniqueId || !playerName) {
    alert("Please enter both room code and your name");
    return;
  }
  socket.emit("joinTicTacToeGame", { roomUniqueId, playerName });
  // requestRoomData(roomUniqueId); // Request room data for player 2
}

function requestRoomData(roomUniqueId) {
  socket.emit("requestTicTacToeRoomData", { roomUniqueId });
}

const displayWinner = (winner) => {
  count = 0;
  ok = false;
  socket.emit("announceWinner", { winner, roomUniqueId, count, ok });

  message.innerText = `Congratulations, Winner is ${winner}`;
  messageContainer.classList.remove("hide");
  document.getElementById("xyz").style.display = "none";
  document.getElementById("gameAreaD").style.display = "none";
  disableBoxes();
  document.getElementById("btnreset").style.display = "none";
};

const announceDraw = () => {
  count = 0;
  ok = false;
  socket.emit("announceDraw", { roomUniqueId, count, ok });

  message.innerText = `OOPS DRAW!!`;
  messageContainer.classList.remove("hide");
  document.getElementById("xyz").style.display = "none";
  document.getElementById("gameAreaD").style.display = "none";
  document.getElementById("btnreset").style.display = "none";

  disableBoxes();
};

socket.on("roomDataResponse", (data) => {
  const { roomData } = data;
  if (roomData) {
    player1Name = roomData.player1Name;
    player2Name = roomData.player2Name;
    console.log("Room Data:", roomData);
  } else {
    console.error("Room data not found");
  }
});

// client/main.js

// Insert CSS for tooltips and layout into the DOM
const style = document.createElement("style");
style.textContent = `
  .social-button {
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    margin: 5px;
    background-color: #ffffff;
    border: 1px solid #ccc;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 18px;
    color: #555;
  }

  .social-button:hover .tooltip {
    visibility: visible;
    opacity: 1;
  }

  .tooltip {
    visibility: hidden;
    width: 80px;
    background-color: black;
    color: #fff;
    text-align: center;
    border-radius: 6px;
    padding: 5px;
    position: absolute;
    z-index: 1;
    bottom: 125%;
    left: 50%;
    margin-left: -40px;
    opacity: 0;
    transition: opacity 0.3s;
  }

  .tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    margin-left: -5px;
    border-width: 5px;
    border-style: solid;
    border-color: black transparent transparent transparent;
  }

  .share-menu {
    display: grid;
    grid-template-columns: repeat(3, auto);
    gap: 10px;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: -150px;
  }
`;
document.head.appendChild(style);

socket.on("playersConnectingTicTacToe", (data) => {
  roomUniqueId = data.roomUniqueId;
  document.getElementById("initial").style.display = "none";
  document.getElementById("gamePlay").style.display = "block";

  // Create copy button
  let copyButton = document.createElement("button");
  copyButton.innerText = "Copy Code";
  copyButton.addEventListener("click", () => {
    navigator.clipboard.writeText(roomUniqueId).then(
      () => alert("Code copied successfully!"),
      () => alert("Error in copying code")
    );
  });

  // Create share button and menu
  let shareButton = document.createElement("button");
  shareButton.innerText = "Share";
  shareButton.style.marginLeft = "10px";

  let shareMenuContainer = document.createElement("div");
  shareMenuContainer.id = "shareMenuContainer";
  shareMenuContainer.style.position = "relative";
  shareMenuContainer.style.display = "inline-block";

  let shareMenu = document.createElement("div");
  shareMenu.id = "shareMenu";
  shareMenu.className = "share-menu"; // Use CSS Grid layout
  shareMenu.style.display = "none";
  shareMenu.style.backgroundColor = "white";
  shareMenu.style.boxShadow = "0px 8px 16px 0px rgba(0,0,0,0.2)";
  shareMenu.style.zIndex = "1";
  shareMenu.style.padding = "10px";
  shareMenu.style.borderRadius = "8px";

  // Function to create social buttons with tooltips
  function createSocialButton(iconClass, color, tooltipText, clickHandler) {
    let button = document.createElement("button");
    button.innerHTML = `<i class="${iconClass}" style="color: ${color};"></i>`;
    button.className = "social-button";
    button.addEventListener("click", clickHandler);

    let tooltip = document.createElement("span");
    tooltip.className = "tooltip";
    tooltip.innerText = tooltipText;
    button.appendChild(tooltip);

    return button;
  }

  // Define the social buttons
  let facebookButton = createSocialButton(
    "fab fa-facebook-f",
    "#3b5998",
    "Facebook",
    () => {
      let facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}`;
      window.open(facebookUrl, "_blank");
    }
  );

  let twitterButton = createSocialButton(
    "fab fa-twitter",
    "#1da1f2",
    "Twitter",
    () => {
      let twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}`;
      window.open(twitterUrl, "_blank");
    }
  );

  let whatsappButton = createSocialButton(
    "fab fa-whatsapp",
    "#25d366",
    "WhatsApp",
    () => {
      let whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}`;
      window.open(whatsappUrl, "_blank");
    }
  );

  let redditButton = createSocialButton(
    "fab fa-reddit-alien",
    "#ff4500",
    "Reddit",
    () => {
      let redditUrl = `https://www.reddit.com/submit?url=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}&title=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}`;
      window.open(redditUrl, "_blank");
    }
  );

  let telegramButton = createSocialButton(
    "fab fa-telegram-plane",
    "#0088cc",
    "Telegram",
    () => {
      let telegramUrl = `https://telegram.me/share/url?url=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}&text=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}`;
      window.open(telegramUrl, "_blank");
    }
  );

  let emailButton = createSocialButton(
    "fas fa-envelope",
    "#dd4b39",
    "Email",
    () => {
      let mailUrl = `mailto:?subject=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}&body=${encodeURIComponent(
        `Join my Tic Tac Toe game with this code: ${roomUniqueId}`
      )}`;
      window.location.href = mailUrl;
    }
  );

  // Append the buttons to the share menu
  shareMenu.appendChild(facebookButton);
  shareMenu.appendChild(twitterButton);
  shareMenu.appendChild(whatsappButton);
  shareMenu.appendChild(redditButton);
  shareMenu.appendChild(telegramButton);
  shareMenu.appendChild(emailButton);

  shareMenuContainer.appendChild(shareButton);
  shareMenuContainer.appendChild(shareMenu);

  // Toggle share menu visibility
  shareButton.addEventListener("click", () => {
    shareMenu.style.display =
      shareMenu.style.display === "block" ? "none" : "block";
  });

  // Close the share menu if the user clicks outside of it
  window.onclick = function (event) {
    if (!event.target.matches("#shareMenuContainer button")) {
      shareMenu.style.display = "none";
    }
  };

  const waitingArea = document.getElementById("waitingArea");
  if (waitingArea) {
    waitingArea.innerHTML = `Waiting For Opponent.., Please share code <span style="font-weight: bold; font-style: italic; color: #ff0000">${roomUniqueId}</span>`;
    waitingArea.appendChild(document.createElement("br"));
    waitingArea.appendChild(copyButton);
    waitingArea.appendChild(shareMenuContainer); // Add the share menu container to the DOM
  }
});

// socket.on("playersConnectingTicTacToe", (data) => {
//   roomUniqueId = data.roomUniqueId;
//   document.getElementById("initial").style.display = "none";
//   document.getElementById("gamePlay").style.display = "block";

//   // Create copy button
//   let copyButton = document.createElement("button");
//   copyButton.innerText = "Copy Code";
//   copyButton.addEventListener("click", () => {
//     navigator.clipboard.writeText(roomUniqueId).then(
//       () => alert("Code copied successfully!"),
//       () => alert("Error in copying code")
//     );
//   });

//   // Create share button
//   let shareButton = document.createElement("button");
//   shareButton.innerHTML = "&#x1f517;"; // Unicode for a link symbol or use any icon you prefer
//   shareButton.style.width = "24px";
//   shareButton.style.height = "24px";
//   shareButton.style.borderRadius = "50%";
//   shareButton.style.marginLeft = "10px"; // Add some space between buttons
//   shareButton.style.backgroundColor = "white";
//   shareButton.style.border = "1px solid #ccc";
//   shareButton.style.display = "flex";
//   shareButton.style.alignItems = "center";
//   shareButton.style.justifyContent = "center";

//   shareButton.addEventListener("click", () => {
//     if (navigator.share) {
//       navigator
//         .share({
//           title: "Tic Tac Toe Game Code",
//           text: `Join my Tic Tac Toe game with this code: ${roomUniqueId}`,
//         })
//         .then(() => console.log("Successful share"))
//         .catch((error) => console.log("Error sharing:", error));
//     } else {
//       alert("Web Share API is not supported in your browser.");
//     }
//   });

//   const waitingArea = document.getElementById("waitingArea");
//   if (waitingArea) {
//     waitingArea.innerHTML = `Waiting For Opponent.., Please share code <span style="font-weight: bold; font-style: italic; color: #ff0000">${roomUniqueId}</span>`;
//     waitingArea.appendChild(document.createElement("br"));
//     waitingArea.appendChild(copyButton);
//     waitingArea.appendChild(shareButton); // Add the share button to the DOM
//   }
// });

socket.on("playersConnectedTicTacToe", (data) => {
  document.getElementById("initial").style.display = "none";
  document.getElementById("gamePlay").style.display = "none";
  document.getElementById("waitingArea").style.display = "none";
  document.querySelector("main").style.display = "block";
  document.getElementById("gameAreaD").style.display = "block";
  document.getElementById("xyz").style.display = "none";
  document.body.style.background = "#c2aff0";

  if (isPlayer1) {
    document.getElementById("ch1").innerText = "You: O";
    document.getElementById("ch2").innerText = "Opponent: X";
    document.getElementById("opponentStateD1").innerText = "Your Turn...";
    document.getElementById("opponentStateD2").innerText = "";
  } else {
    document.getElementById("ch1").innerText = "You: X";
    document.getElementById("ch2").innerText = "Opponent: O";
    document.getElementById("opponentStateD1").innerText = "";
    document.getElementById("opponentStateD2").innerText =
      "Waiting For Opponent Move";
  }

  requestRoomData(roomUniqueId);
});

socket.on("announceWinner", (data) => {
  // Accessing nested data properties correctly
  count = data.data.count;
  console.log(count);
  ok = data.data.ok;
  const winner = data.data.winner;
  message.innerText = `Congratulations, Winner is ${winner}`;
  messageContainer.classList.remove("hide");
  document.getElementById("xyz").style.display = "none";
  document.getElementById("gameAreaD").style.display = "none";
  document.getElementById("btnreset").style.display = "none";
  disableBoxes();
});

socket.on("announceDraw", (data) => {
  count = data.data.count;
  ok = data.data.ok;
  message.innerText = `OOPS DRAW!!`;
  messageContainer.classList.remove("hide");
  document.getElementById("xyz").style.display = "none";
  document.getElementById("gameAreaD").style.display = "none";
  document.getElementById("btnreset").style.display = "none";
  disableBoxes();
});

const checkWinner = () => {
  for (pattern of winningPatterns) {
    let pos0 = boxes[pattern[0]].innerText;
    let pos1 = boxes[pattern[1]].innerText;
    let pos2 = boxes[pattern[2]].innerText;
    if (
      pos0 != "" &&
      pos1 != "" &&
      pos2 != "" &&
      pos0 === pos2 &&
      pos0 === pos1
    ) {
      ok = true;
      if (pos0 === "X") {
        displayWinner(player2Name);
      } else {
        displayWinner(player1Name);
      }
    }
  }
};

// Function to update turn indicators
const updateTurnIndicators = () => {
  let yourTurnMessage, opponentTurnMessage;

  if (isPlayer1) {
    // Player 1's perspective
    if (isPlayer1Turn) {
      yourTurnMessage = "Your Turn...";
      opponentTurnMessage = "";
    } else {
      yourTurnMessage = "";
      opponentTurnMessage = "Waiting for Opponent's Move";
    }
  } else {
    // Player 2's perspective
    if (isPlayer1Turn) {
      yourTurnMessage = "Waiting for Opponent's Move";
      opponentTurnMessage = "";
    } else {
      yourTurnMessage = "Your Turn...";
      opponentTurnMessage = "";
    }
  }

  document.getElementById("opponentStateD1").innerText = yourTurnMessage;
  document.getElementById("opponentStateD2").innerText = opponentTurnMessage;
};

socket.on("player1Move", (data) => {
  if (!isPlayer1) {
    updateBoxes(data.boxes);
    isPlayer1Turn = data.isPlayer1Turn;
    count = data.count;
    updateTurnIndicators();
  }
  // updateTurnIndicators();
});

socket.on("player2Move", (data) => {
  if (isPlayer1) {
    updateBoxes(data.boxes);
    isPlayer1Turn = data.isPlayer1Turn;
    count = data.count;
    updateTurnIndicators();
  }
  // updateTurnIndicators();
});

socket.on("updateBoxesState", (data) => {
  updateBoxes(data.boxesState);
});

function roomCapapcity() {
  alert("Room is Full");
}
socket.on("FullTicTacToe", () => {
  roomCapapcity();
});

// Add click event listeners to each box

boxes.forEach((box, index) => {
  box.addEventListener("click", () => {
    if (isPlayer1Turn && isPlayer1) {
      box.innerText = "O";
      box.classList.add("box0");
      box.classList.remove("box1");
      isPlayer1Turn = false;
      box.disabled = true;

      const boxesState = Array.from(boxes).map((b) => b.innerText);
      count++;

      socket.emit("player1Move", {
        index,
        boxes: boxesState,
        isPlayer1Turn,
        roomUniqueId,
        symbol: "O",
        count: count,
      });

      checkWinner();
      if (count === 9 && ok === false) {
        announceDraw();
      }
      updateTurnIndicators();
    } else if (!isPlayer1Turn && !isPlayer1) {
      box.innerText = "X";
      box.classList.remove("box0");
      box.classList.add("box1");
      // isPlayer1Turn = true;
      isPlayer1Turn = !isPlayer1;
      box.disabled = true;

      const boxesState = Array.from(boxes).map((b) => b.innerText);
      count++;

      socket.emit("player2Move", {
        index,
        boxes: boxesState,
        isPlayer1Turn,
        roomUniqueId,
        symbol: "X",
        count: count,
      });

      checkWinner();
      if (count === 9 && ok === false) {
        announceDraw();
      }
      updateTurnIndicators();
    } else {
      alert("Wait For Opponent's Turn");
    }
  });
});

resetButton.addEventListener("click", ResetBtnPermission);
newGameButton.addEventListener("click", NewGamePermission);



