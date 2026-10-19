/* Fluid motion for fransleys.be
 *
 * A small spring engine (damping ratio + response, as in Apple's
 * "Designing Fluid Interfaces") drives everything that responds to touch:
 * press feedback, the nav pill, and the photo viewer. Springs are
 * interruptible: you can grab one mid-flight and it carries on from where
 * it is, with the velocity you give it.
 */
(() => {
  const root = document.documentElement;
  root.classList.add("js");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- Spring engine ---------- */

  const running = new Set();
  let frame = 0;
  let lastTime = 0;

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    for (const spring of [...running]) spring.step(dt);
    frame = running.size ? requestAnimationFrame(loop) : 0;
  }

  function wake(spring) {
    running.add(spring);
    if (!frame) {
      lastTime = performance.now();
      frame = requestAnimationFrame(loop);
    }
  }

  class Spring {
    // response: seconds for one "natural" cycle (smaller = snappier).
    // damping: 1 = no overshoot, below 1 = bounce.
    constructor(value, { response = 0.4, damping = 1 } = {}, onUpdate = () => {}) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.response = response;
      this.damping = damping;
      this.onUpdate = onUpdate;
      this.onRest = null;
      this.tweenState = null;
    }

    // Jump to a value and stop. Used while a finger is driving the value.
    set(value) {
      this.value = this.target = value;
      this.velocity = 0;
      this.tweenState = null;
      running.delete(this);
      this.onUpdate(this.value);
    }

    // Animate to target, starting from the current value and velocity.
    to(target, { velocity, response, damping, onRest } = {}) {
      if (response !== undefined) this.response = response;
      if (damping !== undefined) this.damping = damping;
      if (velocity !== undefined) this.velocity = velocity;
      this.target = target;
      this.onRest = onRest || null;
      if (reduceMotion.matches) {
        this.tweenState = { from: this.value, t: 0 };
        this.velocity = 0;
      } else {
        this.tweenState = null;
      }
      wake(this);
    }

    step(dt) {
      if (this.tweenState) {
        // Reduced motion: short ease-out instead of a spring.
        this.tweenState.t = Math.min(1, this.tweenState.t + dt / 0.16);
        const eased = 1 - (1 - this.tweenState.t) ** 2;
        this.value = lerp(this.tweenState.from, this.target, eased);
        this.onUpdate(this.value);
        if (this.tweenState.t >= 1) this.settle();
        return;
      }
      const omega = (2 * Math.PI) / this.response;
      const k = omega * omega;
      const c = 2 * this.damping * omega;
      const h = 1 / 240;
      let remaining = dt;
      while (remaining > 1e-6) {
        const step = Math.min(h, remaining);
        const accel = -k * (this.value - this.target) - c * this.velocity;
        this.velocity += accel * step;
        this.value += this.velocity * step;
        remaining -= step;
      }
      this.onUpdate(this.value);
      if (Math.abs(this.value - this.target) < 0.01 && Math.abs(this.velocity) < 0.05) this.settle();
    }

    settle() {
      this.value = this.target;
      this.velocity = 0;
      this.tweenState = null;
      running.delete(this);
      this.onUpdate(this.value);
      const done = this.onRest;
      this.onRest = null;
      if (done) done();
    }
  }

  /* A spring's step response, sampled into a CSS linear() easing, so plain
     CSS transitions (reveals, tooltips, hovers) share the same feel. */
  function springCurve(response, damping) {
    const omega = (2 * Math.PI) / response;
    const h = 1 / 240;
    let x = 0;
    let v = 0;
    const samples = [0];
    let t = 0;
    let settledFor = 0;
    while (t < 3 && settledFor < 0.1) {
      v += (-omega * omega * (x - 1) - 2 * damping * omega * v) * h;
      x += v * h;
      t += h;
      samples.push(x);
      settledFor = Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.01 ? settledFor + h : 0;
    }
    const points = 40;
    const out = [];
    for (let i = 0; i <= points; i++) {
      const value = samples[Math.min(samples.length - 1, Math.round((i / points) * (samples.length - 1)))];
      out.push(+value.toFixed(4));
    }
    out[out.length - 1] = 1;
    return { easing: `linear(${out.join(", ")})`, duration: Math.round(t * 1000) };
  }

  const smooth = springCurve(0.5, 1);
  const lively = springCurve(0.45, 0.72);
  root.style.setProperty("--spring-ease", smooth.easing);
  root.style.setProperty("--spring-dur", `${smooth.duration}ms`);
  root.style.setProperty("--spring-lively-ease", lively.easing);
  root.style.setProperty("--spring-lively-dur", `${lively.duration}ms`);

  /* ---------- Press feedback: respond on pointer-down, not on release ---------- */

  const pressed = new Map();

  function pressSpring(el) {
    let spring = pressed.get(el);
    if (!spring) {
      spring = new Spring(1, { response: 0.2, damping: 1 }, (v) => el.style.setProperty("--press", v.toFixed(4)));
      pressed.set(el, spring);
    }
    return spring;
  }

  document.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    const el = event.target.closest("[data-press]");
    if (!el) return;
    const width = el.offsetWidth || 100;
    const scale = Math.max(0.93, 1 - 14 / width);
    pressSpring(el).to(scale, { response: 0.2, damping: 1 });
    el.dataset.pressed = "";
  });

  function releasePress() {
    for (const [el, spring] of pressed) {
      if (el.dataset.pressed === undefined) continue;
      delete el.dataset.pressed;
      // Released with a little momentum, so a touch of overshoot.
      spring.to(1, { response: 0.35, damping: 0.72 });
    }
  }
  document.addEventListener("pointerup", releasePress);
  document.addEventListener("pointercancel", releasePress);

  /* ---------- Header: translucent material, nav pill that follows the page ---------- */

  const header = document.getElementById("site-header");
  const nav = document.getElementById("main-nav");
  const pill = nav.querySelector(".nav-pill");
  const navLinks = [...nav.querySelectorAll("a")];
  const sectionIds = navLinks.map((a) => a.getAttribute("href").slice(1));
  const sections = sectionIds.map((id) => document.getElementById(id));

  const pillX = new Spring(0, { response: 0.4, damping: 0.9 }, apply);
  const pillW = new Spring(0, { response: 0.4, damping: 0.9 }, apply);
  let activeLink = null;
  let pillShown = false;

  function apply() {
    pill.style.width = `${pillW.value}px`;
    pill.style.transform = `translate3d(${pillX.value}px, 0, 0)`;
  }

  function movePill(immediate) {
    if (!activeLink || activeLink.offsetWidth === 0) {
      pill.style.opacity = "0";
      pillShown = false;
      return;
    }
    const x = activeLink.offsetLeft;
    const w = activeLink.offsetWidth;
    if (immediate || !pillShown) {
      pillX.set(x);
      pillW.set(w);
    } else {
      pillX.to(x);
      pillW.to(w);
    }
    pill.style.opacity = "1";
    pillShown = true;
  }

  function setActive(index) {
    const link = navLinks[index];
    if (link === activeLink) return;
    navLinks.forEach((a) => a.removeAttribute("aria-current"));
    link.setAttribute("aria-current", "true");
    activeLink = link;
    movePill(false);
  }

  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive(sections.indexOf(entry.target));
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  sections.forEach((s) => s && spy.observe(s));
  setActive(0);
  window.addEventListener("resize", () => movePill(true));
  document.fonts?.ready.then(() => movePill(true));

  function onScroll() {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Scroll reveal ---------- */

  const revealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        revealer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => revealer.observe(el));

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---------- Photo viewer ---------- */

  const PHOTO_COUNT = 29;
  const PORTRAITS = new Set([3, 4, 7, 14, 22, 25, 27, 28]);
  const galleryEl = document.getElementById("photo-gallery");
  const thumbs = [];

  for (let n = 1; n <= PHOTO_COUNT; n++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-item" + (PORTRAITS.has(n) ? " gallery-item-portrait" : "");
    button.dataset.press = "";
    button.dataset.index = String(n - 1);
    button.setAttribute("aria-label", `Open photograph ${n}`);
    const img = document.createElement("img");
    img.src = `images/website - ${n}.jpeg`;
    img.alt = `Photograph ${n} by Frans Leys`;
    img.loading = "lazy";
    button.appendChild(img);
    galleryEl.appendChild(button);
    thumbs.push(button);
  }

  const box = document.getElementById("lightbox");
  const stage = document.getElementById("lb-stage");
  const backdrop = box.querySelector(".lb-backdrop");
  const chrome = box.querySelector(".lb-chrome");
  const countEl = document.getElementById("lb-count");
  const prevBtn = box.querySelector(".lb-prev");
  const nextBtn = box.querySelector(".lb-next");
  const closeBtn = box.querySelector(".lb-close");

  const slides = new Map(); // index -> { el, img }
  let W = window.innerWidth;
  let H = window.innerHeight;
  let index = 0;
  let isOpen = false;
  let closing = false;
  let reveal = null; // thumbnail geometry for the open/close transition
  let hiddenThumb = null;

  // sx: horizontal position of the carousel in px (index * W at rest).
  // sy: vertical drag offset (swipe to dismiss).
  // sr: 0 = at the thumbnail, 1 = fully open.
  const sx = new Spring(0, { response: 0.4, damping: 1 }, render);
  const sy = new Spring(0, { response: 0.4, damping: 1 }, render);
  const sr = new Spring(0, { response: 0.45, damping: 1 }, render);

  function getSlide(i) {
    let slide = slides.get(i);
    if (slide) return slide;
    const el = document.createElement("div");
    el.className = "lb-slide";
    const img = document.createElement("img");
    img.src = thumbs[i].querySelector("img").src;
    img.alt = thumbs[i].querySelector("img").alt;
    img.draggable = false;
    el.appendChild(img);
    stage.appendChild(el);
    slide = { el, img };
    slides.set(i, slide);
    return slide;
  }

  // Rubber-band: resistance grows the further you pull past an edge.
  function rubber(overshoot, dimension) {
    const sign = Math.sign(overshoot);
    const d = Math.abs(overshoot);
    return sign * (1 - 1 / ((d * 0.55) / dimension + 1)) * dimension;
  }

  function render() {
    if (!isOpen) return;
    const r = sr.value;
    const ty = sy.value;
    const dragFade = clamp(Math.abs(ty) / (H * 0.5), 0, 1);
    const center = clamp(Math.round(sx.value / W), 0, PHOTO_COUNT - 1);

    for (let i = Math.max(0, center - 1); i <= Math.min(PHOTO_COUNT - 1, center + 1); i++) {
      const { el, img } = getSlide(i);
      const tx = i * W - sx.value;
      let x = tx;
      let y = ty;
      let scale = 1 - dragFade * 0.12;
      let opacity = 1;
      let clip = "none";

      if (i === index && r < 1) {
        if (reveal && !reduceMotion.matches) {
          x += reveal.dx * (1 - r);
          y += reveal.dy * (1 - r);
          scale *= lerp(reveal.scale, 1, r);
          const ix = reveal.ix * (1 - r);
          const iy = reveal.iy * (1 - r);
          clip = `inset(${iy}px ${ix}px ${iy}px ${ix}px)`;
        } else {
          opacity = r;
          if (!reduceMotion.matches) scale *= lerp(0.92, 1, r);
        }
      }
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      img.style.clipPath = clip;
      img.style.opacity = opacity;
    }
    for (const [i, slide] of slides) {
      if (Math.abs(i - center) > 1) {
        slide.el.remove();
        slides.delete(i);
      }
    }

    backdrop.style.opacity = String(r * (1 - dragFade * 0.85));
    const chromeOpacity = r * (1 - clamp(Math.abs(ty) / (H * 0.2), 0, 1));
    chrome.style.opacity = String(chromeOpacity);
    chrome.style.pointerEvents = chromeOpacity < 0.5 ? "none" : "";
  }

  function geometryFor(i) {
    const slide = getSlide(i);
    const fw = slide.img.offsetWidth;
    const fh = slide.img.offsetHeight;
    const rect = thumbs[i].getBoundingClientRect();
    const visible = rect.width > 2 && rect.bottom > 0 && rect.top < H && rect.right > 0 && rect.left < W;
    if (!visible || !fw || !fh) return null;
    // The thumbnail shows the photo cropped to fill (object-fit: cover), so
    // scale and clip the full image to match exactly what the thumbnail shows.
    const scale = Math.max(rect.width / fw, rect.height / fh);
    return {
      dx: rect.left + rect.width / 2 - W / 2,
      dy: rect.top + rect.height / 2 - H / 2,
      scale,
      ix: Math.max(0, (fw - rect.width / scale) / 2),
      iy: Math.max(0, (fh - rect.height / scale) / 2),
    };
  }

  function syncIndexUI() {
    countEl.textContent = `${index + 1} / ${PHOTO_COUNT}`;
    prevBtn.toggleAttribute("aria-disabled", index === 0);
    nextBtn.toggleAttribute("aria-disabled", index === PHOTO_COUNT - 1);
    // Hide the thumbnail the viewer is currently standing in for.
    if (hiddenThumb) hiddenThumb.style.visibility = "";
    hiddenThumb = thumbs[index];
    hiddenThumb.style.visibility = "hidden";
  }

  async function open(i) {
    if (isOpen) return;
    isOpen = true;
    closing = false;
    index = i;
    W = window.innerWidth;
    H = window.innerHeight;
    document.body.classList.add("lightbox-open");
    sx.set(i * W);
    sy.set(0);
    sr.set(0);
    box.showModal();
    const slide = getSlide(i);
    render();
    try {
      await slide.img.decode();
    } catch (_) {
      /* image already shown by the thumbnail; geometry falls back below */
    }
    reveal = geometryFor(i);
    syncIndexUI();
    render();
    sr.to(1, { response: 0.45, damping: 1 });
    closeBtn.focus({ preventScroll: true });
  }

  function finishClose() {
    isOpen = false;
    closing = false;
    reveal = null;
    box.close();
    document.body.classList.remove("lightbox-open");
    if (hiddenThumb) {
      hiddenThumb.style.visibility = "";
      hiddenThumb.focus({ preventScroll: true });
      hiddenThumb = null;
    }
    slides.forEach((s) => s.el.remove());
    slides.clear();
  }

  // Close back into the thumbnail the viewer is standing in for.
  function close() {
    if (!isOpen || closing) return;
    closing = true;
    sx.to(index * W, { response: 0.3 });
    sy.to(0, { response: 0.3 });
    reveal = geometryFor(index);
    sr.to(0, { response: 0.42, damping: 1, onRest: finishClose });
  }

  // Dismiss by flinging the photo off the screen, carrying the release velocity.
  function flingAway(velocityY) {
    closing = true;
    const direction = velocityY === 0 ? Math.sign(sy.value) || 1 : Math.sign(velocityY);
    sy.to(direction * H, { velocity: velocityY, response: 0.35, damping: 1 });
    sr.to(0, {
      response: 0.35,
      damping: 1,
      onRest: finishClose,
    });
    reveal = null;
  }

  function go(target, velocity = 0) {
    const next = clamp(target, 0, PHOTO_COUNT - 1);
    index = next;
    syncIndexUI();
    sx.to(next * W, { velocity, response: 0.4, damping: Math.abs(velocity) > 300 ? 0.85 : 1 });
  }

  galleryEl.addEventListener("click", (event) => {
    const item = event.target.closest(".gallery-item");
    if (item) open(Number(item.dataset.index));
  });
  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => go(index - 1));
  nextBtn.addEventListener("click", () => go(index + 1));
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  box.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") go(index - 1);
    if (event.key === "ArrowRight") go(index + 1);
  });
  window.addEventListener("resize", () => {
    if (!isOpen) return;
    W = window.innerWidth;
    H = window.innerHeight;
    sx.set(index * W);
    render();
  });

  /* Gestures: direct manipulation on the stage.
     - 10px of hysteresis before we commit to horizontal or vertical.
     - The photo follows the finger 1:1, with rubber-banding at the ends.
     - On release the velocity is handed to the spring, and the resting
       point is projected from that velocity (decay rate 0.998). */

  const DECEL = 0.998;
  const project = (velocity) => (velocity / 1000) * (DECEL / (1 - DECEL));
  let drag = null;

  stage.addEventListener("pointerdown", (event) => {
    if (closing || event.button > 0) return;
    stage.setPointerCapture(event.pointerId);
    // Grabbing a moving photo stops it where it is; no jump.
    const grabbed = Math.abs(sy.value) > 2 || Math.abs(sx.value - index * W) > 2;
    sx.set(sx.value);
    sy.set(sy.value);
    drag = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      baseX: sx.value,
      baseY: sy.value,
      startPage: Math.round(sx.value / W),
      mode: grabbed ? "free" : null,
      onImage: !!event.target.closest("img"),
      history: [{ t: performance.now(), x: event.clientX, y: event.clientY }],
    };
  });

  stage.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const now = performance.now();
    drag.history.push({ t: now, x: event.clientX, y: event.clientY });
    while (drag.history.length > 2 && now - drag.history[0].t > 100) drag.history.shift();

    let dx = event.clientX - drag.x0;
    let dy = event.clientY - drag.y0;

    if (!drag.mode) {
      if (Math.hypot(dx, dy) < 10) return;
      drag.mode = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      // Start tracking from here so the photo doesn't jump by the hysteresis.
      drag.x0 = event.clientX;
      drag.y0 = event.clientY;
      dx = 0;
      dy = 0;
    }

    if (drag.mode === "x" || drag.mode === "free") {
      const max = (PHOTO_COUNT - 1) * W;
      const raw = drag.baseX - dx;
      const over = raw < 0 ? raw : raw > max ? raw - max : 0;
      sx.set(clamp(raw, 0, max) + rubber(over, W));
    }
    if (drag.mode === "y" || drag.mode === "free") {
      sy.set(drag.baseY + dy);
    }
  });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const d = drag;
    drag = null;

    const first = d.history[0];
    const last = d.history[d.history.length - 1];
    const span = Math.max(16, last.t - first.t) / 1000;
    const vx = (last.x - first.x) / span;
    const vy = (last.y - first.y) / span;

    if (!d.mode) {
      // A tap on the empty area closes the viewer.
      if (!d.onImage && event.type === "pointerup") close();
      return;
    }

    if (d.mode === "x" || d.mode === "free") {
      const target = clamp(Math.round((sx.value - project(vx)) / W), d.startPage - 1, d.startPage + 1);
      go(target, -vx);
    }
    if (d.mode === "y" || d.mode === "free") {
      const projected = sy.value + project(vy);
      if (Math.abs(projected) > H * 0.3) {
        flingAway(vy);
      } else {
        sy.to(0, { velocity: vy, response: 0.4, damping: Math.abs(vy) > 300 ? 0.85 : 1 });
      }
    }
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dragstart", (event) => event.preventDefault());
})();
