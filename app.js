const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* COMPLIANCE RULE (documented, BR-05/BR-07): Philippine grading scale, 1.00 = highest.
   COMPLIANT iff gwa <= program.required_gwa AND units >= program.min_units
   AND (failed = 0 OR program.allow_failing_grade) AND incomplete = 0.  Else WITH DEFICIENCY. */
function evaluate(s, p) {
  const r = [];
  if (s.gwa > p.required_gwa) r.push(`GWA ${s.gwa} is worse than required ${p.required_gwa}`);
  if (s.units_enrolled < p.min_units) r.push(`Units ${s.units_enrolled} below minimum ${p.min_units}`);
  if (s.failed_subjects > 0 && !p.allow_failing_grade) r.push("Failing grade not allowed");
  if (s.incomplete_subjects > 0) r.push("Incomplete subject(s) pending");
  return { result: r.length ? "With Deficiency" : "Compliant", remarks: r.join("; ") || "All requirements met" };
}

let me = null, view = "dashboard", programs = [], scholars = [], subs = [];
const $ = (id) => document.getElementById(id);
const cls = (s) => (s || "").replace(/ /g, "-");
const pill = (s) => `<span class="pill ${cls(s)}">${s || "—"}</span>`;
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(t, bad) { const m = $("msg"); m.textContent = t; m.style.background = bad ? "var(--bad)" : "var(--primary)"; m.style.display = "block"; setTimeout(() => (m.style.display = "none"), 3500); }
const isStaff = () => me && ["admin", "staff"].includes(me.role);

async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return showLogin();
  const { data } = await db.from("profiles").select("*").eq("id", session.user.id).single();
  me = { ...session.user, ...(data || { role: "scholar" }) };
  if (!isStaff()) { $("nav").hidden = false; $("nav").innerHTML = `<button onclick="logout()">Logout</button>`;
    $("app").innerHTML = `<div class="card"><h2>Access restricted</h2>This prototype is for Staff/Admin. Ask an administrator to update your role.</div>`; return; }
  await load(); renderNav(); render();
}
function showLogin() {
  $("nav").hidden = true;
  $("app").innerHTML = `<div class="card login"><h2>Login</h2><form onsubmit="login(event)">
  <label>Email<input id="em" type="email" required></label><label>Password<input id="pw" type="password" required></label>
  <button class="btn">Login</button></form></div>`;
}
async function login(e) { e.preventDefault();
  const { error } = await db.auth.signInWithPassword({ email: $("em").value, password: $("pw").value });
  if (error) return toast(error.message, true); init(); }
async function logout() { await db.auth.signOut(); me = null; showLogin(); }

async function load() {
  const [a, b, c] = await Promise.all([
    db.from("scholarship_programs").select("*").order("program_name"),
    db.from("scholars").select("*, scholarship_programs(program_name)").order("full_name"),
    db.from("grade_submissions").select("*, scholars(student_id, full_name, scholarship_id)").order("submitted_at", { ascending: false })]);
  programs = a.data || []; scholars = b.data || []; subs = c.data || [];
}
function renderNav() {
  const items = [["dashboard", "Dashboard"], ["scholars", "Scholars"], ["programs", "Scholarship Programs"], ["subs", "Grade Submissions"], ["compliance", "Compliance"]];
  $("nav").hidden = false;
  $("nav").innerHTML = items.map(([k, l]) => `<button class="${view === k ? "on" : ""}" onclick="go('${k}')">${l}</button>`).join("") + `<button onclick="logout()">Logout</button>`;
}
function go(v) { view = v; renderNav(); render(); }
function render() { ({ dashboard, scholars: scholarsView, programs: programsView, subs: subsView, compliance })[view](); }
const progOpts = (sel) => programs.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id == sel ? "selected" : ""}>${esc(p.program_name)}</option>`).join("");

// ---------- Dashboard ----------
function dashboard() {
  const c = (f) => scholars.filter(f).length, s = (f) => subs.filter(f).length;
  const stats = [["Total Scholars", scholars.length], ["Pending Submissions", s((x) => x.submission_status === "Pending")],
    ["Verified Submissions", s((x) => x.submission_status === "Verified")], ["Compliant Scholars", c((x) => x.status === "Compliant")],
    ["With Deficiency", c((x) => x.status === "With Deficiency")]];
  $("app").innerHTML = `<div class="card"><h2>Dashboard</h2><div class="grid">${stats.map(([l, n]) => `<div class="stat"><b>${n}</b>${l}</div>`).join("")}</div></div>
  <div class="card"><h2>Pending Grade Submissions (FR-10)</h2>${subTable(subs.filter((x) => x.submission_status === "Pending"), true)}</div>`;
}

// ---------- Scholars ----------
let fq = "", fp = "", fs = "";
function scholarsView() {
  const statuses = ["Active", "Pending Submission", "For Verification", "Compliant", "With Deficiency", "Probationary", "For Renewal", "Renewed", "Disqualified"];
  $("app").innerHTML = `<div class="card"><h2>Register / Edit Scholar</h2>
  <form onsubmit="saveScholar(event)"><input type="hidden" id="sid">
  <label>Student ID<input id="stu"></label><label>Full Name<input id="nm" required></label>
  <label>Degree Program<input id="dg"></label><label>Year Level<input id="yl" type="number" min="1" max="6"></label>
  <label>Scholarship Program<select id="sp"><option value="">-- select --</option>${progOpts()}</select></label>
  <label>Status<select id="st">${statuses.map((x) => `<option>${x}</option>`).join("")}</select></label>
  <button class="btn">Save Scholar</button></form></div>
  <div class="card"><h2>Scholars</h2><div class="row"><input id="q" placeholder="Search Student ID or name" value="${esc(fq)}" oninput="fq=this.value;list()">
  <select id="fpp" onchange="fp=this.value;list()"><option value="">All programs</option>${programs.map((p) => `<option value="${p.id}" ${p.id == fp ? "selected" : ""}>${esc(p.program_name)}</option>`).join("")}</select>
  <select onchange="fs=this.value;list()"><option value="">All statuses</option>${statuses.map((x) => `<option ${x === fs ? "selected" : ""}>${x}</option>`).join("")}</select></div>
  <div class="table" id="slist"></div></div>`;
  list();
}
function list() {
  const q = fq.toLowerCase();
  const rows = scholars.filter((s) => (!q || s.student_id.toLowerCase().includes(q) || s.full_name.toLowerCase().includes(q)) && (!fp || s.scholarship_id == fp) && (!fs || s.status === fs));
  $("slist").innerHTML = `<table><tr><th>Student ID</th><th>Name</th><th>Degree</th><th>Yr</th><th>Program</th><th>Status</th><th></th></tr>` +
    (rows.map((s) => `<tr><td>${esc(s.student_id)}</td><td>${esc(s.full_name)}</td><td>${esc(s.degree_program)}</td><td>${s.year_level ?? ""}</td><td>${esc(s.scholarship_programs?.program_name)}</td><td>${pill(s.status)}</td><td><button class="btn sm" onclick="editScholar(${s.id})">Edit</button></td></tr>`).join("") || `<tr><td colspan=7>No matching scholars.</td></tr>`) + `</table>`;
}
function editScholar(id) { const s = scholars.find((x) => x.id === id);
  $("sid").value = s.id; $("stu").value = s.student_id; $("nm").value = s.full_name; $("dg").value = s.degree_program || "";
  $("yl").value = s.year_level || ""; $("sp").value = s.scholarship_id; $("st").value = s.status; scrollTo(0, 0); }
async function saveScholar(e) { e.preventDefault();
  const sid = $("stu").value.trim();
  if (!sid) return toast("Student ID cannot be blank.", true);            // TC-03
  if (!$("sp").value) return toast("Select a scholarship program.", true);
  const row = { student_id: sid, full_name: $("nm").value.trim(), degree_program: $("dg").value, year_level: +$("yl").value || null, scholarship_id: +$("sp").value, status: $("st").value };
  const { error } = $("sid").value ? await db.from("scholars").update(row).eq("id", $("sid").value) : await db.from("scholars").insert(row);
  if (error) return toast(error.code === "23505" ? "Student ID already exists." : error.message, true);
  toast("Scholar saved."); await load(); scholarsView(); }

// ---------- Programs ----------
function programsView() {
  $("app").innerHTML = `<div class="card"><h2>Add Scholarship Program &amp; Requirements</h2>
  <form onsubmit="saveProg(event)"><label>Program Name<input id="pn" required></label>
  <label>Required GWA (max allowed)<input id="rg" type="number" step="0.01" min="1" max="5" required></label>
  <label>Minimum Units<input id="mu" type="number" min="0" required></label>
  <label>Failing grade allowed?<select id="af"><option value="false">No</option><option value="true">Yes</option></select></label>
  <button class="btn">Save Program</button></form>
  <p class="note">Scale: 1.00 = highest, 5.00 = failed. A scholar meets the GWA rule when GWA ≤ Required GWA.</p></div>
  <div class="card"><h2>Programs</h2><div class="table"><table><tr><th>Program</th><th>Required GWA</th><th>Min Units</th><th>Failing Allowed</th><th>Active</th></tr>
  ${programs.map((p) => `<tr><td>${esc(p.program_name)}</td><td>${p.required_gwa}</td><td>${p.min_units}</td><td>${p.allow_failing_grade ? "Yes" : "No"}</td><td>${p.active ? "Yes" : "No"}</td></tr>`).join("")}</table></div></div>`;
}
async function saveProg(e) { e.preventDefault();
  const { error } = await db.from("scholarship_programs").insert({ program_name: $("pn").value.trim(), required_gwa: +$("rg").value, min_units: +$("mu").value, allow_failing_grade: $("af").value === "true" });
  if (error) return toast(error.message, true); toast("Program saved."); await load(); programsView(); }

// ---------- Submissions ----------
function subTable(rows, withVerify) {
  return `<div class="table"><table><tr><th>Student</th><th>AY</th><th>Sem</th><th>GWA</th><th>Units</th><th>Failed</th><th>INC</th><th>Status</th><th>Result</th><th></th></tr>` +
    (rows.map((x) => `<tr><td>${esc(x.scholars?.student_id)} – ${esc(x.scholars?.full_name)}</td><td>${esc(x.academic_year)}</td><td>${esc(x.semester)}</td><td>${x.gwa}</td><td>${x.units_enrolled}</td><td>${x.failed_subjects}</td><td>${x.incomplete_subjects}</td><td>${pill(x.submission_status)}</td><td>${x.evaluation ? pill(x.evaluation) : "—"}</td>
    <td>${withVerify && x.submission_status === "Pending" ? `<button class="btn gold sm" onclick="verify(${x.id})">Verify</button>` : ""}</td></tr>`).join("") || `<tr><td colspan=10>No records.</td></tr>`) + `</table></div>`;
}
function subsView() {
  $("app").innerHTML = `<div class="card"><h2>New Semester Grade Submission</h2>
  <form onsubmit="saveSub(event)"><label>Scholar<select id="sc"><option value="">-- select --</option>${scholars.map((s) => `<option value="${s.id}">${esc(s.student_id)} – ${esc(s.full_name)}</option>`).join("")}</select></label>
  <label>Academic Year<input id="ay" placeholder="2026-2027"></label><label>Semester<select id="sm"><option>1st</option><option>2nd</option><option>Summer</option></select></label>
  <label>GWA<input id="gw" type="number" step="0.01"></label><label>Units Enrolled<input id="un" type="number"></label>
  <label>Failed Subjects<input id="fl" type="number" value="0"></label><label>Incomplete Subjects<input id="ic" type="number" value="0"></label>
  <button class="btn">Submit</button></form></div>
  <div class="card"><h2>All Submissions</h2>${subTable(subs, true)}</div>`;
}
async function saveSub(e) { e.preventDefault();
  const v = { gwa: parseFloat($("gw").value), un: parseInt($("un").value), fl: parseInt($("fl").value), ic: parseInt($("ic").value) };
  if (!$("sc").value) return toast("Select a scholar.", true);
  if (!$("ay").value.trim()) return toast("Academic year is required.", true);
  if (isNaN(v.gwa) || v.gwa < 1 || v.gwa > 5) return toast("GWA must be between 1.00 and 5.00.", true);
  if (isNaN(v.un) || v.un < 0) return toast("Units cannot be negative.", true);
  if (isNaN(v.fl) || v.fl < 0 || isNaN(v.ic) || v.ic < 0) return toast("Failed/incomplete counts cannot be negative.", true);
  const { error } = await db.from("grade_submissions").insert({ scholar_id: +$("sc").value, academic_year: $("ay").value.trim(), semester: $("sm").value, gwa: v.gwa, units_enrolled: v.un, failed_subjects: v.fl, incomplete_subjects: v.ic, submission_status: "Pending" });
  if (error) return toast(error.code === "23505" ? "Submission already exists for that scholar/year/semester." : error.message, true);
  await db.from("scholars").update({ status: "For Verification" }).eq("id", $("sc").value);
  toast("Submission saved as Pending."); await load(); subsView(); }

async function verify(id) {
  if (!isStaff()) return toast("Only authorized staff may verify.", true);
  const x = subs.find((s) => s.id === id);
  if (x.submission_status !== "Pending") return toast("Already verified (BR-09).", true);
  const p = programs.find((p) => p.id === x.scholars.scholarship_id);
  const ev = evaluate(x, p);
  const { error } = await db.from("grade_submissions").update({ submission_status: "Verified", verified_by: me.id, verified_at: new Date().toISOString(), evaluation: ev.result, remarks: ev.remarks }).eq("id", id).eq("submission_status", "Pending");
  if (error) return toast(error.message, true);
  await db.from("scholars").update({ status: ev.result }).eq("id", x.scholar_id);
  toast(`Verified → ${ev.result}`); await load(); render(); }

// ---------- Compliance ----------
function compliance() {
  const rows = subs.filter((x) => x.submission_status === "Verified");
  $("app").innerHTML = `<div class="card"><h2>Compliance Evaluations (verified records only)</h2><div class="table"><table><tr><th>Student</th><th>AY / Sem</th><th>Program</th><th>Result</th><th>Remarks</th></tr>
  ${rows.map((x) => `<tr><td>${esc(x.scholars.student_id)} – ${esc(x.scholars.full_name)}</td><td>${esc(x.academic_year)} / ${esc(x.semester)}</td><td>${esc(programs.find((p) => p.id === x.scholars.scholarship_id)?.program_name)}</td><td>${pill(x.evaluation)}</td><td>${esc(x.remarks)}</td></tr>`).join("") || `<tr><td colspan=5>Nothing verified yet.</td></tr>`}</table></div></div>`;
}
init();
