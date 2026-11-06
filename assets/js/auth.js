export async function setupAuthentication({
  authSdk,
  auth,
  googleProvider,
  setStatus,
  showError,
  onUserChanged
}) {
  const authStatus = document.getElementById("auth-status");
  const signInButton = document.getElementById("sign-in");

  signInButton.disabled = true;
  signInButton.textContent = "Provjeravam spremljenu prijavu…";
  authStatus.textContent = "Provjeravam spremljenu prijavu…";

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

  let persistenceError = null;
  try {
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
  } catch (error) {
    persistenceError = error;
    console.error("Spremanje prijave nije uspjelo", error);
  }

  authSdk.getRedirectResult(auth).catch(error => {
    showError("Google prijava nije uspjela", error);
  });

  return authSdk.onAuthStateChanged(auth, user => {
    if (!user) {
      signInButton.disabled = false;
      signInButton.textContent = "Nastavi s Googleom";
      authStatus.textContent = persistenceError
        ? "Ovaj preglednik možda neće zapamtiti tvoju prijavu."
        : "Tvoji podaci sinkroniziraju se uz tvoj Google račun.";
    }
    onUserChanged(user);
  });
}
