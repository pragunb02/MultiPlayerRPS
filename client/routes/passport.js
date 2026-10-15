const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");
const User = require("../../models/User");

const INVALID_CREDENTIALS = { message: "Invalid email or password." };

passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, done) => {
      try {
        // Accounts created before signup normalized emails may be stored mixed-case.
        const user = await User.findOne({ email: { $in: [email, email.toLowerCase()] } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
          return done(null, false, INVALID_CREDENTIALS);
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
