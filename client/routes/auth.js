const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const passport = require("./passport");
const User = require("../../models/User");

const router = express.Router();

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores bytes beyond 72

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

function validateSignup({ username, email, password }) {
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    return "Username must be 3-20 characters: letters, numbers or underscores.";
  }
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
    return "Please enter a valid email address.";
  }
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

function logIn(req, res, user, message) {
  req.login(user, (loginErr) => {
    if (loginErr) {
      console.error("Login error:", loginErr);
      return res.status(500).json({ success: false, message: "Login error." });
    }
    req.session.user = { id: user.id, username: user.username };
    return res.json({ success: true, message });
  });
}

router.post("/login", authLimiter, (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      console.error("Authentication error:", err);
      return res.status(500).json({ success: false, message: "Authentication error." });
    }
    if (!user) {
      return res.status(401).json({ success: false, message: info.message });
    }
    return logIn(req, res, user, "Logged in successfully.");
  })(req, res, next);
});

router.post("/signup", authLimiter, async (req, res) => {
  const validationError = validateSignup(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const username = req.body.username;
  const email = req.body.email.toLowerCase();

  try {
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      const field = existingUser.email === email ? "Email" : "Username";
      return res.status(409).json({ success: false, message: `${field} is already taken.` });
    }

    const newUser = await User.create({
      username,
      email,
      password: await bcrypt.hash(req.body.password, 10),
    });
    return logIn(req, res, newUser, "Signed up and logged in successfully.");
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Username or email is already taken." });
    }
    console.error("Signup error:", error);
    return res.status(500).json({ success: false, message: "Signup error." });
  }
});

router.post("/logout", (req, res) => {
  req.logout((logoutErr) => {
    if (logoutErr) {
      console.error("Error logging out:", logoutErr);
      return res.status(500).json({ success: false, message: "Error logging out" });
    }
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        console.error("Error destroying session:", destroyErr);
        return res.status(500).json({ success: false, message: "Error logging out" });
      }
      res.clearCookie("connect.sid");
      return res.json({ success: true, message: "Logout successful" });
    });
  });
});

module.exports = router;
