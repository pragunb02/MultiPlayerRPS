// db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // .connect("mongodb://127.0.0.1:27017/Bookstore1", {
    await mongoose.connect("mongodb://127.0.0.1:27017/Bookstore1", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected");
  } catch (error) {
    console.error("Error connecting to MongoDB", error);
    process.exit(1);
  }
};

module.exports = connectDB;
