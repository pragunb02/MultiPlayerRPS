document.addEventListener("DOMContentLoaded", () => {
  const track = document.querySelector(".carousel-track");
  const prevButton = document.getElementById("prevBtn");
  const nextButton = document.getElementById("nextBtn");
  const originalCardCount = track.children.length;
  const cardWidth = track.children[0].offsetWidth + 20; // Width of game card + margin

  // Clone the first and last cards to create an infinite loop effect
  const firstCardClone = track.children[0].cloneNode(true);
  const lastCardClone = track.children[originalCardCount - 1].cloneNode(true);
  track.appendChild(firstCardClone);
  track.insertBefore(lastCardClone, track.children[0]);

  const totalCardCount = track.children.length;
  let currentIndex = 1;

  function updateTrackPosition() {
    track.style.transform = `translateX(-${currentIndex * cardWidth}px)`;
  }

  nextButton.addEventListener("click", () => {
    currentIndex = (currentIndex + 1) % totalCardCount;
    updateTrackPosition();
  });

  prevButton.addEventListener("click", () => {
    currentIndex = (currentIndex - 1 + totalCardCount) % totalCardCount;
    updateTrackPosition();
  });

  updateTrackPosition();

  // Logout button functionality
  const logoutButton = document.getElementById("logoutButton");
  if (logoutButton) {
    logoutButton.addEventListener("click", function (e) {
      e.preventDefault();
      fetch("/auth/logout", {
        method: "POST",
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            window.location.href = "/";
          }
        })
        .catch((error) => {
          console.error("Error:", error);
        });
    });
  }
});
