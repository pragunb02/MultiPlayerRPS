const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
// const handlebars = require("express-handlebars");
const connectDB = require("./db");
const RPSData = require("./models/RPSData");
const TicTacToeData = require("./models/TicTacToeData");
const ChessData = require("./models/ChessData");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 8080;

const rpsRooms = {};
const ticTacToeRooms = {};
const chessRooms = {};

// Connect to MongoDB
connectDB();

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "client")); // Assuming your views are in a 'views' folder

app.use(express.static(path.join(__dirname, "client")));

app.use("/public", express.static(path.join(__dirname, "front", "public")));

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
      rpsRooms[roomUniqueId] = { player1: data.playerName, capacity: true };

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
        if (room.capacity === true) {
          room.player2 = data.playerName;
          socket.join(data.roomUniqueId);
          io.to(data.roomUniqueId).emit("playersConnectedRPS");
          socket.emit("playersConnectedRPS");
          await RPSData.findOneAndUpdate(
            { roomUniqueId: data.roomUniqueId },
            { player2Name: data.playerName }
          );
          room.capacity = false;
        } else {
          socket.emit("FullRPS");
        }
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

  // Request Room Data for Tic Tac Toe
  socket.on("requestRPSRoomData", async ({ roomUniqueId }) => {
    try {
      const roomData = await RPSData.findOne({ roomUniqueId });
      socket.emit("roomDataResponse", { roomData });
    } catch (error) {
      console.error("Error requesting Tic Tac Toe room data:", error);
    }
  });

  // ****

  // Create Tic Tac Toe Game
  socket.on("createTicTacToeGame", async (data) => {
    try {
      const roomUniqueId = generateRoomId(5);
      ticTacToeRooms[roomUniqueId] = { player1: data.playerName };
      ticTacToeRooms[roomUniqueId] = { capacity: true };
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
        if (room.capacity === true) {
          room.player2 = data.playerName;
          socket.join(data.roomUniqueId);
          io.to(data.roomUniqueId).emit("playersConnectedTicTacToe");
          await TicTacToeData.findOneAndUpdate(
            { roomUniqueId: data.roomUniqueId },
            { player2Name: data.playerName }
          );
          room.capacity = false;
        } else {
          socket.emit("FullTicTacToe");
        }
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
      count: data.count,
    });
  });

  // Player 2 Tic Tac Toe Move
  socket.on("player2Move", (data) => {
    const room = ticTacToeRooms[data.roomUniqueId];
    socket.to(data.roomUniqueId).emit("player2Move", {
      isPlayer1Turn: data.isPlayer1Turn,
      boxes: data.boxes,
      count: data.count,
    });
  });

  // Announce Tic Tac Toe Winner
  socket.on("announceWinner", async (data) => {
    const { winner, roomUniqueId, count, ok } = data;
    await TicTacToeData.findOneAndUpdate(
      { roomUniqueId },
      { $push: { winner: winner } },
      { new: true }
    );
    socket.to(roomUniqueId).emit("announceWinner", { data });
  });

  // Announce Tic Tac Toe Draw
  socket.on("announceDraw", async (data) => {
    const { roomUniqueId, count, ok } = data;
    await TicTacToeData.findOneAndUpdate(
      { roomUniqueId },
      { $push: { winner: "Draw" } },
      { new: true }
    );
    socket.to(roomUniqueId).emit("announceDraw", { data });
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

  socket.on("requestResetGameTicTacToe", (data) => {
    socket.to(data.roomUniqueId).emit("ConfirmResetGameTicTacToe", {
      isplayer1: data.isplayer1,
    });
  });
  // Request of Reseting the game Board

  socket.on("resetResponseTicTacToe", ({ response, roomUniqueId }) => {
    if (response === true) {
      socket.to(roomUniqueId).emit("resetingTicTacToe");
    } else {
      socket.to(roomUniqueId).emit("CancelingRequestResetGameTicTacToc");
    }
  });

  socket.on("requestNewGameTicTacToe", (data) => {
    socket.to(data.roomUniqueId).emit("ConfirmNewGameTicTacToe", {
      isplayer1: data.isplayer1,
    });
  });
  socket.on("NewGameResponseTicTacToe", ({ response, roomUniqueId }) => {
    if (response === true) {
      socket.to(roomUniqueId).emit("NewGameTicTacToe");
    } else {
      socket.to(roomUniqueId).emit("CancelingRequestNewGameTicTacToc");
    }
  });

  // Create Chess Game
  var isplayer12 = false;
  socket.on("createChessGame", async (data) => {
    console.log("Hi");
    isplayer12 = data.isPlayer1Turn;
    try {
      const roomUniqueId = generateRoomId(5);
      chessRooms[roomUniqueId] = {
        player1: data.playerName,
        capacity: true,
        player1Color: "white",
        player2Color: "black",
        roomUniqueId,
      };
      console.log("rooms");
      console.log(chessRooms[roomUniqueId]);
      socket.join(roomUniqueId);
      socket.emit("playersConnectingChess", { roomUniqueId });

      const gameData = new ChessData({
        roomUniqueId,
        player1Name: data.playerName,
        player1Color: "white",
        player2Color: "black",
      });
      await gameData.save();
    } catch (error) {
      console.error("Error creating Chess game:", error);
    }
  });

  // Join Chess Game
  socket.on("joinChessGame", async (data) => {
    console.log("Joining Button2");
    console.log("data", data);
    try {
      const room = chessRooms[data.roomUniqueId];
      console.log(room);
      if (room) {
        if (room.capacity === true) {
          room.player2 = data.playerName;
          console.log("roooooms");
          console.log(room);
          socket.join(data.roomUniqueId);
          io.to(data.roomUniqueId).emit("playersConnectedChess");
          await ChessData.findOneAndUpdate(
            { roomUniqueId: data.roomUniqueId },
            { player2Name: data.playerName }
          );
          room.capacity = false;
        } else {
          socket.emit("FullChess");
        }
      }
    } catch (error) {
      console.error("Error joining Tic Tac Toe game:", error);
    }
  });

  let currentCode = null;

  socket.on("move", function (move) {
    console.log("move detected");
    console.log(move);

    io.to(currentCode).emit("newMove", move);
  });

  // Socket.io event handler for 'notify'
  socket.on("notify", (data) => {
    console.log(data); // Ensure data is received correctly
    const roomId = data.data; // Assuming 'roomUniqueId' is correctly sent from client
    console.log(data.data);
    console.log("Received roomUniqueId:", roomId);

    // Emit 'notifyChess' event to the specified room
    io.to(roomId).emit("notifyChess");

    // Example: Broadcast to all clients in the room
    // io.in(roomId).emit("notifyChess");
  });

  socket.on("joinGame", function (data) {
    const roomId = data.code;
    currentCode = data.code;
    socket.join(roomId);
    if (!chessRooms[currentCode]) {
      chessRooms[currentCode] = true;
      return;
    }
    // io.to(roomId).emit("notify");
    io.to(roomId).emit("startGame", { isplayer12 });
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

// Route for serving Chess game with white color
app.get("/white", async (req, res) => {
  const roomUniqueId = req.query.code;
  if (!chessRooms[roomUniqueId]) {
    return res.redirect("/?error=invalidCode");
  }
  res.render("game", {
    color: "white",
  });
});

// Route for serving Chess game with black color
app.get("/black", async (req, res) => {
  const roomUniqueId = req.query.code;
  if (!chessRooms[roomUniqueId]) {
    return res.redirect("/?error=invalidCode");
  }
  res.render("game", {
    color: "black",
  });
});

server.listen(PORT, () => {
  console.log(`Listening on PORT ${PORT}`);
});
