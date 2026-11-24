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

const CURRICULUM_STORAGE_KEY = "ge_matriz_curricular_v2";
const MONITORS_STORAGE_KEY = "ge_monitores_complementares_v1";
const CENSUS_STORAGE_KEY = "ge_mapeamento_censo_v1";

const defaultCurriculum = [
  { id: "curr-1", stage: "Educação Infantil", subject: "O eu, o outro e o nós", area: "Campos de Experiência", requirement_type: "obrigatoria", annual_hours: 800 },
  { id: "curr-2", stage: "Educação Infantil", subject: "Corpo, gestos e movimentos", area: "Campos de Experiência", requirement_type: "obrigatoria", annual_hours: 800 },
  { id: "curr-3", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Língua Portuguesa", area: "Linguagens", requirement_type: "obrigatoria", annual_hours: 240 },
  { id: "curr-4", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Matemática", area: "Matemática", requirement_type: "obrigatoria", annual_hours: 240 },
  { id: "curr-5", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Oficina de Leitura e Contação de Histórias", area: "Atividades Complementares", requirement_type: "complementar_nao_obrigatoria", annual_hours: 80 },
  { id: "curr-6", stage: "Ensino Fundamental II (6º ao 9º ano)", subject: "Robótica Educacional e Iniciação Científica", area: "Cultura Digital / Ciências", requirement_type: "complementar_nao_obrigatoria", annual_hours: 80 }
];

let cachedCurriculum = loadLocalJson(CURRICULUM_STORAGE_KEY, defaultCurriculum);
let cachedMonitors = loadLocalJson(MONITORS_STORAGE_KEY, []);
let cachedCensus = loadLocalJson(CENSUS_STORAGE_KEY, []);

const $ = (id) => document.getElementById(id);
const today = new Date().toISOString().slice(0, 10);
const roleNames = {
  secretaria: "Secretaria de Educação",
  gestor: "Gestor escolar",
  secretario_escolar: "Secretário escolar",
  professor: "Professor",
  monitor_complementar: "Monitor de atividade complementar"
};

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

function validateAndNormalizeCpf(value, label = "CPF") {
  const digits = normalizeCpf(value);
  if (!digits) return { valid: true, cpf: null };
  if (digits.length !== 11) {
    return { valid: false, error: `${label} inválido: informe os 11 dígitos numéricos.` };
  }
  return { valid: true, cpf: digits };
}

function formatCpf(value) {
  const digits = normalizeCpf(value);
  if (digits.length !== 11) return value || "—";
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

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

function canManageCurriculumAndMonitors() {
  return isSecretaria() || currentProfile?.role === "gestor";
}

function canManageClassesAndEnrollments() {
  return ["secretaria", "gestor", "secretario_escolar"].includes(currentProfile?.role);
}

function getEffectiveSchoolId() {
  if (isSecretaria()) return selectedSchoolId || "";
  return currentProfile?.school_id || "";
}

function getActiveSchool() {
  const effectiveId = getEffectiveSchoolId();
  if (!effectiveId) return null;
  return cachedSchools.find(s => s.id === effectiveId) || null;
}

function notice(message, bad = false) {
  const el = $("notice");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "bad");
  if (bad) el.classList.add("bad");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => el.classList.add("hidden"), 5500);
}

function escapeHtml(v = "") {
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
    const baseRole = roleNames[currentProfile.role] || currentProfile.role;
    $("user-role").textContent = activeSchool ? `${baseRole} · ${activeSchool.name}` : baseRole;
  }
}

function showApp(profile, user) {
  currentProfile = profile;

  if (isSecretaria()) {
    selectedSchoolId = "";
  } else {
    selectedSchoolId = profile.school_id || "";
  }

  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  $("user-name").textContent = profile.full_name || user.email;
  updateRoleLabel();
  $("avatar").textContent = (profile.full_name || user.email).charAt(0).toUpperCase();
  document.querySelectorAll("[data-roles]").forEach(el => {
    const roles = el.dataset.roles.split(",");
    el.classList.toggle("hidden", !roles.includes(profile.role));
  });

  if (!isSecretaria() && !profile.school_id) {
    notice("Seu perfil ainda não possui uma escola vinculada na tabela de perfis. Solicite à Secretaria de Educação o vínculo da unidade.", true);
  }

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
    matriz: "Matriz curricular e atividades complementares",
    censo: "Mapeamento do Censo Escolar",
    relatorios: "Relatórios",
    usuarios: "Cadastro de usuários"
  })[page] || "Gestão Escolar";
  if (page === "diario") loadLessons();
  if (page === "usuarios") loadProfiles();
  if (page === "matriz") {
    fillMonitorSubjectSelect();
    renderCurriculum();
    renderMonitors();
  }
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

$("login-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  $("login-error").textContent = "";
  if (!await requireConfig()) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error || !data?.user) {
      $("login-error").textContent = "Não foi possível entrar. Confira o e-mail e a senha ou fale com o administrador.";
      return;
    }
    await loadProfile(data.user);
  } catch (err) {
    console.error("Erro no login:", err);
    $("login-error").textContent = "Erro ao conectar com o servidor de autenticação. Tente novamente.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

async function loadProfile(user) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Erro ao consultar profiles:", error);
      $("login-error").textContent = `Não foi possível ler seu perfil no banco (${error.message || "verifique as políticas RLS de profiles"}).`;
      return;
    }

    if (!data) {
      $("login-error").textContent = "Usuário autenticado, mas sem perfil institucional na tabela profiles. Solicite ao administrador a liberação do acesso.";
      return;
    }

    showApp(data, user);
  } catch (err) {
    console.error("Falha inesperada em loadProfile:", err);
    $("login-error").textContent = "Erro inesperado ao carregar o perfil institucional.";
  }
}

$("logout")?.addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
  location.reload();
});

if (supabase) {
  supabase.auth.getSession().then(async ({ data, error }) => {
    if (error) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return;
    }
    if (data?.session?.user) {
      await loadProfile(data.session.user);
    }
  }).catch(async () => {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
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
  if (!isSecretaria()) return;
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
  if (!isSecretaria()) return;
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
  if (!isSecretaria()) return;
  setActiveSchool(null, false);
});

function getScopedSchools() {
  if (isSecretaria()) {
    return selectedSchoolId
      ? cachedSchools.filter(s => s.id === selectedSchoolId)
      : cachedSchools;
  }
  const schoolId = getEffectiveSchoolId();
  if (!schoolId) return [];
  return cachedSchools.filter(s => s.id === schoolId);
}

function getScopedStudents() {
  if (isSecretaria()) {
    return selectedSchoolId
      ? cachedStudents.filter(s => s.school_id === selectedSchoolId)
      : cachedStudents;
  }
  const schoolId = getEffectiveSchoolId();
  if (!schoolId) return [];
  return cachedStudents.filter(s => s.school_id === schoolId);
}

function getScopedClasses() {
  if (isSecretaria()) {
    return selectedSchoolId
      ? cachedClasses.filter(c => c.school_id === selectedSchoolId)
      : cachedClasses;
  }
  const schoolId = getEffectiveSchoolId();
  if (!schoolId) return [];
  return cachedClasses.filter(c => c.school_id === schoolId);
}

function getScopedEnrollments() {
  const scopedStudents = getScopedStudents();
  const scopedClasses = getScopedClasses();

  if (isSecretaria() && !selectedSchoolId) {
    return cachedEnrollments;
  }

  const classIds = new Set(scopedClasses.map(c => c.id));
  const studentIds = new Set(scopedStudents.map(s => s.id));
  return cachedEnrollments.filter(e =>
    (e.class_id && classIds.has(e.class_id)) ||
    (e.student_id && studentIds.has(e.student_id))
  );
}

function getScopedTeachers(schoolIdFilter = "") {
  const targetSchoolId = schoolIdFilter || getEffectiveSchoolId();
  return cachedProfiles.filter(p =>
    p.role === "professor" && (!targetSchoolId || !p.school_id || p.school_id === targetSchoolId)
  );
}

function applySchoolScope() {
  updateRoleLabel();
  const scopedSchools = getScopedSchools();
  const scopedStudents = getScopedStudents();
  const scopedClasses = getScopedClasses();
  const scopedEnrollments = getScopedEnrollments();

  const activeStudentIds = new Set(
    scopedEnrollments
      .filter(e => e.status === "ativa" && e.student_id)
      .map(e => e.student_id)
  );
  const activeStudentsCount = activeStudentIds.size;

  if ($("stat-escolas")) $("stat-escolas").textContent = scopedSchools.length;
  if ($("stat-alunos")) $("stat-alunos").textContent = scopedStudents.length;
  if ($("stat-turmas")) $("stat-turmas").textContent = scopedClasses.length;
  if ($("stat-matriculas")) $("stat-matriculas").textContent = activeStudentsCount;

  if ($("report-students")) $("report-students").textContent = scopedStudents.length;
  if ($("report-classes")) $("report-classes").textContent = scopedClasses.length;
  if ($("report-enrollments")) $("report-enrollments").textContent = activeStudentsCount;

  renderSchools(scopedSchools);
  renderStudents(scopedStudents);
  renderClasses(scopedClasses);
  renderEnrollments(scopedEnrollments);
  fillSelects(scopedStudents, scopedClasses);
  renderUsers();
  renderMonitors();
  renderCensus();
  loadLessons();
}

async function fetchRows(table, select = "*") {
  const orderCol = table === "schools" ? "name" : "created_at";
  const ascending = table === "schools";
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .order(orderCol, { ascending })
    .limit(500);
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
    renderClasses(getScopedClasses());
  } catch (e) {
    console.warn("Não foi possível carregar perfis:", e);
    fillSelect("class-teacher", [], x => x.full_name, "Não definido");
    $("users-body").innerHTML = '<tr><td colspan="5">Não foi possível carregar os usuários. Verifique as permissões da tabela profiles.</td></tr>';
  }
}

function fillTeacherSelect() {
  const formSchoolId = isSecretaria() ? ($("class-school")?.value || selectedSchoolId) : getEffectiveSchoolId();
  const teachers = getScopedTeachers(formSchoolId);
  fillSelect("class-teacher", teachers, x => x.full_name || "Professor sem nome", "Não definido");
}

$("class-school")?.addEventListener("change", () => {
  fillTeacherSelect();
});

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

function fillSelect(id, items, labelFn, placeholder = "Selecione") {
  const el = $(id);
  if (!el) return;
  const old = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(x => `<option value="${escapeHtml(x.id)}">${escapeHtml(labelFn(x))}</option>`).join("");
  if (items.some(x => x.id === old)) el.value = old;
}

function formatClassLabel(c) {
  const comp = c.class_complement ? ` (${c.class_complement})` : "";
  return `${c.name}${comp} — ${c.grade_level}`;
}

function fillSelects(scopedStudents = getScopedStudents(), scopedClasses = getScopedClasses()) {
  const effectiveId = getEffectiveSchoolId();
  const availableSchools = isSecretaria()
    ? cachedSchools
    : cachedSchools.filter(s => s.id === effectiveId);

  fillSelect("student-school", availableSchools, x => x.name);
  fillSelect("class-school", availableSchools, x => x.name);
  fillSelect("user-school", cachedSchools, x => x.name, "Rede / Não vinculada");
  fillSelect("monitor-school", availableSchools, x => x.name, isSecretaria() ? "Rede / Todas as escolas" : "Selecione a escola");
  fillSelect("census-school", availableSchools, x => formatSchoolOption(x), "Selecione a escola");
  fillSelect("enrollment-student", scopedStudents, x => x.full_name);
  fillSelect("enrollment-class", scopedClasses, x => formatClassLabel(x));
  fillSelect("diary-class", scopedClasses, x => formatClassLabel(x));
  fillSelect("attendance-class", scopedClasses, x => formatClassLabel(x));
  fillTeacherSelect();
  fillMonitorSubjectSelect();

  if (effectiveId) {
    if ($("student-school")) $("student-school").value = effectiveId;
    if ($("class-school")) $("class-school").value = effectiveId;
    if ($("user-school")) $("user-school").value = effectiveId;
    if ($("monitor-school")) $("monitor-school").value = effectiveId;
    if ($("census-school")) $("census-school").value = effectiveId;
  }
}

// --- ESCOLAS (COM GESTOR E EXCLUSÃO PELA SECRETARIA) ---
function renderSchools(visibleSchools = getScopedSchools()) {
  if (!$("schools-body")) return;

  $("schools-body").innerHTML = visibleSchools.map(s => {
    const isSelected = isSecretaria() && s.id === selectedSchoolId;
    const deleteBtn = isSecretaria()
      ? `<button type="button" class="secondary small" data-delete-school="${escapeHtml(s.id)}" data-school-name="${escapeHtml(s.name)}">Excluir</button>`
      : `<span class="muted small">—</span>`;
    return `<tr data-select-school="${escapeHtml(s.id)}" style="${isSecretaria() ? "cursor:pointer;" : ""}${isSelected ? "background:#eef5ff;font-weight:600;" : ""}">
      <td>${escapeHtml(s.name)}${isSelected ? " (Selecionada)" : ""}</td>
      <td>${escapeHtml(s.manager_name || "—")}</td>
      <td>${escapeHtml(s.inep_code || "—")}</td>
      <td>${escapeHtml(s.address || "—")}</td>
      <td>${escapeHtml(s.phone || "—")}</td>
      <td>${deleteBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6">Nenhuma escola vinculada.</td></tr>';
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
  if (!$("students-body")) return;
  $("students-body").innerHTML = rows.map(s =>
    `<tr>
      <td>${escapeHtml(s.full_name)}</td>
      <td>${escapeHtml(formatCpf(s.cpf))}</td>
      <td>${escapeHtml(s.birth_date || "—")}</td>
      <td>${escapeHtml(s.guardian_name || "—")}</td>
      <td>${escapeHtml(s.schools?.name || "—")}</td>
    </tr>`
  ).join("") || '<tr><td colspan="5">Nenhum aluno cadastrado.</td></tr>';
}

function formatSchedule(startTime, endTime) {
  if (startTime && endTime) return `${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}`;
  if (startTime) return `${startTime.slice(0, 5)} - —`;
  if (endTime) return `— - ${endTime.slice(0, 5)}`;
  return "—";
}

function renderClasses(rows = getScopedClasses()) {
  if (!$("classes-body")) return;
  const canAssignTeacher = canManageClassesAndEnrollments();
  $("classes-body").innerHTML = rows.map(c => {
    const classTeachers = getScopedTeachers(c.school_id);
    const currentTeacher = cachedProfiles.find(p => p.id === c.teacher_id);
    const teacherCell = canAssignTeacher
      ? `<select data-assign-teacher="${escapeHtml(c.id)}">
          <option value="">Não definido</option>
          ${classTeachers.map(t => `<option value="${escapeHtml(t.id)}"${t.id === c.teacher_id ? " selected" : ""}>${escapeHtml(t.full_name || "Professor sem nome")}</option>`).join("")}
        </select>`
      : escapeHtml(currentTeacher?.full_name || "Não definido");

    return `<tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.class_complement || "—")}</td>
      <td>${escapeHtml(c.grade_level)}</td>
      <td>${escapeHtml(c.modality || "Regular")}</td>
      <td>${escapeHtml(c.mediation_type || "Presencial")}</td>
      <td>${escapeHtml(formatSchedule(c.start_time, c.end_time))}</td>
      <td>${c.school_year}</td>
      <td>${escapeHtml(c.schools?.name || "—")}</td>
      <td>${teacherCell}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="9">Nenhuma turma cadastrada.</td></tr>';
}

$("classes-body")?.addEventListener("change", async e => {
  const select = e.target.closest("[data-assign-teacher]");
  if (!select) return;
  if (!canManageClassesAndEnrollments()) {
    notice("Seu perfil não tem permissão para vincular professores às turmas.", true);
    return;
  }

  const classId = select.dataset.assignTeacher;
  const teacherId = select.value || null;
  const targetClass = getScopedClasses().find(c => c.id === classId);
  if (!targetClass) {
    notice("Turma fora do escopo da sua unidade escolar.", true);
    return;
  }

  if (teacherId) {
    const allowedTeachers = new Set(getScopedTeachers(targetClass.school_id).map(t => t.id));
    if (!allowedTeachers.has(teacherId)) {
      notice("Selecione um professor vinculado à mesma unidade escolar da turma.", true);
      renderClasses();
      return;
    }
  }

  select.disabled = true;
  try {
    const { error } = await supabase
      .from("classes")
      .update({ teacher_id: teacherId })
      .eq("id", classId);
    if (error) throw error;
    notice("Professor da turma atualizado com sucesso.");
    await loadAll();
  } catch (err) {
    console.error(err);
    notice("Não foi possível atualizar o professor da turma.", true);
    select.disabled = false;
  }
});

function renderEnrollments(rows = getScopedEnrollments()) {
  if (!$("enrollments-body")) return;
  $("enrollments-body").innerHTML = rows.map(e =>
    `<tr><td>${escapeHtml(e.students?.full_name || "—")}</td><td>${escapeHtml(e.classes?.name || "—")}</td><td>${e.school_year}</td><td>${escapeHtml(e.status)}</td></tr>`
  ).join("") || '<tr><td colspan="4">Nenhuma matrícula cadastrada.</td></tr>';
}

function renderUsers() {
  if (!$("users-body")) return;
  const effectiveId = getEffectiveSchoolId();
  const visibleProfiles = effectiveId
    ? cachedProfiles.filter(u => u.school_id === effectiveId || u.role === "secretaria")
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
      <td>${escapeHtml(formatCpf(u.cpf))}</td>
      <td>${escapeHtml(roleNames[u.role] || u.role || "—")}</td>
      <td>${escapeHtml(escolaLabel)}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>';
}

// --- MATRIZ CURRICULAR (OBRIGATÓRIA E COMPLEMENTAR NÃO OBRIGATÓRIA) ---
function formatRequirementLabel(type) {
  return type === "complementar_nao_obrigatoria"
    ? "Complementar (Não obrigatória)"
    : "Obrigatória";
}

function fillMonitorSubjectSelect() {
  const select = $("monitor-subject-select");
  if (!select) return;
  const currentVal = select.value;
  const complementaryItems = cachedCurriculum.filter(
    item => item.requirement_type === "complementar_nao_obrigatoria"
  );
  const uniqueSubjects = Array.from(new Set(complementaryItems.map(x => x.subject)));

  select.innerHTML = `<option value="">Selecione a atividade complementar</option>` +
    uniqueSubjects.map(subj => `<option value="${escapeHtml(subj)}">${escapeHtml(subj)}</option>`).join("");

  if (uniqueSubjects.includes(currentVal)) {
    select.value = currentVal;
  }
}

function renderCurriculum() {
  if (!$("curriculum-body")) return;
  const filterStage = $("curriculum-filter-stage")?.value || "";
  const filterReq = $("curriculum-filter-requirement")?.value || "";

  const items = cachedCurriculum.filter(item => {
    const stageOk = !filterStage || item.stage === filterStage;
    const reqOk = !filterReq || (item.requirement_type || "obrigatoria") === filterReq;
    return stageOk && reqOk;
  });

  const canManage = canManageCurriculumAndMonitors();
  $("curriculum-body").innerHTML = items.map(item => {
    const delBtn = canManage
      ? `<button type="button" class="secondary small" data-delete-curriculum="${escapeHtml(item.id)}">Remover</button>`
      : `<span class="muted small">—</span>`;
    return `<tr>
      <td>${escapeHtml(item.stage)}</td>
      <td>${escapeHtml(item.subject)}</td>
      <td>${escapeHtml(item.area || "—")}</td>
      <td>${escapeHtml(formatRequirementLabel(item.requirement_type))}</td>
      <td>${escapeHtml(String(item.annual_hours))}h</td>
      <td>${delBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6">Nenhum componente ou atividade encontrado com o filtro selecionado.</td></tr>';
}

$("curriculum-filter-stage")?.addEventListener("change", renderCurriculum);
$("curriculum-filter-requirement")?.addEventListener("change", renderCurriculum);

$("curriculum-form")?.addEventListener("submit", e => {
  e.preventDefault();
  if (!canManageCurriculumAndMonitors()) {
    notice("Apenas Secretaria ou Gestor podem alterar a matriz curricular.", true);
    return;
  }
  const data = formObject(e.target);
  const requirementType = data.requirement_type || "obrigatoria";
  const newItem = {
    id: `curr-${Date.now()}`,
    stage: data.stage,
    subject: String(data.subject || "").trim(),
    area: String(data.area || "").trim() || (requirementType === "complementar_nao_obrigatoria" ? "Atividades Complementares" : "Formação Geral Básica"),
    requirement_type: requirementType,
    annual_hours: Number(data.annual_hours) || 0
  };
  cachedCurriculum = [newItem, ...cachedCurriculum];
  saveLocalJson(CURRICULUM_STORAGE_KEY, cachedCurriculum);
  e.target.reset();
  if ($("curriculum-stage-select")) $("curriculum-stage-select").value = newItem.stage;
  if ($("curriculum-requirement-select")) $("curriculum-requirement-select").value = requirementType;
  fillMonitorSubjectSelect();
  renderCurriculum();
  notice(
    requirementType === "complementar_nao_obrigatoria"
      ? "Atividade complementar (não obrigatória) adicionada à matriz."
      : "Componente obrigatório adicionado à matriz curricular."
  );
});

$("curriculum-body")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-delete-curriculum]");
  if (!btn) return;
  if (!canManageCurriculumAndMonitors()) {
    notice("Apenas Secretaria ou Gestor podem remover itens da matriz curricular.", true);
    return;
  }
  const id = btn.dataset.deleteCurriculum;
  cachedCurriculum = cachedCurriculum.filter(x => x.id !== id);
  saveLocalJson(CURRICULUM_STORAGE_KEY, cachedCurriculum);
  fillMonitorSubjectSelect();
  renderCurriculum();
  notice("Item removido da matriz curricular.");
});

// --- MONITORES DAS DISCIPLINAS COMPLEMENTARES ---
function renderMonitors() {
  if (!$("monitors-body")) return;
  const effectiveId = getEffectiveSchoolId();
  const rows = effectiveId
    ? cachedMonitors.filter(m => !m.school_id || m.school_id === effectiveId)
    : cachedMonitors;

  const canManage = canManageCurriculumAndMonitors();
  $("monitors-body").innerHTML = rows.map(m => {
    const school = cachedSchools.find(s => s.id === m.school_id);
    const schoolLabel = school ? school.name : "Rede / Todas as escolas";
    const delBtn = canManage
      ? `<button type="button" class="secondary small" data-delete-monitor="${escapeHtml(m.id)}">Remover</button>`
      : `<span class="muted small">—</span>`;
    return `<tr>
      <td>${escapeHtml(m.monitor_name)}</td>
      <td>${escapeHtml(m.subject)}</td>
      <td>${escapeHtml(m.stage)}</td>
      <td>${escapeHtml(schoolLabel)}</td>
      <td>${escapeHtml(String(m.weekly_hours))}h/sem</td>
      <td>${delBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6">Nenhum monitor de atividade complementar cadastrado.</td></tr>';
}

$("monitor-form")?.addEventListener("submit", e => {
  e.preventDefault();
  if (!canManageCurriculumAndMonitors()) {
    notice("Apenas Secretaria ou Gestor podem cadastrar monitores.", true);
    return;
  }
  const data = formObject(e.target);
  if (!data.subject) {
    notice("Selecione uma atividade complementar cadastrada na matriz curricular.", true);
    return;
  }
  const effectiveId = getEffectiveSchoolId();
  const newMonitor = {
    id: `mon-${Date.now()}`,
    monitor_name: String(data.monitor_name || "").trim(),
    subject: String(data.subject || "").trim(),
    stage: data.stage,
    school_id: isSecretaria() ? (data.school_id || null) : effectiveId,
    weekly_hours: Number(data.weekly_hours) || 0
  };
  cachedMonitors = [newMonitor, ...cachedMonitors];
  saveLocalJson(MONITORS_STORAGE_KEY, cachedMonitors);
  e.target.reset();
  if (effectiveId && $("monitor-school")) $("monitor-school").value = effectiveId;
  renderMonitors();
  notice("Monitor de atividade complementar cadastrado com sucesso.");
});

$("monitors-body")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-delete-monitor]");
  if (!btn) return;
  if (!canManageCurriculumAndMonitors()) {
    notice("Apenas Secretaria ou Gestor podem remover monitores.", true);
    return;
  }
  const id = btn.dataset.deleteMonitor;
  cachedMonitors = cachedMonitors.filter(x => x.id !== id);
  saveLocalJson(MONITORS_STORAGE_KEY, cachedMonitors);
  renderMonitors();
  notice("Monitor removido.");
});

// --- MAPEAMENTO DO CENSO ESCOLAR ---
function renderCensus() {
  if (!$("census-body")) return;
  const effectiveId = getEffectiveSchoolId();
  const scopedSchools = getScopedSchools();
  const scopedStudents = getScopedStudents();
  const scopedEnrollments = getScopedEnrollments();
  const validStudents = scopedStudents.filter(s => s.full_name && s.birth_date && s.school_id);
  const activeStudentIds = new Set(
    scopedEnrollments
      .filter(e => e.status === "ativa" && e.student_id)
      .map(e => e.student_id)
  );

  const visibleCensus = effectiveId
    ? cachedCensus.filter(c => c.school_id === effectiveId)
    : cachedCensus;

  if ($("censo-schools-count")) $("censo-schools-count").textContent = scopedSchools.length;
  if ($("censo-students-count")) $("censo-students-count").textContent = validStudents.length;
  if ($("censo-enrollments-count")) $("censo-enrollments-count").textContent = activeStudentIds.size;

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
  const targetSchoolId = isSecretaria() ? data.school_id : getEffectiveSchoolId();
  const school = cachedSchools.find(s => s.id === targetSchoolId);
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
  let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  let token = sessionData?.session?.access_token;

  if (!token || sessionError) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed?.session?.access_token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    token = refreshed.session.access_token;
  }

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
    const cpfCheck = validateAndNormalizeCpf(payload.cpf, "CPF");
    if (!cpfCheck.valid) {
      notice(cpfCheck.error, true);
      return;
    }

    if (cpfCheck.cpf && cachedProfiles.some(p => normalizeCpf(p.cpf) === cpfCheck.cpf)) {
      notice("Já existe um usuário ou professor cadastrado com este CPF.", true);
      return;
    }

    const body = {
      full_name: payload.full_name?.trim(),
      cpf: cpfCheck.cpf,
      email: payload.email?.trim().toLowerCase(),
      password: payload.password,
      role: payload.role,
      school_id: payload.school_id || null
    };

    try {
      await callUserFunction(body);
      userForm.reset();
      const effectiveId = getEffectiveSchoolId();
      if (effectiveId && $("user-school")) $("user-school").value = effectiveId;
      notice("Usuário cadastrado com sucesso.");
      await loadProfiles();
    } catch (err) {
      console.error(err);
      notice(err.message || "Erro ao cadastrar usuário. Verifique se a Edge Function create-user está publicada no Supabase.", true);
    }
  });
}

function resetClassFormDefaults(form, schoolId) {
  form.reset();
  document.querySelectorAll('input[name="school_year"]').forEach(x => x.value = new Date().getFullYear());
  if ($('input[name="census_year"]')) $('input[name="census_year"]').value = new Date().getFullYear();
  if (form.elements["max_students"]) form.elements["max_students"].value = "30";
  if (form.elements["modality"]) form.elements["modality"].value = "Regular";
  if (form.elements["mediation_type"]) form.elements["mediation_type"].value = "Presencial";
  if (form.elements["schooling"]) form.elements["schooling"].value = "Sim";
  if (form.elements["complementary_activity"]) form.elements["complementary_activity"].value = "Não";
  if (form.elements["curriculum_type"]) form.elements["curriculum_type"].value = "Comum";
  if (form.elements["late_tolerance"]) form.elements["late_tolerance"].value = "Padrão do sistema";
  if (form.elements["aee_service"]) form.elements["aee_service"].value = "Não";
  if (form.elements["differentiated_location"]) {
    form.elements["differentiated_location"].value = "A turma não está em local de funcionamento diferenciado";
  }
  if (form.elements["portuguese_second_language"]) {
    form.elements["portuguese_second_language"].value = "Não oferece disciplina";
  }
  if (form.elements["supervised_internship"]) {
    form.elements["supervised_internship"].value = "Não oferece disciplina";
  }
  if (form.elements["bilingual_deaf_class"]) form.elements["bilingual_deaf_class"].value = "Não";
  if (schoolId && $("class-school")) $("class-school").value = schoolId;
}

async function insertForm(formId, table, transform = (x) => x, onSuccess = null, beforeInsert = null) {
  const form = $(formId);
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const raw = formObject(form);
    if (beforeInsert) {
      const check = beforeInsert(raw);
      if (check && check.ok === false) {
        notice(check.message || "Verifique os dados informados.", true);
        return;
      }
    }
    const obj = transform(raw);
    try {
      const { data, error } = await supabase.from(table).insert(obj).select().single();
      if (error) throw error;
      form.reset();
      document.querySelectorAll('input[name="school_year"]').forEach(x => x.value = new Date().getFullYear());
      if ($('input[name="census_year"]')) $('input[name="census_year"]').value = new Date().getFullYear();
      const effectiveId = getEffectiveSchoolId();
      if (effectiveId) {
        if ($("student-school")) $("student-school").value = effectiveId;
        if ($("class-school")) $("class-school").value = effectiveId;
        if ($("monitor-school")) $("monitor-school").value = effectiveId;
        if ($("census-school")) $("census-school").value = effectiveId;
      }
      notice("Registro salvo com sucesso.");
      await loadAll();
      if (onSuccess && data) onSuccess(data);
    } catch (err) {
      console.error(err);
      if (err?.code === "23505" && table === "students") {
        notice("Já existe um aluno cadastrado com este CPF.", true);
        return;
      }
      if (err?.code === "22023") {
        notice(err.message || "CPF inválido: informe 11 dígitos numéricos.", true);
        return;
      }
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

insertForm(
  "student-form",
  "students",
  x => ({
    ...x,
    cpf: validateAndNormalizeCpf(x.cpf, "CPF do aluno").cpf,
    school_id: isSecretaria() ? x.school_id : getEffectiveSchoolId(),
    birth_date: x.birth_date || null,
    guardian_name: x.guardian_name || null,
    guardian_phone: x.guardian_phone || null,
    notes: x.notes || null
  }),
  null,
  raw => {
    const check = validateAndNormalizeCpf(raw.cpf, "CPF do aluno");
    if (!check.valid) return { ok: false, message: check.error };
    if (check.cpf && cachedStudents.some(s => normalizeCpf(s.cpf) === check.cpf)) {
      return { ok: false, message: "Já existe um aluno cadastrado com este CPF." };
    }
    return { ok: true };
  }
);

$("class-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!canManageClassesAndEnrollments()) {
    notice("Seu perfil não tem permissão para criar turmas.", true);
    return;
  }

  const raw = formObject(e.target);
  const targetSchoolId = isSecretaria() ? raw.school_id : getEffectiveSchoolId();
  if (!targetSchoolId) {
    notice("Selecione ou vincule uma unidade escolar antes de criar a turma.", true);
    return;
  }

  if (!raw.grade_level) {
    notice("Selecione uma etapa de ensino para a turma.", true);
    return;
  }

  const teacherId = raw.teacher_id || null;
  if (teacherId) {
    const allowedTeachers = new Set(getScopedTeachers(targetSchoolId).map(t => t.id));
    if (!allowedTeachers.has(teacherId)) {
      notice("Selecione um professor vinculado à escola da turma.", true);
      return;
    }
  }

  try {
    const { error } = await supabase.from("classes").insert({
      name: String(raw.name || "").trim(),
      max_students: Number(raw.max_students) || 30,
      class_complement: String(raw.class_complement || "").trim() || null,
      inep_code: String(raw.inep_code || "").trim() || null,
      modality: raw.modality || "Regular",
      grade_level: String(raw.grade_level || "").trim(),
      mediation_type: raw.mediation_type || "Presencial",
      schooling: raw.schooling || "Sim",
      complementary_activity: raw.complementary_activity || "Não",
      curriculum_type: raw.curriculum_type || "Comum",
      start_time: raw.start_time || null,
      end_time: raw.end_time || null,
      late_tolerance: raw.late_tolerance || "Padrão do sistema",
      aee_service: raw.aee_service || "Não",
      differentiated_location: raw.differentiated_location || "A turma não está em local de funcionamento diferenciado",
      portuguese_second_language: raw.portuguese_second_language || "Não oferece disciplina",
      supervised_internship: raw.supervised_internship || "Não oferece disciplina",
      bilingual_deaf_class: raw.bilingual_deaf_class || "Não",
      shift: raw.shift || "Matutino",
      school_year: Number(raw.school_year),
      school_id: targetSchoolId,
      teacher_id: teacherId
    });
    if (error) throw error;

    resetClassFormDefaults(e.target, targetSchoolId);
    notice("Turma criada com sucesso.");
    await loadAll();
  } catch (err) {
    console.error(err);
    notice("Não foi possível criar a turma. Verifique os campos obrigatórios, o banco de dados e suas permissões.", true);
  }
});

$("enrollment-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!canManageClassesAndEnrollments()) {
    notice("Seu perfil não tem permissão para enturmar alunos.", true);
    return;
  }

  const raw = formObject(e.target);
  const studentId = raw.student_id;
  const classId = raw.class_id;
  const schoolYear = Number(raw.school_year);
  const status = raw.status || "ativa";

  const allowedStudents = new Set(getScopedStudents().map(s => s.id));
  const allowedClasses = new Set(getScopedClasses().map(c => c.id));

  if (!allowedStudents.has(studentId) || !allowedClasses.has(classId)) {
    notice("Selecione um aluno e uma turma da unidade escolar vinculada.", true);
    return;
  }

  try {
    const { error } = await supabase.from("enrollments").insert({
      student_id: studentId,
      class_id: classId,
      school_year: schoolYear,
      status
    });
    if (error) throw error;

    e.target.reset();
    document.querySelectorAll('input[name="school_year"]').forEach(x => x.value = new Date().getFullYear());
    notice("Aluno enturmado com sucesso.");
    await loadAll();
  } catch (err) {
    console.error(err);
    notice("Não foi possível enturmar o aluno. Verifique os campos obrigatórios e suas permissões.", true);
  }
});

insertForm("lesson-form", "lessons", x => ({
  ...x,
  teacher_id: currentProfile?.id
}));

async function loadLessons() {
  if (!$("lessons-body")) return;
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("class_id,lesson_date,subject,content,classes(name,school_id)")
      .order("lesson_date", { ascending: false })
      .limit(50);
    if (error) throw error;
    const effectiveId = getEffectiveSchoolId();
    const rows = (data || []).filter(l => !effectiveId || l.classes?.school_id === effectiveId);
    $("lessons-body").innerHTML = rows.map(l =>
      `<tr><td>${escapeHtml(l.lesson_date)}</td><td>${escapeHtml(l.classes?.name || "—")}</td><td>${escapeHtml(l.subject)}</td><td>${escapeHtml(l.content)}</td></tr>`
    ).join("") || '<tr><td colspan="4">Nenhuma aula registrada.</td></tr>';
  } catch (e) {
    console.error(e);
  }
}

$("load-attendance")?.addEventListener("click", async () => {
  const classId = $("attendance-class")?.value;
  const date = $("attendance-date")?.value;
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
      name: x.students?.full_name || "Aluno",
      status: "presente"
    }));
    $("attendance-list").innerHTML = attendanceRows.map((x, i) =>
      `<div class="attendance-row"><strong>${escapeHtml(x.name)}</strong><select data-attendance="${i}"><option value="presente">Presente</option><option value="falta">Falta</option><option value="justificada">Falta justificada</option></select></div>`
    ).join("") || "<p class='muted'>Não há alunos ativos nesta turma/ano.</p>";
    $("attendance-list").querySelectorAll("select").forEach(s =>
      s.addEventListener("change", () => {
        attendanceRows[Number(s.dataset.attendance)].status = s.value;
      })
    );
    $("save-attendance")?.classList.toggle("hidden", attendanceRows.length === 0);
  } catch (e) {
    console.error(e);
    notice("Não foi possível carregar a lista de alunos.", true);
  }
});

$("save-attendance")?.addEventListener("click", async () => {
  const classId = $("attendance-class")?.value;
  const date = $("attendance-date")?.value;
  if (!classId || !date || !attendanceRows.length) return;

  try {
    const payload = attendanceRows.map(x => ({
      class_id: classId,
      student_id: x.student_id,
      attendance_date: date,
      status: x.status,
      recorded_by: currentProfile?.id || null
    }));
    const { error } = await supabase
      .from("attendance")
      .upsert(payload, { onConflict: "class_id,student_id,attendance_date" });
    if (error) throw error;
    notice("Frequência salva com sucesso.");
  } catch (e) {
    console.error(e);
    notice("Não foi possível salvar a frequência. Verifique as permissões.", true);
  }
});

if ($("attendance-date")) $("attendance-date").value = today;
document.querySelectorAll('input[name="school_year"]').forEach(x => {
  x.value = new Date().getFullYear();
});
if ($('input[name="census_year"]')) {
  $('input[name="census_year"]').value = new Date().getFullYear();
}
