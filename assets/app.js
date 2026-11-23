import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/*
  CONFIGURAÇÃO: substitua pelos dados do projeto Supabase.
  Não coloque a chave secreta / service_role neste arquivo. Use somente a chave pública (Publishable key).
*/
const SUPABASE_URL = "https://xkuypxublyyrevrmaale.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AK9mLZ12c6fUaltPDtTD2Q_oNfG6sXD";
const CREATE_USER_FUNCTION = "create-user";

const configured =
  Boolean(SUPABASE_URL && SUPABASE_URL.startsWith("https://")) &&
  Boolean(SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.trim().length > 0);

const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentProfile = null;
let selectedSchoolId = "";
let cachedSchools = [], cachedStudents = [], cachedClasses = [], cachedEnrollments = [], cachedProfiles = [];
let attendanceRows = [];

const CURRICULUM_STORAGE_KEY = "ge_matriz_curricular_v1";
const CENSUS_STORAGE_KEY = "ge_mapeamento_censo_v1";

const defaultCurriculum = [
  { id: "curr-1", stage: "Educação Infantil", subject: "O eu, o outro e o nós", area: "Campos de Experiência", annual_hours: 800 },
  { id: "curr-2", stage: "Educação Infantil", subject: "Corpo, gestos e movimentos", area: "Campos de Experiência", annual_hours: 800 },
  { id: "curr-3", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Língua Portuguesa", area: "Linguagens", annual_hours: 240 },
  { id: "curr-4", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Matemática", area: "Matemática", annual_hours: 240 },
  { id: "curr-5", stage: "Ensino Fundamental II (6º ao 9º ano)", subject: "Língua Portuguesa", area: "Linguagens", annual_hours: 200 },
  { id: "curr-6", stage: "Ensino Fundamental II (6º ao 9º ano)", subject: "Matemática", area: "Matemática", annual_hours: 200 },
  { id: "curr-7", stage: "Ensino Fundamental II (6º ao 9º ano)", subject: "Ciências", area: "Ciências da Natureza", annual_hours: 120 },
  { id: "curr-8", stage: "Ensino Fundamental II (6º ao 9º ano)", subject: "História / Geografia", area: "Ciências Humanas", annual_hours: 160 }
];

let cachedCurriculum = loadLocalJson(CURRICULUM_STORAGE_KEY, defaultCurriculum);
let cachedCensus = loadLocalJson(CENSUS_STORAGE_KEY, []);

const $ = (id) => document.getElementById(id);
const today = new Date().toISOString().slice(0,10);
const roleNames = {
  secretaria: "Secretaria de Educação",
  gestor: "Gestor escolar",
  secretario_escolar: "Secretário escolar",
  professor: "Professor"
};

function loadLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("Não foi possível salvar localmente:", e);
  }
}

function isSecretaria() {
  return currentProfile?.role === "secretaria";
}

function getActiveSchool() {
  if (!selectedSchoolId) return null;
  return cachedSchools.find(s => s.id === selectedSchoolId) || null;
}

function notice(message, bad=false) {
  const el = $("notice");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "bad");
  if (bad) el.classList.add("bad");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => el.classList.add("hidden"), 5500);
}
function escapeHtml(v="") {
  return String(v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function updateRoleLabel() {
  if (!currentProfile) return;
  const activeSchool = getActiveSchool();
  if (isSecretaria()) {
    $("user-role").textContent = activeSchool
      ? `Secretaria · ${activeSchool.name}`
      : "Secretaria de Educação · Rede Municipal";
  } else {
    $("user-role").textContent = roleNames[currentProfile.role] || currentProfile.role;
  }
}
function showApp(profile, user) {
  currentProfile = profile;
  selectedSchoolId = "";
  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  $("user-name").textContent = profile.full_name || user.email;
  updateRoleLabel();
  $("avatar").textContent = (profile.full_name || user.email).charAt(0).toUpperCase();
  document.querySelectorAll("[data-roles]").forEach(el => {
    const roles = el.dataset.roles.split(",");
    el.classList.toggle("hidden", !roles.includes(profile.role));
  });
  go("inicio");
  loadAll();
}
function go(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("page-" + page)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  $("page-title").textContent = ({
    inicio: "Painel inicial",
    escolas: "Unidades escolares",
    alunos: "Cadastro de alunos",
    matriculas: "Matrículas",
    turmas: "Turmas",
    diario: "Diário de classe",
    matriz: "Matriz curricular por etapa",
    censo: "Mapeamento do Censo Escolar",
    relatorios: "Relatórios",
    usuarios: "Cadastro de usuários"
  })[page] || "Gestão Escolar";
  if (page === "diario") loadLessons();
  if (page === "usuarios") loadProfiles();
  if (page === "matriz") renderCurriculum();
  if (page === "censo") renderCensus();
}
document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => go(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => go(b.dataset.goto)));

async function requireConfig() {
  if (!configured || !supabase) {
    $("login-error").textContent = "Configure a URL e a chave pública do Supabase em assets/app.js antes de entrar.";
    return false;
  }
  return true;
}
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  $("login-error").textContent = "";
  if (!await requireConfig()) return;
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("email").value,
    password: $("password").value
  });
  if (error) {
    $("login-error").textContent = "Não foi possível entrar. Confira o e-mail e a senha ou fale com o administrador.";
    return;
  }
  await loadProfile(data.user);
});
async function loadProfile(user) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error || !data) {
    $("login-error").textContent = "Usuário autenticado, mas sem perfil institucional. Solicite ao administrador a liberação do acesso.";
    await supabase.auth.signOut();
    return;
  }
  showApp(data, user);
}
$("logout").addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
  location.reload();
});
if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) loadProfile(data.session.user);
  });
}

// --- DIRECIONAMENTO POR NOME DA ESCOLA OU CÓDIGO INEP (SECRETARIA) ---
function formatSchoolOption(school) {
  return school.inep_code ? `${school.name} (INEP: ${school.inep_code})` : school.name;
}

function updateSecretariaSchoolDatalist() {
  const list = $("secretaria-schools-list");
  if (!list) return;
  list.innerHTML = cachedSchools
    .map(s => `<option value="${escapeHtml(formatSchoolOption(s))}"></option>`)
    .join("");
}

function findSchoolByNameOrInep(term) {
  const clean = String(term || "").trim().toLowerCase();
  if (!clean) return null;

  let match = cachedSchools.find(s =>
    formatSchoolOption(s).toLowerCase() === clean ||
    String(s.name || "").trim().toLowerCase() === clean ||
    String(s.inep_code || "").trim().toLowerCase() === clean
  );
  if (match) return match;

  const partials = cachedSchools.filter(s =>
    String(s.name || "").toLowerCase().includes(clean) ||
    String(s.inep_code || "").toLowerCase().includes(clean)
  );
  return partials.length === 1 ? partials[0] : null;
}

function setActiveSchool(school, redirectToPanel = true) {
  selectedSchoolId = school ? school.id : "";
  const searchInput = $("secretaria-school-search");
  if (searchInput) {
    searchInput.value = school ? formatSchoolOption(school) : "";
  }
  updateRoleLabel();
  applySchoolScope();

  if (school) {
    notice(`Direcionado para a unidade: ${school.name}${school.inep_code ? ` (INEP ${school.inep_code})` : ""}.`);
    if (redirectToPanel) go("inicio");
  } else {
    notice("Exibindo dados gerais de toda a rede municipal.");
  }
}

$("secretaria-school-search")?.addEventListener("change", e => {
  const raw = e.target.value.trim();
  if (!raw) {
    setActiveSchool(null, false);
    return;
  }
  const school = findSchoolByNameOrInep(raw);
  if (school) {
    setActiveSchool(school, true);
  } else {
    notice("Nenhuma escola única encontrada com esse nome ou código INEP. Selecione uma opção da lista.", true);
  }
});

$("secretaria-clear-school")?.addEventListener("click", () => {
  setActiveSchool(null, false);
});

function getScopedStudents() {
  if (!selectedSchoolId) return cachedStudents;
  return cachedStudents.filter(s => s.school_id === selectedSchoolId);
}

function getScopedClasses() {
  if (!selectedSchoolId) return cachedClasses;
  return cachedClasses.filter(c => c.school_id === selectedSchoolId);
}

function getScopedEnrollments() {
  if (!selectedSchoolId) return cachedEnrollments;
  const classIds = new Set(getScopedClasses().map(c => c.id));
  const studentIds = new Set(getScopedStudents().map(s => s.id));
  return cachedEnrollments.filter(e => classIds.has(e.class_id) || studentIds.has(e.student_id));
}

function applySchoolScope() {
  const scopedStudents = getScopedStudents();
  const scopedClasses = getScopedClasses();
  const scopedEnrollments = getScopedEnrollments();
  const activeEnrollmentsCount = scopedEnrollments.filter(x => x.status === "ativa").length;

  $("stat-escolas").textContent = selectedSchoolId ? 1 : cachedSchools.length;
  $("stat-alunos").textContent = scopedStudents.length;
  $("stat-turmas").textContent = scopedClasses.length;
  $("stat-matriculas").textContent = activeEnrollmentsCount;

  $("report-students").textContent = scopedStudents.length;
  $("report-classes").textContent = scopedClasses.length;
  $("report-enrollments").textContent = activeEnrollmentsCount;

  renderSchools();
  renderStudents(scopedStudents);
  renderClasses(scopedClasses);
  renderEnrollments(scopedEnrollments);
  fillSelects(scopedStudents, scopedClasses);
  renderUsers();
  renderCensus();
  loadLessons();
}

async function fetchRows(table, select="*") {
  const { data, error } = await supabase.from(table).select(select).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  return data || [];
}
async function loadProfiles() {
  if (!$("users-body")) return;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*, schools(name)")
      .order("full_name", { ascending: true })
      .limit(500);
    if (error) throw error;
    cachedProfiles = data || [];
    renderUsers();
    fillTeacherSelect();
  } catch (e) {
    console.warn("Não foi possível carregar perfis:", e);
    fillSelect("class-teacher", [], x => x.full_name, "Não definido");
    $("users-body").innerHTML = '<tr><td colspan="4">Não foi possível carregar os usuários. Verifique as permissões da tabela profiles.</td></tr>';
  }
}
function fillTeacherSelect() {
  const teachers = cachedProfiles.filter(p =>
    p.role === "professor" && (!selectedSchoolId || !p.school_id || p.school_id === selectedSchoolId)
  );
  fillSelect("class-teacher", teachers, x => x.full_name || "Professor sem nome", "Não definido");
}
async function loadAll() {
  try {
    const [schools, students, classes, enrollments] = await Promise.all([
      fetchRows("schools"),
      fetchRows("students", "*, schools(name)"),
      fetchRows("classes", "*, schools(name)"),
      fetchRows("enrollments", "*, students(full_name), classes(name)")
    ]);
    cachedSchools = schools;
    cachedStudents = students;
    cachedClasses = classes;
    cachedEnrollments = enrollments;
    updateSecretariaSchoolDatalist();
    await loadProfiles();
    applySchoolScope();
  } catch (e) {
    notice("Não foi possível carregar os dados. Verifique as políticas de acesso e a conexão com o banco.", true);
    console.error(e);
  }
}
function fillSelect(id, items, labelFn, placeholder="Selecione") {
  const el = $(id);
  if (!el) return;
  const old = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(x => `<option value="${x.id}">${escapeHtml(labelFn(x))}</option>`).join("");
  if (items.some(x => x.id === old)) el.value = old;
}
function fillSelects(scopedStudents = getScopedStudents(), scopedClasses = getScopedClasses()) {
  fillSelect("student-school", cachedSchools, x => x.name);
  fillSelect("class-school", cachedSchools, x => x.name);
  fillSelect("user-school", cachedSchools, x => x.name, "Rede / Não vinculada");
  fillSelect("census-school", cachedSchools, x => formatSchoolOption(x), "Selecione a escola");
  fillSelect("enrollment-student", scopedStudents, x => x.full_name);
  fillSelect("enrollment-class", scopedClasses, x => `${x.name} — ${x.grade_level}`);
  fillSelect("diary-class", scopedClasses, x => `${x.name} — ${x.grade_level}`);
  fillSelect("attendance-class", scopedClasses, x => `${x.name} — ${x.grade_level}`);
  fillTeacherSelect();

  if (selectedSchoolId) {
    if ($("student-school")) $("student-school").value = selectedSchoolId;
    if ($("class-school")) $("class-school").value = selectedSchoolId;
    if ($("user-school")) $("user-school").value = selectedSchoolId;
    if ($("census-school")) $("census-school").value = selectedSchoolId;
  }
}

// --- ESCOLAS (COM GESTOR E EXCLUSÃO PELA SECRETARIA) ---
function renderSchools() {
  if (!$("schools-body")) return;
  $("schools-body").innerHTML = cachedSchools.map(s => {
    const isSelected = s.id === selectedSchoolId;
    const deleteBtn = isSecretaria()
      ? `<button type="button" class="secondary small" data-delete-school="${escapeHtml(s.id)}" data-school-name="${escapeHtml(s.name)}">Excluir</button>`
      : `<span class="muted small">—</span>`;
    return `<tr data-select-school="${escapeHtml(s.id)}" style="cursor:pointer;${isSelected ? "background:#eef5ff;font-weight:600;" : ""}" title="Clique na linha para direcionar à escola">
      <td>${escapeHtml(s.name)}${isSelected ? " (Selecionada)" : ""}</td>
      <td>${escapeHtml(s.manager_name || "—")}</td>
      <td>${escapeHtml(s.inep_code || "—")}</td>
      <td>${escapeHtml(s.address || "—")}</td>
      <td>${escapeHtml(s.phone || "—")}</td>
      <td>${deleteBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6">Nenhuma escola cadastrada.</td></tr>';
}

$("schools-body")?.addEventListener("click", async e => {
  const delBtn = e.target.closest("[data-delete-school]");
  if (delBtn) {
    e.stopPropagation();
    if (!isSecretaria()) {
      notice("Apenas o perfil Secretaria de Educação pode excluir escolas.", true);
      return;
    }
    const schoolId = delBtn.dataset.deleteSchool;
    const schoolName = delBtn.dataset.schoolName;
    const confirmed = window.confirm(`Deseja realmente excluir a escola "${schoolName}"? Use esta opção apenas para cadastros incorretos sem vínculos ativos.`);
    if (!confirmed) return;

    delBtn.disabled = true;
    try {
      const { error } = await supabase.from("schools").delete().eq("id", schoolId);
      if (error) throw error;
      if (selectedSchoolId === schoolId) {
        selectedSchoolId = "";
        if ($("secretaria-school-search")) $("secretaria-school-search").value = "";
        updateRoleLabel();
      }
      cachedCensus = cachedCensus.filter(c => c.school_id !== schoolId);
      saveLocalJson(CENSUS_STORAGE_KEY, cachedCensus);
      notice("Escola removida com sucesso.");
      await loadAll();
    } catch (err) {
      console.error(err);
      notice("Não foi possível excluir a escola. Verifique se há alunos, turmas ou usuários vinculados a ela.", true);
      delBtn.disabled = false;
    }
    return;
  }

  if (!isSecretaria()) return;
  const row = e.target.closest("[data-select-school]");
  if (!row) return;
  const school = cachedSchools.find(s => s.id === row.dataset.selectSchool);
  if (school) setActiveSchool(school, true);
});

function renderStudents(rows = getScopedStudents()) {
  $("students-body").innerHTML = rows.map(s =>
    `<tr><td>${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.birth_date || "—")}</td><td>${escapeHtml(s.guardian_name || "—")}</td><td>${escapeHtml(s.schools?.name || "—")}</td></tr>`
  ).join("") || '<tr><td colspan="4">Nenhum aluno cadastrado.</td></tr>';
}
function renderClasses(rows = getScopedClasses()) {
  $("classes-body").innerHTML = rows.map(c =>
    `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.grade_level)}</td><td>${escapeHtml(c.shift)}</td><td>${c.school_year}</td><td>${escapeHtml(c.schools?.name || "—")}</td></tr>`
  ).join("") || '<tr><td colspan="5">Nenhuma turma cadastrada.</td></tr>';
}
function renderEnrollments(rows = getScopedEnrollments()) {
  $("enrollments-body").innerHTML = rows.map(e =>
    `<tr><td>${escapeHtml(e.students?.full_name || "—")}</td><td>${escapeHtml(e.classes?.name || "—")}</td><td>${e.school_year}</td><td>${escapeHtml(e.status)}</td></tr>`
  ).join("") || '<tr><td colspan="4">Nenhuma matrícula cadastrada.</td></tr>';
}
function renderUsers() {
  if (!$("users-body")) return;
  const visibleProfiles = selectedSchoolId
    ? cachedProfiles.filter(u => u.school_id === selectedSchoolId || u.role === "secretaria")
    : cachedProfiles;

  $("users-body").innerHTML = visibleProfiles.map(u => {
    const isSelf = u.id === currentProfile?.id;
    const escolaLabel = u.role === "secretaria"
      ? (u.schools?.name || "Rede municipal (acesso geral)")
      : (u.schools?.name || "Rede / Não vinculada");
    const actionBtn = isSelf
      ? `<span class="muted small">Conta atual</span>`
      : `<button type="button" class="secondary small" data-delete-user="${escapeHtml(u.id)}" data-user-name="${escapeHtml(u.full_name || "este usuário")}">Excluir</button>`;
    return `<tr>
      <td>${escapeHtml(u.full_name || "—")}</td>
      <td>${escapeHtml(roleNames[u.role] || u.role || "—")}</td>
      <td>${escapeHtml(escolaLabel)}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="4">Nenhum usuário cadastrado.</td></tr>';
}

// --- MATRIZ CURRICULAR POR ETAPA DE ENSINO ---
function renderCurriculum() {
  if (!$("curriculum-body")) return;
  const filterStage = $("curriculum-filter-stage")?.value || "";
  const items = filterStage
    ? cachedCurriculum.filter(item => item.stage === filterStage)
    : cachedCurriculum;

  const canManage = isSecretaria() || currentProfile?.role === "gestor";
  $("curriculum-body").innerHTML = items.map(item => {
    const delBtn = canManage
      ? `<button type="button" class="secondary small" data-delete-curriculum="${escapeHtml(item.id)}">Remover</button>`
      : `<span class="muted small">—</span>`;
    return `<tr>
      <td>${escapeHtml(item.stage)}</td>
      <td>${escapeHtml(item.subject)}</td>
      <td>${escapeHtml(item.area || "—")}</td>
      <td>${escapeHtml(String(item.annual_hours))}h</td>
      <td>${delBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="5">Nenhum componente curricular cadastrado para esta etapa.</td></tr>';
}

$("curriculum-filter-stage")?.addEventListener("change", renderCurriculum);

$("curriculum-form")?.addEventListener("submit", e => {
  e.preventDefault();
  if (!isSecretaria() && currentProfile?.role !== "gestor") {
    notice("Apenas Secretaria ou Gestor podem alterar a matriz curricular.", true);
    return;
  }
  const data = formObject(e.target);
  const newItem = {
    id: `curr-${Date.now()}`,
    stage: data.stage,
    subject: String(data.subject || "").trim(),
    area: String(data.area || "").trim() || "Formação Geral Básica",
    annual_hours: Number(data.annual_hours) || 0
  };
  cachedCurriculum = [newItem, ...cachedCurriculum];
  saveLocalJson(CURRICULUM_STORAGE_KEY, cachedCurriculum);
  e.target.reset();
  if ($("curriculum-stage-select")) $("curriculum-stage-select").value = newItem.stage;
  renderCurriculum();
  notice("Componente adicionado à matriz curricular.");
});

$("curriculum-body")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-delete-curriculum]");
  if (!btn) return;
  if (!isSecretaria() && currentProfile?.role !== "gestor") {
    notice("Apenas Secretaria ou Gestor podem remover itens da matriz curricular.", true);
    return;
  }
  const id = btn.dataset.deleteCurriculum;
  cachedCurriculum = cachedCurriculum.filter(x => x.id !== id);
  saveLocalJson(CURRICULUM_STORAGE_KEY, cachedCurriculum);
  renderCurriculum();
  notice("Componente removido da matriz curricular.");
});

// --- MAPEAMENTO DO CENSO ESCOLAR ---
function renderCensus() {
  if (!$("census-body")) return;
  const scopedStudents = getScopedStudents();
  const scopedEnrollments = getScopedEnrollments();
  const validStudents = scopedStudents.filter(s => s.full_name && s.birth_date && s.school_id);
  const activeEnrollments = scopedEnrollments.filter(e => e.status === "ativa");

  const visibleCensus = selectedSchoolId
    ? cachedCensus.filter(c => c.school_id === selectedSchoolId)
    : cachedCensus;

  if ($("censo-schools-count")) $("censo-schools-count").textContent = selectedSchoolId ? 1 : cachedSchools.length;
  if ($("censo-students-count")) $("censo-students-count").textContent = validStudents.length;
  if ($("censo-enrollments-count")) $("censo-enrollments-count").textContent = activeEnrollments.length;

  $("census-body").innerHTML = visibleCensus.map(row => {
    const school = cachedSchools.find(s => s.id === row.school_id);
    const delBtn = isSecretaria()
      ? `<button type="button" class="secondary small" data-delete-census="${escapeHtml(row.id)}">Excluir</button>`
      : `<span class="muted small">—</span>`;
    return `<tr>
      <td>${escapeHtml(school?.name || row.school_name || "—")}</td>
      <td>${escapeHtml(school?.inep_code || "Sem INEP")}</td>
      <td>${escapeHtml(String(row.census_year))}</td>
      <td>${escapeHtml(row.operating_status)}</td>
      <td>${escapeHtml(row.offered_stages)}</td>
      <td>${escapeHtml(row.validation_status)}</td>
      <td>${delBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="7">Nenhum mapeamento do Censo Escolar registrado ainda.</td></tr>';
}

$("census-form")?.addEventListener("submit", e => {
  e.preventDefault();
  const data = formObject(e.target);
  const school = cachedSchools.find(s => s.id === data.school_id);
  if (!school) {
    notice("Selecione uma unidade escolar válida para o Censo.", true);
    return;
  }
  const entry = {
    id: `censo-${school.id}-${data.census_year}`,
    school_id: school.id,
    school_name: school.name,
    census_year: Number(data.census_year) || new Date().getFullYear(),
    operating_status: data.operating_status,
    offered_stages: String(data.offered_stages || "").trim(),
    infrastructure_notes: String(data.infrastructure_notes || "").trim(),
    validation_status: data.validation_status
  };

  cachedCensus = [entry, ...cachedCensus.filter(x => x.id !== entry.id)];
  saveLocalJson(CENSUS_STORAGE_KEY, cachedCensus);
  renderCensus();
  notice(`Mapeamento do Censo salvo para ${school.name}.`);
});

$("census-body")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-delete-census]");
  if (!btn) return;
  if (!isSecretaria()) {
    notice("Apenas o perfil Secretaria de Educação pode excluir registros do Censo.", true);
    return;
  }
  const id = btn.dataset.deleteCensus;
  cachedCensus = cachedCensus.filter(x => x.id !== id);
  saveLocalJson(CENSUS_STORAGE_KEY, cachedCensus);
  renderCensus();
  notice("Registro do Censo removido.");
});

async function callUserFunction(payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${CREATE_USER_FUNCTION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_ANON_KEY
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || "Não foi possível concluir a operação.");
  }
  return result;
}

$("users-body")?.addEventListener("click", async e => {
  const btn = e.target.closest("[data-delete-user]");
  if (!btn) return;
  if (!isSecretaria()) {
    notice("Apenas o perfil Secretaria de Educação pode excluir usuários.", true);
    return;
  }

  const userId = btn.dataset.deleteUser;
  const userName = btn.dataset.userName;
  const confirmed = window.confirm(`Tem certeza que deseja excluir o acesso de "${userName}"? Essa ação remove o login e o perfil do sistema.`);
  if (!confirmed) return;

  btn.disabled = true;
  try {
    await callUserFunction({ action: "delete", user_id: userId });
    notice("Usuário removido com sucesso.");
    await loadProfiles();
  } catch (err) {
    console.error(err);
    notice(err.message || "Não foi possível excluir o usuário.", true);
    btn.disabled = false;
  }
});

const userForm = $("user-form");
if (userForm) {
  userForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (!isSecretaria()) {
      notice("Apenas o perfil Secretaria de Educação pode cadastrar novos usuários.", true);
      return;
    }

    const payload = formObject(userForm);
    const body = {
      full_name: payload.full_name?.trim(),
      email: payload.email?.trim().toLowerCase(),
      password: payload.password,
      role: payload.role,
      school_id: payload.school_id || null
    };

    try {
      await callUserFunction(body);
      userForm.reset();
      if (selectedSchoolId && $("user-school")) $("user-school").value = selectedSchoolId;
      notice("Usuário cadastrado com sucesso.");
      await loadProfiles();
    } catch (err) {
      console.error(err);
      notice(err.message || "Erro ao cadastrar usuário. Verifique se a Edge Function create-user está publicada no Supabase.", true);
    }
  });
}

async function insertForm(formId, table, transform=(x)=>x, onSuccess=null) {
  const form = $(formId);
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const obj = transform(formObject(form));
    try {
      const { data, error } = await supabase.from(table).insert(obj).select().single();
      if (error) throw error;
      form.reset();
      document.querySelectorAll('input[name="school_year"]').forEach(x => x.value = new Date().getFullYear());
      if ($('input[name="census_year"]')) $('input[name="census_year"]').value = new Date().getFullYear();
      notice("Registro salvo com sucesso.");
      await loadAll();
      if (onSuccess && data) onSuccess(data);
    } catch (err) {
      console.error(err);
      notice("Não foi possível salvar. Verifique os campos obrigatórios e suas permissões.", true);
    }
  });
}

insertForm("school-form", "schools", x => ({
  name: String(x.name || "").trim(),
  manager_name: String(x.manager_name || "").trim() || null,
  inep_code: String(x.inep_code || "").trim() || null,
  address: String(x.address || "").trim() || null,
  phone: String(x.phone || "").trim() || null
}), (createdSchool) => {
  if (isSecretaria() && createdSchool?.id) {
    setActiveSchool(createdSchool, true);
  }
});

insertForm("student-form", "students", x => ({
  ...x,
  birth_date: x.birth_date || null,
  guardian_name: x.guardian_name || null,
  guardian_phone: x.guardian_phone || null,
  notes: x.notes || null
}));
insertForm("class-form", "classes", x => ({
  ...x,
  school_year: Number(x.school_year),
  teacher_id: x.teacher_id || null
}));
insertForm("enrollment-form", "enrollments", x => ({
  ...x,
  school_year: Number(x.school_year)
}));
insertForm("lesson-form", "lessons", x => ({
  ...x,
  teacher_id: currentProfile?.id
}));

async function loadLessons() {
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("class_id,lesson_date,subject,content,classes(name,school_id)")
      .order("lesson_date", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = (data || []).filter(l => !selectedSchoolId || l.classes?.school_id === selectedSchoolId);
    $("lessons-body").innerHTML = rows.map(l =>
      `<tr><td>${l.lesson_date}</td><td>${escapeHtml(l.classes?.name || "—")}</td><td>${escapeHtml(l.subject)}</td><td>${escapeHtml(l.content)}</td></tr>`
    ).join("") || '<tr><td colspan="4">Nenhuma aula registrada.</td></tr>';
  } catch (e) {
    console.error(e);
  }
}
$("load-attendance").addEventListener("click", async () => {
  const classId = $("attendance-class").value, date = $("attendance-date").value;
  if (!classId || !date) {
    notice("Selecione uma turma e uma data.", true);
    return;
  }
  try {
    const { data, error } = await supabase
      .from("enrollments")
      .select("student_id,students(id,full_name)")
      .eq("class_id", classId)
      .eq("school_year", Number(date.slice(0, 4)))
      .eq("status", "ativa");
    if (error) throw error;
    attendanceRows = (data || []).map(x => ({
      student_id: x.student_id,
      name: x.students.full_name,
      status: "presente"
    }));
    $("attendance-list").innerHTML = attendanceRows.map((x, i) =>
      `<div class="attendance-row"><strong>${escapeHtml(x.name)}</strong><select data-attendance="${i}"><option value="presente">Presente</option><option value="falta">Falta</option><option value="justificada">Falta justificada</option></select></div>`
    ).join("") || "<p class='muted'>Não há alunos ativos nesta turma/ano.</p>";
    $("attendance-list").querySelectorAll("select").forEach(s =>
      s.addEventListener("change", () => attendanceRows[Number(s.dataset.attendance)].status = s.value)
    );
    $("save-attendance").classList.toggle("hidden", attendanceRows.length === 0);
  } catch (e) {
    console.error(e);
    notice("Não foi possível carregar a lista de alunos.", true);
  }
});
$("save-attendance").addEventListener("click", async () => {
  const classId = $("attendance-class").value, date = $("attendance-date").value;
  try {
    const payload = attendanceRows.map(x => ({
      class_id: classId,
      student_id: x.student_id,
      attendance_date: date,
      status: x.status,
      recorded_by: currentProfile.id
    }));
    const { error } = await supabase.from("attendance").upsert(payload, { onConflict: "class_id,student_id,attendance_date" });
    if (error) throw error;
    notice("Frequência salva com sucesso.");
  } catch (e) {
    console.error(e);
    notice("Não foi possível salvar a frequência. Verifique as permissões.", true);
  }
});
$("attendance-date").value = today;
document.querySelectorAll('input[name="school_year"]').forEach(x => x.value = new Date().getFullYear());
if ($('input[name="census_year"]')) $('input[name="census_year"]').value = new Date().getFullYear();
