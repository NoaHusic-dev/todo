const firebaseConfig = {
  apiKey: "AIzaSyBB9Yhm_SAge2QsQ7V8TBY2_cwY7zuVMwc",
  authDomain: "todo-2fff8.firebaseapp.com",
  projectId: "todo-2fff8",
  appId: "1:479116317561:web:d6b8c1d628db0d9ea395a8"
};

export async function initializeFirebase() {
  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js")
  ]);
  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true
  });

  return {
    authSdk,
    auth,
    googleProvider: new authSdk.GoogleAuthProvider(),
    firestoreSdk,
    db
  };
}
