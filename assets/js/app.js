import { setupAuthentication } from "./auth.js";
import { initializeFirebase } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const authStatus = $("auth-status");
const setStatus = (message) => {
  $("tool-status").textContent = message;
  const f = $("form-status");
  if (f) f.textContent = message;
};
try {
  const { authSdk, auth, firestoreSdk, db, googleProvider } = await initializeFirebase();
  const PRIO = { visok: "Visok prioritet", srednji: "Srednji prioritet", nizak: "Nizak prioritet" };
  const list = $("list");
  let todos = [];
  let filter = "all";
  let view = "tasks";
  let currentUser = null;
  let itemsRef = null;
  let unsubscribeItems = null;
  let legacyItems = [];
  let itemsLoading = false;
  let itemsLoadError = "";

  function counts() {
    const items = todos.filter(t => view === "notes" ? t.type === "note" : t.type !== "note");
    const left = items.filter(t => !t.done).length;
    $("count").textContent = items.length
      ? view === "notes" ? `Bilješki ${items.length}` : `Preostalo ${left}/${items.length}`
      : "";
    $("clear").hidden = view === "notes" || !items.some(t => t.done);
  }

  function render() {
    const items = todos.filter(t => view === "notes" ? t.type === "note" : t.type !== "note");
    const visible = view === "notes" ? items : items.filter(t => filter === "all" ? true : filter === "done" ? t.done : !t.done);
    list.replaceChildren();
    if (!visible.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = itemsLoading
        ? "Učitavam tvoje podatke…"
        : itemsLoadError
          ? itemsLoadError
          : view === "notes"
            ? "Još nema bilješki. Dodaj novu ili prebaci zadatak u bilješke."
            : items.length ? "Nema zadataka u ovom prikazu." : "Još nema zadataka. Upiši prvi iznad.";
      list.append(li);
    }
    for (const t of visible) {
      const li = document.createElement("li");
      li.className = view === "tasks" && t.done ? "done" : "";
      li.dataset.id = t.id;

      if (view === "tasks") {
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "check"; cb.checked = t.done;
        cb.setAttribute("aria-label", "Završeno: " + t.title);
        li.append(cb);
      }

      const body = document.createElement("div"); body.className = "body";
      const text = document.createElement("div"); text.className = "text"; text.textContent = t.title;
      const meta = document.createElement("div"); meta.className = "meta caps";
      if (view === "tasks") {
        const p = document.createElement("span"); p.className = "prio " + t.priority; p.textContent = PRIO[t.priority];
        meta.append(p);
      }
      if (t.category) { const c = document.createElement("span"); c.textContent = t.category; meta.append(c); }
      body.append(text);
      if (view === "notes" && t.body) {
        const noteContent = document.createElement("div");
        noteContent.className = "note-content";
        noteContent.textContent = t.body;
        body.append(noteContent);
      }
      if (meta.childElementCount) body.append(meta);

      const del = document.createElement("button");
      del.className = "del"; del.type = "button"; del.textContent = "×";
      del.setAttribute("aria-label", (view === "notes" ? "Obriši bilješku: " : "Obriši zadatak: ") + t.title);

      li.append(body);
      const actions = document.createElement("div");
      actions.className = "actions";
      const edit = document.createElement("button");
      edit.className = "edit"; edit.type = "button"; edit.textContent = "Uredi";
      edit.setAttribute("aria-label", (view === "notes" ? "Uredi bilješku: " : "Uredi zadatak: ") + t.title);
      actions.append(edit);
      if (view === "tasks") {
        const move = document.createElement("button");
        move.className = "move"; move.type = "button"; move.textContent = "U bilješke";
        move.setAttribute("aria-label", "Prebaci u bilješke: " + t.title);
        actions.append(move);
      }
      actions.append(del);
      li.append(actions);
      list.append(li);
    }
    counts();
  }

  function showError(action, error) {
    console.error(action, error);
    const message = `${action}: ${error.message || error}`;
    if ($("app-shell").hidden) authStatus.textContent = message;
    else setStatus(message);
  }

  function itemDocument(id) {
    return firestoreSdk.doc(db, "users", currentUser.uid, "items", id);
  }

  function inspectLegacyItems() {
    const panel = $("migration");
    try {
      const saved = localStorage.getItem("todo.zadaci.v1");
      legacyItems = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(legacyItems)) throw new Error("Stari podaci nisu u očekivanom formatu.");
      legacyItems = legacyItems.filter(item => item && typeof item.title === "string" && item.title.trim());
      panel.hidden = legacyItems.length === 0;
      $("migration-message").textContent = legacyItems.length
        ? `Pronađeno je ${legacyItems.length} lokalnih stavki. Možeš ih prenijeti u svoj račun.`
        : "";
    } catch (error) {
      panel.hidden = true;
      showError("Stare podatke nije moguće pročitati", error);
    }
  }

  $("migration-button").addEventListener("click", async () => {
    if (!currentUser || !legacyItems.length) return;
    if (!confirm(`Prenijeti ${legacyItems.length} starih stavki u račun ${currentUser.email || ""}?`)) return;
    $("migration-button").disabled = true;
    try {
      for (let offset = 0; offset < legacyItems.length; offset += 400) {
        const batch = firestoreSdk.writeBatch(db);
        const chunk = legacyItems.slice(offset, offset + 400);
        const writes = await Promise.all(chunk.map(async (item, index) => {
          const legacyId = encodeURIComponent(String(item.id || "item"));
          const reference = firestoreSdk.doc(itemsRef, `legacy_${legacyId}_${offset + index}`);
          if ((await firestoreSdk.getDoc(reference)).exists()) return null;
          const type = item.type === "note" ? "note" : "task";
          const data = {
            type,
            title: item.title.trim().slice(0, 140),
            category: typeof item.category === "string" ? item.category.slice(0, 24) : "",
            createdAt: firestoreSdk.serverTimestamp(),
            updatedAt: firestoreSdk.serverTimestamp()
          };
          if (type === "note") data.body = typeof item.body === "string" ? item.body.slice(0, 2000) : "";
          else {
            data.done = Boolean(item.done);
            data.priority = PRIO[item.priority] ? item.priority : "srednji";
          }
          return { reference, data };
        }));
        writes.filter(Boolean).forEach(write => batch.set(write.reference, write.data));
        if (writes.some(Boolean)) await batch.commit();
      }
      localStorage.removeItem("todo.zadaci.v1");
      legacyItems = [];
      $("migration").hidden = true;
      setStatus("Stari zadaci i bilješke preneseni su u tvoj račun.");
    } catch (error) {
      showError("Prijenos starih stavki nije uspio", error);
    } finally {
      $("migration-button").disabled = false;
    }
  });

  $("export-pdf").addEventListener("click", () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setStatus("Izvoz nije uspio: dopusti skočne prozore za ovu stranicu i pokušaj ponovno.");
      return;
    }

    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
    const tasks = todos.filter(item => item.type !== "note");
    const notes = todos.filter(item => item.type === "note");
    const taskList = tasks.length
      ? `<ol>${tasks.map(item => `<li>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${item.done ? "Završeno" : "Nije završeno"} · ${escapeHtml(PRIO[item.priority] || "Srednji prioritet")}${item.category ? ` · ${escapeHtml(item.category)}` : ""}</span>
        </li>`).join("")}</ol>`
      : "<p>Nema zadataka.</p>";
    const noteList = notes.length
      ? `<ol>${notes.map(item => `<li>
          <strong>${escapeHtml(item.title)}</strong>
          ${item.category ? `<span>${escapeHtml(item.category)}</span>` : ""}
          ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}
        </li>`).join("")}</ol>`
      : "<p>Nema bilješki.</p>";
    const generatedAt = new Date().toLocaleString("hr-HR");

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="hr">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Zadaci i bilješke</title>
          <style>
            @page { margin: 18mm; }
            body { color: #222; font: 12pt/1.5 Arial, sans-serif; }
            h1 { margin: 0 0 4pt; font-size: 24pt; }
            .date { margin: 0 0 24pt; color: #555; font-size: 10pt; }
            h2 { margin: 22pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #999; font-size: 16pt; }
            ol { padding-left: 22pt; }
            li { margin: 0 0 12pt; padding-left: 4pt; break-inside: avoid; }
            li span { display: block; color: #555; font-size: 10pt; }
            li p { margin: 5pt 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
            @media print { a { color: inherit; } }
          </style>
        </head>
        <body>
          <h1>Zadaci i bilješke</h1>
          <p class="date">Izvezeno: ${escapeHtml(generatedAt)}</p>
          <section><h2>Zadaci (${tasks.length})</h2>${taskList}</section>
          <section><h2>Bilješke (${notes.length})</h2>${noteList}</section>
        <\/body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setStatus("U prozoru za ispis odaberi „Spremi kao PDF”.");
  });

  $("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("title").value.trim();
  if (!title || !currentUser || !itemsRef) return;

  const saved = {
    title,
    category: $("category").value.trim(),
    body: $("note-body").value,
    priority: $("priority").value
  };
  const item = {
    type: view === "notes" ? "note" : "task",
    title,
    category: saved.category,
    createdAt: firestoreSdk.serverTimestamp(),
    updatedAt: firestoreSdk.serverTimestamp()
  };
  if (view === "notes") item.body = saved.body.trim();
  else { item.priority = saved.priority; item.done = false; }

  // polja se prazne odmah, ne čeka se server
  $("form").reset();
  $("title").focus();
  setStatus("Spremam…");

  const slow = setTimeout(() => {
    setStatus("Spremanje traje predugo. Provjeri vezu, blokatore oglasa i postoji li Firestore baza.");
  }, 6000);

  try {
    await firestoreSdk.addDoc(itemsRef, item);
    setStatus("");
  } catch (error) {
    // greška: vrati tekst da se ništa ne izgubi
    $("title").value = saved.title;
    $("category").value = saved.category;
    $("note-body").value = saved.body;
    $("priority").value = saved.priority;
    showError("Spremanje nije uspjelo", error);
  } finally {
    clearTimeout(slow);
  }
});

  list.addEventListener("click", async (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const t = todos.find(x => x.id === li.dataset.id);
    if (!t) return;
    if (e.target.matches(".edit")) {
      const editor = document.createElement("form");
      editor.className = "edit-form";
      const titleInput = document.createElement("input");
      titleInput.className = "title-input"; titleInput.name = "title"; titleInput.maxLength = 140;
      titleInput.required = true; titleInput.value = t.title;
      titleInput.setAttribute("aria-label", "Naslov");
      editor.append(titleInput);
      if (t.type === "note") {
        const content = document.createElement("textarea");
        content.className = "field note-body"; content.name = "body"; content.maxLength = 2000;
        content.value = t.body || ""; content.setAttribute("aria-label", "Sadržaj bilješke");
        editor.append(content);
      }
      const fields = document.createElement("div");
      fields.className = "fields" + (t.type === "note" ? " notes-mode" : "");
      const category = document.createElement("input");
      category.className = "field"; category.name = "category"; category.maxLength = 24;
      category.value = t.category || ""; category.placeholder = "Kategorija (neobavezno)";
      category.setAttribute("aria-label", "Kategorija");
      fields.append(category);
      if (t.type !== "note") {
        const priority = document.createElement("select");
        priority.className = "field"; priority.name = "priority";
        priority.setAttribute("aria-label", "Prioritet");
        for (const [value, label] of Object.entries(PRIO)) {
          const option = document.createElement("option");
          option.value = value; option.textContent = label; option.selected = value === t.priority;
          priority.append(option);
        }
        fields.append(priority);
      }
      editor.append(fields);
      const editActions = document.createElement("div");
      editActions.className = "edit-actions";
      const saveEdit = document.createElement("button");
      saveEdit.className = "tool-button"; saveEdit.type = "submit"; saveEdit.textContent = "Spremi";
      const cancelEdit = document.createElement("button");
      cancelEdit.className = "tool-button"; cancelEdit.type = "button"; cancelEdit.textContent = "Odustani";
      editActions.append(saveEdit, cancelEdit);
      editor.append(editActions);
      li.replaceChildren(editor);
      titleInput.focus();
    } else if (e.target.matches(".edit-form button[type=button]")) {
      render();
    } else if (e.target.matches(".check")) {
      try {
        await firestoreSdk.updateDoc(itemDocument(t.id), {
          done: e.target.checked,
          updatedAt: firestoreSdk.serverTimestamp()
        });
      } catch (error) {
        showError("Ažuriranje zadatka nije uspjelo", error);
      }
    } else if (e.target.matches(".move")) {
      try {
        await firestoreSdk.updateDoc(itemDocument(t.id), {
          type: "note",
          body: "",
          done: firestoreSdk.deleteField(),
          priority: firestoreSdk.deleteField(),
          updatedAt: firestoreSdk.serverTimestamp()
        });
      } catch (error) {
        showError("Premještanje u Bilješke nije uspjelo", error);
      }
    } else if (e.target.matches(".del")) {
      li.classList.add("removing");
      await new Promise(resolve => setTimeout(resolve, 200));
      try {
        await firestoreSdk.deleteDoc(itemDocument(t.id));
      } catch (error) {
        li.classList.remove("removing");
        showError("Brisanje nije uspjelo", error);
      }
    }
  });

  list.addEventListener("submit", async (e) => {
    if (!e.target.matches(".edit-form")) return;
    e.preventDefault();
    const li = e.target.closest("li[data-id]");
    const item = todos.find(x => x.id === li.dataset.id);
    if (!item) return;
    const data = new FormData(e.target);
    const updated = {
      title: data.get("title").trim(),
      category: data.get("category").trim(),
      updatedAt: firestoreSdk.serverTimestamp()
    };
    if (item.type === "note") updated.body = data.get("body").trim();
    else updated.priority = data.get("priority");
    try {
      await firestoreSdk.updateDoc(itemDocument(item.id), updated);
    } catch (error) {
      showError("Uređivanje nije uspjelo", error);
    }
  });

  $("clear").addEventListener("click", async () => {
    const completed = todos.filter(item => item.type !== "note" && item.done);
    try {
      for (let offset = 0; offset < completed.length; offset += 400) {
        const batch = firestoreSdk.writeBatch(db);
        completed.slice(offset, offset + 400).forEach(item => batch.delete(itemDocument(item.id)));
        await batch.commit();
      }
    } catch (error) {
      showError("Brisanje završenih zadataka nije uspjelo", error);
    }
  });

  document.querySelector(".views").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    $("form").reset();
    view = b.dataset.view;
    $("app-shell").classList.toggle("notes-view", view === "notes");
    document.querySelectorAll("[data-view]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("title").placeholder = view === "notes" ? "Naslov bilješke" : "Što treba napraviti?";
    $("title").setAttribute("aria-label", view === "notes" ? "Naslov bilješke" : "Naslov zadatka");
    $("submit-label").textContent = view === "notes" ? "Dodaj bilješku" : "Dodaj zadatak";
    $("zadaci").setAttribute("aria-label", view === "notes" ? "Popis bilješki" : "Popis zadataka");
    $("note-body").hidden = view !== "notes";
    $("priority").hidden = view === "notes";
    document.querySelector(".fields").classList.toggle("notes-mode", view === "notes");
    document.querySelector(".filters").hidden = view === "notes";
    filter = "all";
    document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.filter === filter)));
    render();
  });

  document.querySelector(".filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });

  setupAuthentication({
    authSdk,
    auth,
    googleProvider,
    setStatus,
    showError,
    onUserChanged: user => {
      currentUser = user;
      if (unsubscribeItems) unsubscribeItems();
      unsubscribeItems = null;
      todos = [];
      render();
      $("auth-screen").hidden = Boolean(user);
      $("app-shell").hidden = !user;
      $("account").hidden = !user;
      $("github-nav").hidden = Boolean(user);
      if (!user) {
        itemsRef = null;
        itemsLoading = false;
        itemsLoadError = "";
        $("migration").hidden = true;
        $("sign-in").disabled = false;
        return;
      }
      $("user-email").textContent = user.email || user.displayName || "Google račun";
      itemsRef = firestoreSdk.collection(db, "users", user.uid, "items");
      itemsLoading = true;
      itemsLoadError = "";
      setStatus("Učitavam tvoje zadatke i bilješke…");
      render();
      inspectLegacyItems();

      // dijagnostika: pita server izravno i ispiše točan razlog ako ne uspije
      firestoreSdk.getDocFromServer(firestoreSdk.doc(db, "users", user.uid, "items", "_test"))
        .then(() => setStatus("Veza s bazom radi."))
        .catch(err => setStatus(`Firestore greška [${err.code}]: ${err.message}`));
      let isInitialSnapshot = true;
      unsubscribeItems = firestoreSdk.onSnapshot(itemsRef, snapshot => {
        todos = snapshot.docs
          .map(document => ({ id: document.id, ...document.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        itemsLoading = false;
        itemsLoadError = "";
        if (isInitialSnapshot) {
          isInitialSnapshot = false;
          setStatus("");
        }
        render();
      }, error => {
        itemsLoading = false;
        itemsLoadError = "Podaci nisu učitani. Provjeri vezu i Firebase pravila, zatim ponovno učitaj stranicu.";
        isInitialSnapshot = false;
        showError("Učitavanje zadataka i bilješki nije uspjelo", error);
        render();
      });
    }
  });
} catch (error) {
  console.error("Firebase initialization failed", error);
  $("sign-in").disabled = true;
  $("sign-in").textContent = "Prijava nije dostupna";
  authStatus.textContent = `Firebase se nije mogao učitati: ${error.message || error}`;
}
