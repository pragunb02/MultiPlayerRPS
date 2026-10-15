const mongoose = require("mongoose");
const MongoDBStore = require("connect-mongodb-session")(
  require("express-session")
);
const { mongoUri } = require("./config");

mongoose.set("strictQuery", true); // Suppress deprecation warning

const store = new MongoDBStore({
  uri: mongoUri,
  collection: "sessions",
});

store.on("error", function (error) {
  console.error("Session store error", error);
});

const connectDB = async () => {
  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("Error connecting to MongoDB", error);
    process.exit(1);
  }
};

module.exports = {
  connectDB,
  store,
};
