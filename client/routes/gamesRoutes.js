const express = require("express");
const router = express.Router();
// const isAuthenticated = require("./middleware/isAuthenticated"); // Assuming you have isAuthenticated middleware configured
const RPSData = require("../../models/RPSData");
const ChessData = require("../../models/ChessData");
const TicTacToeData = require("../../models/TicTacToeData");
router.get("/chess", (req, res) => {
  const user = req.session.user || { username: "Guest" };
  console.log(user);
  res.render("index4", {
    user: {
      name: user.username,
      isLoggedIn: !!req.session.user,
    },
  });
});
router.get("/tictactoe", (req, res) => {
  const user = req.session.user || { username: "Guest" };

  res.render("index3", {
    user: {
      name: user.username,
      isLoggedIn: !!req.session.user,
    },
  });
});
router.get("/rockpaperscissors", (req, res) => {
  const user = req.session.user || { username: "Guest" };

  res.render("index2", {
    user: {
      name: user.username,
      isLoggedIn: !!req.session.user,
    },
  });
});

module.exports = router;
