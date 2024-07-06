document.addEventListener("DOMContentLoaded", function () {
  const signupLink = document.getElementById("signup-link");
  const loginLink = document.getElementById("login-link");
  const loginCard = document.querySelector(".login-card");
  const signupCard = document.querySelector(".signup-card");

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
  const loginform = document.querySelector("#login-form");

  const emailInput = document.querySelector(
    '.login-container input[type="text"]'
  );
  const passwordInput = document.querySelector(
    '.login-container input[type="password"]'
  );

  const loginBtn = document.querySelector(".login-container .btn");

  loginform.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value;

    const password = passwordInput.value;

    console.log(email);

    try {
      const response = await fetch("./auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      console.log(response);
      console.log(data);
      if (response.ok) {
        if (data.success) {
          // window.location.href = "/";
        } else {
          // alert("Authentication failed. Please check your credentials.");
        }
      } else {
        console.error("Failed to login:", response.statusText);
      }
    } catch (error) {
      console.error("Error:", error);
      //   alert("An error occurred while trying to sign in.");
    }
  });
});
