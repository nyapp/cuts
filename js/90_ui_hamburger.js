// js/90_ui_hamburger.js
// Hamburger (EXPORT menu) helpers

// Close the <details> menu containing the clicked element.
// Used by onclick="...; closeHamburger(this);"
function closeHamburger(el) {
  const details = el && el.closest ? el.closest("details.hamburger-menu") : null;
  if (details) details.removeAttribute("open");
}

// Close any open hamburger menus when clicking outside the menu.
document.addEventListener("click", function (e) {
  document.querySelectorAll(".hamburger-menu[open]").forEach((menu) => {
    if (!menu.contains(e.target)) {
      menu.removeAttribute("open");
    }
  });
});