const mongoose = require("mongoose");
const MongoDBStore = require("connect-mongodb-session")(
  require("express-session")
);

const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

// Get the MongoDB URIs from environment variables
const s1 = process.env.MONGO_URI_PRODUCTION;
const s2 = process.env.MONGO_URI_LOCAL;

// Define the MongoDB session store
const store = new MongoDBStore({
  uri: s1,
  collection: "sessions",
});

store.on("error", function (error) {
  console.error("Session store error", error);
});

// Function to connect to MongoDB
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

// Export both connectDB and store
module.exports = {
  connectDB,
  store,
};
