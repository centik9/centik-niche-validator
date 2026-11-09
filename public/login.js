const form = document.getElementById("login-form");
const status = document.getElementById("login-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Checking the access code…";
  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("email").value.trim(),
        access_code: document.getElementById("access-code").value
      })
    });
    const body = await response.json();
    if (!response.ok) {
      status.textContent = body.message || "Sign-in failed.";
      return;
    }
    window.location.assign("/");
  } catch {
    status.textContent = "Sign-in could not reach the server.";
  }
});
