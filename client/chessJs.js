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

socket.on("playersConnectingChess", (data) => {
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

socket.on("playersConnectedChess", (data) => {
  console.log("Hell0000000000000000000000o");
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
  socket.emit("createChessGame", { playerName, isPlayer1Turn });
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
