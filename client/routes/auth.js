const express = require("express");
const router = express.Router();
const passport = require("./passport");
const User = require("../../models/User");
const bcrypt = require("bcrypt"); // Import bcrypt
// console.log(passport);
router.use(express.json());
// router.use(flash());
router.use(passport.initialize());

router.use(passport.session());

// // This is the login route
// router.post("/login", (req, res) => {
//   const { email, password } = req.body;
//   // console.log(res.body);
//   console.log(req.body);
//   console.log("ok");
//   // Add your authentication logic here
//   // If authentication is successful
//   res.json({ success: true });
//   // If authentication fails
//   // res.json({ success: false, message: 'Invalid credentials' });
// });
router.post("/login", (req, res, next) => {
  console.log("Received login request with data:", req.body);
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      console.error("Authentication error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Authentication error." });
    }
    if (!user) {
      console.log("Failed login attempt:", info.message);
      return res.status(400).json({ success: false, message: info.message });
    }
    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error("Login error:", loginErr);
        return res
          .status(500)
          .json({ success: false, message: "Login error." });
      }
      // Set user information in the session
      req.session.user = {
        id: user.id,
        username: user.username,
      };
      console.log("User logged in successfully:", user);
      return res.json({ success: true, message: "Logged in successfully." });
    });
  })(req, res, next);
});

// Signup Route
router.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    // Check if the user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists." });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });

    // Save the user to the database
    await newUser.save();

    // Automatically log the user in after successful signup
    req.login(newUser, (loginErr) => {
      if (loginErr) {
        console.error("Login error after signup:", loginErr);
        return res
          .status(500)
          .json({ success: false, message: "Login error after signup." });
      }
      // Set user information in the session
      req.session.user = {
        id: newUser.id,
        username: newUser.username,
      };
      console.log("User signed up and logged in successfully:", newUser);
      return res.json({
        success: true,
        message: "Signed up and logged in successfully.",
      });
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Signup error." });
  }
});

// Logout route
router.post("/logout", (req, res) => {
  // Logout logic
  try {
    // Clear the user's session to log them out
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
        return res
          .status(500)
          .json({ success: false, message: "Error logging out" });
      }

      res.status(200).json({ success: true, message: "Logout successful" });
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
