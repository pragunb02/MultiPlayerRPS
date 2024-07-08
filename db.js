const mongoose = require("mongoose");
const MongoDBStore = require("connect-mongodb-session")(
  require("express-session")
);

const s1 =
  "mongodb+srv://pragunb02:pragunb02@cluster0.ch62m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const s2 = "mongodb://127.0.0.1:27017/Bookstore1";

const store = new MongoDBStore({
  uri: s1,
  collection: "sessions",
});

store.on("error", function (error) {
  console.error("Session store error", error);
});

const connectDB = async () => {
  try {
    await mongoose.connect(s1, {
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
