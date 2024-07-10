const express = require("express");
const router = express.Router();
const RPSData = require("../../models/RPSData");
const ChessData = require("../../models/ChessData");
const TicTacToeData = require("../../models/TicTacToeData");

router.get("/userprofile", async (req, res) => {
  try {
    const username = req.user.username;

    const chessStats = await ChessData.find({
      $or: [{ player1Name: username }, { player2Name: username }],
    });
    const rpsStats = await RPSData.find({
      $or: [{ player1Name: username }, { player2Name: username }],
    });
    const ticTacToeStats = await TicTacToeData.find({
      $or: [{ player1Name: username }, { player2Name: username }],
    });

    res.render("profile", { username, chessStats, rpsStats, ticTacToeStats });
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
