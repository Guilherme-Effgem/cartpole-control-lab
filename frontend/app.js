const $ = (id) => document.getElementById(id);
const PANELS = ["a", "b"];
const COLORS = { a: "#49a6ff", b: "#38d6a0" };
const CTRL_NAMES = { fuzzy: "Fuzzy", pid: "PID", manual: "Manual" };
const DT = 0.02;
const HISTORY_SECONDS = 65;
const BENCH = 12 * Math.PI / 180;

let socket;
let latest = null;
let initialized = false;
let history = [];          // {t, a, b}
let markers = [];          // {t, color}
const camera = { a: 0, b: 0 };
const kickFlash = { a: 0, b: 0 };
const chartSettings = { zoom: 0.25, window: 10 };

const num = (n, d = 2) => Number(n).toFixed(d).replace(".", ",");
const deg = (rad, d = 2) => `${num(rad * 180 / Math.PI, d)}°`;

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------
function connect() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws`);
  initialized = false;
  socket.onopen = () => {
    $("connectionDot").classList.add("online");
    $("connectionText").textContent = "Conectado ao simulador";
  };
  socket.onclose = () => {
    $("connectionDot").classList.remove("online");
    $("connectionText").textContent = "Desconectado: atualize a página";
  };
  socket.onerror = () => { $("connectionText").textContent = "Erro de conexão"; };
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type !== "state") return;
    latest = data;
    if (!initialized) { syncInputsFromServer(data); initialized = true; }
    ingest(data);
    updateDashboard(data);
  };
}
function send(command, extra = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ command, ...extra }));
}

// ---------------------------------------------------------------------------
// Barra de ferramentas
// ---------------------------------------------------------------------------
$("startBtn").onclick = () => send("start");
$("pauseBtn").onclick = () => send("pause");
$("resetBtn").onclick = () => send("reset", { seed: latest?.seed ?? 42 });
$("speedSelect").onchange = (e) => send("speed", { value: Number(e.target.value) });
$("autoRise").onchange = (e) => send("auto_rise", { enabled: e.target.checked });

// ---------------------------------------------------------------------------
// Controladores por painel
// ---------------------------------------------------------------------------
function showParams(key, type) {
  document.querySelectorAll(`#${key}Params .param-block`).forEach((el) => {
    el.hidden = el.dataset.for !== type;
  });
}
function sendController(key) {
  send("controller", {
    panel: key,
    type: $(key + "Controller").value,
    params: {
      kp: Number($(key + "Kp").value), ki: Number($(key + "Ki").value), kd: Number($(key + "Kd").value),
      kx: Number($(key + "Kx").value), kv: Number($(key + "Kv").value),
      threshold: Number($(key + "Threshold").value),
      fx: Number($(key + "Fx").value), fv: Number($(key + "Fv").value),
    },
  });
}
function setPidInputs(key, p) {
  for (const [g, v] of [["Kp", p.kp], ["Ki", p.ki], ["Kd", p.kd], ["Kx", p.kx], ["Kv", p.kv]]) {
    $(key + g).value = v; $(key + g + "Out").value = v;
  }
}
function setFuzzyInputs(key, p) {
  $(key + "Threshold").value = p.threshold; $(key + "ThresholdOut").value = num(p.threshold);
  $(key + "Fx").value = p.fx; $(key + "FxOut").value = num(p.fx, 3);
  $(key + "Fv").value = p.fv; $(key + "FvOut").value = num(p.fv, 3);
}

// Tabela de regras Fuzzy (linhas: θ, colunas: θ̇)
const SETS = ["NG", "NP", "Z", "PP", "PG"];
const ruleCells = { a: [], b: [] };
function ruleColor(v) {
  const a = Math.min(1, Math.abs(v)) * 0.45;
  return v >= 0 ? `rgba(56,214,160,${a})` : `rgba(255,115,115,${a})`;
}
function buildRules(key) {
  const table = $(key + "Rules");
  const head = `<tr><th class="corner">θ \\ θ̇</th>${SETS.map((s) => `<th>${s}</th>`).join("")}</tr>`;
  const body = SETS.map((s, i) => `<tr><th>${s}</th>${SETS.map((_, j) =>
    `<td><input type="text" inputmode="decimal" autocomplete="off" data-i="${i}" data-j="${j}" aria-label="θ ${s}, θ̇ ${SETS[j]}"></td>`).join("")}</tr>`).join("");
  table.innerHTML = head + body;
  ruleCells[key] = SETS.map((_, i) => SETS.map((_, j) => table.querySelector(`input[data-i="${i}"][data-j="${j}"]`)));
  table.addEventListener("change", (e) => {
    const input = e.target;
    if (input.tagName !== "INPUT") return;
    let v = Number(input.value.replace(",", "."));
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(-1, Math.min(1, v));
    input.value = num(v);
    input.parentElement.style.background = ruleColor(v);
    sendRules(key);
  });
}
function setRuleInputs(key, rules) {
  ruleCells[key].forEach((row, i) => row.forEach((input, j) => {
    input.value = num(rules[i][j]);
    input.parentElement.style.background = ruleColor(rules[i][j]);
  }));
}
function sendRules(key) {
  const rules = ruleCells[key].map((row) => row.map((input) => Number(input.value.replace(",", ".")) || 0));
  send("controller", { panel: key, type: $(key + "Controller").value, params: { rules } });
}
function showActivations(key, act) {
  ruleCells[key].forEach((row, i) => row.forEach((input, j) => {
    const a = act ? act[i][j] : 0;
    input.parentElement.style.boxShadow = a > 0.01 ? `inset 0 0 0 2px rgba(232,238,246,${0.25 + 0.75 * a})` : "";
  }));
}

PANELS.forEach((key) => {
  $(key + "Controller").onchange = (e) => {
    showParams(key, e.target.value);
    if (e.target.value !== "fuzzy") $(key + "RulesDialog").close();
    sendController(key);
    e.target.blur(); // libera as setas do teclado para o modo manual
  };
  ["Kp", "Ki", "Kd", "Kx", "Kv"].forEach((g) => {
    $(key + g).oninput = (e) => { $(key + g + "Out").value = e.target.value; sendController(key); };
  });
  $(key + "Threshold").oninput = (e) => { $(key + "ThresholdOut").value = num(e.target.value); sendController(key); };
  ["Fx", "Fv"].forEach((g) => {
    $(key + g).oninput = (e) => { $(key + g + "Out").value = num(e.target.value, 3); sendController(key); };
  });
  $(key + "Rise").onclick = () => send("rise", { panel: key });
  $(key + "PidDefault").onclick = () => {
    const d = latest?.defaults ?? { kp: 80, ki: 0, kd: 18, kx: 6, kv: 10 };
    setPidInputs(key, d);
    sendController(key);
  };
  $(key + "RulesDefault").onclick = () => {
    const d = latest?.defaults;
    if (!d) return;
    setRuleInputs(key, d.rules);
    setFuzzyInputs(key, d);
    sendController(key);
    sendRules(key);
  };
  buildRules(key);
  const dlg = $(key + "RulesDialog");
  $(key + "RulesOpen").onclick = () => {
    PANELS.forEach((o) => { if (o !== key) $(o + "RulesDialog").close(); });
    if (dlg.open) dlg.close(); else dlg.show(); // não modal: a simulação continua visível e clicável
  };
  dlg.querySelector("[data-close]").onclick = () => dlg.close();

  document.querySelectorAll(`#${key}Params .hold`).forEach((btn) => {
    const dir = Number(btn.dataset.dir);
    const press = (e) => { e.preventDefault(); btn.classList.add("pressed"); send("manual", { panel: key, direction: dir }); };
    const release = () => { if (btn.classList.contains("pressed")) { btn.classList.remove("pressed"); send("manual", { panel: key, direction: 0 }); } };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
  });
});

// ---------------------------------------------------------------------------
// Teclado: manual (A/D e ←/→) e perturbação (Q/E)
// ---------------------------------------------------------------------------
const pressed = new Set();
const KEYSETS = {
  wasd: { left: "a", right: "d", prefer: "a" },
  jl: { left: "j", right: "l", prefer: "b" },
};
function manualPanels() { return PANELS.filter((k) => $(k + "Controller").value === "manual"); }
function targetFor(set) {
  const manual = manualPanels();
  if (manual.includes(set.prefer)) return set.prefer;
  return manual.length === 1 ? manual[0] : null; // um só painel manual: as duas teclas servem
}
function refreshManual() {
  const dirs = {};
  for (const set of Object.values(KEYSETS)) {
    const target = targetFor(set);
    if (!target) continue;
    const dir = (pressed.has(set.right) ? 1 : 0) - (pressed.has(set.left) ? 1 : 0);
    dirs[target] = dirs[target] ? dirs[target] : dir;
  }
  for (const key of manualPanels()) send("manual", { panel: key, direction: dirs[key] || 0 });
}
function isTyping(el) { return el && (el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "range" && el.type !== "checkbox")); }
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") PANELS.forEach((k) => $(k + "RulesDialog").close());
  if (isTyping(document.activeElement)) return;
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "arrowright") {
    e.preventDefault(); // a seta perturba em vez de mover um slider focado
    if (!e.repeat) disturb(k === "arrowleft" ? -1 : 1);
    return;
  }
  const manualKey = ["a", "d", "j", "l"].includes(k);
  if (!manualKey || manualPanels().length === 0) return;
  e.preventDefault();
  if (!pressed.has(k)) { pressed.add(k); refreshManual(); }
});
document.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (pressed.delete(k)) refreshManual();
});
window.addEventListener("blur", () => { if (pressed.size) { pressed.clear(); refreshManual(); } });

// ---------------------------------------------------------------------------
// Perturbações
// ---------------------------------------------------------------------------
function disturbParams() {
  return {
    target: $("disturbTarget").value,
    magnitude: Number($("disturbMag").value),
    duration: Number($("disturbDur").value),
    panels: $("disturbPanels").value,
  };
}
function disturb(direction) { send("disturb", { direction, ...disturbParams() }); }
function sendAutoDisturb() {
  const p = disturbParams();
  send("auto_disturb", {
    enabled: $("autoDisturb").checked, interval: Number($("autoInterval").value),
    target: p.target, magnitude: p.magnitude, duration: p.duration,
  });
}
const magByTarget = { cart: 20, pole: 1 };
let magTarget = "cart";
function refreshDisturbLabels() {
  const target = $("disturbTarget").value, pole = target === "pole";
  const mag = $("disturbMag");
  $("disturbMagLabel").textContent = pole ? "Golpe (variação de velocidade angular)" : "Força";
  if (target !== magTarget) {
    // cada tipo guarda a própria intensidade (o navegador cortaria o valor ao trocar a escala)
    magByTarget[magTarget] = Number(mag.value);
    magTarget = target;
    if (pole) { mag.min = 0.1; mag.max = 5; mag.step = 0.1; }
    else { mag.min = 1; mag.max = 100; mag.step = 1; }
    mag.value = magByTarget[target];
  }
  $("disturbMagOut").value = pole ? `${num(mag.value, 1)} rad/s` : `${num(mag.value, 0)} N`;
  $("disturbDurField").hidden = pole;
  $("disturbDurOut").value = `${num($("disturbDur").value)} s`;
}
$("pushLeft").onclick = () => disturb(-1);
$("quickLeft").onclick = () => disturb(-1);
$("quickRight").onclick = () => disturb(1);
$("pushRight").onclick = () => disturb(1);
$("disturbTarget").onchange = () => { refreshDisturbLabels(); sendAutoDisturb(); };
["disturbMag", "disturbDur"].forEach((id) => { $(id).oninput = () => { refreshDisturbLabels(); sendAutoDisturb(); }; });
$("autoDisturb").onchange = sendAutoDisturb;
$("autoInterval").oninput = (e) => { $("autoIntervalOut").value = `${num(e.target.value, 1)} s`; sendAutoDisturb(); };

// ---------------------------------------------------------------------------
// Modelo mecânico
// ---------------------------------------------------------------------------
const PHYS = {
  cartMass: { key: "cart_mass", unit: "kg", d: 2, def: 1.0 },
  cartWidth: { key: "cart_width", unit: "m", d: 2, def: 0.4 },
  cartHeight: { key: "cart_height", unit: "m", d: 2, def: 0.2 },
  poleMass: { key: "pole_mass", unit: "kg", d: 2, def: 0.1 },
  poleLength: { key: "pole_length", unit: "m", d: 2, def: 1.0 },
  poleThickness: { key: "pole_thickness", unit: "m", d: 3, def: 0.05 },
  forceMag: { key: "force_mag", unit: "N", d: 1, def: 10.0 },
  gravity: { key: "gravity", unit: "m/s²", d: 1, def: 9.8 },
  trackLength: { key: "track_length", unit: "m", d: 1, def: 4.8 },
};
function physLabel(id) { $(id + "Out").textContent = `${num($(id).value, PHYS[id].d)} ${PHYS[id].unit}`; }
function physicalPending() {
  if (!latest) return false;
  return Object.entries(PHYS).some(([id, p]) => Math.abs(Number($(id).value) - latest.config[p.key]) > 1e-6);
}
function refreshPhysicalState() {
  const pending = physicalPending();
  $("physicalState").textContent = pending ? "alterações não aplicadas" : "aplicado";
  $("physicalState").classList.toggle("pending", pending);
  $("applyPhysicalBtn").classList.toggle("attention", pending);
}
Object.keys(PHYS).forEach((id) => { $(id).oninput = () => { physLabel(id); refreshPhysicalState(); }; });
$("applyPhysicalBtn").onclick = () => {
  const values = {};
  for (const [id, p] of Object.entries(PHYS)) values[p.key] = Number($(id).value);
  send("physical_config", { values });
};
$("defaultPhysicalBtn").onclick = () => {
  for (const [id, p] of Object.entries(PHYS)) { $(id).value = p.def; physLabel(id); }
  $("applyPhysicalBtn").onclick();
};

// ---------------------------------------------------------------------------
// Gráfico
// ---------------------------------------------------------------------------
$("angleZoom").onchange = (e) => { chartSettings.zoom = Number(e.target.value); drawAngleChart(); };
$("timeWindow").onchange = (e) => { chartSettings.window = Number(e.target.value); drawAngleChart(); };

// ---------------------------------------------------------------------------
// Estado vindo do servidor
// ---------------------------------------------------------------------------
function syncInputsFromServer(d) {
  // Só na conexão: depois disso a tela nunca sobrescreve o que o usuário mexeu.
  for (const key of PANELS) {
    const p = d.panels[key];
    $(key + "Controller").value = p.controller;
    setPidInputs(key, p.params);
    setRuleInputs(key, p.params.rules);
    setFuzzyInputs(key, p.params);
    showParams(key, p.controller);
  }
  for (const [id, p] of Object.entries(PHYS)) { $(id).value = d.config[p.key]; physLabel(id); }
  $("speedSelect").value = String(d.speed);
  $("autoRise").checked = d.auto_rise;
  $("autoDisturb").checked = d.auto_disturb.enabled;
  $("autoInterval").value = d.auto_disturb.interval;
  $("autoIntervalOut").value = `${num(d.auto_disturb.interval, 1)} s`;
  $("versionTag").textContent = d.version;
  refreshDisturbLabels();
}

function ingest(d) {
  for (const ev of d.events) {
    if (ev.type === "reset") {
      history = []; markers = []; camera.a = camera.b = 0;
      $("eventLog").innerHTML = "";
    } else if (ev.type === "disturb") {
      markers.push({ t: ev.t });
      if (ev.target === "pole") ev.panels.forEach((k) => { kickFlash[k] = performance.now(); });
      logEvent(ev);
    }
  }
  for (const [t, a, b] of d.samples) history.push({ t, a, b });
  const cutoff = d.sim_time - HISTORY_SECONDS;
  while (history.length && history[0].t < cutoff) history.shift();
  while (markers.length && markers[0].t < cutoff) markers.shift();
}

function logEvent(ev) {
  const where = ev.target === "pole" ? "golpe no pêndulo" : "força no carrinho";
  const value = ev.unit === "N" ? `${num(ev.value, 0)} N` : `${num(ev.value, 1)} rad/s`;
  const panels = ev.panels.length === 2 ? "A e B" : ev.panels.join("").toUpperCase();
  const li = document.createElement("div");
  li.textContent = `${num(ev.t)} s · ${ev.source === "auto" ? "auto" : "manual"} · ${where} ${value} · ${panels}`;
  const log = $("eventLog");
  log.prepend(li);
  while (log.children.length > 6) log.lastChild.remove();
}

function updateDashboard(d) {
  $("seedValue").textContent = d.seed;
  $("simTime").textContent = `${num(d.sim_time)} s`;
  const anyTime = d.sim_time > 0;
  $("experimentStatus").textContent = d.running ? "Executando" : anyTime ? "Pausado" : "Pronto";
  refreshPhysicalState();

  for (const key of PANELS) {
    const s = d.panels[key];
    $(key + "Angle").textContent = deg(s.theta);
    $(key + "Position").textContent = `${num(s.x, 3)} m`;
    $(key + "Force").textContent = `${num(s.control_force, 1)} N`;
    const failText = s.fail_reason === "track" ? "SAIU DA PISTA" : "CAIU";
    $(key + "Upright").textContent = s.fallen ? (s.fail_reason === "track" ? "fim da pista" : "caído") : `${num(s.time_upright, 1)} s`;
    const status = $(key + "Status");
    status.textContent = s.fallen ? failText : d.running ? "EM EXECUÇÃO" : anyTime ? "PAUSADO" : "PRONTO";
    status.className = "status" + (s.fallen ? " fallen" : d.running ? " running" : "");
    $(key + "Rise").classList.toggle("attention", s.fallen);
    drawCartpole($(key + "Canvas"), s, key, d.config);
    if (s.controller === "fuzzy") showActivations(key, s.activations);

    $(key + "ResCtrl").textContent = CTRL_NAMES[s.controller];
    $(key + "ResTime").textContent = `${num(s.time, 1)} s`;
    $(key + "ResFalls").textContent = s.falls;
    $(key + "ResTrack").textContent = s.track_hits;
    $(key + "ResRms").textContent = deg(s.rms_theta);
    $(key + "ResMax").textContent = deg(s.max_abs_theta);
    $(key + "ResBench").textContent = s.time > 0 ? `${num(100 * s.time_in_bench / s.time, 1)}%` : "0%";
    $(key + "ResX").textContent = `${num(s.x)} m (${num(s.max_abs_x)})`;
  }
  $("legendA").textContent = `A · ${CTRL_NAMES[d.panels.a.controller]}`;
  $("legendB").textContent = `B · ${CTRL_NAMES[d.panels.b.controller]}`;
  drawAngleChart();
}

// ---------------------------------------------------------------------------
// Desenho do carrinho
// ---------------------------------------------------------------------------
function arrow(ctx, x, y, length, color, width) {
  if (Math.abs(length) < 1) return;
  const dir = Math.sign(length), head = Math.min(10, Math.abs(length));
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length - dir * head, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + length, y); ctx.lineTo(x + length - dir * head, y - head * 0.6);
  ctx.lineTo(x + length - dir * head, y + head * 0.6); ctx.closePath(); ctx.fill();
}

function drawCartpole(canvas, state, key, cfg) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c1420"; ctx.fillRect(0, 0, w, h);
  const ground = h - 70;
  const half = cfg.track_length / 2;
  // Escala única: cabe a pista inteira na largura e o pêndulo na altura.
  const ppm = Math.min(112, (h - 110) / Math.max(0.3, cfg.pole_length), (w - 70) / cfg.track_length);
  const color = COLORS[key];
  const toPx = (xm) => w / 2 + xm * ppm;

  // pista com batentes nas pontas
  const railL = toPx(-half), railR = toPx(half);
  ctx.strokeStyle = "#42566c"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(railL, ground + 24); ctx.lineTo(railR, ground + 24); ctx.stroke();
  const limit = half - cfg.cart_width / 2;
  const near = Math.abs(state.x) / Math.max(0.05, limit);
  for (const s of [-1, 1]) {
    const px = toPx(s * half);
    const hot = Math.sign(state.x) === s && near > 0.75;
    ctx.fillStyle = hot ? "#ff7373" : "#6b7f95";
    ctx.fillRect(px - (s < 0 ? 6 : 0), ground - 16, 6, 44);
  }
  // marcas a cada 0,5 m
  ctx.font = "11px sans-serif"; ctx.textAlign = "center";
  const step = cfg.track_length > 10 ? 1 : 0.5;
  for (let m = -Math.floor(half / step) * step; m <= half + 1e-9; m += step) {
    const px = toPx(m), major = Math.abs(m - Math.round(m)) < 1e-6;
    ctx.strokeStyle = major ? "#42566c" : "#26384b"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, ground + 24); ctx.lineTo(px, ground + (major ? 34 : 29)); ctx.stroke();
    if (major) { ctx.fillStyle = "#5d7086"; ctx.fillText(`${Math.round(m)} m`, px, ground + 48); }
  }
  // origem
  const ox = toPx(0);
  if (ox > 0 && ox < w) {
    ctx.strokeStyle = "#203247"; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(ox, 60); ctx.lineTo(ox, ground + 18); ctx.stroke(); ctx.setLineDash([]);
  }

  const cartX = toPx(state.x), cartY = ground;
  const cartW = cfg.cart_width * ppm, cartH = cfg.cart_height * ppm;
  const poleL = cfg.pole_length * ppm;
  const poleThickness = Math.max(3, cfg.pole_thickness * ppm);
  const pivotX = cartX, pivotY = cartY - cartH / 2;

  // faixa do limite clássico ±12°
  ctx.strokeStyle = "rgba(242,182,93,.22)"; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(pivotX + Math.sin(s * BENCH) * poleL * 1.05, pivotY - Math.cos(s * BENCH) * poleL * 1.05); ctx.stroke();
  }
  ctx.setLineDash([]);

  // haste
  const tipX = pivotX + Math.sin(state.theta) * poleL;
  const tipY = pivotY - Math.cos(state.theta) * poleL;
  ctx.lineCap = "round"; ctx.strokeStyle = state.fallen ? "#7a3b3b" : color; ctx.lineWidth = poleThickness;
  ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.fillStyle = "#dce7f2"; ctx.beginPath(); ctx.arc(tipX, tipY, 7, 0, Math.PI * 2); ctx.fill();

  // golpe no pêndulo
  const flash = (performance.now() - kickFlash[key]) / 400;
  if (flash < 1) {
    ctx.strokeStyle = `rgba(255,115,115,${1 - flash})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(tipX, tipY, 12 + flash * 18, 0, Math.PI * 2); ctx.stroke();
  }

  // carro
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(cartX - cartW / 2, cartY - cartH / 2, cartW, cartH, 6); ctx.fill();
  ctx.fillStyle = "#0b1018"; ctx.beginPath();
  const r = Math.max(4, cartH * 0.28);
  ctx.arc(cartX - cartW * 0.27, cartY + cartH / 2, r, 0, Math.PI * 2);
  ctx.arc(cartX + cartW * 0.27, cartY + cartH / 2, r, 0, Math.PI * 2); ctx.fill();

  // setas de força: controle (cor do painel) e perturbação (vermelho)
  const fmag = Math.max(1, cfg.force_mag);
  arrow(ctx, cartX, cartY + cartH / 2 + r + 12, (state.control_force / fmag) * 45, color, 3);
  if (Math.abs(state.disturbance_force) > 0.01) {
    const len = Math.sign(state.disturbance_force) * Math.min(140, 30 + Math.abs(state.disturbance_force) * 1.5);
    const start = cartX - Math.sign(state.disturbance_force) * (cartW / 2 + 8 + Math.abs(len));
    arrow(ctx, start, cartY, len, "#ff7373", 4);
  }

  ctx.textAlign = "left"; ctx.fillStyle = "#9fb0c3"; ctx.font = "12px sans-serif";
  ctx.fillText(`x = ${num(state.x, 3)} m`, 18, 24);
  ctx.fillText(`θ = ${deg(state.theta)}`, 18, 43);
  ctx.fillStyle = color; ctx.textAlign = "right";
  ctx.fillText(`${key.toUpperCase()} · ${CTRL_NAMES[state.controller].toUpperCase()}`, w - 18, 24);
  if (state.controller === "manual") {
    ctx.fillStyle = "#9fb0c3";
    ctx.fillText(state.manual_input === 0 ? "sem força" : state.manual_input > 0 ? "empurrando ▶" : "◀ empurrando", w - 18, 43);
  }
  if (state.fallen) {
    ctx.fillStyle = "rgba(12,20,32,.7)"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ff7373"; ctx.textAlign = "center"; ctx.font = "bold 22px sans-serif";
    ctx.fillText(state.fail_reason === "track" ? "SAIU DA PISTA" : "CAIU", w / 2, h / 2 - 6);
    ctx.fillStyle = "#9fb0c3"; ctx.font = "13px sans-serif";
    ctx.fillText("Clique em Reerguer ou ligue o reerguer automático", w / 2, h / 2 + 18);
  }
  ctx.textAlign = "left";
}

// ---------------------------------------------------------------------------
// Gráfico do ângulo
// ---------------------------------------------------------------------------
function drawAngleChart() {
  const canvas = $("angleChart"), ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#0c1420"; ctx.fillRect(0, 0, w, h);
  const pad = { l: 92, r: 24, t: 22, b: 42 }, pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const max = chartSettings.zoom, min = -max;
  const win = chartSettings.window;
  const tEnd = Math.max(win, latest ? latest.sim_time : 0), tStart = tEnd - win;
  const xOf = (t) => pad.l + ((t - tStart) / win) * pw;
  const yOf = (v) => pad.t + (max - Math.max(min, Math.min(max, v))) / (max - min) * ph;

  ctx.font = "15px sans-serif"; ctx.fillStyle = "#a7b7c8"; ctx.strokeStyle = "#26384b"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = max - (2 * max * i / 4), y = pad.t + i / 4 * ph;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(num(v), pad.l - 10, y + 5); ctx.textAlign = "left";
  }
  if (BENCH < max) {
    ctx.strokeStyle = "rgba(242,182,93,.45)"; ctx.setLineDash([3, 5]);
    for (const v of [BENCH, -BENCH]) { ctx.beginPath(); ctx.moveTo(pad.l, yOf(v)); ctx.lineTo(w - pad.r, yOf(v)); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const zeroY = yOf(0);
  ctx.strokeStyle = "#8093a8"; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
  ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(w - pad.r, zeroY); ctx.stroke(); ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(255,115,115,.75)"; ctx.lineWidth = 2;
  for (const m of markers) {
    if (m.t < tStart) continue;
    const x = xOf(m.t);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
  }

  const visible = history.filter((p) => p.t >= tStart);
  for (const key of PANELS) {
    if (visible.length < 2) break;
    ctx.strokeStyle = COLORS[key]; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    visible.forEach((p, i) => { const x = xOf(p.t), y = yOf(p[key]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
  }
  ctx.fillStyle = "#a7b7c8"; ctx.font = "14px sans-serif";
  ctx.fillText(`${num(tStart, 1)} s`, pad.l - 8, h - 12);
  ctx.textAlign = "right"; ctx.fillText(`${num(tEnd, 1)} s`, w - pad.r, h - 12);
  ctx.textAlign = "center"; ctx.fillText("tempo", w / 2, h - 12);
  ctx.save(); ctx.translate(18, h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("Ângulo (rad)", 0, 0); ctx.restore();
  ctx.textAlign = "left";
}

PANELS.forEach((k) => showParams(k, $(k + "Controller").value));
Object.keys(PHYS).forEach(physLabel);
refreshDisturbLabels();
connect();
