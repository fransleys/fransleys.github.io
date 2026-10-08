// Mobile "cards" mode: tab bar, one section per screen, tap-through career,
// and tiles that open into sheets. Does nothing on wider screens.
(() => {
  const mq = window.matchMedia("(max-width: 800px)");
  const tabs = [
    { id: "home", label: "Home", icon: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>' },
    { id: "career", label: "Career", icon: '<path d="M4 7h16v12H4zM9 7V4h6v3"/>' },
    { id: "how-i-work", label: "Work", icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>' },
    { id: "beyond-the-screen", label: "Beyond", icon: '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>' },
    { id: "contact", label: "Contact", icon: '<path d="M4 6h16v12H4zM4 7l8 6 8-6"/>' },
  ];
  const sections = tabs.map((t) => document.getElementById(t.id));
  let built = false;
  let tabbar, scrim, steps, dots, prev, next, count;
  let current = 0;

  function build() {
    built = true;

    tabbar = document.createElement("nav");
    tabbar.className = "tabbar";
    tabbar.setAttribute("aria-label", "Sections");
    tabs.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tab = t.id;
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span>`;
      b.addEventListener("click", () => showTab(t.id));
      tabbar.appendChild(b);
    });
    document.body.appendChild(tabbar);

    scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.addEventListener("click", closeSheet);
    document.body.appendChild(scrim);

    buildCareer();
    buildSheets();

    // In-page links (hero button, "Reach out") switch tabs instead of scrolling.
    document.addEventListener("click", (e) => {
      if (!document.body.classList.contains("cards")) return;
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute("href").slice(1);
      if (tabs.some((t) => t.id === id)) {
        e.preventDefault();
        showTab(id);
      }
    });

    window.addEventListener("hashchange", () => {
      if (document.body.classList.contains("cards")) showTab(location.hash.slice(1), false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSheet();
    });
  }

  function showTab(id, updateHash = true) {
    if (!tabs.some((t) => t.id === id)) id = "home";
    closeSheet();
    sections.forEach((s) => {
      const on = s.id === id;
      s.classList.toggle("is-active", on);
      if (on) s.scrollTop = 0;
    });
    tabbar.querySelectorAll("button").forEach((b) => {
      if (b.dataset.tab === id) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (updateHash) history.replaceState(null, "", id === "home" ? location.pathname : "#" + id);
  }

  // Career: show one step at a time, oldest first, with prev/next, dots and swipe.
  function buildCareer() {
    const list = document.querySelector(".career-timeline");
    steps = [...list.querySelectorAll(".career-step")].sort((a, b) => {
      const n = (el) => parseInt(el.querySelector(".career-number").textContent, 10);
      return n(a) - n(b);
    });
    steps.forEach((s) => list.appendChild(s));

    const labels = { 1: ["2006", "Fortis"], 2: ["2013", "Engagor"], 3: ["2017", "HubSpot"], 4: ["Next", "Who knows?"] };
    const stepper = document.createElement("div");
    stepper.className = "stepper";
    stepper.setAttribute("role", "group");
    stepper.setAttribute("aria-label", "Career steps");
    dots = steps.map((step, i) => {
      const n = parseInt(step.querySelector(".career-number").textContent, 10);
      const [when, who] = labels[n] || ["", ""];
      const d = document.createElement("button");
      d.type = "button";
      d.innerHTML = `${who}<small>${when}</small>`;
      d.addEventListener("click", () => showStep(i));
      stepper.appendChild(d);
      return d;
    });
    list.before(stepper);

    const pager = document.createElement("div");
    pager.className = "pager";
    prev = document.createElement("button");
    prev.type = "button";
    prev.className = "pager-btn";
    prev.setAttribute("aria-label", "Previous role");
    prev.textContent = "←";
    next = document.createElement("button");
    next.type = "button";
    next.className = "pager-btn";
    next.setAttribute("aria-label", "Next role");
    next.textContent = "→";
    count = document.createElement("span");
    count.className = "pager-count";
    pager.append(prev, count, next);
    list.after(pager);

    prev.addEventListener("click", () => showStep(current - 1));
    next.addEventListener("click", () => showStep(current + 1));

    let x0 = 0;
    list.addEventListener("touchstart", (e) => { x0 = e.changedTouches[0].clientX; }, { passive: true });
    list.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) showStep(current + (dx < 0 ? 1 : -1));
    }, { passive: true });

    showStep(0);
  }

  function showStep(i) {
    current = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((s, n) => s.classList.toggle("is-current", n === current));
    dots.forEach((d, n) => {
      d.setAttribute("aria-current", String(n === current));
      d.classList.toggle("is-done", n < current);
    });
    count.textContent = `${current + 1} of ${steps.length}`;
    prev.disabled = current === 0;
    next.disabled = current === steps.length - 1;
  }

  // Skill and Beyond tiles open into a sheet; the card itself is reused so
  // links and the photo viewer keep working.
  function buildSheets() {
    document.querySelectorAll(".skill-card, .beyond-card").forEach((card) => {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "sheet-close";
      close.textContent = "← Back";
      close.addEventListener("click", (e) => { e.stopPropagation(); closeSheet(); });
      card.prepend(close);

      card.addEventListener("click", (e) => {
        if (!document.body.classList.contains("cards")) return;
        if (card.classList.contains("is-open")) return;
        e.preventDefault();
        openSheet(card);
      });
    });
  }

  function openSheet(card) {
    closeSheet();
    card.classList.add("is-open");
    // Keep the (hidden) scrim inside the section.
    card.closest("main > section").appendChild(scrim);
    scrim.classList.add("is-on");
    card.scrollTop = 0;
  }

  function closeSheet() {
    if (!built) return;
    document.querySelectorAll(".is-open").forEach((c) => c.classList.remove("is-open"));
    scrim.classList.remove("is-on");
  }

  function apply() {
    const on = mq.matches;
    document.body.classList.toggle("cards", on);
    document.documentElement.classList.toggle("cards-on", on);
    if (!on) {
      if (built) closeSheet();
      return;
    }
    if (!built) build();
    const hash = location.hash.slice(1);
    showTab(tabs.some((t) => t.id === hash) ? hash : "home", false);
  }

  mq.addEventListener("change", apply);
  apply();
})();
