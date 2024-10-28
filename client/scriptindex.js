document.addEventListener("DOMContentLoaded", () => {
    const menuToggle = document.querySelector(".menu-toggle");
    const navLinks = document.querySelector(".nav-links");
    const navbar = document.querySelector(".navbar");
  
    // Toggle navigation menu on mobile
    menuToggle.addEventListener("click", () => {
      navLinks.classList.toggle("show");
    });
  
    // Change navbar background on scroll
    window.addEventListener("scroll", () => {
      if (window.scrollY > 100) {
        navbar.classList.add("scrolled");
      } else {
        navbar.classList.remove("scrolled");
      }
    });
  
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
  
    // Initialize Carousel after all images have loaded
    window.addEventListener("load", () => {
      const track = document.querySelector('.carousel-track');
      const slides = Array.from(track.children);
      const nextButton = document.querySelector('#nextBtn');
      const prevButton = document.querySelector('#prevBtn');
  
      if (slides.length === 0) return; // Exit if no slides
  
      let currentIndex = 0;
      let slideWidth = slides[0].getBoundingClientRect().width;
  
      // Arrange the slides next to one another
      const setSlidePosition = (slide, index) => {
        slide.style.left = `${slideWidth * index}px`;
      };
      slides.forEach(setSlidePosition);
  
      const moveToSlide = (index) => {
        track.style.transform = `translateX(-${index * slideWidth}px)`;
        currentIndex = index;
      };
  
      nextButton.addEventListener('click', () => {
        let newIndex = currentIndex + 1;
        if (newIndex >= slides.length) {
          newIndex = 0; // Loop back to first slide
        }
        moveToSlide(newIndex);
      });
  
      prevButton.addEventListener('click', () => {
        let newIndex = currentIndex - 1;
        if (newIndex < 0) {
          newIndex = slides.length - 1; // Loop to last slide
        }
        moveToSlide(newIndex);
      });
  
      // Handle window resize
      window.addEventListener('resize', () => {
        slideWidth = slides[0].getBoundingClientRect().width;
        slides.forEach(setSlidePosition);
        moveToSlide(currentIndex);
      });
  
      // Swipe functionality for mouse and touch devices
      let startX = 0;
      let isDragging = false;
      let currentTranslate = 0;
      let prevTranslate = 0;
      let animationID;
      let currentSlide = currentIndex;
  
      const getPositionX = (event) => {
        return event.type.includes('mouse') ? event.pageX : event.touches[0].clientX;
      };
  
      const touchStart = (event) => {
        isDragging = true;
        startX = getPositionX(event) - track.offsetLeft;
        animationID = requestAnimationFrame(animation);
        track.classList.add('grabbing');
      };
  
      const touchMove = (event) => {
        if (!isDragging) return;
        const currentPosition = getPositionX(event) - track.offsetLeft;
        currentTranslate = currentPosition - startX;
      };
  
      const touchEnd = () => {
        cancelAnimationFrame(animationID);
        isDragging = false;
        const movedBy = currentTranslate - prevTranslate;
  
        if (movedBy < -100 && currentIndex < slides.length - 1)
          moveToSlide(currentIndex + 1);
        else if (movedBy > 100 && currentIndex > 0)
          moveToSlide(currentIndex - 1);
        else
          moveToSlide(currentIndex);
  
        track.classList.remove('grabbing');
        prevTranslate = currentTranslate;
        currentTranslate = 0;
      };
  
      const animation = () => {
        setSliderPosition();
        if (isDragging) requestAnimationFrame(animation);
      };
  
      const setSliderPosition = () => {
        track.style.transform = `translateX(${currentTranslate - currentIndex * slideWidth}px)`;
      };
  
      // Add event listeners to each slide
      slides.forEach((slide) => {
        // Disable default image drag
        const image = slide.querySelector('img');
        if (image) {
          image.addEventListener('dragstart', (e) => e.preventDefault());
        }
  
        // Touch events
        slide.addEventListener('touchstart', touchStart);
        slide.addEventListener('touchmove', touchMove);
        slide.addEventListener('touchend', touchEnd);
  
        // Mouse events
        slide.addEventListener('mousedown', touchStart);
        slide.addEventListener('mousemove', touchMove);
        slide.addEventListener('mouseup', touchEnd);
        slide.addEventListener('mouseleave', () => {
          if (isDragging) {
            touchEnd();
          }
        });
      });
  
      // Optional: Keyboard navigation for accessibility
      document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          nextButton.click();
        } else if (e.key === 'ArrowLeft') {
          prevButton.click();
        }
      });
    });
  });
  