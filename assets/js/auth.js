export function setupAuthentication({
  authSdk,
  auth,
  googleProvider,
  setStatus,
  showError,
  onUserChanged
}) {
  const authStatus = document.getElementById("auth-status");
  const signInButton = document.getElementById("sign-in");

  signInButton.addEventListener("click", async () => {
    signInButton.disabled = true;
    authStatus.textContent = "Otvaram Google prijavu…";
    try {
      await authSdk.signInWithPopup(auth, googleProvider);
    } catch (error) {
      if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
        authStatus.textContent = "Prijava je otkazana. Pokušaj ponovno.";
      } else {
        showError("Google prijava nije uspjela", error);
      }
      signInButton.disabled = false;
    }
  });

  document.getElementById("sign-out").addEventListener("click", async () => {
    try {
      await authSdk.signOut(auth);
      setStatus("");
    } catch (error) {
      showError("Odjava nije uspjela", error);
    }
  });

  signInButton.disabled = false;
  signInButton.textContent = "Nastavi s Googleom";
  authStatus.textContent = "Tvoji podaci sinkroniziraju se uz tvoj Google račun.";

  authSdk.getRedirectResult(auth).catch(error => {
    showError("Google prijava nije uspjela", error);
  });

  return authSdk.onAuthStateChanged(auth, onUserChanged);
}
