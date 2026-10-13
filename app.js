// TraderJim – Web-App (nur lesen). Daten: privates Repository über GitHub-API mit Lese-Schlüssel.
// Datenformat und Rechenregeln: app/SCHNITTSTELLE.md im privaten Repository.
"use strict";

const REPO = "chris-da-r4ven/TraderJim";
const LOKAL = new URLSearchParams(location.search).has("lokal");   // Testmodus: Dateien relativ vom eigenen Server
const START_LANGFRIST = "2026-10-12";
const FARBEN = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#9333ea"];
const VGL_FARBE = "#6b7280";

// ------------------------------------------------------------------ Hilfen
const $ = s => document.querySelector(s);
const eur = x => (x == null || isNaN(x)) ? "–" : x.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const pct = x => (x == null || isNaN(x)) ? "–" : (x >= 0 ? "+" : "") + (x * 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " %";
const kl = x => x > 0 ? "plus" : x < 0 ? "minus" : "";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tagStr = d => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const zeitStr = d => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const berlinTag = d => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });  // JJJJ-MM-TT

function csv(text) {
  const zeilen = []; let feld = "", zeile = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inQ = false; } else feld += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { zeile.push(feld); feld = ""; }
    else if (c === "\n") { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ""; }
    else if (c !== "\r") feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  const kopf = zeilen.shift() || [];
  return zeilen.filter(z => z.length > 1).map(z => Object.fromEntries(kopf.map((k, i) => [k, z[i]])));
}
const zahl = v => (v === "" || v == null) ? null : Number(v);

// ------------------------------------------------------------------ Daten laden
const SCHLUESSEL = () => localStorage.getItem("tj_schluessel") || "";
async function datei(pfad) {
  if (LOKAL) { const r = await fetch("../../" + pfad, { cache: "no-store" }); if (r.status === 404) return null; if (!r.ok) throw new Error(pfad + ": " + r.status); return r.text(); }
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${pfad}?ref=main`, {
    headers: { Authorization: "Bearer " + SCHLUESSEL(), Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${pfad}: ${r.status}`);
  return r.text();
}

const D = { status: null, strategien: {}, vergleich: [], depots: {}, wp: {} };   // depots[id] = {meta, verlauf:[[ms,wert]], trades:[...]}

async function laden() {
  const st = JSON.parse(await datei("app_daten/status.json"));
  D.status = st;
  D.strategien = JSON.parse(await datei("app_daten/strategien.json") || "{}");
  D.wp = JSON.parse(await datei("app_daten/wertpapiere.json") || "{}");
  const vtext = await datei("app_daten/vergleich.csv");
  D.vergleich = vtext ? csv(vtext) : [];
  const cache = {};
  const lese = async p => (p in cache) ? cache[p] : (cache[p] = (await datei(p)) || "");
  for (const g of st.gruppen) for (const d of g.depots) {
    const v = csv(await lese(d.dateien.verlauf));
    let verlauf;
    if (d.dateien.verlauf_spalte) verlauf = v.map(r => [Date.parse(r.zeit), zahl(r[d.dateien.verlauf_spalte])]);
    else verlauf = v.map(r => [Date.parse(r.datum + "T20:00:00Z"), zahl(r.depotwert_eur)]);
    verlauf = verlauf.filter(x => x[1] != null && !isNaN(x[0]));
    let trades = csv(await lese(d.dateien.trades));
    if (d.dateien.trades_filter) trades = trades.filter(t => t.konto === d.dateien.trades_filter.konto);
    trades = trades.map(t => ({
      zeit: t.zeit ? new Date(t.zeit) : new Date(t.datum + "T13:30:00Z"), typ: t.typ, ticker: t.ticker, name: t.name || t.ticker,
      betrag: zahl(t.betrag_eur), gewinn: zahl(t.gewinn_eur), anteil: zahl(t.anteil) ?? 1, grund: t.grund, kurs: zahl(t.kurs_eur)
    })).sort((a, b) => a.zeit - b.zeit);
    D.depots[d.id] = { meta: d, gruppe: g.id, verlauf, trades };
  }
  localStorage.setItem("tj_letzte_daten", new Date().toISOString());
}

// Kürzel fett, darunter klein: Name · ISIN (app_daten/wertpapiere.json)
function wertHtml(ticker, nameFallback) {
  const w = D.wp[ticker] || {};
  const name = w.name || (nameFallback && nameFallback !== ticker ? nameFallback : "");
  const nr = w.isin ? "ISIN " + w.isin : (w.art === "Kryptowährung" ? "Kryptowährung, keine ISIN" : "");
  const unter = [name, nr].filter(Boolean).join(" · ");
  return `<b>${esc(ticker)}</b>${unter ? `<br><span class="wp">${esc(unter)}</span>` : ""}`;
}

// ------------------------------------------------------------------ Kennzahlen (Regeln: SCHNITTSTELLE.md)
function spreadSatz(meta, ticker) {
  const s = meta.spread_satz || {};
  if (s.alle != null) return s.alle;
  if (s.etf != null) return s.etf;
  return ticker.endsWith("-USD") ? (s.krypto ?? 0.005) : (s.aktie ?? 0.002);
}
function wertBis(dep, ms) {
  let w = null;
  for (const [t, v] of dep.verlauf) { if (t <= ms) w = v; else break; }
  return w;
}
function kennzahlen(dep, von, bis) {
  const start = dep.meta.startkapital;
  const vor = dep.verlauf.filter(x => x[0] < von);
  const anf = vor.length ? vor[vor.length - 1][1] : start;
  const ende = wertBis(dep, bis) ?? anf;
  const tr = dep.trades.filter(t => t.zeit >= von && t.zeit <= bis);
  let gebuehren = 0, spread = 0, realisiert = 0, verk = 0, treffer = 0, gewSumme = 0, verlSumme = 0, verlust = 0;
  for (const t of tr) {
    const s = spreadSatz(dep.meta, t.ticker);
    gebuehren += 1;
    spread += t.typ === "Kauf" ? (t.betrag - 1) * s / (1 + s) : (t.betrag + 1) * s / (1 - s);
    if (t.typ === "Verkauf") {
      const g = t.gewinn ?? 0;
      realisiert += g; verk++;
      if (g > 0) { treffer++; gewSumme += g; } else if (g < 0) { verlust++; verlSumme += g; }
    }
  }
  const tage = new Set(dep.verlauf.filter(x => x[0] >= von && x[0] <= bis).map(x => berlinTag(new Date(x[0])))).size || 1;
  const spanneTage = Math.max(1, (Math.min(bis, Date.now()) - Math.max(von, dep.verlauf[0]?.[0] ?? von)) / 864e5);
  let hoch = -Infinity, rueck = 0;
  for (const [t, v] of dep.verlauf) if (t >= von && t <= bis) { hoch = Math.max(hoch, v); rueck = Math.min(rueck, v / hoch - 1); }
  const pos = dep.meta.positionen_detail || [];
  const unreal = pos.reduce((a, p) => a + ((p.aktueller_wert ?? p.einstand) - p.einstand), 0);
  return {
    anf, ende, gv: ende - anf, gvp: ende / anf - 1, seitStart: ende / start - 1, trades: tr.length,
    proTag: tr.length / tage, proWoche: tr.length / Math.max(1, spanneTage / 7), proMonat: tr.length / Math.max(1, spanneTage / 30.4),
    gebuehren, spread, kosten: gebuehren + spread, kurs: (ende - anf) + gebuehren + spread, realisiert, unreal,
    rueck, treffer: verk ? treffer / verk : null, verkaeufe: verk, gewSumme, verlSumme, nGew: treffer, nVerl: verlust
  };
}
function veraenderungSeit(dep, ms) {
  const vor = dep.verlauf.filter(x => x[0] < ms);
  const basis = vor.length ? vor[vor.length - 1][1] : dep.meta.startkapital;
  return dep.meta.wert / basis - 1;
}
function montag(d) { const x = new Date(d); const w = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - w); return x; }

// ------------------------------------------------------------------ Vergleichswerte
function vergleichReihe(name) {
  return D.vergleich.map(r => [Date.parse(r.datum + "T20:00:00Z"), zahl(r[name])]).filter(x => x[1] != null && !isNaN(x[1]));
}
function vergleichNamen() { return D.vergleich.length ? Object.keys(D.vergleich[0]).filter(k => k !== "datum") : []; }
function vergleichSeitStart(name) {
  const r = vergleichReihe(name);
  const s = Date.parse(START_LANGFRIST + "T00:00:00Z");
  const vor = r.filter(x => x[0] < s);
  const basis = vor.length ? vor[vor.length - 1][1] : r[0]?.[1];
  return r.length ? r[r.length - 1][1] / basis - 1 : null;
}

// ------------------------------------------------------------------ Statuszeile
function statuszeile() {
  const lauf = D.status?.letzte_laeufe?.daytrading || D.status?.erzeugt;
  const t = new Date(D.status?.erzeugt);
  const min = Math.round((Date.now() - t) / 60000);
  const el = $("#status");
  el.textContent = `Daten aktualisiert ${min < 60 ? "vor " + min + " Min." : "am " + zeitStr(t)} · letzter Daytrading-Lauf ${lauf ? zeitStr(new Date(lauf)) : "–"}`;
  el.className = "status" + (min > 120 ? " alt" : "");
}

// ------------------------------------------------------------------ Seiten
function seiteStart() {
  const heute0 = new Date(); heute0.setHours(0, 0, 0, 0);
  const woche0 = montag(new Date());
  let html = "";
  for (const g of D.status.gruppen) {
    html += `<h2>${esc(g.name)} <span class="hinweis">(${esc(g.beschreibung)})</span></h2><div class="kacheln">`;
    for (const m of g.depots) {
      const dep = D.depots[m.id];
      const h = veraenderungSeit(dep, +heute0), w = veraenderungSeit(dep, +woche0), s = m.wert / m.startkapital - 1;
      html += `<a class="karte kachel" href="#/depot/${m.id}">
        <div class="zeile"><span class="name">${esc(m.name)}</span><span class="marke">${esc(m.status)}</span></div>
        <div class="unter">${esc(D.strategien[m.id]?.kurz || "")}</div>
        <div class="wert">${eur(m.wert)}</div>
        <div class="zeile"><span>heute <b class="${kl(h)}">${pct(h)}</b></span><span>Woche <b class="${kl(w)}">${pct(w)}</b></span><span>seit Start <b class="${kl(s)}">${pct(s)}</b></span></div>
      </a>`;
    }
    html += "</div>";
    if (g.id === "langfrist" && D.vergleich.length) {
      html += `<div class="karte"><b>Vergleichswerte</b> <span class="hinweis">seit Start ${new Date(START_LANGFRIST).toLocaleDateString("de-DE")}</span><table>`;
      for (const n of vergleichNamen()) { const v = vergleichSeitStart(n); html += `<tr><td>${esc(n)}</td><td class="z ${kl(v)}">${pct(v)}</td></tr>`; }
      html += "</table></div>";
    }
  }
  $("#app").innerHTML = html;
}

// Zeitraum-Steuerung (gemeinsam für Depot- und Vergleichsseite)
const Z = { modus: "alles", von: null, bis: null, einheit: "pct" };
function zeitraum(daten) {
  const jetzt = Date.now();
  const erstes = Math.min(...daten.map(d => d[0]?.[0] ?? jetzt));
  if (Z.modus === "frei" && Z.von && Z.bis) return [Date.parse(Z.von + "T00:00:00"), Date.parse(Z.bis + "T23:59:59")];
  const t = { tag: 1, woche: 7, monat: 31 }[Z.modus];
  if (t === 1) { const h = new Date(); h.setHours(0, 0, 0, 0); return [+h, jetzt]; }
  return t ? [jetzt - t * 864e5, jetzt] : [erstes, jetzt];
}
function zeitKnoepfe(neuZeichnen, mitEinheit = true) {
  const b = (m, t) => `<button data-m="${m}" class="${Z.modus === m ? "an" : ""}">${t}</button>`;
  return `<div class="knoepfe" id="zk">${b("tag", "Tag")}${b("woche", "Woche")}${b("monat", "Monat")}${b("alles", "Alles")}
    <input type="date" id="von" value="${Z.von || ""}"> – <input type="date" id="bis" value="${Z.bis || ""}">
    ${mitEinheit ? `<button data-e="pct" class="${Z.einheit === "pct" ? "an" : ""}">%</button><button data-e="eur" class="${Z.einheit === "eur" ? "an" : ""}">€</button>` : ""}</div>`;
}
function zeitKnoepfeAktiv(neu) {
  document.querySelectorAll("#zk button[data-m]").forEach(x => x.onclick = () => { Z.modus = x.dataset.m; neu(); });
  document.querySelectorAll("#zk button[data-e]").forEach(x => x.onclick = () => { Z.einheit = x.dataset.e; neu(); });
  const f = () => { Z.von = $("#von").value; Z.bis = $("#bis").value; if (Z.von && Z.bis) { Z.modus = "frei"; neu(); } };
  $("#von").onchange = f; $("#bis").onchange = f;
}

// Chart: reihen = [{name, punkte:[[ms,wert]], farbe, gestrichelt}]
let chart = null;
function zeichne(el, reihen, von, bis, einheit) {
  if (chart) { chart.destroy(); chart = null; }
  reihen = reihen.map(r => ({ ...r, punkte: r.punkte.filter(p => p[0] >= von && p[0] <= bis) })).filter(r => r.punkte.length);
  if (!reihen.length) { el.innerHTML = '<p class="hinweis">Für diesen Zeitraum gibt es noch keine Daten.</p>'; return; }
  const zeiten = [...new Set(reihen.flatMap(r => r.punkte.map(p => p[0])))].sort((a, b) => a - b);
  const daten = [zeiten.map(t => t / 1000)];
  for (const r of reihen) {
    const basis = r.punkte[0][1], m = new Map(r.punkte.map(p => [p[0], p[1]]));
    let letzter = null;
    daten.push(zeiten.map(t => {
      if (m.has(t)) letzter = m.get(t);
      if (letzter == null) return null;
      return einheit === "pct" ? (letzter / basis - 1) * 100 : (r.skalieren ? letzter * r.skalieren : letzter);
    }));
  }
  const breite = el.clientWidth || 340;
  chart = new uPlot({
    width: breite, height: Math.round(Math.min(360, breite * 0.7)),
    scales: { x: { time: true } },
    series: [{ label: "Zeit", value: (u, v) => v == null ? "" : zeitStr(new Date(v * 1000)) },
      ...reihen.map(r => ({ label: r.name, stroke: r.farbe, width: r.gestrichelt ? 1.5 : 2, dash: r.gestrichelt ? [6, 4] : undefined, spanGaps: true,
        value: (u, v) => v == null ? "–" : einheit === "pct" ? v.toFixed(2).replace(".", ",") + " %" : eur(v) }))],
    axes: [{ stroke: getComputedStyle(document.body).color, values: (u, vs) => {
        const spanne = (u.scales.x.max - u.scales.x.min) / 3600;
        return vs.map(v => { const d = new Date(v * 1000);
          return spanne <= 36 ? d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }); }); } }, { stroke: getComputedStyle(document.body).color, size: 64,
      values: (u, vs) => vs.map(v => einheit === "pct" ? v.toFixed(1) + " %" : Math.round(v).toLocaleString("de-DE")) }],
    legend: { live: true }
  }, daten, el);
}

function seiteDepot(id) {
  const dep = D.depots[id];
  if (!dep) { $("#app").innerHTML = "<p>Depot nicht gefunden.</p>"; return; }
  const m = dep.meta;
  const vglNamen = dep.gruppe === "langfrist" ? vergleichNamen() : [];
  const gewaehlt = new Set(JSON.parse(localStorage.getItem("tj_vgl_" + dep.gruppe) || '["Welt-ETF ACWI"]'));
  const neu = () => {
    const [von, bis] = zeitraum([dep.verlauf]);
    const k = kennzahlen(dep, von, bis);
    const kz = (l, w, c = "") => `<div class="kz"><div class="l">${l}</div><div class="w ${c}">${w}</div></div>`;
    const tradeTage = {};
    for (const t of [...dep.trades].reverse()) (tradeTage[berlinTag(t.zeit)] ||= []).push(t);
    $("#app").innerHTML = `
      <h2>${esc(m.name)} <span class="marke">${esc(m.status)}</span></h2>
      <div class="karte"><div class="kennzahlen">
        ${kz("Wert", eur(m.wert))}${kz("Cash", eur(m.cash))}${kz("investiert", eur(m.wert - (m.cash ?? 0)))}
        ${kz("seit Start", pct(m.wert / m.startkapital - 1), kl(m.wert - m.startkapital))}${kz("Startkapital", eur(m.startkapital))}
      </div></div>
      ${zeitKnoepfe(neu)}
      ${vglNamen.length ? `<div class="auswahl">${vglNamen.map(n => `<label><input type="checkbox" data-v="${esc(n)}" ${gewaehlt.has(n) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div>` : ""}
      <div class="karte"><div id="chart" class="chart"></div></div>
      <h3>Kennzahlen im gewählten Zeitraum</h3>
      <div class="karte"><div class="kennzahlen">
        ${kz("Gewinn/Verlust", eur(k.gv), kl(k.gv))}${kz("in Prozent", pct(k.gvp), kl(k.gvp))}
        ${kz("Kursgewinn ohne Kosten", eur(k.kurs), kl(k.kurs))}${kz("Handelskosten", eur(k.kosten))}
        ${kz("davon Gebühren", eur(k.gebuehren))}${kz("davon Spread", eur(k.spread))}
        ${kz("realisiert (Verkäufe)", eur(k.realisiert), kl(k.realisiert))}${kz("nicht realisiert (jetzt)", eur(k.unreal), kl(k.unreal))}
        ${kz(`Summe Verkaufsgewinne (${k.nGew})`, eur(k.gewSumme), "plus")}${kz(`Summe Verkaufsverluste (${k.nVerl})`, eur(k.verlSumme), k.verlSumme < 0 ? "minus" : "")}
        ${kz("Trades", k.trades)}${kz("pro Tag", k.proTag.toFixed(1).replace(".", ","))}
        ${kz("pro Woche", k.proWoche.toFixed(1).replace(".", ","))}${kz("pro Monat", k.proMonat.toFixed(1).replace(".", ","))}
        ${kz("größter Rückgang ⓘ", pct(k.rueck), kl(k.rueck))}${kz("Trefferquote ⓘ", k.treffer == null ? "–" : pct(k.treffer).replace("+", ""))}
      </div><p class="hinweis">ⓘ Größter Rückgang: wie weit der Wert im Zeitraum höchstens unter seinen bisherigen Höchststand gefallen ist. Trefferquote: Anteil der Verkäufe mit Gewinn.</p></div>
      <h3>Gehaltene Werte</h3>
      <div class="karte">${(m.positionen_detail || []).length ? `<table><tr><th>Wert</th><th>seit</th><th class="z">Einstand</th><th class="z">aktuell</th><th class="z">+/−</th></tr>
        ${m.positionen_detail.map(p => { const a = p.aktueller_wert ?? p.einstand, d = a - p.einstand;
          return `<tr><td>${wertHtml(p.wert)}</td><td>${esc(p.kauf_tag || "")}</td><td class="z">${eur(p.einstand)}</td><td class="z">${eur(a)}</td><td class="z ${kl(d)}">${eur(d)}</td></tr>`; }).join("")}</table>`
        : '<p class="hinweis">Zurzeit keine Positionen (alles in Cash).</p>'}</div>
      <h3>Kauf- und Verkaufshistorie</h3>
      <div class="karte">${Object.keys(tradeTage).length ? Object.entries(tradeTage).map(([tag, ts], i) => {
        const g = ts.reduce((a, t) => a + (t.gewinn ?? 0), 0);
        return `<details ${i === 0 ? "open" : ""}><summary>${tagStr(new Date(tag + "T12:00:00"))} · ${ts.length} Trades · Ergebnis Verkäufe <span class="${kl(g)}">${eur(g)}</span></summary>
          <table>${ts.map(t => `<tr><td>${t.zeit.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })}</td>
            <td>${esc(t.typ)}${t.anteil < 1 ? ` (${Math.round(t.anteil * 100)} %)` : ""}: ${wertHtml(t.ticker, t.name)}<br><span class="hinweis">${esc(t.grund)}</span></td>
            <td class="z">${eur(t.betrag)}${t.gewinn != null ? `<br><span class="${kl(t.gewinn)}">${eur(t.gewinn)}</span>` : ""}</td></tr>`).join("")}</table></details>`;
      }).join("") : '<p class="hinweis">Noch keine Trades.</p>'}</div>
      <h3>Kauf → Verkauf (Paare)</h3>
      <div class="karte">${paareHtml(dep)}</div>
      <details class="karte" open><summary>So funktioniert diese Strategie</summary><p>${esc(D.strategien[id]?.text || "")}</p></details>`;
    zeitKnoepfeAktiv(neu);
    document.querySelectorAll("input[data-v]").forEach(x => x.onchange = () => {
      x.checked ? gewaehlt.add(x.dataset.v) : gewaehlt.delete(x.dataset.v);
      localStorage.setItem("tj_vgl_" + dep.gruppe, JSON.stringify([...gewaehlt])); neu();
    });
    const reihen = [{ name: m.name, punkte: dep.verlauf, farbe: FARBEN[0] }];
    let i = 1;
    for (const n of gewaehlt) if (vglNamen.includes(n)) {
      const r = vergleichReihe(n), basis = wertBis(dep, r[0]?.[0]) ?? m.startkapital;
      reihen.push({ name: n, punkte: r.map(p => [p[0], p[1] / r[0][1] * basis]), farbe: FARBEN[i++ % FARBEN.length], gestrichelt: true });
    }
    if (dep.gruppe === "daytrading" && id !== "VGL") reihen.push({ name: "Vergleich: einfach halten", punkte: D.depots.VGL.verlauf, farbe: VGL_FARBE, gestrichelt: true });
    zeichne($("#chart"), reihen, von, bis, Z.einheit);
  };
  neu();
}

function paareHtml(dep) {
  const offen = {}, paare = [];
  for (const t of dep.trades) {
    if (t.typ === "Kauf") (offen[t.ticker] ||= []).push({ ...t, rest: 1 });
    else {
      const l = (offen[t.ticker] || [])[0];
      paare.push({ ticker: t.ticker, name: t.name, kauf: l?.zeit, verkauf: t.zeit, anteil: t.anteil, gewinn: t.gewinn, grund: t.grund });
      if (l) { l.rest -= t.anteil >= 0.999 ? l.rest : t.anteil * l.rest; if (l.rest <= 0.001) offen[t.ticker].shift(); }
    }
  }
  for (const [tk, ls] of Object.entries(offen)) for (const l of ls) paare.push({ ticker: tk, name: l.name, kauf: l.zeit, verkauf: null, anteil: l.rest });
  if (!paare.length) return '<p class="hinweis">Noch keine Trades.</p>';
  paare.sort((a, b) => (b.verkauf || Infinity) - (a.verkauf || Infinity) || b.kauf - a.kauf);
  const dauer = (a, b) => { const h = ((b || Date.now()) - a) / 36e5; return h < 24 ? Math.round(h) + " Std." : (h / 24).toFixed(1).replace(".", ",") + " Tage"; };
  return `<details><summary>${paare.length} Positionen anzeigen</summary><table><tr><th>Wert</th><th>gekauft</th><th>verkauft</th><th class="z">Dauer</th><th class="z">Ergebnis</th></tr>
    ${paare.slice(0, 300).map(p => `<tr><td>${wertHtml(p.ticker, p.name)}${p.anteil < 0.999 ? ` (${Math.round(p.anteil * 100)} %)` : ""}</td><td>${p.kauf ? zeitStr(p.kauf) : "–"}</td>
      <td>${p.verkauf ? zeitStr(p.verkauf) : "<i>offen</i>"}</td><td class="z">${p.kauf ? dauer(p.kauf, p.verkauf) : ""}</td>
      <td class="z ${kl(p.gewinn)}">${p.gewinn != null ? eur(p.gewinn) : ""}</td></tr>`).join("")}</table></details>`;
}

function seiteVergleich() {
  const alle = Object.values(D.depots);
  const gewaehlt = new Set(JSON.parse(localStorage.getItem("tj_vergleich") || '["V1","G1","S2","VGL"]'));
  const vgl = new Set(JSON.parse(localStorage.getItem("tj_vergleich_bm") || '["Welt-ETF ACWI"]'));
  const neu = () => {
    const sel = alle.filter(d => gewaehlt.has(d.meta.id));
    const [von, bis] = zeitraum(sel.map(d => d.verlauf).concat([[[Date.now()]]]));
    $("#app").innerHTML = `<h2>Vergleich</h2>
      <div class="karte"><b>Depots</b><div class="auswahl">${alle.map(d => `<label><input type="checkbox" data-d="${d.meta.id}" ${gewaehlt.has(d.meta.id) ? "checked" : ""}> ${esc(d.meta.name)}</label>`).join("")}</div>
      ${vergleichNamen().length ? `<b>Vergleichswerte</b><div class="auswahl">${vergleichNamen().map(n => `<label><input type="checkbox" data-b="${esc(n)}" ${vgl.has(n) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div>` : ""}</div>
      ${zeitKnoepfe(neu)}
      <div class="karte"><div id="chart" class="chart"></div></div>
      <p class="hinweis">In % startet jede Linie bei 0 am Anfang des Zeitraums. In € werden Vergleichswerte auf 50.000 € (Langfrist-Start) umgerechnet. Daytrading-Konten starten mit 5.000 €, Langfrist-Depots mit 50.000 €: In € ist der Vergleich deshalb nur bedingt aussagekräftig.</p>
      <div class="karte"><table><tr><th>im Zeitraum</th><th class="z">€</th><th class="z">%</th></tr>
        ${sel.map(d => { const k = kennzahlen(d, von, bis); return `<tr><td>${esc(d.meta.name)}</td><td class="z ${kl(k.gv)}">${eur(k.gv)}</td><td class="z ${kl(k.gvp)}">${pct(k.gvp)}</td></tr>`; }).join("")}</table></div>`;
    zeitKnoepfeAktiv(neu);
    document.querySelectorAll("input[data-d]").forEach(x => x.onchange = () => { x.checked ? gewaehlt.add(x.dataset.d) : gewaehlt.delete(x.dataset.d); localStorage.setItem("tj_vergleich", JSON.stringify([...gewaehlt])); neu(); });
    document.querySelectorAll("input[data-b]").forEach(x => x.onchange = () => { x.checked ? vgl.add(x.dataset.b) : vgl.delete(x.dataset.b); localStorage.setItem("tj_vergleich_bm", JSON.stringify([...vgl])); neu(); });
    let i = 0;
    const reihen = sel.map(d => ({ name: d.meta.name, punkte: d.verlauf, farbe: FARBEN[i++ % FARBEN.length] }));
    for (const n of vgl) { const r = vergleichReihe(n); reihen.push({ name: n, punkte: r.map(p => [p[0], p[1] / r[0][1] * 50000]), farbe: FARBEN[i++ % FARBEN.length], gestrichelt: true }); }
    zeichne($("#chart"), reihen, von, bis, Z.einheit);
  };
  neu();
}

// ------------------------------------------------------------------ Wochenberichte (app_daten/wochenberichte/, Markdown)
function mdInline(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])_(.+?)_(?=[\s).,:;!?]|$)/g, "$1<i>$2</i>").replace(/`(.+?)`/g, "<code>$1</code>");
}
function markdown(text) {
  const zeilen = text.split("\n"); let html = "", i = 0;
  const zellen = z => z.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  while (i < zeilen.length) {
    const z = zeilen[i];
    if (/^\s*\|/.test(z)) {                                   // Tabelle
      const kopf = zellen(z); i++;
      if (i < zeilen.length && /^\s*\|[\s:|-]+\|\s*$/.test(zeilen[i])) i++;
      const zahlSp = kopf.map((_, k) => k > 0);
      let t = `<div class="karte tabelle"><table><tr>${kopf.map((c, k) => `<th class="${zahlSp[k] ? "z" : ""}">${mdInline(c)}</th>`).join("")}</tr>`;
      while (i < zeilen.length && /^\s*\|/.test(zeilen[i])) {
        t += `<tr>${zellen(zeilen[i]).map((c, k) => `<td class="${k > 0 ? "z" : ""} ${/^[+-]\d/.test(c) || /^-\d/.test(c) ? (c.startsWith("-") ? "minus" : "plus") : ""}">${mdInline(c)}</td>`).join("")}</tr>`; i++;
      }
      html += t + "</table></div>"; continue;
    }
    if (/^- /.test(z)) {                                       // Liste
      let l = "<ul>"; while (i < zeilen.length && /^- /.test(zeilen[i])) { l += `<li>${mdInline(zeilen[i].slice(2))}</li>`; i++; }
      html += l + "</ul>"; continue;
    }
    if (/^### /.test(z)) html += `<h3>${mdInline(z.slice(4))}</h3>`;
    else if (/^## /.test(z)) html += `<h3>${mdInline(z.slice(3))}</h3>`;
    else if (/^# /.test(z)) html += `<h2>${mdInline(z.slice(2))}</h2>`;
    else if (/^---\s*$/.test(z)) html += "<hr>";
    else if (z.trim()) html += `<p>${mdInline(z)}</p>`;
    i++;
  }
  return html;
}
async function seiteBerichte() {
  $("#app").innerHTML = `<h2>Wochenberichte</h2><p class="hinweis">Lädt …</p>`;
  const idx = JSON.parse((await datei("app_daten/wochenberichte/index.json")) || "[]");
  $("#app").innerHTML = `<h2>Wochenberichte</h2>` + (idx.length
    ? `<div class="karte">${idx.map(e => `<div class="zeile" style="padding:8px 0;border-bottom:1px solid var(--linie)"><a href="#/bericht/${encodeURIComponent(e.datei)}">${esc(e.titel)}</a></div>`).join("")}</div>`
    : `<div class="karte"><p>Noch kein Bericht vorhanden.</p><p class="hinweis">Der erste erscheint am Freitagabend (ca. 0:30 Uhr), zusammen mit der E-Mail.</p></div>`);
}
async function seiteBericht(name) {
  if (!/^[\w.-]+\.md$/.test(name)) return seiteBerichte();
  $("#app").innerHTML = `<p class="hinweis">Lädt …</p>`;
  const t = await datei("app_daten/wochenberichte/" + name);
  $("#app").innerHTML = `<p><a href="#/berichte">← alle Berichte</a></p>` + (t ? `<div class="bericht">${markdown(t)}</div>` : `<div class="karte">Bericht nicht gefunden.</div>`);
}

function seiteEinstellungen(meldung = "") {
  $("#app").innerHTML = `<h2>Einstellungen</h2><div class="karte">
    <p><b>Lese-Schlüssel für GitHub</b><br><span class="hinweis">Wird nur auf diesem Gerät gespeichert. Er darf nur das Repository TraderJim lesen (Contents: Read-only). Bei Verlust des Geräts auf github.com unter Settings → Developer settings → Personal access tokens widerrufen.</span></p>
    <input type="password" id="sch" placeholder="github_pat_…" value="${SCHLUESSEL() ? "••••••••" : ""}">
    <div class="knoepfe"><button id="speichern">Speichern und laden</button><button id="loeschen">Schlüssel löschen</button></div>
    <p class="hinweis">${esc(meldung)}</p></div>
    <div class="karte"><p class="hinweis">Datenstand dieser App: ${esc(localStorage.getItem("tj_letzte_daten") || "–")}<br>Modus: ${LOKAL ? "lokal (Test)" : "GitHub"}</p></div>`;
  $("#speichern").onclick = async () => {
    const v = $("#sch").value.trim();
    if (v && !v.startsWith("•")) localStorage.setItem("tj_schluessel", v);
    try { await laden(); location.hash = "#/"; route(); } catch (e) { seiteEinstellungen("Laden fehlgeschlagen: " + e.message); }
  };
  $("#loeschen").onclick = () => { localStorage.removeItem("tj_schluessel"); seiteEinstellungen("Schlüssel gelöscht."); };
}

// ------------------------------------------------------------------ Steuerung
function route() {
  const h = location.hash || "#/";
  if (h.startsWith("#/einstellungen")) return seiteEinstellungen();
  if (!D.status) return;
  statuszeile();
  if (h.startsWith("#/depot/")) return seiteDepot(decodeURIComponent(h.slice(8)));
  if (h.startsWith("#/vergleich")) return seiteVergleich();
  if (h.startsWith("#/berichte")) return seiteBerichte();
  if (h.startsWith("#/bericht/")) return seiteBericht(decodeURIComponent(h.slice(10)));
  return seiteStart();
}

async function start() {
  if ("serviceWorker" in navigator && !LOKAL) navigator.serviceWorker.register("sw.js").catch(() => {});
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", () => { clearTimeout(window._rz); window._rz = setTimeout(route, 250); });
  if (!LOKAL && !SCHLUESSEL()) { location.hash = "#/einstellungen"; return seiteEinstellungen("Bitte zuerst den Lese-Schlüssel eintragen."); }
  try { await laden(); route(); }
  catch (e) { $("#app").innerHTML = `<div class="karte"><p>Daten konnten nicht geladen werden: ${esc(e.message)}</p><p class="hinweis">Prüfe den Lese-Schlüssel unter ⚙ Einstellungen.</p></div>`; }
  setInterval(async () => { if (document.visibilityState === "visible") { try { await laden(); route(); } catch (e) {} } }, 5 * 60 * 1000);
}
start();
