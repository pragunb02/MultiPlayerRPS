const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const connectDB = require("./db");
const RPSData = require("./models/RPSData");
const TicTacToeData = require("./models/TicTacToeData");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 8080;

const rpsRooms = {};
const ticTacToeRooms = {};

// Connect to MongoDB
connectDB();

app.use(express.static(path.join(__dirname, "client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });

  // Create RPS Game
  socket.on("createRPSGame", async (data) => {
    try {
      const roomUniqueId = generateRoomId(5);
      rpsRooms[roomUniqueId] = { player1: data.playerName };
      socket.join(roomUniqueId);
      socket.emit("newRPSGame", { roomUniqueId });

      const gameData = new RPSData({
        roomUniqueId,
        player1Name: data.playerName,
      });
      await gameData.save();
    } catch (error) {
      console.error("Error creating RPS game:", error);
    }
  });

  // Join RPS Game
  socket.on("joinRPSGame", async (data) => {
    try {
      const room = rpsRooms[data.roomUniqueId];
      if (room) {
        room.player2 = data.playerName;
        socket.join(data.roomUniqueId);
        // socket.to(data.roomUniqueId).emit("playersConnectedRPS", { data: "p1" });
        io.to(data.roomUniqueId).emit("playersConnectedRPS");
        socket.emit("playersConnectedRPS");
        await RPSData.findOneAndUpdate(
          { roomUniqueId: data.roomUniqueId },
          { player2Name: data.playerName }
        );
      }
    } catch (error) {
      console.error("Error joining RPS game:", error);
    }
  });

  // Player 1 RPS Choice
  socket.on("player1ChoiceRPS", async (data) => {
    try {
      const room = rpsRooms[data.roomUniqueId];
      room.player1Choice = data.choice;
      socket
        .to(data.roomUniqueId)
        .emit("player1ChoiceRPS", { choice: data.choice });
      if (room.player2Choice) {
        await determineRPSWinner(data.roomUniqueId);
      }
      await RPSData.findOneAndUpdate(
        { roomUniqueId: data.roomUniqueId },
        { player1Choice: data.choice }
      );
    } catch (error) {
      console.error("Error handling player 1 RPS choice:", error);
    }
  });

  // Player 2 RPS Choice
  socket.on("player2ChoiceRPS", async (data) => {
    try {
      const room = rpsRooms[data.roomUniqueId];
      room.player2Choice = data.choice;
      socket
        .to(data.roomUniqueId)
        .emit("player2ChoiceRPS", { choice: data.choice });
      if (room.player1Choice) {
        await determineRPSWinner(data.roomUniqueId);
      }
      await RPSData.findOneAndUpdate(
        { roomUniqueId: data.roomUniqueId },
        { player2Choice: data.choice }
      );
    } catch (error) {
      console.error("Error handling player 2 RPS choice:", error);
    }
  });

  // ****

  // Create Tic Tac Toe Game
  socket.on("createTicTacToeGame", async (data) => {
    try {
      const roomUniqueId = generateRoomId(5);
      ticTacToeRooms[roomUniqueId] = { player1: data.playerName };
      socket.join(roomUniqueId);
      socket.emit("playersConnectingTicTacToe", { roomUniqueId });

      const gameData = new TicTacToeData({
        roomUniqueId,
        player1Name: data.playerName,
      });
      await gameData.save();
    } catch (error) {
      console.error("Error creating Tic Tac Toe game:", error);
    }
  });

  // Join Tic Tac Toe Game
  socket.on("joinTicTacToeGame", async (data) => {
    try {
      const room = ticTacToeRooms[data.roomUniqueId];
      if (room) {
        room.player2 = data.playerName;
        socket.join(data.roomUniqueId);
        io.to(data.roomUniqueId).emit("playersConnectedTicTacToe");
        await TicTacToeData.findOneAndUpdate(
          { roomUniqueId: data.roomUniqueId },
          { player2Name: data.playerName }
        );
      }
    } catch (error) {
      console.error("Error joining Tic Tac Toe game:", error);
    }
  });

  // Player 1 Tic Tac Toe Move
  socket.on("player1Move", (data) => {
    const room = ticTacToeRooms[data.roomUniqueId];
    socket.to(data.roomUniqueId).emit("player1Move", {
      isPlayer1Turn: data.isPlayer1Turn,
      boxes: data.boxes,
    });
  });

  // Player 2 Tic Tac Toe Move
  socket.on("player2Move", (data) => {
    const room = ticTacToeRooms[data.roomUniqueId];
    socket.to(data.roomUniqueId).emit("player2Move", {
      isPlayer1Turn: data.isPlayer1Turn,
      boxes: data.boxes,
    });
  });

  // Announce Tic Tac Toe Winner
  socket.on("announceWinner", async (data) => {
    const { winner, roomUniqueId } = data;
    await TicTacToeData.findOneAndUpdate({ roomUniqueId }, { winner });
    socket.to(roomUniqueId).emit("announceWinner", { winner });
  });

  // Announce Tic Tac Toe Draw
  socket.on("announceDraw", async (data) => {
    const { roomUniqueId } = data;
    await TicTacToeData.findOneAndUpdate({ roomUniqueId }, { winner: "Draw" });
    socket.to(roomUniqueId).emit("announceDraw");
  });

  // Request Room Data for Tic Tac Toe
  socket.on("requestTicTacToeRoomData", async ({ roomUniqueId }) => {
    try {
      const roomData = await TicTacToeData.findOne({ roomUniqueId });
      socket.emit("roomDataResponse", { roomData });
    } catch (error) {
      console.error("Error requesting Tic Tac Toe room data:", error);
    }
  });
});

// Determine RPS Winner
async function determineRPSWinner(roomUniqueId) {
  const room = rpsRooms[roomUniqueId];
  const p1 = room.player1Choice;
  const p2 = room.player2Choice;
  let winner;

  if (p1 === p2) {
    winner = "draw";
  } else if (
    (p1 === "Paper" && p2 === "Rock") ||
    (p1 === "Rock" && p2 === "Scissors") ||
    (p1 === "Scissors" && p2 === "Paper")
  ) {
    winner = "player1";
  } else {
    winner = "player2";
  }

  io.to(roomUniqueId).emit("rpsGameResult", { winner });
  // why io

  room.player1Choice = null;
  room.player2Choice = null;

  await RPSData.findOneAndUpdate({ roomUniqueId }, { winner });
}

// Generate Room ID
function generateRoomId(length) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

server.listen(PORT, () => {
  console.log(`Listening on PORT ${PORT}`);
});
