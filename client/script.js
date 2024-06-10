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
    document.getElementById("gameArea").style.display = "none";
    document.querySelector('main').style.display = 'block';
    document.getElementById("gameAreaD").style.display = "none";
    document.getElementById('xyz').style.display = 'none';
    document.body.style.background="#c2aff0"
    // document.querySelector(".msg-container").style.display = 'block';
    let c1,c2;
    if(player1){
        c1="You : O";
        c2="Opponent : X";
    }
    if(!player){
        c1="You : X";
        c2="Opponent : O";
    }
    document.getElementById("ch1").innerText=c1;
    document.getElementById("ch2").innerText=c2;

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
  disabledBtn();
};
const Draw = () => {
  msg.innerText = `OOPS DRAW!!`;
  msgContainer.classList.remove("hide");
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

boxes.forEach((box) => {
  box.addEventListener("click", () => {
    // console.log("Clicked");
    // box.innerText = "ABCD";
    if (turn0 === true) {
      box.innerText = "O";
      box.classList.add("box0");
      box.classList.remove("box1");
    } else {
      box.innerText = "X";
      box.classList.remove("box0");
      box.classList.add("box1");
    }
    turn0 = !turn0;
    box.disabled = true;
    checkWinner();
    DrawCondition();
  });
});

resetBtn.addEventListener("click", ResetBtn);
newGameBtn.addEventListener("click", ResetBtn);
