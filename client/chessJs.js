console.log("Running Chess Script");

const socket = io();

let roomUniqueId;
let isPlayer1 = false;
let playerName;
let player1Name = "SAMPLE";
let player2Name = "SAMPLE";
let isPlayer1Turn = true;
let count = 0;
let ok = false;

socket.on("playersConnectingChess", (data) => {
  roomUniqueId = data.roomUniqueId;
  document.getElementById("initial").style.display = "none";
  document.getElementById("gamePlay").style.display = "block";
  let copyButton = document.createElement("button");
  copyButton.innerText = "Copy Code";
  copyButton.addEventListener("click", () => {
    navigator.clipboard.writeText(roomUniqueId).then(
      () => alert("Code copied successfully!"),
      () => alert("Error in copying code")
    );
  });
  const waitingArea = document.getElementById("waitingArea");
  if (waitingArea) {
    waitingArea.innerHTML = `Waiting For Opponent.., Please share code <span style="font-weight: bold; font-style: italic; color: #ff0000">${roomUniqueId}</span>`;
    waitingArea.appendChild(document.createElement("br"));
    waitingArea.appendChild(copyButton);
  }
});

socket.on("playersConnectedChess", (data) => {
  console.log("Hello");
  if (isPlayer1) {
    window.location.replace("/white?code=" + roomUniqueId);
  } else {
    window.location.replace("/black?code=" + roomUniqueId);
  }
});

function createGame() {
  isPlayer1 = true;
  isPlayer1Turn = true;
  playerName = document.getElementById("playerName").value;
  if (!playerName) {
    alert("Please enter your name");
    return;
  }
  socket.emit("createChessGame", { playerName });
}

function joinGame() {
  roomUniqueId = document.getElementById("roomUniqueId").value;
  playerName = document.getElementById("playerName").value;
  if (!roomUniqueId || !playerName) {
    alert("Please enter both room code and your name");
    return;
  }
  console.log("Joining Button");
  socket.emit("joinChessGame", { roomUniqueId, playerName });
  //   requestRoomData(roomUniqueId); // Request room data for player 2
}
