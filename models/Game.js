// models/Game.js
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
  player1Choice: {
    type: String,
    default: null,
  },
  player2Choice: {
    type: String,
    default: null,
  },
  winner: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Game", GameSchema);
