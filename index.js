const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
require("dotenv").config();
const { connectDB, store } = require("./db");
const bodyParser = require("body-parser");
const session = require("express-session");
const authRouter = require("./client/routes/auth");
const gamesRoutes = require("./client/routes/gamesRoutes");
const userRoutes = require("./client/routes/userRoutes");
const passport = require("./client/routes/passport");
const RPSData = require("./models/RPSData");
const ChessData = require("./models/ChessData");
const TicTacToeData = require("./models/TicTacToeData");
const User = require("./models/User"); // Import User model

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;
const SESSION_SECRET = process.env.SESSION_SECRET;
const chessRooms = {};
const ticTacToeRooms = {};
const rpsRooms = {};
const LEVEL_UP_THRESHOLD = 10; // Number of games to level up

const userSocketMap = {}; // Map to track user IDs and socket IDs

// Connect to MongoDB
connectDB();

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Session configuration
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

app.use(express.static(path.join(__dirname, "client")));
// Set up view engine and static files
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "client"));

app.use(passport.initialize());
app.use(passport.session()); // This is essential for persistent login sessions
app.use("/auth", authRouter);
app.use("/games", gamesRoutes);
app.use("/u/:username", isAuthenticated, userRoutes);

// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login-signup.html?a=0");
}

// Root Route
app.get("/", async (req, res) => {
  const user = req.user ? await User.findById(req.user._id) : { username: "Guest", gamesPlayed: 0, level: 1 };
  const showDropdown = req.user ? req.user : null;

  const games = [
    {
      id: "rockpaperscissors",
      title: "Rock Paper Scissors",
      link: "/games/rockpaperscissors",
      image: "/space-game-background-neon-night-alien-landscape-free-vector.jpg",
      icon: "fas fa-hand-peace",
    },
    {
      id: "tictactoe",
      title: "Tic Tac Toe",
      link: "/games/tictactoe",
      image: "/space-game-background-neon-night-alien-landscape-free-vector.jpg",
      icon: "fas fa-hand-peace",
    },
    {
      id: "chess",
      title: "Chess",
      link: "/games/chess",
      image: "/space-game-background-neon-night-alien-landscape-free-vector.jpg",
      icon: "fas fa-chess",
    },
  ];

  res.render("index", {
    title: "Gaming Arena",
    user: {
      id: req.user ? req.user._id : null,
      name: req.user ? req.user.username : "Guest",
      isLoggedIn: !!req.user,
      gamesPlayed: user.gamesPlayed,
      level: user.level,
    },
    showDropdown,
    games: games,
  });
});


// CHECK THIS ***********
// Middleware to update games played and level
async function updateUserGameCount(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    user.gamesPlayed += 1;

    // Calculate new level
    const newLevel = Math.floor(user.gamesPlayed / LEVEL_UP_THRESHOLD) + 1;
    if (newLevel > user.level) {
      user.level = newLevel;
      // Emit levelUp event to the user's socket
      const socketId = userSocketMap[userId];
      if (socketId) {
        io.to(socketId).emit("levelUp", { level: newLevel });
      }
      console.log(`User ${user.username} leveled up to Level ${newLevel}!`);
    }

    await user.save();
  } catch (error) {
    console.error("Error updating user game count:", error);
  }
}

io.on("connection", (socket) => {
  console.log("A user connected");

  // CHECK THIS ***********
  // Register user ID to socket
  socket.on("registerUser", (userId) => {
    userSocketMap[userId] = socket.id;
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
    // CHECK THIS ***********
    // Remove user from the map upon disconnection
    for (const [userId, sockId] of Object.entries(userSocketMap)) {
      if (sockId === socket.id) {
        delete userSocketMap[userId];
        break;
      }
    }
  });

  // === Rock Paper Scissors (RPS) Events ===

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

  // Request Room Data for RPS
  socket.on("requestRPSRoomData", async ({ roomUniqueId }) => {
    try {
      const roomData = await RPSData.findOne({ roomUniqueId });
      socket.emit("roomDataResponse", { roomData });
    } catch (error) {
      console.error("Error requesting RPS room data:", error);
    }
  });

  // === Tic Tac Toe Events ===

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
    socket.to(roomUniqueId).emit("announceWinner", { data })


    // CHECK THIS ***********
    // Update games played and level for both players
    const gameData = await TicTacToeData.findOne({ roomUniqueId });
    if (gameData) {
      const player1 = await User.findOne({ username: gameData.player1Name });
      const player2 = await User.findOne({ username: gameData.player2Name });

      if (player1) {
        updateUserGameCount(player1._id);
      }
      if (player2) {
        updateUserGameCount(player2._id);
      }
    }
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


    // CHECK THIS ***********
    // Update games played and level for both players
    const gameData = await TicTacToeData.findOne({ roomUniqueId });
    if (gameData) {
      const player1 = await User.findOne({ username: gameData.player1Name });
      const player2 = await User.findOne({ username: gameData.player2Name });

      if (player1) {
        updateUserGameCount(player1._id);
      }
      if (player2) {
        updateUserGameCount(player2._id);
      }
    }
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

  // === Chess Events ===

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

          // CHECK THIS ***********
          // Update games played and level for both players
          const gameData = await ChessData.findOne({ roomUniqueId: data.roomUniqueId });
          if (gameData) {
            const player1 = await User.findOne({ username: gameData.player1Name });
            const player2 = await User.findOne({ username: gameData.player2Name });

            if (player1) {
              updateUserGameCount(player1._id);
            }
            if (player2) {
              updateUserGameCount(player2._id);
            }
          }
        } else {
          socket.emit("FullChess");
        }
      } else {
        // Handle invalid room
        // CHECK THIS ***********
        socket.emit("InvalidChessRoom");
      }
    } catch (error) {
      console.error("Error joining Chess game:", error);
    }
  });

  // Chess Moves (Assuming you have existing logic)
  let currentCode = null;

  socket.on("move", function (data) {
    const move = data.theMove;
    const timer = data.timer;
    const moveObj = data.moveObj;
    console.log("move detected");
    console.log(data);

    io.to(currentCode).emit("newMove", data);
  });
  socket.on("joinGame", function (data) {
    const roomId = data.code;
    currentCode = data.code;
    socket.join(roomId);
    if (!chessRooms[currentCode]) {
      chessRooms[currentCode] = true;
      return;
    }
    socket.emit("startGame");
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

  // Reset choices
  room.player1Choice = null;
  room.player2Choice = null;

  // Update game data in DB
  await RPSData.findOneAndUpdate({ roomUniqueId }, { winner });

  // CHECK THIS ***********
  // Update games played and level for both players
  const gameData = await RPSData.findOne({ roomUniqueId });
  if (gameData) {
    const player1 = await User.findOne({ username: gameData.player1Name });
    const player2 = await User.findOne({ username: gameData.player2Name });

    if (player1) {
      updateUserGameCount(player1._id);
    }
    if (player2) {
      updateUserGameCount(player2._id);
    }
  }
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
