(() => {
"use strict";

// Mobile feature modules share this one connection. This file is also loaded by
// pet.html, so only connect when the mobile application is present.
if (!document.getElementById("phone-app") || window.mobileSocket) return;
window.mobileSocket = io({ autoConnect: false });
})();
