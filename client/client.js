console.log("Running Rock Paper Scissors Script");

const socket = io();

let roomUniqueId;
let isPlayer1 = false;
let player1Name = "SAMPLE";
let player2Name = "SAMPLE";
let isPlayer1Turn = false;
let playerName;

function createGame() {
  isPlayer1Turn = true;
  playerName = document.getElementById("playerName").value;
  if (!playerName) {
    alert("Please enter your name");
    return;
  }
  socket.emit("createRPSGame", { playerName });
}

function joinGame() {
  roomUniqueId = document.getElementById("roomUniqueId").value;
  playerName = document.getElementById("playerName").value;
  if (!roomUniqueId || !playerName) {
    alert("Please enter both room code and your name");
    return;
  }
  socket.emit("joinRPSGame", { roomUniqueId, playerName });
  requestRoomData(roomUniqueId);
}

socket.on("newRPSGame", (data) => {
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

function requestRoomData(roomUniqueId) {
  socket.emit("requestRPSRoomData", { roomUniqueId });
}

socket.on("playersConnectedRPS", (data) => {
  requestRoomData(roomUniqueId);
  document.getElementById("initial").style.display = "none";
  document.getElementById("gamePlay").style.display = "block";
  document.getElementById("waitingArea").style.display = "none";
  document.getElementById("gameArea").style.display = "block";
  if (isPlayer1Turn) {
    document.getElementById("ch1").innerText = "You";
    document.getElementById("ch2").innerText = "Opponent";
  } else {
    document.getElementById("ch1").innerText = "You";
    document.getElementById("ch2").innerText = "Opponent";
  }
});

socket.on("player1ChoiceRPS", (data) => {
  if (!isPlayer1Turn) {
    displayOpponentChoice(data.choice);
  }
});

socket.on("player2ChoiceRPS", (data) => {
  if (isPlayer1Turn) {
    displayOpponentChoice(data.choice);
  }
});

socket.on("rpsGameResult", (data) => {
  let winnerMessage;
  if (data.winner === "draw") {
    winnerMessage = "It's a draw";
  } else if (data.winner === "player1") {
    winnerMessage = isPlayer1Turn ? "You Win" : "You Lose";
  } else {
    winnerMessage = isPlayer1Turn ? "You Lose" : "You Win";
  }
  document.getElementById("winnerArea").innerText = winnerMessage;
  document.getElementById("initial").style.display = "none";
  document.getElementById("gamePlay").style.display = "block";
  document.getElementById("waitingArea").style.display = "none";
  document.getElementById("gameArea").style.display = "block";
  document.getElementById("winnerArea").style.display = "block";
  document.getElementById("opponentState").style.display = "none";
  document.getElementById("opponentButton").style.display = "block";
  document.getElementById("player1Choice").style.display = "block";
});

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

function roomCapapcity() {
  alert("Room is Full");
}
socket.on("FullRPS", () => {
  roomCapapcity();
});

function sendChoice(choice) {
  const choiceEvent = isPlayer1Turn ? "player1ChoiceRPS" : "player2ChoiceRPS";
  socket.emit(choiceEvent, { choice: choice, roomUniqueId });
  displayPlayerChoice(choice);
}

function displayPlayerChoice(choice) {
  const playerChoiceButton = document.createElement("button");
  playerChoiceButton.style.display = "block";
  playerChoiceButton.innerText = choice;
  document.getElementById("player1Choice").innerHTML = "";
  document.getElementById("player1Choice").appendChild(playerChoiceButton);
}

function displayOpponentChoice(choice) {
  document.getElementById("opponentState").innerText = "Opponent Made A Choice";
  const opponentButton = document.createElement("button");
  opponentButton.id = "opponentButton";
  opponentButton.style.display = "none";
  opponentButton.innerText = choice;
  document.getElementById("player2Choice").appendChild(opponentButton);
}
