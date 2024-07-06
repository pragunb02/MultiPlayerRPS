const express = require("express");
const router = express.Router();
const passport = require("./passport"); // Adjust the path as necessary
const User = require("../../models/User");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

// JSON body parsing middleware

console.log("ji");
router.use(express.json());

// Function to send email
function sendEmail(receiverEmail, subject, text) {
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: "bookbazaar959@gmail.com",
      pass: "konr fuuw tfla pmoj",
    },
  });

  const mailOptions = {
    from: "bookbazaar959@gmail.com",
    to: receiverEmail,
    subject: subject,
    text: text,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Email sent:", info.response);
    }
  });
}
router.post("/login", async (req, res) => {
  // Login logic
  try {
    const { email, password } = req.body;

    // Check if it's an admin login
    if (email === "admin@gmail.com" && password === "admin") {
      req.session.admin = true;
      return res
        .status(200)
        .json({ success: true, isAdmin: true, message: "Login successful!" });
    }

    // Validate the input (you can add more validation here)
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required." });
    }
    console.log(email, password);
    // Find the user by their email in the database
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed. User not found.",
      });
    }

    // Check if the user is blocked
    if (user.blocked) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed. User is blocked.",
      });
    }

    // Compare the provided password with the hashed password in the database
    // const passwordMatch = await bcrypt.compare(password, user.password);
    const passwordMatch = password === user.password;

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed. Incorrect password.",
      });
    }

    // If authentication is successful, you can generate a JWT token here
    // and send it to the client for future authenticated requests
    req.session.user = user;
    console.log(req.session.user);

    res.status(200).json({ success: true, message: "Login successful!" });

    // res.redirect('/dashboard');
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
