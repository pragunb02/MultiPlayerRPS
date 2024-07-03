const mongoose = require("mongoose");

const GameSchema = new mongoose.Schema({
  roomUniqueId: {
    type: String,
    required: true,
  },
  player1Name: {
    type: String,
    required: true,
  },
  player2Name: {
    type: String,
    default: null,
  },
  winner: {
    type: [String], //array of strings
    default: [], // Default empty array
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("TicTacToeData", GameSchema);
