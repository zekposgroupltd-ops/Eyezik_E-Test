/* Ken E-Test - config.js
   The only place that contains the backend URL.
   Paste the Web App URL you get after deploying backend/Code.gs. */

const CONFIG = {
  API_URL: "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE",
  APP_NAME: "Ken E-Test",
  SESSION_KEYS: {
    student: "eyezik_student_session",
    admin: "eyezik_admin_session"
  }
};

// Keep the existing HTML pages and accessible labels in sync with the current brand.
(function applyBranding() {
  const oldName = /Eyezik E-Test/g;
  const oldDesigner = /Designed by Isaac Youdiowei|Isaac Youdiowei/g;
  const newDesigner = "Designed by: KENANAGHA DEINYEFA GODSPOWER";

  function updateBranding() {
    document.title = document.title.replace(oldName, CONFIG.APP_NAME);

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      node.nodeValue = node.nodeValue
        .replace(oldName, CONFIG.APP_NAME)
        .replace(oldDesigner, newDesigner);
    }

    document.querySelectorAll("meta[name='description'], img[alt], [aria-label], [title]").forEach((element) => {
      ["content", "alt", "aria-label", "title"].forEach((attribute) => {
        if (element.hasAttribute(attribute)) {
          element.setAttribute(attribute, element.getAttribute(attribute)
            .replace(oldName, CONFIG.APP_NAME)
            .replace(oldDesigner, newDesigner));
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateBranding, { once: true });
  } else {
    updateBranding();
  }
})();
