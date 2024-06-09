console.log("RUNNING");
const socket = io();

let roomUniqueId;
let player1 = false;
let playerName;

function createGame() {
    player1 = true;
    playerName = document.getElementById("playerName").value;
    if (!playerName) {
        alert("Please enter your name");
        return;
    }
    socket.emit("createGame", { playerName: playerName });
}

function joinGame() {
    roomUniqueId = document.getElementById("roomUniqueId").value;
    playerName = document.getElementById("playerName").value;
    if (!roomUniqueId || !playerName) {
        alert("Please enter both room code and your name");
        return;
    }
    socket.emit("joinGame", {
        roomUniqueId: roomUniqueId,
        playerName: playerName,
    });
}

socket.on("newGame", (data) => {
  roomUniqueId = data.roomUniqueId;
  document.getElementById("initial").style.display = "none";
  document.getElementById("gamePlay").style.display = "block";
  let copyBtn = document.createElement("button");
  copyBtn.innerText = "Copy Code";
  copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(roomUniqueId).then(
          function () {
              console.log("Done Copying Code");
              // Notify user about successful copying
              alert("Code copied successfully!");
          },
          function (err) {
              console.log("Error in copying");
              // Notify user about error
              alert("Error in copying code");
          }
      );
  });
  const waitingArea = document.getElementById("waitingArea");
  if (waitingArea) {
      waitingArea.innerHTML = `Waiting For Opponent.., Please share code <span style="font-weight: bold; font-style: italic; color: #ff0000">${roomUniqueId}</span>`;
  }
  var br = document.createElement("br");
  waitingArea.appendChild(br);
  waitingArea.appendChild(copyBtn); 
});


socket.on("playersConnected", (data) => {
    console.log("Players connected:", data);
    document.getElementById("initial").style.display = "none";
    document.getElementById("gamePlay").style.display="block";
    document.getElementById("waitingArea").style.display = "none";
    document.getElementById("gameArea").style.display = "block";
    // // document.getElementById("gameOptions").style.display = "block";
    
});

socket.on("p1Choice", (data) => {
    if (!player1) {
        createOpponentChoiceButton(data);
    }
});

socket.on("p2Choice", (data) => {
    if (player1) {
        createOpponentChoiceButton(data);
    }
});

socket.on("result", (data) => {
    let winner = "";
    if (data.winner === "d") {
        winner = "It's a draw";
    } else if (data.winner === "p1") {
        winner = player1 ? "You Win" : "You lose";
    } else {
        winner = player1 ? "You lose" : "You Win";
    }
    document.getElementById("initial").style.display = "none";
    document.getElementById("gamePlay").style.display="block";
    document.getElementById("waitingArea").style.display = "none";
    document.getElementById("gameArea").style.display = "block";
    document.getElementById("winnerArea").style.display="block"
    document.getElementById("opponentState").style.display = "none";
    document.getElementById("opponentButton").style.display = "block"
    document.getElementById("player1Choice").style.display="block";
    document.getElementById("winnerArea").innerHTML = winner;
});

function sendChoice(rpsChoice) {
    const choiceEvent = player1 ? "p1Choice" : "p2Choice";
    socket.emit(choiceEvent, {
        rpsChoice: rpsChoice,
        roomUniqueId: roomUniqueId,
    });
    const playerChoiceButton = document.createElement("button");
    playerChoiceButton.style.display = "block";
    playerChoiceButton.innerText = rpsChoice;
    document.getElementById("player1Choice").innerHTML = "";
    document.getElementById("player1Choice").appendChild(playerChoiceButton);
}

function createOpponentChoiceButton(data) {
    document.getElementById("opponentState").innerHTML = "Opponent Made A Choice";
    const opponentButton = document.createElement("button");
    opponentButton.id = "opponentButton";
    opponentButton.style.display = "none";
    opponentButton.innerText = data.rpsChoice;
    document.getElementById("player2Choice").appendChild(opponentButton);
}
