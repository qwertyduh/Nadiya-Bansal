// Book-style portfolio reader.
//
// Reads slides/slides.json and flips through the deck one "page" at a time:
//   - small screens  -> a single slide per page
//   - large screens  -> a two-slide spread per page
// Each new page shows shimmer skeletons until its images decode; the page
// ahead is prefetched so forward flipping feels sequential and instant.
// Nav: right half tap / → / swipe-left = next; left half tap / ← / swipe-right = prev.

(() => {
  const mqSpread = window.matchMedia("(min-width: 860px)");

  const view = document.getElementById("view");
  const pageview = document.getElementById("pageview");
  const progressEl = document.getElementById("progress");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const hint = document.getElementById("hint");

  const deck = []; // { fig, frame, img, ratio }
  let total = 0;
  let pageSize = mqSpread.matches ? 2 : 1;
  let page = 0;

  // ---------- helpers ----------
  const numPages = () => Math.max(1, Math.ceil(total / pageSize));
  const shownCount = (p) => Math.min(pageSize, total - p * pageSize);

  // "Tap left/right" is a first-run cue: once the person starts flipping (or
  // after a few idle seconds) it drifts away so it never gets in the way.
  const dismissHint = () => hint?.classList.add("gone");

  function go(p, animate) {
    const last = numPages() - 1;
    const target = Math.max(0, Math.min(last, p));
    if (target === page) return; // already at the requested page (e.g. a boundary)
    page = target;
    dismissHint();
    render(animate);
  }
  const next = () => go(page + 1, true);
  const prev = () => go(page - 1, true);

  // ---------- sizing: fit the shown slide(s) inside the stage ----------
  function layout() {
    const cs = getComputedStyle(pageview);
    const padX = parseFloat(cs.paddingLeft);
    const padY = parseFloat(cs.paddingTop);
    const gap = parseFloat(cs.columnGap) || 0; // matches the CSS gutter
    const availW = pageview.clientWidth - padX * 2;
    const availH = pageview.clientHeight - padY * 2;
    if (availW <= 0 || availH <= 0) return;

    const shown = deck.slice(page * pageSize, page * pageSize + shownCount(page));
    const n = shown.length;
    // Height cap uses the smallest ratio present (it yields the tallest slide).
    const minRatio = Math.min(...shown.map((s) => s.ratio));

    const w = Math.min((availW - (n - 1) * gap) / n, availH * minRatio);
    shown.forEach((s) => {
      s.fig.style.width = Math.max(w, 1) + "px";
    });
  }

  // ---------- render the current page ----------
  function render(animate = false) {
    pageview.innerHTML = "";
    const start = page * pageSize;
    const count = shownCount(page);

    for (let i = 0; i < count; i++) {
      const s = deck[start + i];
      pageview.append(s.fig);
      // "warm" the page after this one too, so forward flips are sequential & ready
      const lookahead = start + pageSize + pageSize;
      for (let j = start; j < lookahead && j < total; j++) deck[j].request();
    }

    if (animate) {
      pageview.classList.remove("pop");
      void pageview.offsetWidth; // restart the entrance animation
      pageview.classList.add("pop");
    }

    layout();
    updateChrome();
  }

  // ---------- chrome ----------
  function updateChrome() {
    const a = page * pageSize + 1;
    const b = Math.min(total, a + shownCount(page) - 1);
    progressEl.textContent = total ? `${a === b ? a : `${a}–${b}`} / ${total}` : "";
    btnPrev.disabled = page <= 0;
    btnNext.disabled = page >= numPages() - 1;
  }

  // ---------- build one slide ----------
  function buildSlide(meta, index) {
    const fig = document.createElement("figure");
    fig.className = "slide";
    fig.setAttribute("aria-label", `Slide ${index + 1}`);

    const frame = document.createElement("div");
    frame.className = "frame";
    frame.style.setProperty("--ar", meta.aspectRatio || "16 / 9");

    const img = document.createElement("img");
    img.alt = `Slide ${index + 1}`;
    img.decoding = "async";
    img.dataset.src = `slides/${meta.file}`;
    img.addEventListener("load", () => fig.classList.add("loaded"));
    img.addEventListener("error", () => fig.classList.add("error"));

    const skeleton = document.createElement("div");
    skeleton.className = "skeleton";
    skeleton.setAttribute("aria-hidden", "true");

    frame.append(img, skeleton);
    fig.append(frame);

    // Images start with no src. request() is idempotent, so a slide that was
    // prefetched earlier swaps in instantly when it finally reaches the page.
    const request = () => {
      if (img.getAttribute("src") === null) img.src = img.dataset.src;
    };

    deck[index] = { fig, frame, img, ratio: meta.aspectRatio, request };
  }

  // ---------- input: arrows, keys, clicks, swipe ----------
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      prev();
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(numPages() - 1);
    }
  });

  btnPrev.addEventListener("click", prev);
  btnNext.addEventListener("click", next);

  // Tapping anywhere (on the image or the margins) flips the page: the side of
  // the viewport that was tapped decides the direction.
  let swipeJustHandled = false; // ignore the click a swipe can leave behind
  view.addEventListener("click", (e) => {
    if (swipeJustHandled) return;
    const rect = view.getBoundingClientRect();
    (e.clientX < rect.left + rect.width / 2 ? prev : next)();
  });

  // swipe navigation
  let touchX = null;
  view.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX;
  }, { passive: true });
  view.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 48) {
      (dx < 0 ? next : prev)();
      swipeJustHandled = true;
      setTimeout(() => (swipeJustHandled = false), 350);
    }
  }, { passive: true });

  // ---------- responsive mode ----------
  function onBreakpoint(e) {
    const newSize = e.matches ? 2 : 1;
    if (newSize === pageSize) return;
    // Preserve the first slide on screen across the mode change.
    const currentSlide = page * pageSize;
    pageSize = newSize;
    page = Math.min(Math.floor(currentSlide / pageSize), numPages() - 1);
    render();
  }
  mqSpread.addEventListener("change", onBreakpoint);
  window.addEventListener("resize", layout);

  // ---------- boot ----------
  fetch("slides/slides.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((manifest) => {
      total = manifest.total;
      manifest.slides.forEach(buildSlide);
      render();
      setTimeout(dismissHint, 8000); // if they don’t flip, let the cue fade anyway
    })
    .catch((err) => {
      pageview.innerHTML =
        `<p class="progress">Couldn’t load the deck (${err.message}). ` +
        `Build it first with <code>npm run render</code>.</p>`;
      dismissHint();
    });
})();
