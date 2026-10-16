// The dev dashboard's behavior: live fragments over Server-Sent Events, the live log tail with
// pause and resume, and the charts' hover readout. Everything works without it: the pages are
// server-rendered, the charts are SVG with a data table, and a reload shows the latest numbers.
//
// The charts take their colors from CSS (light-dark() tokens), so a theme change needs nothing
// here. With prefers-reduced-motion, live fragments update at most every 5 seconds and nothing
// animates.
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---- live fragments: <div data-live="cards"> gets the "cards" event's HTML ------------------
  const root = document.querySelector("[data-dashboard]");
  const src = root && root.dataset.stream;
  if (root && src) {
    const status = root.querySelector("[data-live-status]");
    const statusText = root.querySelector("[data-live-text]");
    const toggle = root.querySelector("[data-live-toggle]");
    const pending = new Map();
    let es = null;
    let paused = false;
    let flushTimer = null;

    const setStatus = (state, text) => {
      if (!status) return;
      status.classList.remove("on", "paused");
      if (state) status.classList.add(state);
      statusText.textContent = text;
    };
    const apply = (key, html) => {
      const el = document.querySelector(`[data-live="${key}"]`);
      if (!el) return;
      // Keep open <details> (a chart's data table) open across updates.
      const open = [...el.querySelectorAll("details[open]")].map((d) => d.closest("[id]")?.id);
      el.innerHTML = html;
      open.forEach((id) => id && document.getElementById(id)?.querySelector("details")?.setAttribute("open", ""));
      bindCharts(el);
    };
    const flush = () => {
      flushTimer = null;
      pending.forEach((html, key) => apply(key, html));
      pending.clear();
    };
    const connect = () => {
      es = new EventSource(src);
      es.addEventListener("open", () => setStatus("on", "Live"));
      es.addEventListener("error", () => setStatus("", "Reconnecting…"));
      document.querySelectorAll("[data-live]").forEach((el) => {
        es.addEventListener(el.dataset.live, (e) => {
          if (reduced.matches) {
            pending.set(el.dataset.live, e.data);
            if (!flushTimer) flushTimer = setTimeout(flush, 5000);
          } else {
            apply(el.dataset.live, e.data);
          }
        });
      });
    };
    const stop = () => {
      if (es) es.close();
      es = null;
    };
    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener("click", () => {
        paused = !paused;
        toggle.setAttribute("aria-pressed", String(paused));
        toggle.textContent = paused ? "Resume" : "Pause";
        if (paused) {
          stop();
          setStatus("paused", "Paused");
        } else {
          connect();
        }
      });
    }
    // A hidden tab doesn't need a stream.
    document.addEventListener("visibilitychange", () => {
      if (paused) return;
      if (document.hidden) stop();
      else if (!es) connect();
    });
    connect();
  }

  // ---- the live log tail ---------------------------------------------------------------------
  const logs = document.querySelector("[data-logs]");
  if (logs && logs.dataset.logStream) {
    const MAX = 500;
    const status = document.querySelector("[data-log-status]");
    const statusText = document.querySelector("[data-log-status-text]");
    const toggle = document.querySelector("[data-log-toggle]");
    const buffered = document.querySelector("[data-log-buffered]");
    const empty = document.querySelector("[data-logs-empty]");
    let held = [];
    let paused = false;
    const add = (html) => {
      logs.insertAdjacentHTML("afterbegin", html);
      const row = logs.firstElementChild;
      if (row && !reduced.matches) row.classList.add("fresh");
      while (logs.children.length > MAX) logs.lastElementChild.remove();
      if (empty) empty.hidden = true;
    };
    const es = new EventSource(logs.dataset.logStream);
    es.addEventListener("open", () => {
      status?.classList.add("on");
      if (statusText) statusText.textContent = paused ? "Paused" : "Live";
    });
    es.addEventListener("error", () => {
      status?.classList.remove("on");
      if (statusText) statusText.textContent = "Reconnecting…";
    });
    es.addEventListener("log", (e) => {
      // A line already on the page (the backlog) isn't added twice.
      if (e.lastEventId && logs.querySelector(`[data-log-id="${e.lastEventId}"]`)) return;
      if (paused) {
        held.push(e.data);
        if (held.length > MAX) held.shift();
        if (buffered) buffered.textContent = `${held.length} new line${held.length === 1 ? "" : "s"} held while paused.`;
      } else {
        add(e.data);
      }
    });
    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener("click", () => {
        paused = !paused;
        toggle.setAttribute("aria-pressed", String(paused));
        toggle.textContent = paused ? "Resume" : "Pause";
        status?.classList.toggle("paused", paused);
        if (statusText) statusText.textContent = paused ? "Paused" : "Live";
        if (!paused) {
          held.forEach(add);
          held = [];
          if (buffered) buffered.textContent = "";
        }
      });
    }
  }

  // ---- chart readout: hover a chart to read every series at that moment -------------------------
  const units = {
    bytes: (v) => (v >= 1073741824 ? `${(v / 1073741824).toFixed(1)} GB` : v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB` : v >= 1024 ? `${(v / 1024).toFixed(1)} KB` : `${Math.round(v)} B`),
    percent: (v) => `${Math.round(v)}%`,
    rate: (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}/s`,
    micros: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}s` : v >= 1000 ? `${(v / 1000).toFixed(1)}ms` : `${Math.round(v)}µs`),
    count: (v) => `${Math.round(v)}`,
  };
  function bindCharts(scope) {
    scope.querySelectorAll("[data-chart]").forEach((fig) => {
      const wrap = fig.querySelector(".plot-wrap");
      const svg = fig.querySelector("svg.plot");
      if (!wrap || !svg || wrap.dataset.bound) return;
      wrap.dataset.bound = "1";
      const lines = [...svg.querySelectorAll("path.line")].map((p) => ({
        name: p.dataset.name,
        cls: [...p.classList].find((c) => /^s\d$/.test(c)),
        values: (p.dataset.values || "").split(",").filter(Boolean).map(Number),
      }));
      const fmt = units[fig.dataset.unit] || units.count;
      const t0 = Number(fig.dataset.t0);
      const step = Number(fig.dataset.step) || 1;
      const tip = document.createElement("div");
      tip.className = "readout";
      tip.hidden = true;
      tip.setAttribute("aria-hidden", "true");
      wrap.appendChild(tip);
      wrap.addEventListener("pointermove", (e) => {
        const n = lines[0]?.values.length || 0;
        if (!n) return;
        const box = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const left = (52 / vb.width) * box.width;
        const right = box.width - (8 / vb.width) * box.width;
        const x = Math.min(Math.max(e.clientX - box.left, left), right);
        const i = Math.round(((x - left) / Math.max(right - left, 1)) * (n - 1));
        const ago = Math.max(0, Math.round(Date.now() / 1000 - (t0 + i * step)));
        tip.textContent = "";
        const head = document.createElement("div");
        head.textContent = ago < 2 ? "now" : ago < 120 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
        tip.appendChild(head);
        lines.forEach((l) => {
          const row = document.createElement("div");
          row.textContent = `${l.name}: ${fmt(l.values[i] ?? 0)}`;
          tip.appendChild(row);
        });
        tip.hidden = false;
        const w = tip.offsetWidth;
        tip.style.left = `${Math.min(Math.max(x - w / 2, 0), box.width - w)}px`;
      });
      wrap.addEventListener("pointerleave", () => {
        tip.hidden = true;
      });
    });
  }
  bindCharts(document);
})();
