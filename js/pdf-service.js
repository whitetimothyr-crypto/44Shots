// js/pdf-service.js - 44 Shots PDF generation + HTML report builder
//
// Pulled from index.html (originally lines 5169-5424 pre-refactor;
// post-Step-4 at 3894-3906 + 4023-4160). Top-level classic script -- no
// IIFE wrapper -- so the function declarations and _jsPdfPromise share
// script-scope with the main inline block which still owns the click
// handlers for #exportPdfBtn, #printReportBtn, etc.
//
// LOCKED SPEC -- Scoreboard order: the inline HTML template in
// buildHtmlReport ships the trio Goalie Save %, Score, SOG Us/Them in
// that exact left-to-right order. Carried over byte-for-byte from the
// original (now visible near the .scoreboard div below).
//
// Load order: this file loads BEFORE main inline at index.html line 1000
// (immediately after js/supabase-config.js). Safe because nothing here
// executes at top level -- only declarations. All function bodies that
// reference main-inline globals (state, buildBrief, lastReportText,
// APP_VERSION) fire lazily on user click (Generate Report, Export PDF,
// Print, etc.) by which point every script has loaded.
//
// Exports via script-scope:
//   _jsPdfPromise (module-private latch for the jsPDF lazy load),
//   ensureJsPDF() -- returns Promise<jsPDF constructor>,
//   buildHtmlReport() -- returns the full self-contained HTML string,
//   downloadHtmlReport() -- triggers a Blob download of buildHtmlReport().

let _jsPdfPromise = null;
function ensureJsPDF(){
  if(window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if(_jsPdfPromise) return _jsPdfPromise;
  _jsPdfPromise = new Promise((resolve, reject)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
    s.onload = ()=> (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf.jsPDF) : reject(new Error("jspdf missing"));
    s.onerror = ()=> reject(new Error("jspdf load failed"));
    document.head.appendChild(s);
  });
  return _jsPdfPromise;
}

function buildHtmlReport(){
  const b = buildBrief();
  const reportText = lastReportText || "Tap 'Generate Report' first to include analysis.";
  const photos = state.photos || [];
  const stamp = new Date().toLocaleString();
  const our = b.ourTeam, opp = b.oppTeam;
  const ourShots = our.totals.shotsOnNet, ourGoals = our.totals.goals;
  const oppShots = opp.totals.shotsOnNet, oppGoals = opp.totals.goals;
  const goalieSaves = oppShots - oppGoals;
  const sv = oppShots>0 ? Math.round(goalieSaves*100/oppShots) : 0;
  const svDisplay = "."+String(Math.round(sv*10)).padStart(3,"0").slice(-3);
  const goalieRecs = state._lastGoalieRecs || [];
  const defenseRecs = state._lastDefenseRecs || [];
  const offenseRecs = state._lastOffenseRecs || [];
  const esc = s => String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const renderDrillCard = (rec, i, color) => `
    <div class="drill-card" style="border-left:4px solid ${color}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <strong style="font-size:16px">${i+1}. ${esc(rec.drill)}</strong>
        <span style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--text-muted);background:var(--text);padding:3px 8px;border-radius:10px;font-family:Helvetica,sans-serif">${esc(rec.source)}</span>
      </div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px"><strong>Focus:</strong> ${esc(rec.focus)}</div>
      <div style="font-size:13px;line-height:1.5;margin-bottom:8px">${esc(rec.why)}</div>
      <a href="${esc(rec.url)}" target="_blank" rel="noopener" style="font-size:12px;color:${color};text-decoration:none;font-weight:700;letter-spacing:.04em">${"\u2192"} ${esc(rec.url)}</a>
    </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<title>44 Shots Report - ${esc(b.opponent||'Game')}</title>
<style>
@media print { body{margin:0;padding:15px} .photos img{max-height:300px;object-fit:contain} }
body{font-family:var(--serif);max-width:800px;margin:20px auto;padding:20px;background:var(--text);color:var(--bg)}
h1{font-size:32px;margin:0 0 4px;letter-spacing:.5px}
h1 em{color:var(--accent);}
.kicker{font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--text-muted);margin-bottom:20px}
.meta{background:#fff;padding:14px 18px;border-radius:8px;border:1px solid #e0dcd0;margin-bottom:20px;font-size:14px}
.meta b{display:inline-block;min-width:100px;color:var(--text-muted)}
.scoreboard{background:linear-gradient(135deg,var(--bg),var(--panel-hi));color:var(--text);padding:24px;border-radius:8px;margin:20px 0;display:flex;justify-content:space-around;align-items:center;flex-wrap:wrap;gap:12px}
.scoreboard .stat{text-align:center}
.scoreboard .stat .num{font-size:36px;font-weight:700;color:var(--accent-2);display:block;line-height:1}
.scoreboard .stat .lbl{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--text-muted);margin-top:4px;display:block}
.stat-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}
.stat-row .panel{background:#fff;border:1px solid #e0dcd0;border-radius:8px;padding:14px 16px}
.stat-row .panel h3{margin:0 0 8px;font-size:13px;letter-spacing:.15em;text-transform:uppercase;font-family:Helvetica,sans-serif;color:var(--text-muted)}
.stat-row .panel .big{font-size:24px;font-weight:700;color:var(--bg)}
pre.report{background:var(--bg);color:var(--text);padding:20px;border-radius:8px;white-space:pre-wrap;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.6;overflow-x:auto}
h2{font-size:20px;border-bottom:2px solid var(--accent);padding-bottom:6px;margin-top:30px;letter-spacing:.05em}
h2.def{border-bottom-color:var(--accent)}
h2.off{border-bottom-color:var(--accent-2)}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:14px}
.photos img{width:100%;border-radius:8px;border:1px solid #e0dcd0;display:block}
.drill-card{background:#fff;border:1px solid #e0dcd0;border-radius:8px;padding:14px 18px;margin-bottom:10px}
footer{margin-top:40px;color:var(--text-muted);font-size:11px;text-align:center;letter-spacing:.1em;text-transform:uppercase}
</style></head>

<body>
<div class="kicker">44 Shots ${"\u00b7"} Game Report</div>
<h1>vs <em>${esc(b.opponent||'Unknown opponent')}</em></h1>

<div class="meta">
<div><b>Final:</b> Us ${ourGoals} ${"\u2014"} ${oppGoals} Them${b.score?' (recorded: '+esc(b.score)+')':''}</div>
<div><b>We are:</b> ${b.weAre==='home'?'HOME':'AWAY'}</div>
<div><b>Date:</b> ${stamp}</div>
${b.notes?`<div style="margin-top:8px"><b>Notes:</b> ${esc(b.notes)}</div>`:''}
</div>

<div class="scoreboard">
<div class="stat"><span class="num">${svDisplay}</span><span class="lbl">Goalie Save %</span></div>
<div class="stat"><span class="num">${ourGoals}-${oppGoals}</span><span class="lbl">Score</span></div>
<div class="stat"><span class="num">${ourShots}/${oppShots}</span><span class="lbl">SOG Us/Them</span></div>
</div>

<div class="stat-row">
<div class="panel">
  <h3>Our Offense</h3>
  <div class="big">${ourShots} SOG ${"\u00b7"} ${ourGoals} G</div>
  <div style="font-size:13px;color:var(--text-muted);margin-top:6px">
    Slot ${our.zones.slot} ${"\u00b7"} LW ${our.zones.leftWing} ${"\u00b7"} RW ${our.zones.rightWing}<br>
    Avg dist: ~${our.zones.avgDistFt} ft ${"\u00b7"} Missed: ${our.totals.misses}
  </div>
</div>
<div class="panel">
  <h3>Pressure on Goalie</h3>
  <div class="big">${oppShots} SOG ${"\u00b7"} ${oppGoals} GA</div>
  <div style="font-size:13px;color:var(--text-muted);margin-top:6px">
    Slot ${opp.zones.slot} ${"\u00b7"} LW ${opp.zones.leftWing} ${"\u00b7"} RW ${opp.zones.rightWing}<br>
    Rebounds ${opp.styles.rebounds} ${"\u00b7"} Tips ${opp.styles.tips} ${"\u00b7"} Wraps ${opp.styles.wraps}
  </div>
</div>
</div>

<h2>Game Analysis</h2>
<pre class="report">${esc(reportText)}</pre>

${goalieRecs.length ? `<h2>Goalie Drills</h2>

<div style="display:grid;gap:10px;margin-top:14px">
${goalieRecs.map((rec,i)=>renderDrillCard(rec,i,'var(--accent)')).join('')}
</div>` : ''}

${defenseRecs.length ? `<h2 class="def">Defense Drills</h2>

<div style="display:grid;gap:10px;margin-top:14px">
${defenseRecs.map((rec,i)=>renderDrillCard(rec,i,'var(--accent)')).join('')}
</div>` : ''}

${offenseRecs.length ? `<h2 class="off">Offense Drills</h2>

<div style="display:grid;gap:10px;margin-top:14px">
${offenseRecs.map((rec,i)=>renderDrillCard(rec,i,'#d4a017')).join('')}
</div>` : ''}

<div style="margin-top:14px;padding:10px 14px;background:#fff;border-radius:6px;font-size:12px;color:var(--text-muted)">
<strong>Resources:</strong>
<a href="https://www.usahockey.com/goaltending" target="_blank" rel="noopener" style="color:var(--accent)">USA Hockey Goaltending</a> ${"\u00b7"}
<a href="https://www.usahockey.com/coaches" target="_blank" rel="noopener" style="color:var(--accent)">USA Hockey Coaches</a> ${"\u00b7"}
<a href="https://www.icehockeysystems.com/" target="_blank" rel="noopener" style="color:var(--accent)">IceHockeySystems</a>
</div>

${photos.length ? `<h2>Game Photos (${photos.length})</h2>

<div class="photos">
${photos.map(p=>`<img src="${p.data}" alt="game photo"/>`).join('')}
</div>` : ''}

<footer>Generated by 44 Shots ${APP_VERSION} ${"\u00b7"} ${stamp}</footer>
</body></html>`;
}
function downloadHtmlReport(){
  const html = buildHtmlReport();
  const blob = new Blob([html],{type:"text/html"});
  const a = document.createElement("a");
  const fstamp = new Date().toISOString().slice(0,16).replace(/[-:T]/g,"");
  a.href = URL.createObjectURL(blob);
  a.download = "44shots-report-"+fstamp+".html";
  a.click();
}
