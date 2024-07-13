const mongoose = require("mongoose");
const MongoDBStore = require("connect-mongodb-session")(
  require("express-session")
);
require("dotenv").config();

mongoose.set("strictQuery", true); // Suppress deprecation warning

const s1 = process.env.MONGO_URI_PRODUCTION;
const s2 = process.env.MONGO_URI_LOCAL;

// Logging to check if environment variables are loaded
console.log("MONGO_URI_PRODUCTION:", s1);
console.log("MONGO_URI_LOCAL:", s2);

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
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
    });
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
