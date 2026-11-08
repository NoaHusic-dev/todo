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
  const priorityOrder = { visok: 0, srednji: 1, nizak: 2 };
  const today = new Date();
  let todos = [];
  let filter = "all";
  let view = "tasks";
  let calendarDateFilter = "";
  let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let currentUser = null;
  let itemsRef = null;
  let unsubscribeItems = null;
  let legacyItems = [];
  let itemsLoading = false;
  let itemsLoadError = "";

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDueDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
    return date.toLocaleDateString("hr-HR", { day: "numeric", month: "short", year: "numeric" });
  }

  function taskCountLabel(count) {
    const lastTwoDigits = count % 100;
    if (count % 10 === 1 && lastTwoDigits !== 11) return `${count} zadatak s rokom`;
    if (count % 10 >= 2 && count % 10 <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
      return `${count} zadatka s rokom`;
    }
    return `${count} zadataka s rokom`;
  }

  function sortTasks(tasks) {
    return tasks.slice().sort((a, b) => {
      const completionOrder = Number(Boolean(a.done)) - Number(Boolean(b.done));
      if (completionOrder) return completionOrder;
      const priorityDifference = (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
      if (priorityDifference) return priorityDifference;
      if (a.dueDate !== b.dueDate) {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
      return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
    });
  }

  function renderCalendar() {
    $("calendar-month").textContent = calendarMonth.toLocaleDateString("hr-HR", {
      month: "long",
      year: "numeric"
    });
    const days = $("calendar-days");
    days.replaceChildren();

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const dayCount = new Date(year, month + 1, 0).getDate();
    const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
    const cellCount = Math.ceil((leadingDays + dayCount) / 7) * 7;

    for (let cell = 0; cell < cellCount; cell += 1) {
      const dayNumber = cell - leadingDays + 1;
      if (dayNumber < 1 || dayNumber > dayCount) {
        const emptyDay = document.createElement("span");
        emptyDay.className = "calendar-empty-day";
        emptyDay.setAttribute("aria-hidden", "true");
        days.append(emptyDay);
        continue;
      }

      const dayDate = new Date(year, month, dayNumber);
      const key = dateKey(dayDate);
      const dueTasks = todos.filter(item => item.type !== "note" && !item.done && item.dueDate === key);
      const button = document.createElement("button");
      button.className = "calendar-day";
      button.type = "button";
      button.dataset.calendarDate = key;
      button.textContent = String(dayNumber);
      button.setAttribute("aria-label", `${dayDate.toLocaleDateString("hr-HR", {
        day: "numeric",
        month: "long",
        year: "numeric"
      })}${dueTasks.length ? `, ${taskCountLabel(dueTasks.length)}` : ""}`);
      if (key === dateKey(new Date())) button.classList.add("today");
      if (key === calendarDateFilter) {
        button.classList.add("selected");
        button.setAttribute("aria-pressed", "true");
      } else {
        button.setAttribute("aria-pressed", "false");
      }
      if (dueTasks.length) {
        const dot = document.createElement("span");
        dot.className = "calendar-dot";
        dot.setAttribute("aria-hidden", "true");
        button.append(dot);
      }
      days.append(button);
    }

    const clearDateFilter = $("clear-date-filter");
    clearDateFilter.hidden = !calendarDateFilter;
    clearDateFilter.textContent = calendarDateFilter
      ? `Rok: ${formatDueDate(calendarDateFilter)} · Prikaži sve`
      : "";
    renderOverview();
  }

  function renderOverview() {
    const activeTasks = todos.filter(item => item.type !== "note" && !item.done);
    $("active-task-count").textContent = String(activeTasks.length);
    $("priority-task-count").textContent = String(activeTasks.filter(item => item.priority === "visok").length);

    const upcomingList = $("upcoming-list");
    upcomingList.replaceChildren();
    const upcomingTasks = activeTasks
      .filter(item => formatDueDate(item.dueDate))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)
        || (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1))
      .slice(0, 5);

    if (!upcomingTasks.length) {
      const empty = document.createElement("li");
      empty.className = "upcoming-empty";
      empty.textContent = activeTasks.length ? "Nema zadanih rokova." : "Nema aktivnih zadataka.";
      upcomingList.append(empty);
      return;
    }

    for (const task of upcomingTasks) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "upcoming-task";
      button.type = "button";
      button.dataset.upcomingDate = task.dueDate;
      const title = document.createElement("span");
      title.className = "upcoming-task-title";
      title.textContent = task.title;
      const date = document.createElement("span");
      date.className = "upcoming-task-date";
      date.textContent = formatDueDate(task.dueDate);
      button.append(title, date);
      item.append(button);
      upcomingList.append(item);
    }
  }

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
    const visible = view === "notes" ? items : items
      .filter(t => !calendarDateFilter || t.dueDate === calendarDateFilter)
      .filter(t => filter === "all" ? true : filter === "done" ? t.done : !t.done);
    const orderedVisible = view === "notes" ? visible : sortTasks(visible);
    list.replaceChildren();
    if (!orderedVisible.length) {
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
    for (const t of orderedVisible) {
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
      if (view === "tasks" && t.dueDate && formatDueDate(t.dueDate)) {
        const dueDate = document.createElement("span");
        dueDate.className = "due-date";
        const dot = document.createElement("span");
        dot.className = "calendar-dot";
        dot.setAttribute("aria-hidden", "true");
        dueDate.append(dot, document.createTextNode(`Rok: ${formatDueDate(t.dueDate)}`));
        meta.append(dueDate);
      }
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
    renderCalendar();
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
    const tasks = sortTasks(todos.filter(item => item.type !== "note"));
    const notes = todos.filter(item => item.type === "note");
    const taskList = tasks.length
      ? `<ol>${tasks.map(item => `<li>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${item.done ? "Završeno" : "Nije završeno"} · ${escapeHtml(PRIO[item.priority] || "Srednji prioritet")}${item.category ? ` · ${escapeHtml(item.category)}` : ""}${formatDueDate(item.dueDate) ? ` · Rok: ${escapeHtml(formatDueDate(item.dueDate))}` : ""}</span>
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
    const taskLabel = tasks.length === 1
      ? "zadatak"
      : tasks.length % 10 >= 2 && tasks.length % 10 <= 4 && (tasks.length % 100 < 12 || tasks.length % 100 > 14)
        ? "zadatka"
        : "zadataka";
    const noteLabel = notes.length === 1
      ? "bilješka"
      : notes.length % 10 >= 2 && notes.length % 10 <= 4 && (notes.length % 100 < 12 || notes.length % 100 > 14)
        ? "bilješke"
        : "bilješki";
    const printDocument = document.createElement("article");
    printDocument.id = "print-document";
    printDocument.innerHTML = `
      <header class="print-header">
        <div class="print-brand">
          <span><strong>TODO</strong><small>VERZIJA 1.1</small></span>
        </div>
        <a class="print-site" href="https://todo.noahusicdev.site/">todo.noahusicdev.site</a>
      </header>
      <main class="print-main">
        <p class="print-eyebrow">PREGLED</p>
        <h1>Zadaci i bilješke</h1>
        <p class="print-date">Dokument izrađen ${escapeHtml(generatedAt)}</p>
        <div class="print-summary">
          <div><strong>${tasks.length}</strong><span>${taskLabel}</span></div>
          <div><strong>${notes.length}</strong><span>${noteLabel}</span></div>
        </div>
        <section class="print-section"><h2><span>Zadaci</span><span class="print-section-count">${tasks.length}</span></h2>${taskList}</section>
        <section class="print-section"><h2><span>Bilješke</span><span class="print-section-count">${notes.length}</span></h2>${noteList}</section>
      </main>
      <footer class="print-footer">
      
      </footer>`;
    const printStyles = `
      @page { margin: 16mm 18mm; }
      html, body { background: #fff !important; color: #222 !important; }
      body.printing { margin: 0; padding: 0; }
      body.printing > :not(#print-document) { display: none !important; }
      body.printing > #print-document {
        display: block !important;
        color: #222;
        font: 12pt/1.5 Arial, sans-serif;
      }
      #print-document .print-header { display: flex; height: auto; margin: 0; align-items: center; justify-content: space-between; padding-bottom: 12pt; border-bottom: 1px solid #d5dbe2; background: #fff; }
      #print-document .print-brand { display: flex; align-items: center; }
      #print-document .print-brand strong, #print-document .print-brand small { display: block; line-height: 1.2; }
      #print-document .print-brand strong { font-size: 11pt; letter-spacing: .08em; }
      #print-document .print-brand small { margin-top: 2pt; color: #667085; font-size: 7pt; letter-spacing: .12em; }
      #print-document .print-site, #print-document .print-footer a { color: #347FC4; font-size: 9pt; text-decoration: none; }
      #print-document .print-main { padding-top: 25pt; }
      #print-document .print-eyebrow { margin: 0 0 6pt; color: #347FC4; font-size: 8pt; font-weight: 700; letter-spacing: .15em; }
      #print-document h1 { margin: 0; font-size: 27pt; letter-spacing: -.03em; line-height: 1.15; }
      #print-document .print-date { margin: 7pt 0 18pt; color: #667085; font-size: 10pt; }
      #print-document .print-summary { display: flex; gap: 10pt; margin-bottom: 24pt; }
      #print-document .print-summary div { display: flex; min-width: 90pt; align-items: baseline; gap: 7pt; padding: 9pt 12pt; border: 1px solid #e1e6eb; border-radius: 6pt; background: #f7f9fb; }
      #print-document .print-summary strong { color: #347FC4; font-size: 17pt; }
      #print-document .print-summary span { color: #475467; font-size: 9pt; }
      #print-document .print-section { margin-top: 20pt; }
      #print-document .print-section h2 { display: flex; align-items: center; gap: 8pt; margin: 0 0 8pt; padding-bottom: 6pt; border-bottom: 1.5pt solid #347FC4; font-size: 15pt; }
      #print-document .print-section-count { display: inline-grid; min-width: 18pt; height: 18pt; place-items: center; border-radius: 9pt; background: #eaf3fb; color: #24639b; font-size: 8pt; }
      #print-document ol { margin: 0; padding-left: 22pt; }
      #print-document li { display: list-item; margin: 0; padding: 9pt 4pt 9pt 2pt; border-bottom: 1px solid #e8ebef; break-inside: avoid; }
      #print-document li::marker { color: #347FC4; font-weight: 700; }
      #print-document li strong { font-size: 11pt; }
      #print-document li span { display: block; margin-top: 2pt; color: #667085; font-size: 9pt; }
      #print-document li p { margin: 5pt 0 0; color: #344054; white-space: pre-wrap; overflow-wrap: anywhere; }
      #print-document .print-section > p { margin: 0; padding: 12pt; border: 1px dashed #cbd3dc; border-radius: 5pt; color: #667085; font-size: 10pt; }
      #print-document .print-footer { display: flex; justify-content: space-between; gap: 10pt; margin: 30pt 0 0; padding: 9pt 0 0; border-top: 1px solid #d5dbe2; color: #667085; font-size: 8pt; }
      #print-document a { color: #347FC4; }
    `;

    try {
      const startPrint = () => {
        printWindow.focus();
        try {
          printWindow.print();
        } catch (error) {
          printWindow.close();
          showError("Ispis nije uspio", error);
        }
      };
      printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
      const schedulePrint = () => {
        printWindow.requestAnimationFrame(() => {
          printWindow.requestAnimationFrame(startPrint);
        });
      };
      printWindow.document.open();
      printWindow.document.write(`<!doctype html>
        <html lang="hr">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Zadaci i bilješke</title>
            <style>${printStyles}</style>
          </head>
          <body class="printing">${printDocument.outerHTML}</body>
        </html>`);
      printWindow.document.close();
      if (printWindow.document.readyState === "complete") {
        schedulePrint();
      } else {
        printWindow.addEventListener("load", schedulePrint, { once: true });
      }
      setStatus("U prozoru za ispis odaberi „Spremi kao PDF” ili svoj pisač.");
    } catch (error) {
      printWindow.close();
      showError("Ispis nije uspio", error);
    }
  });

  $("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("title").value.trim();
  if (!title || !currentUser || !itemsRef) return;

  const saved = {
    title,
    category: $("category").value.trim(),
    body: $("note-body").value,
    priority: $("priority").value,
    dueDate: $("due-date").value
  };
  const item = {
    type: view === "notes" ? "note" : "task",
    title,
    category: saved.category,
    createdAt: firestoreSdk.serverTimestamp(),
    updatedAt: firestoreSdk.serverTimestamp()
  };
  if (view === "notes") item.body = saved.body.trim();
  else {
    item.priority = saved.priority;
    item.done = false;
    if (saved.dueDate) item.dueDate = saved.dueDate;
  }

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
    $("due-date").value = saved.dueDate;
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
        const dueDate = document.createElement("label");
        dueDate.className = "date-field";
        const dueDateLabel = document.createElement("span");
        dueDateLabel.className = "date-label caps";
        dueDateLabel.textContent = "Rok (neobavezno)";
        const dueDateInput = document.createElement("input");
        dueDateInput.className = "field";
        dueDateInput.type = "date";
        dueDateInput.name = "dueDate";
        dueDateInput.value = t.dueDate || "";
        dueDate.append(dueDateLabel, dueDateInput);
        fields.append(dueDate);
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
          dueDate: firestoreSdk.deleteField(),
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
    else {
      updated.priority = data.get("priority");
      updated.dueDate = data.get("dueDate") || firestoreSdk.deleteField();
    }
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
    calendarDateFilter = "";
    $("app-shell").classList.toggle("notes-view", view === "notes");
    $("overview-panel").hidden = view === "notes";
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

  $("upcoming-list").addEventListener("click", e => {
    const task = e.target.closest("[data-upcoming-date]");
    if (!task) return;
    calendarDateFilter = task.dataset.upcomingDate;
    const [year, month] = calendarDateFilter.split("-").map(Number);
    calendarMonth = new Date(year, month - 1, 1);
    filter = "active";
    document.querySelectorAll("[data-filter]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    });
    render();
    $("zadaci").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  document.querySelector(".filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });

  $("calendar-widget").addEventListener("click", e => {
    const navigation = e.target.closest("[data-calendar-shift]");
    if (navigation) {
      calendarMonth = new Date(
        calendarMonth.getFullYear(),
        calendarMonth.getMonth() + Number(navigation.dataset.calendarShift),
        1
      );
      calendarDateFilter = "";
      render();
      return;
    }

    const day = e.target.closest("[data-calendar-date]");
    if (!day) return;
    calendarDateFilter = calendarDateFilter === day.dataset.calendarDate ? "" : day.dataset.calendarDate;
    render();
  });

  $("clear-date-filter").addEventListener("click", () => {
    calendarDateFilter = "";
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
