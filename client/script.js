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
  console.log("yess1");
  socket.emit("createGameD", { playerName: playerName });
  console.log("yess2");
}

function joinGame() {
  roomUniqueId = document.getElementById("roomUniqueId").value;
  playerName = document.getElementById("playerName").value;
  if (!roomUniqueId || !playerName) {
    alert("Please enter both room code and your name");
    return;
  }
  console.log("indised3");
  socket.emit("joinGameD", {
    roomUniqueId: roomUniqueId,
    playerName: playerName,
  });
}

socket.on("newGameD", (data) => {
  console.log("hnji");
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
    console.log("hnj2i");
    waitingArea.innerHTML = `Waiting For Opponent.., Please share code <span style="font-weight: bold; font-style: italic; color: #ff0000">${roomUniqueId}</span>`;
  }
  var br = document.createElement("br");
  waitingArea.appendChild(br);
  waitingArea.appendChild(copyBtn);
  console.log("hnji3");
});

socket.on("playersConnectedD", (data) => {
  console.log("Players connected:", data);
  console.log("hiiiiiiii");
  document.getElementById("initial").style.display = "none";
  document.getElementById("gamePlay").style.display = "none";
  document.getElementById("waitingArea").style.display = "none";
  // document.getElementById("gameArea").style.display = "none";
  document.querySelector("main").style.display = "block";
  document.getElementById("gameAreaD").style.display = "block";
  document.getElementById("xyz").style.display = "none";
  document.body.style.background = "#c2aff0";
  // document.querySelector(".msg-container").style.display = 'block';
  let c1, c2;
  let d1, d2;
  if (player1) {
    c1 = "You : O";
    c2 = "Opponent : X";
    d1 = "Your Turn...";
    d2 = "";
  }
  if (!player1) {
    c1 = "You : X";
    c2 = "Opponent : O";
    d2 = "Waiting For Oppnent Move";
    d1 = "";
  }
  console.log(player1);
  document.getElementById("ch1").innerText = c1;
  document.getElementById("ch2").innerText = c2;
  // document.getElementById("player1ChoiceD").style.display = "none";

  document.getElementById("opponentStateD1").innerText = d1;
  document.getElementById("opponentStateD2").innerText = d2;

  // document.querySelector('.msg-container').style.display="block";
  // // document.getElementById("gameOptions").style.display = "block";
});

let boxes = document.querySelectorAll(".box");
let resetBtn = document.querySelector("#reset-btn");
let newGameBtn = document.querySelector("#new-game");
let msgContainer = document.querySelector(".msg-container");
let msg = document.querySelector("#msg");

let turn0 = true;
const winningPattern = [
  [0, 1, 2],
  [0, 3, 6],
  [0, 4, 8],
  [1, 4, 7],
  [2, 5, 8],
  [2, 4, 6],
  [3, 4, 5],
  [6, 7, 8],
];

const ResetBtn = () => {
  turn0 = true;
  enabledBtn();
  msgContainer.classList.add("hide");
};
// every box of boxes got diasbled
const disabledBtn = () => {
  for (let box of boxes) {
    box.disabled = true;
  }
};
const enabledBtn = () => {
  for (let box of boxes) {
    box.disabled = false;
    box.innerText = "";
  }
};
const showWinner = (winner) => {
  msg.innerText = `Congratulations, Winner is ${winner}`;
  msgContainer.classList.remove("hide");
  document.getElementById("xyz").style.display = "none";
  document.getElementById("gameAreaD").style.display = "none";

  disabledBtn();
};
const Draw = () => {
  msg.innerText = `OOPS DRAW!!`;
  msgContainer.classList.remove("hide");
  document.getElementById("xyz").style.display = "none";
  document.getElementById("gameAreaD").style.display = "none";
  disabledBtn();
};
const checkWinner = () => {
  for (pattern of winningPattern) {
    let pos0 = boxes[pattern[0]].innerText;
    let pos1 = boxes[pattern[1]].innerText;
    let pos2 = boxes[pattern[2]].innerText;
    console.log(pos0, pos1, pos2);
    if (
      pos0 != "" &&
      pos1 != "" &&
      pos2 != "" &&
      pos0 === pos2 &&
      pos0 === pos1
    ) {
      console.log(`Hurrah!! ${pos0}`);
      showWinner(pos0);
    }
  }
};

const DrawCondition = () => {
  let ok = true;
  for (box of boxes) {
    ok &= box.innerText != "";
  }
  if (ok) {
    Draw();
  }
};

// const funt = () => {
//   console.log("Clicked");
// };
// boxes.forEach((box) => {
//   box.addEventListener("click", funt);
// });

// boxes.forEach((box, index) => {
//   box.addEventListener("click", () => {
//     // console.log("Clicked");
//     // box.innerText = "ABCD";
//     console.log(player1, turn0);
//     if (turn0 === true) {
//       if (player1) {
//         box.innerText = "O";
//         box.classList.add("box0");
//         box.classList.remove("box1");
//         turn0 = false;
//         box.disabled = true;
//         socket.emit("choicep1D", {
//           index: index,
//           // boxes: boxes,
//           turn0: turn0,
//           roomUniqueId: roomUniqueId,
//         });
//         checkWinner();
//         DrawCondition();
//         console.log(player1, turn0);
//       } else {
//         alert("Wait For Oppenent Turns");
//       }
//     } else {
//       if (!player1) {
//         box.innerText = "X";
//         box.classList.remove("box0");
//         box.classList.add("box1");
//         turn0 = !turn0;
//         box.disabled = true;
//         socket.emit("choicep2D", {
//           boxes: boxes,
//           turn0: turn0,
//           roomUniqueId: roomUniqueId,
//         });
//         checkWinner();
//         DrawCondition();
//       } else {
//         alert("Wait For Oppenent Turnd");
//       }
//     }
//     // turn0 = !turn0;
//     // box.disabled = true;
//     // checkWinner();
//     // DrawCondition();
//   });
// });

// Add click event listeners to each box
boxes.forEach((box, index) => {
  box.addEventListener("click", () => {
    console.log(player1, turn0);
    if (turn0 === true) {
      if (player1) {
        box.innerText = "O";
        box.classList.add("box0");
        box.classList.remove("box1");
        turn0 = false;
        box.disabled = true;

        // Convert NodeList to Array and get the state of each box
        let boxesState = Array.from(boxes).map((b) => b.innerText);

        // Emit the move event to the server for player 1
        socket.emit("choicep1D", {
          index: index,
          boxes: boxesState,
          turn0: turn0,
          roomUniqueId: roomUniqueId,
          symbol: "O",
        });

        checkWinner();
        DrawCondition();
        console.log(player1, turn0);

        if (!player1) {
          c1 = "You : O";
          c2 = "Opponent : X";
          d1 = "Your Turn... dfghj";
          d2 = "";
        }
        if (player1) {
          c1 = "You : X";
          c2 = "Opponent : O";
          d2 = "Waiting For Oppnent Move fghjk";
          d1 = "";
        }
        console.log(player1);
        // document.getElementById("ch1").innerText = c1;
        // document.getElementById("ch2").innerText = c2;
        // document.getElementById("player1ChoiceD").style.display = "none";

        document.getElementById("opponentStateD1").innerText = d1;
        document.getElementById("opponentStateD2").innerText = d2;
        console.log(document.getElementById("opponentStateD1").innerText);
        console.log(document.getElementById("opponentStateD2").innerText);
      } else {
        alert("Wait For Opponent's Turn");
      }
    } else {
      if (!player1) {
        box.innerText = "X";
        box.classList.remove("box0");
        box.classList.add("box1");
        turn0 = !turn0;
        box.disabled = true;

        // Convert NodeList to Array and get the state of each box
        let boxesState = Array.from(boxes).map((b) => b.innerText);

        // Emit the move event to the server for player 2
        socket.emit("choicep2D", {
          index: index,
          boxes: boxesState,
          turn0: turn0,
          roomUniqueId: roomUniqueId,
          symbol: "X",
        });

        checkWinner();
        DrawCondition();

        // if (!player1) {
        //   c1 = "You : O";
        //   c2 = "Opponent : X";
        //   d1 = "Your Turn... dfghj";
        //   d2 = "";
        // }
        if (!player1) {
          c1 = "You : X";
          c2 = "Opponent : O";
          d2 = "Waiting For Oppnent Move fghjk";
          d1 = "";
        }
        console.log(player1);
        // document.getElementById("ch1").innerText = c1;
        // document.getElementById("ch2").innerText = c2;
        // document.getElementById("player1ChoiceD").style.display = "none";

        document.getElementById("opponentStateD1").innerText = d1;
        document.getElementById("opponentStateD2").innerText = d2;
        console.log(document.getElementById("opponentStateD1").innerText);
        console.log(document.getElementById("opponentStateD2").innerText);
      } else {
        alert("Wait For Opponent's Turn");
      }
    }
  });
});

// socket.on("p1ChoiceD", (data) => {
//   console.log("bccccc");
//   if (!player1) {
//     turn0 = data.turn0;
//     boxes = data.boxes;
//   }
//   console.log(player1);
//   console.log(turn0);
//   console.log(boxes);
// });

// socket.on("p2ChoiceD", (data) => {
//   if (player1) {
//     turn0 = data.turn0;
//     boxes = data.boxes;
//   }
// });

// Listen for move events from the server
socket.on("p1ChoiceD", (data) => {
  if (!player1) {
    console.log("bccccccccccccccccccc");
    updateBoxes(data.boxes);
    turn0 = data.turn0;
  }
  let c1, c2;
  let d1, d2;
  if (!player1) {
    c1 = "You : O";
    c2 = "Opponent : X";
    d1 = "Your Turn... dfghj";
    d2 = "";
  }
  if (player1) {
    c1 = "You : X";
    c2 = "Opponent : O";
    d2 = "Waiting For Oppnent Move fghjk";
    d1 = "";
  }
  console.log(player1);
  // document.getElementById("ch1").innerText = c1;
  // document.getElementById("ch2").innerText = c2;
  // document.getElementById("player1ChoiceD").style.display = "none";

  document.getElementById("opponentStateD1").innerText = d1;
  document.getElementById("opponentStateD2").innerText = d2;
  console.log(document.getElementById("opponentStateD1").innerText);
  console.log(document.getElementById("opponentStateD2").innerText);
});

socket.on("p2ChoiceD", (data) => {
  if (player1) {
    updateBoxes(data.boxes);
    turn0 = data.turn0;
  }
  let c1, c2;
  let d1, d2;
  if (player1) {
    c1 = "You : O";
    c2 = "Opponent : X";
    d1 = "Your Turn...  mbnvbc";
    d2 = "";
  }
  if (!player1) {
    c1 = "You : X";
    c2 = "Opponent : O";
    d2 = "Waiting For Oppnent Move iuyt";
    d1 = "";
  }
  console.log(player1);
  // document.getElementById("ch1").innerText = c1;
  // document.getElementById("ch2").innerText = c2;
  // document.getElementById("player1ChoiceD").style.display = "none";

  document.getElementById("opponentStateD1").innerText = d1;
  document.getElementById("opponentStateD2").innerText = d2;
});

function updateBoxes(boxesState) {
  boxesState.forEach((symbol, index) => {
    let box = boxes[index];
    box.innerText = symbol;
    box.disabled = symbol !== ""; // Disable box if it has a symbol
    box.classList.toggle("box0", symbol === "O");
    box.classList.toggle("box1", symbol === "X");
  });
}

resetBtn.addEventListener("click", ResetBtn);
newGameBtn.addEventListener("click", ResetBtn);
