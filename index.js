const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const connectDB = require("./db");
const Game = require("./models/Game");
const GameD = require("./models/GameD");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 8080;
const rooms = {};
const roomsD = {};

// Connect to MongoDB
connectDB();
// const rid=1;
app.use(express.static(path.join(__dirname, "client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

io.on("connection", (socket) => {
  console.log("A user is connected");
  console.log("okji1");
  socket.on("disconnect", () => {
    // if(rid!=1){
    //   rooms[rid]=NULL;
    // }
    // console.log("abcd");
    // console.log(rooms)
    console.log("User disconnected");
  });

  socket.on("createGame", async (data) => {
    try {
      const roomUniqueId = makeId(5);
      // rid=roomUniqueId;
      rooms[roomUniqueId] = { player1: data.playerName };
      socket.join(roomUniqueId);
      socket.emit("newGame", { roomUniqueId: roomUniqueId });

      const game = new Game({
        roomUniqueId: roomUniqueId,
        player1Name: data.playerName,
      });
      await game.save();
    } catch (error) {
      console.error("Error creating game:", error);
    }
  });

  console.log("okji2");
  socket.on("createGameD", async (data) => {
    try {
      console.log("arewe");
      const roomUniqueId = makeId(5);
      // rid=roomUniqueId;
      roomsD[roomUniqueId] = { player1: data.playerName };
      socket.join(roomUniqueId);
      console.log("happen");
      console.log(roomUniqueId);
      socket.emit("newGameD", { roomUniqueId: roomUniqueId });

      const gameD = new GameD({
        roomUniqueId: roomUniqueId,
        player1Name: data.playerName,
      });
      await gameD.save();
    } catch (error) {
      console.error("Error creating game:", error);
    }
  });

  socket.on("joinGame", async (data) => {
    try {
      const room = rooms[data.roomUniqueId];
      if (room) {
        room.player2 = data.playerName;
        socket.join(data.roomUniqueId);
        socket.to(data.roomUniqueId).emit("playersConnected", { data: "p1" });
        socket.emit("playersConnected", { data: "p2" });

        await Game.findOneAndUpdate(
          { roomUniqueId: data.roomUniqueId },
          { player2Name: data.playerName }
        );
      }
    } catch (error) {
      alert("Error joining game:");
      console.error("Error joining game:", error);
    }
  });

  socket.on("joinGameD", async (data) => {
    console.log("indised54");
    // console.log("indised54");
    console.log("Received data:", data); // Log the received data
    try {
      console.log("indised");
      const room = roomsD[data.roomUniqueId];
      // console.log()
      console.log("vghb", room);
      if (room) {
        room.player2 = data.playerName;
        socket.join(data.roomUniqueId);
        socket.to(data.roomUniqueId).emit("playersConnectedD", { data: "p1" });
        socket.emit("playersConnectedD", { data: "p2" });

        console.log("yes");
        await GameD.findOneAndUpdate(
          { roomUniqueId: data.roomUniqueId },
          { player2Name: data.playerName }
        );
        console.log("indisedw");
      }
    } catch (error) {
      alert("Error joining game:");
      console.error("Error joining game:", error);
    }
    console.log("no on ");
  });

  socket.on("p1Choice", async (data) => {
    try {
      const room = rooms[data.roomUniqueId];
      room.p1Choice = data.rpsChoice;
      socket
        .to(data.roomUniqueId)
        .emit("p1Choice", { rpsChoice: data.rpsChoice });
      if (room.p2Choice) {
        await declareWinner(data.roomUniqueId);
      }

      await Game.findOneAndUpdate(
        { roomUniqueId: data.roomUniqueId },
        { player1Choice: data.rpsChoice }
      );
    } catch (error) {
      console.error("Error handling player 1 choice:", error);
    }
  });

  socket.on("choicep1D", async (data) => {
    console.log("here1");
    try {
      const room = roomsD[data.roomUniqueId];
      socket.to(data.roomUniqueId).emit("p1ChoiceD", {
        turn0: data.turn0,
        boxes: data.boxes,
      });
      console.log("here2");
      await GameD.findOneAndUpdate(
        { roomUniqueId: data.roomUniqueId }
        // { player1Choice: data.rpsChoice }
      );
    } catch (error) {
      console.error("Error handling player 1 choiceD:", error);
    }
  });

  socket.on("p2Choice", async (data) => {
    try {
      const room = rooms[data.roomUniqueId];
      room.p2Choice = data.rpsChoice;
      socket
        .to(data.roomUniqueId)
        .emit("p2Choice", { rpsChoice: data.rpsChoice });
      if (room.p1Choice) {
        await declareWinner(data.roomUniqueId);
      }

      await Game.findOneAndUpdate(
        { roomUniqueId: data.roomUniqueId },
        { player2Choice: data.rpsChoice }
      );
    } catch (error) {
      console.error("Error handling player 2 choice:", error);
    }
  });

  // socket.on("choicep2D", async (data) => {
  //   console.log("here1");
  //   try {
  //     const room = roomsD[data.roomUniqueId];
  //     socket.to(data.roomUniqueId).emit("p2ChoiceD", {
  //       turn0: data.turn0,
  //       boxes: data.boxes,
  //     });
  //     console.log("here2");
  //     await GameD.findOneAndUpdate(
  //       { roomUniqueId: data.roomUniqueId }
  //       // { player1Choice: data.rpsChoice }
  //     );
  //   } catch (error) {
  //     console.error("Error handling player 1 choiceD:", error);
  //   }
  // });

  socket.on("choicep1D", (data) => {
    console.log("here1");
    try {
      const room = roomsD[data.roomUniqueId];
      socket.to(data.roomUniqueId).emit("p1ChoiceD", {
        turn0: data.turn0,
        boxes: data.boxes,
        symbol: data.symbol,
      });
      console.log("here2");
      // await GameD.findOneAndUpdate(
      //   { roomUniqueId: data.roomUniqueId }
      //   // { player1Choice: data.boxes } // Updated with player1Choice
      // );
    } catch (error) {
      console.error("Error handling player 1 choiceD:", error);
    }
  });

  socket.on("choicep2D", (data) => {
    console.log("bccccc");
    try {
      const room = roomsD[data.roomUniqueId];
      socket.to(data.roomUniqueId).emit("p2ChoiceD", {
        turn0: data.turn0,
        boxes: data.boxes,

        symbol: data.symbol,
      });
      console.log("here2");
      // await GameD.findOneAndUpdate(
      //   { roomUniqueId: data.roomUniqueId }
      //   // { player2Choice: data.boxes } // Updated with player2Choice
      // );
    } catch (error) {
      console.error("Error handling player 2 choiceD:", error);
    }
  });

  socket.on("winnerAnnouncement", (data) => {
    console.log("getting now wait for upafdting");
    const { winner, roomUniqueId } = data;
    socket.to(roomUniqueId).emit("winnerAnnouncements", { winner });
  });

  socket.on("drawAnnouncement", (data) => {
    console.log("getting now wait for upafdting");
    const { roomUniqueId } = data;
    socket.to(roomUniqueId).emit("drawAnnouncements", { roomUniqueId });
  });

  socket.on("updateBoxesState", (data) => {
    const { roomUniqueId, boxesState } = data;
    console.log("ppppppp", typeof boxesState);
    socket.to(roomUniqueId).emit("updateBoxesStates", { boxesState });
  });

  // socket.on("connection", (socket) => {
  socket.on("requestRoomData", async ({ roomUniqueId }) => {
    try {
      const rid = roomUniqueId;
      console.log("find data of roomid", rid);
      const roomData = await GameD.findOne({ roomUniqueId: rid });
      console.log("usssss iddd", rid);
      console.log(roomData);
      socket.emit("roomDataResponse", { roomData });
    } catch (error) {
      console.error(error);
    }
  });
  // });
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
