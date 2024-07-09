document.addEventListener("DOMContentLoaded", function () {
  document
    .getElementById("logoutButton")
    .addEventListener("click", function () {
      fetch("./auth/logout", {
        method: "POST",
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            window.location.href = ".";
          }
        })
        .catch((error) => {
          console.error("Error:", error);
        });
    });

  const signupLink = document.getElementById("signup-link");
  const loginLink = document.getElementById("login-link");
  const loginCard = document.querySelector(".login-card");
  const signupCard = document.querySelector(".signup-card");
  const msg = document.querySelector("i");

  signupLink.addEventListener("click", (event) => {
    event.preventDefault();
    loginCard.style.display = "none";
    signupCard.style.display = "block";
  });

  loginLink.addEventListener("click", (event) => {
    event.preventDefault();
    signupCard.style.display = "none";
    loginCard.style.display = "block";
  });

  function getQueryParams() {
    const params = {};
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);

    urlParams.forEach((value, key) => {
      params[key] = value;
    });

    return params;
  }

  function handleDisplay() {
    const params = getQueryParams();
    console.log(params);
    if (params.a === "1") {
      loginCard.style.display = "none";
      signupCard.style.display = "block";
    } else {
      signupCard.style.display = "none";
      loginCard.style.display = "block";
    }
  }

  window.onload = handleDisplay;

  // Login form handler
  const loginForm = document.querySelector("#login-form");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const loginBtn = document.querySelector(".login-container .btn");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;

    try {
      const response = await fetch("./auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      // Log the entire response for debugging
      console.log("Response:", response);

      if (response.ok) {
        const data = await response.json();
        console.log("Data:", data); // Log the parsed JSON data

        if (data.success) {
          // Redirect or perform actions upon successful login
          msg.innerText = "Login successful! Redirecting...";
          msg.style.color = "green";
          setTimeout(() => {
            window.location.href = ".";
          }, 1500);
          // window.location.href = ".";
        } else {
          // Handle unsuccessful login (display error message, etc.)
          // alert("Authentication failed. Please check your credentials.");
          msg.innerText =
            "Authentication failed. Please check your credentials.";
          msg.style.color = "red";
        }
      } else {
        console.error("Failed to login:", response.statusText);
        // Handle non-200 HTTP status (e.g., 400 Bad Request)
        msg.innerText = "Login failed. Please try again.";
        msg.style.color = "red";
      }
    } catch (error) {
      console.error("Error:", error);
      // Handle network errors or other exceptions
      msg.innerText = "An error occurred while trying to sign in.";
      msg.style.color = "red";
      // alert("An error occurred while trying to sign in.");
    }
  });

  // Signup form handler
  const signupForm = document.querySelector("#signup-form");
  const usernameInput = document.querySelector("#new-username");
  const signupEmailInput = document.querySelector("#new-email");
  const signupPasswordInput = document.querySelector("#new-password");
  const confirmPasswordInput = document.querySelector("#confirm-password");
  const signupBtn = document.querySelector(".signup-card .btn");

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = usernameInput.value;
    const email = signupEmailInput.value;
    const password = signupPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (password !== confirmPassword) {
      msg.innerText = "Passwords do not match!";
      msg.style.color = "red";
      return;
    }

    try {
      const response = await fetch("./auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, email, password }),
      });

      console.log("Response:", response);

      if (response.ok) {
        const data = await response.json();
        console.log("Data:", data);

        if (data.success) {
          msg.innerText = "Signup successful! Redirecting...";
          msg.style.color = "green";
          setTimeout(() => {
            window.location.href = ".";
          }, 1500); // Wait for 1.5 seconds before redirecting
          // Redirect or perform actions upon successful signup
          // window.location.href = ".";
        } else {
          // Handle unsuccessful signup (display error message, etc.)
          // alert("Signup failed. Please try again.");
          msg.innerText = "Signup failed. Please try again.";
          msg.style.color = "red";
        }
      } else {
        console.error("Failed to signup:", response.statusText);
        msg.innerText = "Signup failed. Please try again.";
        msg.style.color = "red";
        // Handle non-200 HTTP status (e.g., 400 Bad Request)
      }
    } catch (error) {
      console.error("Error:", error);
      msg.innerText = "An error occurred while trying to sign up.";
      msg.style.color = "red";
    }
  });
});
