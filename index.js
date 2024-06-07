const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const connectDB = require("./db");
const Game = require("./models/Game");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 8080;
const rooms = {};

// Connect to MongoDB
connectDB();

app.use(express.static(path.join(__dirname, "client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

io.on("connection", (socket) => {
  console.log("A user is connected");

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });

  socket.on("createGame", async (data) => {
    const roomUniqueId = makeId(5);
    rooms[roomUniqueId] = { player1: data.playerName };
    socket.join(roomUniqueId);
    socket.emit("newGame", { roomUniqueId: roomUniqueId });

    // Create a new game document
    const game = new Game({
      roomUniqueId: roomUniqueId,
      player1Name: data.playerName,
    });
    await game.save();
  });

  socket.on("joinGame", async (data) => {
    const room = rooms[data.roomUniqueId];
    if (room) {
      room.player2 = data.playerName;
      socket.join(data.roomUniqueId);
      socket.to(data.roomUniqueId).emit("playersConnected", { data: "p1" });
      socket.emit("playersConnected", { data: "p2" });

      // Update game document
      await Game.findOneAndUpdate(
        { roomUniqueId: data.roomUniqueId },
        { player2Name: data.playerName }
      );
    }
  });

  socket.on("p1Choice", async (data) => {
    const room = rooms[data.roomUniqueId];
    room.p1Choice = data.rpsChoice;
    socket
      .to(data.roomUniqueId)
      .emit("p1Choice", { rpsChoice: data.rpsChoice });
    if (room.p2Choice) {
      await declareWinner(data.roomUniqueId);
    }

    // Update game document
    await Game.findOneAndUpdate(
      { roomUniqueId: data.roomUniqueId },
      { player1Choice: data.rpsChoice }
    );
  });

  socket.on("p2Choice", async (data) => {
    const room = rooms[data.roomUniqueId];
    room.p2Choice = data.rpsChoice;
    socket
      .to(data.roomUniqueId)
      .emit("p2Choice", { rpsChoice: data.rpsChoice });
    if (room.p1Choice) {
      await declareWinner(data.roomUniqueId);
    }

    // Update game document
    await Game.findOneAndUpdate(
      { roomUniqueId: data.roomUniqueId },
      { player2Choice: data.rpsChoice }
    );
  });
});

async function declareWinner(roomUniqueId) {
  const room = rooms[roomUniqueId];
  const p1 = room.p1Choice;
  const p2 = room.p2Choice;
  let winner;

  if (p1 === p2) {
    winner = "d";
  } else if (
    (p1 === "Paper" && p2 === "Rock") ||
    (p1 === "Rock" && p2 === "Scissor") ||
    (p1 === "Scissor" && p2 === "Paper")
  ) {
    winner = "p1";
  } else {
    winner = "p2";
  }

  io.to(roomUniqueId).emit("result", { winner: winner });

  room.p1Choice = null;
  room.p2Choice = null;

  // Update game document
  await Game.findOneAndUpdate(
    { roomUniqueId: roomUniqueId },
    { winner: winner }
  );
}

function makeId(length) {
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
