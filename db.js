const mongoose = require("mongoose");

const s1 =
  "mongodb+srv://pragunb02:pragunb02@cluster0.ch62m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const s2 = "mongodb://127.0.0.1:27017/Bookstore1";
const connectDB = async () => {
  try {
    await mongoose.connect(s2, {
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
