import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/*
  CONFIGURAÇÃO: substitua pelos dados do projeto Supabase.
  Não coloque a chave secreta / service_role neste arquivo. Use somente a chave pública (Publishable / anon key).
*/
const SUPABASE_URL = "https://xkuypxublyyrevrmaale.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AK9mLZ12c6fUaltPDtTD2Q_oNfG6sXD";
const CREATE_USER_FUNCTION = "create-user";

// E-mail(s) exclusivos do proprietário do sistema com acesso ao licenciamento de cidades.
const OWNER_EMAILS = [
  "ws048400@gmail.com"
].map(e => e.trim().toLowerCase());

const configured =
  Boolean(SUPABASE_URL && SUPABASE_URL.startsWith("https://")) &&
  Boolean(SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.trim().length > 0);

const tabSessionStorage = {
  getItem: (key) => {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // ignora restrições de armazenamento privado
    }
  },
  removeItem: (key) => {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignora restrições de armazenamento privado
    }
  }
};

const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: tabSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    })
  : null;

let currentProfile = null;
let currentAuthEmail = "";
let selectedSchoolId = "";
let cachedSchools = [], cachedStudents = [], cachedClasses = [], cachedEnrollments = [], cachedProfiles = [], cachedLessons = [];
let cachedCityLicenses = [];
let attendanceRows = [];
let activeLessonDetailSchoolId = null;
let isSigningOut = false;

const CURRICULUM_STORAGE_KEY = "ge_matriz_curricular_v2";
const MONITORS_STORAGE_KEY = "ge_monitores_complementares_v1";
const CENSUS_STORAGE_KEY = "ge_mapeamento_censo_v2";
const SCHOOL_DRAFT_CENSUS_KEY = "ge_rascunho_censo_escola_v1";
const CITY_LICENSES_STORAGE_KEY = "ge_licencas_cidades_v1";

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getScopedStorageKey(baseKey) {
  const userScope = currentProfile?.id ? `_${currentProfile.id}` : "";
  return `${baseKey}${userScope}`;
}

function formatSupabaseError(err) {
  if (!err) return "Erro desconhecido";
  if (typeof err === "string") return err;
  const parts = [];
  if (err.status || err.statusCode) parts.push(`HTTP ${err.status || err.statusCode}`);
  if (err.code) parts.push(`código ${err.code}`);
  if (err.message) parts.push(err.message);
  if (err.details) parts.push(err.details);
  if (err.hint) parts.push(`dica: ${err.hint}`);
  return parts.length ? parts.join(" · ") : JSON.stringify(err);
}

function isAuth401Error(err) {
  const status = Number(err?.status || err?.statusCode || 0);
  const msg = String(err?.message || "").toLowerCase();
  return status === 401 || msg.includes("invalid api key") || msg.includes("jwt") || msg.includes("401");
}

// 21 blocos exibidos no cadastro da unidade escolar e na seção CENSO ESCOLAR (gestor e secretário escolar)
const CENSUS_MODULES = [
  {
    key: "identificacao_escola",
    label: "Identificação Escola",
    icon: "||| |||",
    fields: [
      { name: "nome_escola", label: "Nome da escola", placeholder: "Ex.: E.M. Monteiro Lobato" },
      { name: "codigo_inep", label: "Código INEP", placeholder: "Ex.: 29235146" },
      { name: "situacao_funcionamento", label: "Situação de funcionamento", options: ["Em atividade", "Paralisada", "Extinta"] },
      { name: "dependencia_administrativa", label: "Dependência administrativa", options: ["Municipal", "Estadual", "Federal", "Privada"] },
      { name: "regulamentacao", label: "Regulamentação / Autorização", placeholder: "Ex.: Autorizada pelo Conselho Municipal" }
    ]
  },
  {
    key: "endereco",
    label: "Endereço",
    icon: "⚑",
    fields: [
      { name: "cep", label: "CEP", placeholder: "00000-000" },
      { name: "logradouro", label: "Logradouro / Endereço", placeholder: "Rua, Avenida, Rodovia..." },
      { name: "numero_bairro", label: "Número / Bairro", placeholder: "Ex.: 120 - Centro" },
      { name: "localizacao_zona", label: "Localização / Zona", options: ["Urbana", "Rural"] }
    ]
  },
  {
    key: "contatos",
    label: "Contatos",
    icon: "☎",
    fields: [
      { name: "telefone_principal", label: "Telefone principal", placeholder: "(00) 0000-0000" },
      { name: "telefone_secundario", label: "Telefone secundário / Celular", placeholder: "(00) 90000-0000" },
      { name: "email_institucional", label: "E-mail institucional", placeholder: "escola@educacao.gov.br" }
    ]
  },
  {
    key: "dados_gestor",
    label: "Dados do gestor",
    icon: "👤",
    fields: [
      { name: "nome_gestor", label: "Nome do gestor(a) escolar", placeholder: "Nome completo" },
      { name: "cargo_gestor", label: "Cargo / Função", options: ["Diretor(a)", "Gestor(a) Escolar", "Coordenador(a) Pedagógico(a)", "Responsável pela Unidade"] },
      { name: "email_gestor", label: "E-mail do gestor", placeholder: "gestor@educacao.gov.br" }
    ]
  },
  {
    key: "local_funcionamento",
    label: "Local de funcionamento",
    icon: "📍",
    fields: [
      { name: "tipo_local", label: "Local de funcionamento", options: ["Prédio escolar", "Galpão / Anexo", "Sala em outra escola", "Unidade socioeducativa", "Unidade prisional", "Outro"] },
      { name: "compartilhado", label: "Prédio compartilhado com outra escola?", options: ["Não", "Sim"] },
      { name: "forma_ocupacao", label: "Forma de ocupação do prédio", options: ["Próprio", "Alugado", "Cedido"] }
    ]
  },
  {
    key: "abastecimento_agua",
    label: "Abastecimento de água",
    icon: "💧",
    fields: [
      { name: "fonte_agua", label: "Abastecimento de água", options: ["Rede pública", "Poço artesiano", "Cacimba / Cisterna / Poço", "Fonte / Rio / Igarapé", "Não há abastecimento de água"] },
      { name: "agua_potavel", label: "Água potável para consumo?", options: ["Sim", "Não"] }
    ]
  },
  {
    key: "abastecimento_energia",
    label: "Abastecimento de energia",
    icon: "⚡",
    fields: [
      { name: "fonte_energia", label: "Abastecimento de energia elétrica", options: ["Rede pública", "Gerador movido a combustível", "Fonte de energia renovável / Solar", "Não há energia elétrica"] },
      { name: "energia_ativa", label: "Energia em funcionamento regular?", options: ["Sim", "Não"] }
    ]
  },
  {
    key: "rede_esgoto",
    label: "Rede de esgoto",
    icon: "🍃",
    fields: [
      { name: "tipo_esgoto", label: "Esgotamento sanitário", options: ["Rede pública", "Fossa séptica", "Fossa rudimentar / Comum", "Não há rede de esgoto"] }
    ]
  },
  {
    key: "destinacao_lixo",
    label: "Destinação do lixo",
    icon: "🗑",
    fields: [
      { name: "coleta_lixo", label: "Serviço de coleta / Destinação do lixo", options: ["Coleta periódica", "Queima", "Enterra", "Leva a destinação licenciada", "Não há coleta"] },
      { name: "separacao_reciclagem", label: "Faz separação / reciclagem de resíduos?", options: ["Sim", "Não"] }
    ]
  },
  {
    key: "dependencias_fisicas",
    label: "Dependências física",
    icon: "▤",
    fields: [
      { name: "salas_aula", label: "Salas de aula / Atendimento", placeholder: "Ex.: 8 salas de aula" },
      { name: "espacos_apoio", label: "Salas administrativas / Biblioteca / Refeitório / Quadra", placeholder: "Ex.: Secretaria, cozinha, pátio coberto" },
      { name: "sanitarios", label: "Sanitários (alunos, acessíveis, funcionários)", placeholder: "Ex.: 4 banheiros de alunos, 1 PcD" }
    ]
  },
  {
    key: "acessibilidade",
    label: "Acessibilidade",
    icon: "♿",
    fields: [
      { name: "recursos_acessibilidade", label: "Recursos de acessibilidade arquitetônica", placeholder: "Ex.: Rampas, corrimão, sanitário acessível, piso tátil" },
      { name: "atendimento_pcd", label: "Atendimento educacional adaptado para PcD?", options: ["Sim", "Não"] }
    ]
  },
  {
    key: "equipamentos",
    label: "Equipamentos",
    icon: "▭",
    fields: [
      { name: "equipamentos_gerais", label: "Equipamentos da unidade", placeholder: "Ex.: TV, projetor, impressora, copiadora, som" }
    ]
  },
  {
    key: "equipamentos_aprendizagem",
    label: "Equipamentos aprendizagem",
    icon: "🎧",
    fields: [
      { name: "recursos_pedagogicos", label: "Equipamentos e materiais de aprendizagem", placeholder: "Ex.: Tablets, kits de robótica, fones, jogos educativos" }
    ]
  },
  {
    key: "computadores_internet",
    label: "Computadores / Internet",
    icon: "📡",
    fields: [
      { name: "computadores_escola", label: "Computadores / Notebooks / Tablets", placeholder: "Ex.: 10 computadores na secretaria/lab" },
      { name: "acesso_internet", label: "Acesso à internet", options: ["Banda larga", "Fibra óptica / Satélite", "Sem acesso à internet"] },
      { name: "rede_alunos", label: "Internet disponível para uso dos alunos?", options: ["Sim", "Não"] }
    ]
  },
  {
    key: "instrumentos_ensino",
    label: "Instrumentos de ensino",
    icon: "🧩",
    fields: [
      { name: "instrumentos_pedagogicos", label: "Instrumentos e acervos de ensino", placeholder: "Ex.: Acervo literário, mapas, material didático, laboratório" }
    ]
  },
  {
    key: "sistema_cotas",
    label: "Sistema de cotas",
    icon: "⇊",
    fields: [
      { name: "possui_cotas", label: "Adota reserva de vagas / sistema de cotas?", options: ["Não se aplica / Não", "Sim - PPI (Pretos, Pardos e Indígenas)", "Sim - PcD", "Sim - Renda / Escola pública"] },
      { name: "detalhes_cotas", label: "Observações sobre cotas / critérios", placeholder: "Detalhes normativos ou critérios" }
    ]
  },
  {
    key: "lingua",
    label: "Língua",
    icon: "🌐",
    fields: [
      { name: "lingua_instrucao", label: "Língua em que o ensino é ministrado", options: ["Língua Portuguesa", "Língua Indígena", "Libras / Bilíngue", "Outra"] },
      { name: "lingua_estrangeira_adicional", label: "Idioma / Língua adicional ofertada", placeholder: "Ex.: Inglês, Espanhol, Libras" }
    ]
  },
  {
    key: "organizacao_ensino",
    label: "Organização do ensino",
    icon: "↓19",
    fields: [
      { name: "forma_organizacao", label: "Formas de organização", options: ["Séries / Anos regulares", "Ciclos do ensino fundamental", "Grupos não seriados", "Módulos / Alternância", "Etapas combinadas"] },
      { name: "etapas_ofertadas", label: "Etapas ofertadas", placeholder: "Ex.: Educação Infantil, Ensino Fundamental I e II" }
    ]
  },
  {
    key: "orgaos_colegiados",
    label: "Orgãos colegiados",
    icon: "⚖",
    fields: [
      { name: "orgaos_ativos", label: "Órgãos colegiados em funcionamento", placeholder: "Ex.: Conselho Escolar, APM / Caixa Escolar, Grêmio Estudantil" },
      { name: "participacao_comunidade", label: "Reuniões periódicas com a comunidade?", options: ["Sim", "Não"] }
    ]
  },
  {
    key: "recursos_humanos",
    label: "Recursos Humanos",
    icon: "👥",
    fields: [
      { name: "equipe_docente_gestao", label: "Professores, gestores e equipe pedagógica", placeholder: "Ex.: 14 professores, 1 gestor, 1 coordenador" },
      { name: "equipe_apoio_monitores", label: "Secretaria, apoio operacional e monitores", placeholder: "Ex.: 2 secretários, 3 merendeiras/limpeza, 2 monitores" }
    ]
  },
  {
    key: "educacao_ambiental",
    label: "Educação Ambiental",
    icon: "🌲",
    fields: [
      { name: "acoes_ambientais", label: "Práticas / Projetos de Educação Ambiental", options: ["Sim - Inserida no currículo e projetos", "Sim - Ações pontuais / Horta / Reciclagem", "Não desenvolve"] },
      { name: "descricao_ambiental", label: "Descrição das ações ambientais", placeholder: "Ex.: Horta escolar, compostagem, coleta seletiva" }
    ]
  }
];

let activeCensusModuleKey = null;
let draftSchoolCensusModules = {};
let activeDraftSchoolModuleKey = null;

const defaultCurriculum = [
  { id: "curr-1", stage: "Educação Infantil", subject: "O eu, o outro e o nós", area: "Campos de Experiência", requirement_type: "obrigatoria", annual_hours: 800 },
  { id: "curr-2", stage: "Educação Infantil", subject: "Corpo, gestos e movimentos", area: "Campos de Experiência", requirement_type: "obrigatoria", annual_hours: 800 },
  { id: "curr-3", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Língua Portuguesa", area: "Linguagens", requirement_type: "obrigatoria", annual_hours: 240 },
  { id: "curr-4", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Matemática", area: "Matemática", requirement_type: "obrigatoria", annual_hours: 240 },
  { id: "curr-5", stage: "Ensino Fundamental I (1º ao 5º ano)", subject: "Oficina de Leitura e Contação de Histórias", area: "Atividades Complementares", requirement_type: "complementar_nao_obrigatoria", annual_hours: 80 },
  { id: "curr-6", stage: "Ensino Fundamental II (6º ao 9º ano)", subject: "Robótica Educacional e Iniciação Científica", area: "Cultura Digital / Ciências", requirement_type: "complementar_nao_obrigatoria", annual_hours: 80 }
];

let cachedCurriculum = [...defaultCurriculum];
let cachedMonitors = [];
let cachedCensus = [];

function hydrateUserScopedCache() {
  draftSchoolCensusModules = loadLocalJson(getScopedStorageKey(SCHOOL_DRAFT_CENSUS_KEY), {});
  cachedCurriculum = loadLocalJson(getScopedStorageKey(CURRICULUM_STORAGE_KEY), defaultCurriculum);
  cachedMonitors = loadLocalJson(getScopedStorageKey(MONITORS_STORAGE_KEY), []);
  cachedCensus = loadLocalJson(getScopedStorageKey(CENSUS_STORAGE_KEY), []);
  cachedCityLicenses = loadLocalJson(CITY_LICENSES_STORAGE_KEY, []);
}

const $ = (id) => document.getElementById(id);
const roleNames = {
  proprietario: "Proprietário do Sistema",
  secretaria: "Secretaria de Educação",
  gestor: "Gestor escolar",
  secretario_escolar: "Secretário escolar",
  professor: "Professor",
  monitor_complementar: "Monitor de atividade complementar"
};

function isOwnerEmail(email) {
  const clean = String(email || "").trim().toLowerCase();
  return Boolean(clean && OWNER_EMAILS.includes(clean));
}

function isProprietario() {
  return currentProfile?.role === "proprietario" || isOwnerEmail(currentAuthEmail);
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function slugifyMunicipality(name, stateUf) {
  const base = `${name || ""}-${stateUf || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `municipio-${Date.now()}`;
}

function generateFourDigitCode(existingList, fieldName) {
  const existingCodes = new Set(
    existingList
      .map(item => String(item?.[fieldName] || "").trim())
      .filter(Boolean)
  );

  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!existingCodes.has(code)) return code;
  }

  for (let n = 1000; n <= 9999; n++) {
    const candidate = String(n);
    if (!existingCodes.has(candidate)) return candidate;
  }

  return String(1000 + (Date.now() % 9000)).padStart(4, "0");
}

function generateFourDigitSchoolCode() {
  return generateFourDigitCode(cachedSchools, "school_code");
}

function generateFourDigitClassCode() {
  return generateFourDigitCode(cachedClasses, "class_code");
}

function isAeeClass(cls) {
  if (!cls) return false;
  if (String(cls.aee_service || "").trim().toLowerCase() === "sim") return true;
  if (String(cls.modality || "").trim().toLowerCase() === "educação especial") return true;
  return /\baee\b/i.test(String(cls.name || "")) || /\baee\b/i.test(String(cls.grade_level || ""));
}

function isPcdStudent(student) {
  if (!student) return false;
  if (student.is_pcd === true) return true;
  const val = String(student.is_pcd || "").trim().toLowerCase();
  return val === "true" || val === "sim" || val === "1";
}

function usesTransport(enrollment) {
  if (!enrollment) return false;
  if (enrollment.uses_school_transport === true) return true;
  const val = String(enrollment.uses_school_transport || "").trim().toLowerCase();
  return val === "true" || val === "sim" || val === "1";
}

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
    console.warn("Não foi possível salvar localmente:", formatSupabaseError(e));
  }
}

function isSecretaria() {
  return currentProfile?.role === "secretaria";
}

function isSchoolUnitProfile() {
  return ["gestor", "secretario_escolar"].includes(currentProfile?.role);
}

function hasBoundSchoolUnit() {
  return Boolean(currentProfile?.school_id);
}

function canAccessCensus() {
  return isSchoolUnitProfile() && hasBoundSchoolUnit();
}

function canManageCurriculumAndMonitors() {
  return isSecretaria() || currentProfile?.role === "gestor";
}

function canManageClassesAndEnrollments() {
  return isSchoolUnitProfile() && hasBoundSchoolUnit();
}

function canAccessDiary() {
  return ["gestor", "secretario_escolar", "professor"].includes(currentProfile?.role) && hasBoundSchoolUnit();
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

function updateHomeSchoolCard() {
  const card = $("school-identity-card");
  const showIdentityCard = isSchoolUnitProfile();
  const activeSchool = showIdentityCard ? getActiveSchool() : null;

  if (card) {
    card.classList.toggle("hidden", !showIdentityCard);
  }

  if ($("home-school-id")) {
    $("home-school-id").textContent = activeSchool?.school_code || "—";
  }
  if ($("home-school-inep")) {
    $("home-school-inep").textContent = activeSchool?.inep_code || "—";
  }
  if ($("home-school-curriculum")) {
    $("home-school-curriculum").textContent = activeSchool ? (activeSchool.curriculum_offer || "Comum") : "—";
  }

  if ($("inicio-school-subtitle")) {
    if (isProprietario()) {
      $("inicio-school-subtitle").textContent = "Área administrativa do proprietário: gerencie o licenciamento de cidades e contratos.";
    } else if (showIdentityCard && activeSchool) {
      $("inicio-school-subtitle").textContent = `Unidade ativa: ${activeSchool.name} · ID ${activeSchool.school_code || "—"} · INEP ${activeSchool.inep_code || "Não informado"}.`;
    } else if (isSecretaria()) {
      $("inicio-school-subtitle").textContent = "Acompanhe as informações gerais da rede municipal e das unidades escolares.";
    } else {
      $("inicio-school-subtitle").textContent = "Acompanhe as informações da sua unidade escolar.";
    }
  }
}

function notice(message, bad = false) {
  const el = $("notice");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "bad");
  if (bad) el.classList.add("bad");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => el.classList.add("hidden"), 6500);
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
  if (isProprietario()) {
    $("user-role").textContent = `Proprietário do Sistema · ${currentAuthEmail}`;
    return;
  }
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

function resetAppStateOnSignOut() {
  currentProfile = null;
  currentAuthEmail = "";
  selectedSchoolId = "";
  cachedSchools = [];
  cachedStudents = [];
  cachedClasses = [];
  cachedEnrollments = [];
  cachedProfiles = [];
  cachedLessons = [];
  cachedCityLicenses = [];
  attendanceRows = [];
  activeLessonDetailSchoolId = null;
  activeCensusModuleKey = null;
  activeDraftSchoolModuleKey = null;

  $("school-census-module-editor")?.classList.add("hidden");
  $("census-module-editor")?.classList.add("hidden");
  $("sec-lessons-school-detail")?.classList.add("hidden");
  $("notice")?.classList.add("hidden");

  $("app-view")?.classList.add("hidden");
  $("login-view")?.classList.remove("hidden");
  if ($("login-error")) $("login-error").textContent = "";
}

async function validateMunicipalityReleaseForProfile(profile, emailLower) {
  const isOwner = isOwnerEmail(emailLower) || profile?.role === "proprietario";
  if (isOwner) {
    return { ok: true };
  }

  if (profile?.active === false) {
    return {
      ok: false,
      message: "Seu usuário está desativado no sistema. Fale com a Secretaria de Educação."
    };
  }

  if (!profile?.municipality_id) {
    return {
      ok: false,
      message: "Seu perfil não está vinculado a um município liberado. Solicite a liberação do município ao proprietário do programa."
    };
  }

  if (!supabase) {
    return { ok: true };
  }

  const { data: municipality, error } = await supabase
    .from("municipalities")
    .select("id, name, state_uf, active")
    .eq("id", profile.municipality_id)
    .maybeSingle();

  if (error) {
    console.warn("Erro ao verificar liberação do município:", formatSupabaseError(error));
    return {
      ok: false,
      message: "Não foi possível confirmar se o município está liberado no momento."
    };
  }

  if (!municipality || municipality.active !== true) {
    return {
      ok: false,
      message: "Acesso bloqueado: este município ainda não está liberado ou encontra-se suspenso."
    };
  }

  return { ok: true };
}

function showApp(profile, user) {
  currentAuthEmail = String(user?.email || "").trim().toLowerCase();
  const ownerAccess = isOwnerEmail(currentAuthEmail) || profile?.role === "proprietario";

  currentProfile = {
    ...profile,
    role: ownerAccess ? "proprietario" : profile.role
  };
  hydrateUserScopedCache();

  if (isSecretaria() || isProprietario()) {
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
    el.classList.toggle("hidden", !roles.includes(currentProfile.role));
  });

  if (!isSecretaria() && !isProprietario() && !profile.school_id) {
    notice("Seu perfil ainda não possui uma escola vinculada na tabela de perfis. Solicite à Secretaria de Educação o vínculo da unidade.", true);
  }

  if (isProprietario()) {
    go("cidades");
  } else {
    go("inicio");
  }
  loadAll();
}

function go(page) {
  if (isProprietario()) {
    page = "cidades";
  }

  if (page === "cidades" && !isProprietario()) {
    notice("Acesso restrito: apenas o e-mail do proprietário do programa pode gerenciar licenças de cidades.", true);
    page = "inicio";
  }

  if ((page === "matriculas" || page === "turmas") && !canManageClassesAndEnrollments()) {
    notice("Matrículas e Turmas estão disponíveis apenas para Gestor escolar e Secretário escolar vinculados a uma unidade escolar.", true);
    page = "inicio";
  }

  if (page === "diario" && !canAccessDiary()) {
    notice("O Diário de classe está disponível apenas para Gestor escolar, Secretário escolar e Professor vinculados a uma unidade escolar.", true);
    page = "inicio";
  }

  if (page === "censo" && !canAccessCensus()) {
    notice("O Censo Escolar é gerenciado diretamente por Secretário escolar e Gestor escolar na unidade vinculada.", true);
    page = "inicio";
  }

  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("page-" + page)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  $("page-title").textContent = ({
    inicio: "Painel inicial",
    cidades: "Licenciamento de Cidades",
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

  if (page === "cidades" && isProprietario()) {
    loadCityLicenses();
  }
  if (page === "diario" && canAccessDiary()) loadLessons();
  if (page === "usuarios") loadProfiles();
  if (page === "matriz") {
    fillMonitorSubjectSelect();
    renderCurriculum();
    renderMonitors();
  }
  if (page === "censo" && canAccessCensus()) renderCensus();
  if (page === "escolas") renderSchoolFormCensusGrid();
  if (page === "relatorios") {
    if (isSecretaria()) {
      initSecretariaLessonMonitoringControls();
      loadSecretariaLessonsMonitorData();
    }
    renderReportSection();
  }
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
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});

    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error || !data?.user) {
      $("login-error").textContent = isAuth401Error(error)
        ? "Falha de autenticação (401): verifique a chave pública do Supabase em assets/app.js ou o e-mail/senha."
        : "Não foi possível entrar. Confira o e-mail e a senha ou fale com o administrador.";
      return;
    }
    await loadProfile(data.user);
  } catch (err) {
    console.error("Erro no login:", formatSupabaseError(err), err);
    $("login-error").textContent = "Erro ao conectar com o servidor de autenticação. Tente novamente.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

async function loadProfile(user) {
  try {
    const emailLower = String(user?.email || "").trim().toLowerCase();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error && !isOwnerEmail(emailLower)) {
      console.error("Erro ao consultar profiles:", formatSupabaseError(error), error);
      $("login-error").textContent = isAuth401Error(error)
        ? "Erro 401 ao ler perfil: verifique SUPABASE_ANON_KEY em assets/app.js e a sessão do usuário."
        : `Não foi possível ler seu perfil no banco (${error.message || "verifique as políticas RLS de profiles"}).`;
      return;
    }

    if (!data && isOwnerEmail(emailLower)) {
      showApp({
        id: user.id,
        full_name: user.user_metadata?.full_name || "Proprietário do Sistema",
        role: "proprietario",
        municipality_id: null,
        school_id: null,
        active: true
      }, user);
      return;
    }

    if (!data) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      $("login-error").textContent = "Usuário autenticado, mas sem perfil institucional na tabela profiles. Solicite ao administrador a liberação do acesso.";
      return;
    }

    const releaseCheck = await validateMunicipalityReleaseForProfile(data, emailLower);
    if (!releaseCheck.ok) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      resetAppStateOnSignOut();
      $("login-error").textContent = releaseCheck.message;
      return;
    }

    showApp(data, user);
  } catch (err) {
    console.error("Falha inesperada em loadProfile:", formatSupabaseError(err), err);
    $("login-error").textContent = "Erro inesperado ao carregar o perfil institucional.";
  }
}

$("logout")?.addEventListener("click", async () => {
  isSigningOut = true;
  try {
    if (supabase) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
  } finally {
    resetAppStateOnSignOut();
    isSigningOut = false;
  }
});

if (supabase) {
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT") {
      if (!isSigningOut && currentProfile) {
        resetAppStateOnSignOut();
      }
      return;
    }
    if (event === "TOKEN_REFRESHED" && session?.user && currentProfile && session.user.id === currentProfile.id) {
      const check = await validateMunicipalityReleaseForProfile(currentProfile, session.user.email);
      if (!check.ok) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        resetAppStateOnSignOut();
        notice(check.message, true);
      }
    }
  });

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

// --- LICENCIAMENTO DE CIDADES (EXCLUSIVO DO PROPRIETÁRIO DO PROGRAMA) ---
function formatBrDate(isoDate) {
  if (!isoDate) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate).trim());
  if (!match) return String(isoDate);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function getEffectiveLicenseStatus(item) {
  if (!item) return "expirada";
  if (item.status === "suspensa") return "suspensa";
  if (item.expires_at && String(item.expires_at).slice(0, 10) < getTodayIso()) {
    return "expirada";
  }
  return item.status || "ativa";
}

async function syncMunicipalityActiveFlag(item, isActive) {
  if (!supabase || !item) return;
  try {
    const cleanCity = String(item.city_name || "").trim();
    const cleanUf = String(item.state_uf || "").trim().toUpperCase();
    const slug = item.slug || slugifyMunicipality(cleanCity, cleanUf);

    if (item.municipality_id) {
      await supabase
        .from("municipalities")
        .update({ active: Boolean(isActive) })
        .eq("id", item.municipality_id);
      return;
    }

    const { data: existingMun } = await supabase
      .from("municipalities")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingMun?.id) {
      item.municipality_id = existingMun.id;
      await supabase
        .from("municipalities")
        .update({ active: Boolean(isActive) })
        .eq("id", existingMun.id);
    } else if (isActive && cleanCity && cleanUf) {
      const { data: createdMun } = await supabase
        .from("municipalities")
        .insert({
          name: cleanCity,
          state_uf: cleanUf,
          ibge_code: item.ibge_code || null,
          slug,
          active: true
        })
        .select("id")
        .single();
      if (createdMun?.id) {
        item.municipality_id = createdMun.id;
      }
    }
  } catch (err) {
    console.warn("Não foi possível sincronizar tabela municipalities:", formatSupabaseError(err));
  }
}

async function provisionCityAdminAccount(licenseItem, adminPassword) {
  if (!supabase || !licenseItem?.admin_email || !adminPassword) {
    return { provisioned: false, reason: "missing_params" };
  }

  try {
    await callUserFunction({
      action: "provision_city_admin",
      full_name: String(licenseItem.contact_name || "").trim() || `Secretaria de Educação - ${licenseItem.city_name}`,
      email: licenseItem.admin_email,
      password: adminPassword,
      role: "secretaria",
      municipality_id: licenseItem.municipality_id || null,
      city_name: licenseItem.city_name,
      state_uf: licenseItem.state_uf,
      license_id: licenseItem.id
    });
    return { provisioned: true };
  } catch (err) {
    console.warn("Provisionamento automático de conta do município não concluído:", formatSupabaseError(err));
    return { provisioned: false, error: formatSupabaseError(err) };
  }
}

function renderCityLicenses() {
  if (!isProprietario() || !$("cities-body")) return;

  const total = cachedCityLicenses.length;
  let activeCount = 0;
  let inactiveCount = 0;

  const rowsHtml = cachedCityLicenses.map(item => {
    const effectiveStatus = getEffectiveLicenseStatus(item);
    if (effectiveStatus === "ativa") activeCount += 1;
    else inactiveCount += 1;

    let statusBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;background:#dcfce7;color:#15803d;">Ativa</span>`;
    if (effectiveStatus === "suspensa") {
      statusBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;background:#fef3c7;color:#b45309;">Suspensa</span>`;
    } else if (effectiveStatus === "expirada") {
      statusBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;background:#fee2e2;color:#b91c1c;">Expirada</span>`;
    }

    const nextAction = effectiveStatus === "ativa"
      ? `<button type="button" class="secondary small" data-toggle-city-status="${escapeHtml(item.id)}" data-next-status="suspensa">Suspender</button>`
      : `<button type="button" class="secondary small" data-toggle-city-status="${escapeHtml(item.id)}" data-next-status="ativa">Ativar</button>`;

    const cityLabel = `${item.city_name} - ${item.state_uf}`;
    const ibgeSub = item.ibge_code ? `<br><small class="muted small">IBGE: ${escapeHtml(item.ibge_code)}</small>` : "";

    return `<tr>
      <td><strong>${escapeHtml(cityLabel)}</strong>${ibgeSub}</td>
      <td>${escapeHtml(item.cnpj || "—")}</td>
      <td>${escapeHtml(item.admin_email || "—")}</td>
      <td>${formatCount(item.max_schools || 0)}</td>
      <td>${escapeHtml(formatBrDate(item.expires_at))}</td>
      <td>${statusBadge}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        ${nextAction}
        <button type="button" class="secondary small" data-renew-city="${escapeHtml(item.id)}">+1 Ano</button>
        <button type="button" class="secondary small" data-delete-city="${escapeHtml(item.id)}" data-city-name="${escapeHtml(cityLabel)}">Excluir</button>
      </td>
    </tr>`;
  }).join("");

  if ($("cities-total-count")) $("cities-total-count").textContent = formatCount(total);
  if ($("cities-active-count")) $("cities-active-count").textContent = formatCount(activeCount);
  if ($("cities-inactive-count")) $("cities-inactive-count").textContent = formatCount(inactiveCount);

  $("cities-body").innerHTML = rowsHtml || '<tr><td colspan="7">Nenhuma cidade licenciada cadastrada ainda.</td></tr>';
}

async function loadCityLicenses() {
  if (!isProprietario()) return;
  cachedCityLicenses = loadLocalJson(CITY_LICENSES_STORAGE_KEY, []);

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("city_licenses")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!error && Array.isArray(data) && data.length) {
        cachedCityLicenses = data;
        saveLocalJson(CITY_LICENSES_STORAGE_KEY, cachedCityLicenses);
      }
    } catch (err) {
      console.warn("Tabela city_licenses ainda não disponível no Supabase:", formatSupabaseError(err));
    }

    try {
      const { data: munRows, error: munErr } = await supabase
        .from("municipalities")
        .select("id, name, state_uf, ibge_code, slug, active, created_at")
        .order("name", { ascending: true });
      if (!munErr && Array.isArray(munRows)) {
        const bySlug = new Map(cachedCityLicenses.map(c => [c.slug || slugifyMunicipality(c.city_name, c.state_uf), c]));
        for (const m of munRows) {
          const existing = bySlug.get(m.slug);
          if (existing) {
            existing.municipality_id = m.id;
            existing.slug = m.slug;
            if (!m.active && existing.status === "ativa") {
              existing.status = "suspensa";
            }
          } else {
            bySlug.set(m.slug, {
              id: `mun-${m.id}`,
              municipality_id: m.id,
              city_name: m.name,
              state_uf: m.state_uf,
              ibge_code: m.ibge_code || null,
              slug: m.slug,
              cnpj: null,
              admin_email: "—",
              max_schools: 50,
              expires_at: null,
              status: m.active ? "ativa" : "suspensa",
              created_at: m.created_at || new Date().toISOString()
            });
          }
        }
        cachedCityLicenses = Array.from(bySlug.values());
        saveLocalJson(CITY_LICENSES_STORAGE_KEY, cachedCityLicenses);
      }
    } catch (err) {
      console.warn("Não foi possível mesclar municipalities:", formatSupabaseError(err));
    }
  }

  renderCityLicenses();
}

$("city-license-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!isProprietario()) {
    notice("Acesso negado: apenas o proprietário do programa pode cadastrar licenças de cidades.", true);
    return;
  }

  const raw = formObject(e.target);
  const cityName = String(raw.city_name || "").trim();
  const stateUf = String(raw.state_uf || "").trim().toUpperCase();
  const adminEmail = String(raw.admin_email || "").trim().toLowerCase();
  const adminPassword = String(raw.admin_password || "");

  if (!cityName || !stateUf || !adminEmail) {
    notice("Preencha o município, estado (UF) e e-mail do administrador da cidade.", true);
    return;
  }

  if (adminPassword.length < 6) {
    notice("Defina uma senha para login com no mínimo 6 caracteres.", true);
    return;
  }

  const licenseStatus = raw.status || "ativa";
  const isActiveMunicipality = licenseStatus === "ativa" && (!raw.expires_at || String(raw.expires_at).slice(0, 10) >= getTodayIso());

  const newLicense = {
    id: `lic-${Date.now()}`,
    city_name: cityName,
    state_uf: stateUf,
    ibge_code: String(raw.ibge_code || "").replace(/\D/g, "") || null,
    slug: slugifyMunicipality(cityName, stateUf),
    cnpj: String(raw.cnpj || "").trim() || null,
    admin_email: adminEmail,
    contact_name: String(raw.contact_name || "").trim() || null,
    contact_phone: String(raw.contact_phone || "").trim() || null,
    max_schools: Number(raw.max_schools) || 50,
    expires_at: raw.expires_at,
    status: licenseStatus,
    notes: String(raw.notes || "").trim() || null,
    owner_email: currentAuthEmail,
    created_at: new Date().toISOString()
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (supabase) {
      const dbPayload = {
        city_name: newLicense.city_name,
        state_uf: newLicense.state_uf,
        ibge_code: newLicense.ibge_code,
        cnpj: newLicense.cnpj,
        admin_email: newLicense.admin_email,
        contact_name: newLicense.contact_name,
        contact_phone: newLicense.contact_phone,
        max_schools: newLicense.max_schools,
        expires_at: newLicense.expires_at,
        status: newLicense.status,
        notes: newLicense.notes,
        created_by: currentProfile?.id || null
      };
      const { data, error } = await supabase
        .from("city_licenses")
        .insert(dbPayload)
        .select()
        .single();
      if (!error && data) {
        newLicense.id = data.id;
      } else if (error) {
        console.warn("Não foi possível gravar na tabela city_licenses:", formatSupabaseError(error));
      }

      await syncMunicipalityActiveFlag(newLicense, isActiveMunicipality);
    }

    const accountResult = await provisionCityAdminAccount(newLicense, adminPassword);

    cachedCityLicenses = [newLicense, ...cachedCityLicenses];
    saveLocalJson(CITY_LICENSES_STORAGE_KEY, cachedCityLicenses);
    e.target.reset();
    if (e.target.elements["max_schools"]) e.target.elements["max_schools"].value = "50";
    if (e.target.elements["status"]) e.target.elements["status"].value = "ativa";
    renderCityLicenses();

    if (accountResult.provisioned) {
      notice(`Licença liberada para ${cityName} - ${stateUf} e acesso de login criado/atualizado para ${adminEmail}.`);
    } else {
      notice(
        `Licença registrada para ${cityName} - ${stateUf} com senha informada para ${adminEmail}. Se o login ainda não existir no Supabase Auth, configure/ative o suporte no backend do Supabase.`,
        false
      );
    }
  } catch (err) {
    console.error("Erro ao cadastrar licença da cidade:", formatSupabaseError(err), err);
    notice(`Não foi possível salvar a licença (${formatSupabaseError(err)}).`, true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

$("cities-body")?.addEventListener("click", async e => {
  if (!isProprietario()) return;

  const toggleBtn = e.target.closest("[data-toggle-city-status]");
  if (toggleBtn) {
    const id = toggleBtn.dataset.toggleCityStatus;
    const nextStatus = toggleBtn.dataset.nextStatus;
    const target = cachedCityLicenses.find(c => c.id === id);
    if (!target) return;

    toggleBtn.disabled = true;
    try {
      if (supabase && !String(id).startsWith("lic-") && !String(id).startsWith("mun-")) {
        const { error } = await supabase
          .from("city_licenses")
          .update({ status: nextStatus })
          .eq("id", id);
        if (error) console.warn("Falha ao atualizar status no Supabase:", formatSupabaseError(error));
      }
      target.status = nextStatus;
      await syncMunicipalityActiveFlag(target, nextStatus === "ativa");
      saveLocalJson(CITY_LICENSES_STORAGE_KEY, cachedCityLicenses);
      renderCityLicenses();
      notice(`Status da licença de ${target.city_name} alterado para "${nextStatus}".`);
    } finally {
      toggleBtn.disabled = false;
    }
    return;
  }

  const renewBtn = e.target.closest("[data-renew-city]");
  if (renewBtn) {
    const id = renewBtn.dataset.renewCity;
    const target = cachedCityLicenses.find(c => c.id === id);
    if (!target) return;

    const currentToday = getTodayIso();
    const baseDateStr = target.expires_at && String(target.expires_at).slice(0, 10) > currentToday
      ? String(target.expires_at).slice(0, 10)
      : currentToday;
    const baseDate = new Date(`${baseDateStr}T12:00:00Z`);
    baseDate.setUTCFullYear(baseDate.getUTCFullYear() + 1);
    const nextExpires = baseDate.toISOString().slice(0, 10);

    renewBtn.disabled = true;
    try {
      if (supabase && !String(id).startsWith("lic-") && !String(id).startsWith("mun-")) {
        const { error } = await supabase
          .from("city_licenses")
          .update({ expires_at: nextExpires, status: "ativa" })
          .eq("id", id);
        if (error) console.warn("Falha ao renovar licença no Supabase:", formatSupabaseError(error));
      }
      target.expires_at = nextExpires;
      target.status = "ativa";
      await syncMunicipalityActiveFlag(target, true);
      saveLocalJson(CITY_LICENSES_STORAGE_KEY, cachedCityLicenses);
      renderCityLicenses();
      notice(`Licença de ${target.city_name} renovada até ${formatBrDate(nextExpires)}.`);
    } finally {
      renewBtn.disabled = false;
    }
    return;
  }

  const delBtn = e.target.closest("[data-delete-city]");
  if (delBtn) {
    const id = delBtn.dataset.deleteCity;
    const cityName = delBtn.dataset.cityName;
    if (!window.confirm(`Deseja realmente remover a licença de "${cityName}"?`)) return;

    delBtn.disabled = true;
    try {
      const target = cachedCityLicenses.find(c => c.id === id);
      if (supabase && !String(id).startsWith("lic-") && !String(id).startsWith("mun-")) {
        const { error } = await supabase
          .from("city_licenses")
          .delete()
          .eq("id", id);
        if (error) console.warn("Falha ao excluir licença no Supabase:", formatSupabaseError(error));
      }
      if (target) {
        await syncMunicipalityActiveFlag(target, false);
      }
      cachedCityLicenses = cachedCityLicenses.filter(c => c.id !== id);
      saveLocalJson(CITY_LICENSES_STORAGE_KEY, cachedCityLicenses);
      renderCityLicenses();
      notice(`Licença de "${cityName}" removida e acesso do município suspenso.`);
    } finally {
      delBtn.disabled = false;
    }
  }
});

// --- DIRECIONAMENTO POR NOME DA ESCOLA, ID OU CÓDIGO INEP (SECRETARIA) ---
function formatSchoolOption(school) {
  const idPart = school.school_code ? `ID ${school.school_code}` : "";
  const inepPart = school.inep_code ? `INEP ${school.inep_code}` : "";
  const meta = [idPart, inepPart].filter(Boolean).join(" · ");
  return meta ? `${school.name} (${meta})` : school.name;
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
    String(s.school_code || "").trim().toLowerCase() === clean ||
    String(s.inep_code || "").trim().toLowerCase() === clean
  );
  if (match) return match;

  const partials = cachedSchools.filter(s =>
    String(s.name || "").toLowerCase().includes(clean) ||
    String(s.school_code || "").toLowerCase().includes(clean) ||
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
    notice(`Direcionado para a unidade: ${school.name}${school.school_code ? ` · ID ${school.school_code}` : ""}${school.inep_code ? ` · INEP ${school.inep_code}` : ""}.`);
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
    notice("Nenhuma escola única encontrada com esse nome, ID ou código INEP. Selecione uma opção da lista.", true);
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

function getActiveStudentCountForClass(classId) {
  const activeStudentIds = new Set(
    cachedEnrollments
      .filter(e => e.class_id === classId && e.status === "ativa" && e.student_id)
      .map(e => e.student_id)
  );
  return activeStudentIds.size;
}

function computeSecretariaGeneralReport() {
  const registeredSchoolIds = new Set(cachedSchools.map(s => s.id).filter(Boolean));
  const studentsInRegisteredSchools = cachedStudents.filter(
    s => s.school_id && registeredSchoolIds.has(s.school_id)
  );

  const matriculadosCount = studentsInRegisteredSchools.length;
  const totalEscolasCount = cachedSchools.length;

  const educationRoles = new Set(["professor", "monitor_complementar", "gestor", "secretario_escolar"]);
  const profissionaisCount = cachedProfiles.filter(p =>
    p.school_id &&
    registeredSchoolIds.has(p.school_id) &&
    educationRoles.has(p.role)
  ).length;

  const uniqueStudentKeys = new Set(
    studentsInRegisteredSchools.map((s, idx) => {
      const cpfDigits = normalizeCpf(s.cpf);
      return cpfDigits || s.id || `stu-${idx}`;
    })
  );
  const alunosUnicosCount = uniqueStudentKeys.size;

  const aeeClassIds = new Set(
    cachedClasses
      .filter(c => c.school_id && registeredSchoolIds.has(c.school_id) && isAeeClass(c))
      .map(c => c.id)
  );
  const specialEnrollmentStudentIds = new Set();

  for (const en of cachedEnrollments) {
    if (en.class_id && aeeClassIds.has(en.class_id) && en.student_id && en.status !== "cancelada") {
      specialEnrollmentStudentIds.add(en.student_id);
    }
  }
  for (const stu of studentsInRegisteredSchools) {
    if (stu.aee_class_id && aeeClassIds.has(stu.aee_class_id) && stu.id) {
      specialEnrollmentStudentIds.add(stu.id);
    }
  }
  const matriculasEspeciaisCount = specialEnrollmentStudentIds.size;

  const schoolClassIds = new Set(
    cachedClasses
      .filter(c => c.school_id && registeredSchoolIds.has(c.school_id))
      .map(c => c.id)
  );
  const studentSchoolMap = new Map(studentsInRegisteredSchools.map(s => [s.id, s.school_id]));
  const mudancasMatriculaCount = cachedEnrollments.filter(en => {
    const inSchool =
      (en.class_id && schoolClassIds.has(en.class_id)) ||
      (en.student_id && studentSchoolMap.has(en.student_id));
    return inSchool && ["transferida", "cancelada"].includes(String(en.status || "").toLowerCase());
  }).length;

  return {
    matriculados: matriculadosCount,
    totalEscolas: totalEscolasCount,
    profissionais: profissionaisCount,
    alunosUnicos: alunosUnicosCount,
    matriculasEspeciais: matriculasEspeciaisCount,
    mudancasMatricula: mudancasMatriculaCount
  };
}

// --- ANÁLISE DE DADOS — REGISTROS DE AULAS (APENAS PERFIL SECRETARIA) ---
function parseLessonDateToMs(dateStr) {
  if (!dateStr) return null;
  const clean = String(dateStr).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  if (isoMatch) {
    return Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }
  const parsed = Date.parse(clean);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatBrDateFromMs(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getDaysSinceMs(ms) {
  if (!ms) return null;
  const now = new Date();
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.floor((todayUtcMs - ms) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

function initSecretariaLessonMonitoringControls() {
  if (!isSecretaria()) return;
  const yearSelect = $("sec-lessons-year");
  const schoolSelect = $("sec-lessons-school");

  if (yearSelect) {
    const currentYear = new Date().getFullYear();
    const yearsSet = new Set([currentYear, currentYear - 1, 2026]);
    for (const c of cachedClasses) {
      if (c.school_year) yearsSet.add(Number(c.school_year));
    }
    for (const l of cachedLessons) {
      const ms = parseLessonDateToMs(l.lesson_date);
      if (ms) yearsSet.add(new Date(ms).getUTCFullYear());
    }
    const years = Array.from(yearsSet).filter(Boolean).sort((a, b) => b - a);
    const prevYear = yearSelect.value;
    yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
    if (prevYear && years.includes(Number(prevYear))) {
      yearSelect.value = prevYear;
    } else if (years.includes(currentYear)) {
      yearSelect.value = String(currentYear);
    } else if (years.includes(2026)) {
      yearSelect.value = "2026";
    }
  }

  if (schoolSelect) {
    const prevSchool = schoolSelect.value;
    const sortedSchools = [...cachedSchools].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
    );
    schoolSelect.innerHTML =
      `<option value="">— Todas as escolas —</option>` +
      sortedSchools.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
    if (prevSchool && sortedSchools.some(s => s.id === prevSchool)) {
      schoolSelect.value = prevSchool;
    } else if (selectedSchoolId && sortedSchools.some(s => s.id === selectedSchoolId)) {
      schoolSelect.value = selectedSchoolId;
    }
  }
}

async function loadSecretariaLessonsMonitorData() {
  if (!isSecretaria() || !supabase) return;
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("id,class_id,lesson_date,subject,content,classes(id,name,school_id,school_year,grade_level,shift)")
      .order("lesson_date", { ascending: false })
      .limit(1000);
    if (error) throw error;
    cachedLessons = data || [];
  } catch (err) {
    console.warn("Não foi possível carregar registros de aulas para monitoramento:", formatSupabaseError(err));
  }
  renderSecretariaLessonsMonitor();
}

function buildSecretariaLessonMetrics() {
  const selectedYear = Number($("sec-lessons-year")?.value) || new Date().getFullYear();
  const selectedSchool = $("sec-lessons-school")?.value || "";

  const classMap = new Map(cachedClasses.map(c => [c.id, c]));

  const targetSchools = selectedSchool
    ? cachedSchools.filter(s => s.id === selectedSchool)
    : cachedSchools;

  const targetSchoolIds = new Set(targetSchools.map(s => s.id));

  const yearClasses = cachedClasses.filter(c => {
    const yearMatches = !c.school_year || Number(c.school_year) === selectedYear;
    const schoolMatches = c.school_id && targetSchoolIds.has(c.school_id);
    return yearMatches && schoolMatches;
  });

  const classStatsMap = new Map();
  for (const cls of yearClasses) {
    classStatsMap.set(cls.id, {
      classItem: cls,
      count: 0,
      lastMs: null
    });
  }

  for (const lesson of cachedLessons) {
    const ms = parseLessonDateToMs(lesson.lesson_date);
    if (!ms) continue;
    const lessonYear = new Date(ms).getUTCFullYear();
    if (lessonYear !== selectedYear) continue;

    const cls = classMap.get(lesson.class_id) || lesson.classes;
    const schoolId = cls?.school_id;
    if (!schoolId || !targetSchoolIds.has(schoolId)) continue;

    if (lesson.class_id && classStatsMap.has(lesson.class_id)) {
      const st = classStatsMap.get(lesson.class_id);
      st.count += 1;
      if (!st.lastMs || ms > st.lastMs) st.lastMs = ms;
    }
  }

  const schoolRows = targetSchools.map(school => {
    const sClasses = yearClasses.filter(c => c.school_id === school.id);
    const schoolLessons = cachedLessons.filter(l => {
      const ms = parseLessonDateToMs(l.lesson_date);
      if (!ms || new Date(ms).getUTCFullYear() !== selectedYear) return false;
      const cls = classMap.get(l.class_id) || l.classes;
      return cls?.school_id === school.id;
    });

    const recordCount = schoolLessons.length;
    let lastMs = null;
    for (const l of schoolLessons) {
      const ms = parseLessonDateToMs(l.lesson_date);
      if (ms && (!lastMs || ms > lastMs)) lastMs = ms;
    }

    const daysWithoutLaunch = lastMs ? getDaysSinceMs(lastMs) : null;
    const hasRecord = recordCount > 0;

    return {
      school,
      classesCount: sClasses.length,
      recordCount,
      lastMs,
      lastDateLabel: lastMs ? formatBrDateFromMs(lastMs) : "—",
      daysWithoutLaunch,
      hasRecord
    };
  }).sort((a, b) => String(a.school.name || "").localeCompare(String(b.school.name || ""), "pt-BR"));

  const totalClassesCount = yearClasses.length;
  const schoolsWithRecordCount = schoolRows.filter(r => r.hasRecord).length;
  const schoolsWithoutRecordCount = schoolRows.filter(r => !r.hasRecord).length;

  const rowsWithDays = schoolRows.filter(r => typeof r.daysWithoutLaunch === "number");
  const avgDaysWithoutLaunch = rowsWithDays.length
    ? Math.round(rowsWithDays.reduce((acc, r) => acc + r.daysWithoutLaunch, 0) / rowsWithDays.length)
    : 0;

  return {
    selectedYear,
    selectedSchool,
    targetSchools,
    yearClasses,
    classStatsMap,
    schoolRows,
    totalClassesCount,
    schoolsWithRecordCount,
    schoolsWithoutRecordCount,
    avgDaysWithoutLaunch
  };
}

function renderSecretariaSchoolLessonDetail(metrics) {
  const detailBox = $("sec-lessons-school-detail");
  if (!detailBox) return;

  if (!activeLessonDetailSchoolId) {
    detailBox.classList.add("hidden");
    return;
  }

  const school = cachedSchools.find(s => s.id === activeLessonDetailSchoolId);
  if (!school) {
    activeLessonDetailSchoolId = null;
    detailBox.classList.add("hidden");
    return;
  }

  const schoolClasses = metrics.yearClasses.filter(c => c.school_id === school.id);
  detailBox.classList.remove("hidden");
  if ($("sec-lessons-detail-title")) {
    $("sec-lessons-detail-title").textContent = `Turmas — ${school.name}`;
  }
  if ($("sec-lessons-detail-subtitle")) {
    $("sec-lessons-detail-subtitle").textContent = `Ano letivo ${metrics.selectedYear} · ${schoolClasses.length} turma(s)`;
  }

  if ($("sec-lessons-detail-body")) {
    $("sec-lessons-detail-body").innerHTML = schoolClasses.map(cls => {
      const st = metrics.classStatsMap.get(cls.id) || { count: 0, lastMs: null };
      const days = st.lastMs ? getDaysSinceMs(st.lastMs) : null;
      const etapaTurno = [cls.grade_level, cls.shift].filter(Boolean).join(" · ") || "—";
      return `<tr>
        <td><strong>${escapeHtml(cls.name || "—")}</strong></td>
        <td>${escapeHtml(etapaTurno)}</td>
        <td>${formatCount(st.count)}</td>
        <td>${st.lastMs ? formatBrDateFromMs(st.lastMs) : "—"}</td>
        <td>${typeof days === "number" ? `${days}d` : "—"}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="5">Nenhuma turma cadastrada para esta escola no ano selecionado.</td></tr>';
  }
}

function renderSecretariaLessonsMonitor() {
  if (!isSecretaria() || !$("sec-lessons-body")) return;
  initSecretariaLessonMonitoringControls();

  const metrics = buildSecretariaLessonMetrics();

  if ($("sec-lessons-kpi-classes")) {
    $("sec-lessons-kpi-classes").textContent = formatCount(metrics.totalClassesCount);
  }
  if ($("sec-lessons-kpi-schools")) {
    $("sec-lessons-kpi-schools").textContent = `${formatCount(metrics.targetSchools.length)} escola(s)`;
  }
  if ($("sec-lessons-kpi-with")) {
    $("sec-lessons-kpi-with").textContent = formatCount(metrics.schoolsWithRecordCount);
  }
  if ($("sec-lessons-kpi-without")) {
    $("sec-lessons-kpi-without").textContent = formatCount(metrics.schoolsWithoutRecordCount);
  }
  if ($("sec-lessons-kpi-avg-days")) {
    $("sec-lessons-kpi-avg-days").textContent = `${metrics.avgDaysWithoutLaunch}d`;
  }

  $("sec-lessons-body").innerHTML = metrics.schoolRows.map(row => {
    const familyBadges = [
      `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700;background:#0284c7;color:#ffffff;">DOCR</span>`
    ];
    if (!row.hasRecord) {
      familyBadges.push(
        `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700;background:#dc2626;color:#ffffff;margin-left:4px;">Sem Reg.</span>`
      );
    }

    let daysBadge = `<span class="muted small">—</span>`;
    if (typeof row.daysWithoutLaunch === "number") {
      const isLate = row.daysWithoutLaunch >= 7;
      const bg = isLate ? "#fef3c7" : "#dcfce7";
      const fg = isLate ? "#b45309" : "#15803d";
      daysBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;background:${bg};color:${fg};">${row.daysWithoutLaunch}d</span>`;
    }

    return `<tr>
      <td><strong>${escapeHtml(row.school.name)}</strong></td>
      <td>${familyBadges.join("")}</td>
      <td><span style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;font-size:0.78rem;font-weight:700;background:#2563eb;color:#ffffff;">${formatCount(row.classesCount)}</span></td>
      <td><strong>${formatCount(row.recordCount)}</strong></td>
      <td>${escapeHtml(row.lastDateLabel)}</td>
      <td>${daysBadge}</td>
      <td><button type="button" class="secondary small" data-view-school-classes="${escapeHtml(row.school.id)}">Ver Turmas</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="7">Nenhuma escola encontrada para o filtro selecionado.</td></tr>';

  if ($("sec-lessons-summary")) {
    $("sec-lessons-summary").textContent =
      `${formatCount(metrics.schoolRows.length)} de ${formatCount(cachedSchools.length)} escola(s) — ${metrics.selectedYear}`;
  }

  renderSecretariaSchoolLessonDetail(metrics);
}

$("sec-lessons-year")?.addEventListener("change", () => {
  if (!isSecretaria()) return;
  renderSecretariaLessonsMonitor();
});

$("sec-lessons-school")?.addEventListener("change", () => {
  if (!isSecretaria()) return;
  activeLessonDetailSchoolId = null;
  renderSecretariaLessonsMonitor();
});

$("sec-lessons-refresh")?.addEventListener("click", async () => {
  if (!isSecretaria()) return;
  await loadSecretariaLessonsMonitorData();
  notice("Monitoramento de registros de aulas atualizado.");
});

$("sec-lessons-print")?.addEventListener("click", () => {
  if (!isSecretaria()) return;
  window.print();
});

$("sec-lessons-body")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-view-school-classes]");
  if (!btn || !isSecretaria()) return;
  activeLessonDetailSchoolId = btn.dataset.viewSchoolClasses;
  renderSecretariaSchoolLessonDetail(buildSecretariaLessonMetrics());
});

$("sec-lessons-close-detail")?.addEventListener("click", () => {
  activeLessonDetailSchoolId = null;
  renderSecretariaSchoolLessonDetail(buildSecretariaLessonMetrics());
});

function renderReportSection() {
  const secView = $("secretaria-report-view");
  const stdView = $("standard-report-view");
  const subtitle = $("report-subtitle");

  if (isSecretaria()) {
    secView?.classList.remove("hidden");
    stdView?.classList.add("hidden");
    if (subtitle) {
      subtitle.textContent = "Números gerais e monitoramento de registros de aulas de todas as escolas cadastradas na rede municipal.";
    }
    if ($("secretaria-report-year")) {
      $("secretaria-report-year").textContent = `Ano de referência: ${new Date().getFullYear()}`;
    }

    const metrics = computeSecretariaGeneralReport();
    if ($("sec-report-matriculados")) $("sec-report-matriculados").textContent = formatCount(metrics.matriculados);
    if ($("sec-report-escolas")) $("sec-report-escolas").textContent = formatCount(metrics.totalEscolas);
    if ($("sec-report-profissionais")) $("sec-report-profissionais").textContent = formatCount(metrics.profissionais);
    if ($("sec-report-alunos-unicos")) $("sec-report-alunos-unicos").textContent = formatCount(metrics.alunosUnicos);
    if ($("sec-report-matriculas-especiais")) $("sec-report-matriculas-especiais").textContent = formatCount(metrics.matriculasEspeciais);
    if ($("sec-report-mudancas-matricula")) $("sec-report-mudancas-matricula").textContent = formatCount(metrics.mudancasMatricula);

    renderSecretariaLessonsMonitor();
  } else {
    secView?.classList.add("hidden");
    stdView?.classList.remove("hidden");
    if (subtitle) {
      subtitle.textContent = "Resumo dos registros aos quais seu perfil tem acesso.";
    }
  }
}

function applySchoolScope() {
  updateRoleLabel();
  updateHomeSchoolCard();
  const scopedSchools = getScopedSchools();
  const scopedStudents = getScopedStudents();
  const scopedClasses = getScopedClasses();
  const scopedEnrollments = getScopedEnrollments();

  const activeEnrollments = scopedEnrollments.filter(e => e.status === "ativa");
  const activeStudentIds = new Set(
    activeEnrollments.filter(e => e.student_id).map(e => e.student_id)
  );
  const activeStudentsCount = activeStudentIds.size;

  const classById = new Map(cachedClasses.map(c => [c.id, c]));
  const aeeActiveStudentIds = new Set(
    activeEnrollments
      .filter(e => e.student_id && isAeeClass(classById.get(e.class_id)))
      .map(e => e.student_id)
  );
  const aeeEnrolledCount = aeeActiveStudentIds.size;

  const pcdStudentsCount = scopedStudents.filter(s => isPcdStudent(s)).length;

  if ($("stat-escolas")) $("stat-escolas").textContent = scopedSchools.length;
  if ($("stat-alunos")) $("stat-alunos").textContent = scopedStudents.length;
  if ($("stat-turmas")) $("stat-turmas").textContent = scopedClasses.length;
  if ($("stat-matriculas")) $("stat-matriculas").textContent = activeStudentsCount;
  if ($("stat-aee")) $("stat-aee").textContent = aeeEnrolledCount;
  if ($("stat-pcd")) $("stat-pcd").textContent = pcdStudentsCount;

  if ($("enrollments-aee-count")) $("enrollments-aee-count").textContent = aeeEnrolledCount;
  if ($("enrollments-pcd-count")) $("enrollments-pcd-count").textContent = pcdStudentsCount;
  if ($("enrollments-active-count")) $("enrollments-active-count").textContent = activeStudentsCount;

  if ($("report-students")) $("report-students").textContent = scopedStudents.length;
  if ($("report-classes")) $("report-classes").textContent = scopedClasses.length;
  if ($("report-enrollments")) $("report-enrollments").textContent = activeStudentsCount;
  if ($("report-aee")) $("report-aee").textContent = aeeEnrolledCount;
  if ($("report-pcd")) $("report-pcd").textContent = pcdStudentsCount;

  renderReportSection();
  renderSchools(scopedSchools);
  renderStudents(scopedStudents);
  if (canManageClassesAndEnrollments()) {
    renderClasses(scopedClasses);
    renderEnrollments(scopedEnrollments);
  }
  fillSelects(scopedStudents, scopedClasses);
  renderUsers();
  renderMonitors();
  if (canAccessCensus()) renderCensus();
  if (canAccessDiary()) loadLessons();
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
  if (!$("users-body") && !isSecretaria()) return;
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
    if (canManageClassesAndEnrollments()) {
      renderClasses(getScopedClasses());
    }
    if (isSecretaria()) {
      renderReportSection();
    }
  } catch (e) {
    console.warn("Não foi possível carregar perfis:", formatSupabaseError(e), e);
    fillSelect("class-teacher", [], x => x.full_name, "Não definido");
    if ($("users-body")) {
      $("users-body").innerHTML = '<tr><td colspan="5">Não foi possível carregar os usuários. Verifique as permissões da tabela profiles.</td></tr>';
    }
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
  if (!currentProfile) return;

  if (isProprietario()) {
    await loadCityLicenses();
    return;
  }

  const releaseCheck = await validateMunicipalityReleaseForProfile(currentProfile, currentAuthEmail);
  if (!releaseCheck.ok) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    resetAppStateOnSignOut();
    notice(releaseCheck.message, true);
    return;
  }

  try {
    const queries = [
      fetchRows("schools"),
      fetchRows("students", "*, schools(name)"),
      fetchRows("classes", "*, schools(name)"),
      fetchRows("enrollments", "*, students(full_name, is_pcd), classes(name, aee_service, modality)")
    ];
    if (isSecretaria()) {
      queries.push(
        supabase
          .from("lessons")
          .select("id,class_id,lesson_date,subject,content,classes(id,name,school_id,school_year,grade_level,shift)")
          .order("lesson_date", { ascending: false })
          .limit(1000)
          .then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          })
      );
    }

    const [schools, students, classes, enrollments, secretariaLessons = []] = await Promise.all(queries);
    cachedSchools = schools;
    cachedStudents = students;
    cachedClasses = classes;
    cachedEnrollments = enrollments;
    if (isSecretaria()) {
      cachedLessons = secretariaLessons;
    }

    if (supabase && canAccessCensus()) {
      try {
        const remoteCensus = await fetchRows("school_census_mappings");
        if (Array.isArray(remoteCensus) && remoteCensus.length) {
          const mergedMap = new Map(cachedCensus.map(item => [item.id, item]));
          for (const rc of remoteCensus) {
            const localId = `censo-${rc.school_id}-${rc.census_year}`;
            const prevLocal = mergedMap.get(localId);
            mergedMap.set(localId, {
              id: localId,
              school_id: rc.school_id,
              school_name: cachedSchools.find(s => s.id === rc.school_id)?.name || prevLocal?.school_name || "—",
              census_year: rc.census_year,
              operating_status: rc.operating_status || "Em atividade",
              offered_stages: rc.offered_stages || "",
              infrastructure_notes: rc.infrastructure_notes || "",
              validation_status: rc.validation_status || "Pendente",
              modules: (rc.modules_data && Object.keys(rc.modules_data).length) ? rc.modules_data : (prevLocal?.modules || {})
            });
          }
          cachedCensus = Array.from(mergedMap.values());
          saveLocalJson(getScopedStorageKey(CENSUS_STORAGE_KEY), cachedCensus);
        }
      } catch (e) {
        console.warn("Tabela school_census_mappings não lida remotamente:", formatSupabaseError(e));
      }
    }

    updateSecretariaSchoolDatalist();
    await loadProfiles();
    applySchoolScope();
  } catch (e) {
    const detail = formatSupabaseError(e);
    console.error("Erro em loadAll:", detail, e);
    if (isAuth401Error(e)) {
      notice("Erro de autenticação (HTTP 401) ao consultar o Supabase. Confira a chave pública (SUPABASE_ANON_KEY) em assets/app.js e faça login novamente.", true);
    } else {
      notice(`Não foi possível carregar os dados (${detail}).`, true);
    }
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
  const codePrefix = c.class_code ? `[${c.class_code}] ` : "";
  const comp = c.class_complement ? ` (${c.class_complement})` : "";
  const tipo = isAeeClass(c) ? " · AEE" : " · Regular";
  return `${codePrefix}${c.name}${comp} — ${c.grade_level}${tipo}`;
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
  fillSelect("enrollment-student", scopedStudents, x => `${x.full_name}${isPcdStudent(x) ? " (PcD)" : ""}`);
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

// --- ESCOLAS (SALVAMENTO POR BLOCO TEMÁTICO ATÉ CADASTRAR A UNIDADE) ---
function hasModuleData(modObj) {
  if (!modObj || typeof modObj !== "object") return false;
  return Object.values(modObj).some(v => String(v || "").trim().length > 0);
}

function countSavedDraftModules() {
  return CENSUS_MODULES.filter(mod => hasModuleData(draftSchoolCensusModules[mod.key])).length;
}

function updateDraftStatusSummary() {
  const statusEl = $("school-census-draft-status");
  if (!statusEl) return;
  const savedCount = countSavedDraftModules();
  const schoolName = String(draftSchoolCensusModules.identificacao_escola?.nome_escola || "").trim();
  const namePart = schoolName ? ` · Escola: "${schoolName}"` : "";
  statusEl.textContent = `${savedCount} de ${CENSUS_MODULES.length} blocos salvos no rascunho${namePart}. Clique em "Cadastrar escola" para gravar na unidade.`;
}

function renderSchoolFormCensusGrid() {
  const grid = $("school-census-modules-grid");
  if (!grid) return;

  updateDraftStatusSummary();

  grid.innerHTML = CENSUS_MODULES.map(mod => {
    const saved = draftSchoolCensusModules[mod.key] || {};
    const hasData = hasModuleData(saved);
    const isActive = activeDraftSchoolModuleKey === mod.key;
    return `<button
      type="button"
      data-draft-census-module="${escapeHtml(mod.key)}"
      style="background:${isActive ? "#d3e8ca" : (hasData ? "#dcefd4" : "#e3f1dc")};color:#2c3e28;border:${isActive ? "2px solid #4c833c" : (hasData ? "1px solid #6fa15e" : "1px solid #c9dfbe")};border-radius:8px;padding:12px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;text-align:center;">
      <span style="font-size:1.15rem;line-height:1;">${escapeHtml(mod.icon)}</span>
      <strong style="font-size:0.82rem;font-weight:600;">${escapeHtml(mod.label)}</strong>
      <span style="font-size:0.72rem;font-weight:${hasData ? "600" : "400"};color:${hasData ? "#255e1e" : "#5c6b58"};">${hasData ? "Salvo no rascunho" : "Disponível"}</span>
    </button>`;
  }).join("");
}

function saveCurrentDraftModuleFromEditor(showFeedback = false) {
  if (!activeDraftSchoolModuleKey) return null;
  const modKey = activeDraftSchoolModuleKey;
  const modValues = {};
  document.querySelectorAll("#school-census-module-fields [data-draft-census-field]").forEach(el => {
    modValues[el.dataset.draftCensusField] = String(el.value || "").trim();
  });

  draftSchoolCensusModules = {
    ...draftSchoolCensusModules,
    [modKey]: modValues
  };
  saveLocalJson(getScopedStorageKey(SCHOOL_DRAFT_CENSUS_KEY), draftSchoolCensusModules);
  renderSchoolFormCensusGrid();

  if (showFeedback) {
    const label = CENSUS_MODULES.find(m => m.key === modKey)?.label || "Bloco";
    notice(`Bloco "${label}" salvo! As informações permanecerão gravadas até você clicar em "Cadastrar escola".`);
  }
  return modValues;
}

function openSchoolFormCensusModule(modKey) {
  const mod = CENSUS_MODULES.find(m => m.key === modKey);
  const editor = $("school-census-module-editor");
  const fieldsContainer = $("school-census-module-fields");
  if (!mod || !editor || !fieldsContainer) return;

  if (activeDraftSchoolModuleKey && activeDraftSchoolModuleKey !== modKey) {
    saveCurrentDraftModuleFromEditor(false);
  }

  activeDraftSchoolModuleKey = modKey;
  renderSchoolFormCensusGrid();

  const saved = draftSchoolCensusModules[modKey] || {};
  const idDraft = draftSchoolCensusModules.identificacao_escola || {};
  const addrDraft = draftSchoolCensusModules.endereco || {};
  const contactDraft = draftSchoolCensusModules.contatos || {};
  const managerDraft = draftSchoolCensusModules.dados_gestor || {};
  const orgDraft = draftSchoolCensusModules.organizacao_ensino || {};

  const getInitialVal = (fieldName) => {
    if (saved[fieldName] !== undefined) return saved[fieldName];
    if (modKey === "identificacao_escola" && fieldName === "nome_escola") return idDraft.nome_escola || "";
    if (modKey === "identificacao_escola" && fieldName === "codigo_inep") return idDraft.codigo_inep || "";
    if (modKey === "endereco" && fieldName === "logradouro") return addrDraft.logradouro || "";
    if (modKey === "contatos" && fieldName === "telefone_principal") return contactDraft.telefone_principal || "";
    if (modKey === "dados_gestor" && fieldName === "nome_gestor") return managerDraft.nome_gestor || "";
    if (modKey === "organizacao_ensino" && fieldName === "etapas_ofertadas") return orgDraft.etapas_ofertadas || "";
    return "";
  };

  if ($("school-census-editor-title")) $("school-census-editor-title").textContent = `${mod.icon} ${mod.label}`;

  fieldsContainer.innerHTML = mod.fields.map(field => {
    const val = getInitialVal(field.name);
    if (Array.isArray(field.options)) {
      return `<label>${escapeHtml(field.label)}
        <select data-draft-census-field="${escapeHtml(field.name)}">
          ${field.options.map(opt => `<option value="${escapeHtml(opt)}"${opt === val ? " selected" : ""}>${escapeHtml(opt)}</option>`).join("")}
        </select>
      </label>`;
    }
    return `<label>${escapeHtml(field.label)}
      <input type="text" maxlength="250" data-draft-census-field="${escapeHtml(field.name)}" value="${escapeHtml(val || "")}" placeholder="${escapeHtml(field.placeholder || "")}">
    </label>`;
  }).join("") + `<label style="grid-column: 1 / -1;">Observações complementares do bloco
    <input type="text" maxlength="300" data-draft-census-field="observacoes" value="${escapeHtml(saved.observacoes || "")}" placeholder="Anotações adicionais do bloco">
  </label>`;

  editor.classList.remove("hidden");
}

$("toggle-school-census-panel")?.addEventListener("click", () => {
  const panel = $("school-census-panel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    renderSchoolFormCensusGrid();
  }
});

$("school-census-modules-grid")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-draft-census-module]");
  if (!btn) return;
  openSchoolFormCensusModule(btn.dataset.draftCensusModule);
});

$("school-census-apply-module")?.addEventListener("click", () => {
  if (!activeDraftSchoolModuleKey) return;
  saveCurrentDraftModuleFromEditor(true);
});

$("school-census-cancel-module")?.addEventListener("click", () => {
  if (activeDraftSchoolModuleKey) {
    saveCurrentDraftModuleFromEditor(false);
  }
  activeDraftSchoolModuleKey = null;
  $("school-census-module-editor")?.classList.add("hidden");
  renderSchoolFormCensusGrid();
});

$("school-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!isSecretaria()) {
    notice("Apenas o perfil Secretaria de Educação pode cadastrar escolas.", true);
    return;
  }

  if (activeDraftSchoolModuleKey) {
    saveCurrentDraftModuleFromEditor(false);
  }

  const idBlock = draftSchoolCensusModules.identificacao_escola || {};
  const schoolName = String(idBlock.nome_escola || "").trim();
  if (!schoolName) {
    openSchoolFormCensusModule("identificacao_escola");
    notice("Informe o Nome da escola e clique em 'Salvar bloco' em Identificação Escola antes de cadastrar.", true);
    return;
  }

  const addrBlock = draftSchoolCensusModules.endereco || {};
  const contactBlock = draftSchoolCensusModules.contatos || {};
  const managerBlock = draftSchoolCensusModules.dados_gestor || {};
  const orgBlock = draftSchoolCensusModules.organizacao_ensino || {};

  const fullAddress = [addrBlock.logradouro, addrBlock.numero_bairro, addrBlock.cep]
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .join(" · ");

  const schoolPayload = {
    ...(currentProfile?.municipality_id ? { municipality_id: currentProfile.municipality_id } : {}),
    school_code: generateFourDigitSchoolCode(),
    name: schoolName,
    manager_name: String(managerBlock.nome_gestor || "").trim() || null,
    inep_code: String(idBlock.codigo_inep || "").trim() || null,
    curriculum_offer: String(orgBlock.etapas_ofertadas || "Comum").trim() || "Comum",
    address: fullAddress || null,
    phone: String(contactBlock.telefone_principal || "").trim() || null
  };

  try {
    const { data: createdSchool, error } = await supabase
      .from("schools")
      .insert(schoolPayload)
      .select()
      .single();
    if (error) throw error;

    if (createdSchool?.id) {
      const year = new Date().getFullYear();
      const migratedModules = {
        ...draftSchoolCensusModules,
        identificacao_escola: {
          ...idBlock,
          nome_escola: createdSchool.name,
          codigo_inep: createdSchool.inep_code || idBlock.codigo_inep || ""
        }
      };

      await persistCensusEntry({
        id: `censo-${createdSchool.id}-${year}`,
        school_id: createdSchool.id,
        school_name: createdSchool.name,
        census_year: year,
        operating_status: idBlock.situacao_funcionamento || "Em atividade",
        offered_stages: orgBlock.etapas_ofertadas || createdSchool.curriculum_offer || "Comum",
        infrastructure_notes: draftSchoolCensusModules.computadores_internet?.acesso_internet || "",
        validation_status: "Em conferência",
        modules: migratedModules
      });
    }

    draftSchoolCensusModules = {};
    saveLocalJson(getScopedStorageKey(SCHOOL_DRAFT_CENSUS_KEY), {});
    activeDraftSchoolModuleKey = null;
    $("school-census-module-editor")?.classList.add("hidden");
    renderSchoolFormCensusGrid();

    notice(`Unidade escolar "${createdSchool.name}" cadastrada com sucesso! ID Escola: ${createdSchool.school_code}. Blocos do Censo migrados.`);
    await loadAll();
  } catch (err) {
    const detail = formatSupabaseError(err);
    console.error("Erro ao cadastrar escola:", detail, err);
    if (isAuth401Error(err)) {
      notice("Erro de autenticação (HTTP 401) ao cadastrar escola. Verifique a chave pública do Supabase em assets/app.js e sua sessão.", true);
      return;
    }
    if (err?.code === "23505") {
      notice("Conflito ao gerar o ID escolar de 4 dígitos. Tente salvar novamente.", true);
      return;
    }
    notice(`Não foi possível cadastrar a escola (${detail}).`, true);
  }
});

function renderSchools(visibleSchools = getScopedSchools()) {
  if (!$("schools-body")) return;

  $("schools-body").innerHTML = visibleSchools.map(s => {
    const isSelected = isSecretaria() && s.id === selectedSchoolId;
    const deleteBtn = isSecretaria()
      ? `<button type="button" class="secondary small" data-delete-school="${escapeHtml(s.id)}" data-school-name="${escapeHtml(s.name)}">Excluir</button>`
      : `<span class="muted small">—</span>`;
    return `<tr data-select-school="${escapeHtml(s.id)}" style="${isSecretaria() ? "cursor:pointer;" : ""}${isSelected ? "background:#eef5ff;font-weight:600;" : ""}">
      <td>${escapeHtml(s.school_code || "—")}</td>
      <td>${escapeHtml(s.name)}${isSelected ? " (Selecionada)" : ""}</td>
      <td>${escapeHtml(s.manager_name || "—")}</td>
      <td>${escapeHtml(s.inep_code || "—")}</td>
      <td>${escapeHtml(s.curriculum_offer || "Comum")}</td>
      <td>${escapeHtml(s.address || "—")}</td>
      <td>${escapeHtml(s.phone || "—")}</td>
      <td>${deleteBtn}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="8">Nenhuma escola vinculada.</td></tr>';
}

async function unlinkProfilesFromSchool(schoolId) {
  const { error } = await supabase
    .from("profiles")
    .update({ school_id: null })
    .eq("school_id", schoolId);
  if (error) throw error;
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
    const linkedUsersCount = cachedProfiles.filter(p => p.school_id === schoolId).length;
    const extraMsg = linkedUsersCount > 0
      ? `\n\nAtenção: existem ${linkedUsersCount} usuário(s) vinculado(s) a esta escola. Eles serão desvinculados (sem apagar a conta) antes da exclusão.`
      : "";
    const confirmed = window.confirm(`Deseja realmente excluir a escola "${schoolName}"?${extraMsg}`);
    if (!confirmed) return;

    delBtn.disabled = true;
    try {
      if (linkedUsersCount > 0) {
        await unlinkProfilesFromSchool(schoolId);
      }

      let { error } = await supabase.from("schools").delete().eq("id", schoolId);
      if (error?.code === "23503" && String(error.message || "").includes("profiles_school_id_fkey")) {
        await unlinkProfilesFromSchool(schoolId);
        const retry = await supabase.from("schools").delete().eq("id", schoolId);
        error = retry.error;
      }
      if (error) throw error;

      if (selectedSchoolId === schoolId) {
        selectedSchoolId = "";
        if ($("secretaria-school-search")) $("secretaria-school-search").value = "";
        updateRoleLabel();
      }
      cachedCensus = cachedCensus.filter(c => c.school_id !== schoolId);
      saveLocalJson(getScopedStorageKey(CENSUS_STORAGE_KEY), cachedCensus);
      notice(
        linkedUsersCount > 0
          ? `Escola "${schoolName}" removida e ${linkedUsersCount} usuário(s) desvinculado(s) com sucesso.`
          : `Escola "${schoolName}" removida com sucesso.`
      );
      await loadAll();
    } catch (err) {
      const detail = formatSupabaseError(err);
      console.error("Erro ao excluir escola:", detail, err);
      if (err?.code === "23503") {
        notice("Não foi possível excluir a escola porque existem registros vinculados (alunos, turmas ou usuários). Remova ou desvincule esses registros primeiro.", true);
      } else {
        notice(`Não foi possível excluir a escola (${detail}).`, true);
      }
      delBtn.disabled = false;
    }
    return;
  }

  if (!isSecretaria()) return;
  const row = e.target.closest("[data-select-school]");
  if (!row) return;
  const school = cachedSchools.find(s => s.id === row.dataset.selectSchool);
  if (school) setActiveSchool(school, false);
});

function renderStudents(rows = getScopedStudents()) {
  if (!$("students-body")) return;
  $("students-body").innerHTML = rows.map(s =>
    `<tr>
      <td>${escapeHtml(s.full_name)}</td>
      <td>${escapeHtml(formatCpf(s.cpf))}</td>
      <td>${escapeHtml(s.birth_date || "—")}</td>
      <td>${escapeHtml(s.race_color || "Não declarada")}</td>
      <td>${isPcdStudent(s) ? "Sim" : "Não"}</td>
      <td>${escapeHtml(s.guardian_name || "—")}</td>
      <td>${escapeHtml(s.schools?.name || "—")}</td>
    </tr>`
  ).join("") || '<tr><td colspan="7">Nenhum aluno cadastrado.</td></tr>';
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
    const activeCount = getActiveStudentCountForClass(c.id);
    const isAee = isAeeClass(c);
    const teacherCell = canAssignTeacher
      ? `<select data-assign-teacher="${escapeHtml(c.id)}">
          <option value="">Não definido</option>
          ${classTeachers.map(t => `<option value="${escapeHtml(t.id)}"${t.id === c.teacher_id ? " selected" : ""}>${escapeHtml(t.full_name || "Professor sem nome")}</option>`).join("")}
        </select>`
      : escapeHtml(currentTeacher?.full_name || "Não definido");

    return `<tr>
      <td>${escapeHtml(c.class_code || "—")}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.class_complement || "—")}</td>
      <td>${escapeHtml(c.grade_level)}</td>
      <td>${escapeHtml(c.modality || "Regular")}</td>
      <td>${isAee ? "Sim (AEE)" : "Não"}</td>
      <td><strong>${activeCount}</strong></td>
      <td>${escapeHtml(formatSchedule(c.start_time, c.end_time))}</td>
      <td>${c.school_year}</td>
      <td>${escapeHtml(c.schools?.name || "—")}</td>
      <td>${teacherCell}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="11">Nenhuma turma cadastrada.</td></tr>';
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
    console.error("Erro ao atualizar professor:", formatSupabaseError(err), err);
    notice("Não foi possível atualizar o professor da turma.", true);
    select.disabled = false;
  }
});

function renderEnrollments(rows = getScopedEnrollments()) {
  if (!$("enrollments-body")) return;
  const classById = new Map(cachedClasses.map(c => [c.id, c]));
  const studentById = new Map(cachedStudents.map(s => [s.id, s]));

  $("enrollments-body").innerHTML = rows.map(e => {
    const cls = e.classes || classById.get(e.class_id);
    const stu = e.students || studentById.get(e.student_id);
    const pcdLabel = isPcdStudent(stu) ? "Sim" : "Não";
    const classType = isAeeClass(cls) ? "AEE" : "Regular";
    const transportLabel = usesTransport(e) ? "Sim" : "Não";
    return `<tr>
      <td>${escapeHtml(stu?.full_name || "—")}</td>
      <td>${pcdLabel}</td>
      <td>${escapeHtml(cls?.name || "—")}</td>
      <td>${classType}</td>
      <td>${transportLabel}</td>
      <td>${e.school_year}</td>
      <td>${escapeHtml(e.status)}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="7">Nenhuma matrícula cadastrada.</td></tr>';
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

// --- MATRIZ CURRICULAR ---
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
  saveLocalJson(getScopedStorageKey(CURRICULUM_STORAGE_KEY), cachedCurriculum);
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
  saveLocalJson(getScopedStorageKey(CURRICULUM_STORAGE_KEY), cachedCurriculum);
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
  saveLocalJson(getScopedStorageKey(MONITORS_STORAGE_KEY), cachedMonitors);
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
  saveLocalJson(getScopedStorageKey(MONITORS_STORAGE_KEY), cachedMonitors);
  renderMonitors();
  notice("Monitor removido.");
});

// --- MAPEAMENTO DO CENSO ESCOLAR ---
function getSelectedCensusSchoolId() {
  if (!canAccessCensus()) return "";
  return currentProfile?.school_id || "";
}

function getSelectedCensusYear() {
  const y = Number($("census-year-input")?.value);
  return y || new Date().getFullYear();
}

function getCurrentCensusEntry(schoolId = getSelectedCensusSchoolId(), year = getSelectedCensusYear()) {
  if (!schoolId) return null;
  return cachedCensus.find(c => c.school_id === schoolId && Number(c.census_year) === Number(year)) || null;
}

function countFilledCensusModules(entry) {
  const mods = entry?.modules || {};
  return CENSUS_MODULES.filter(mod => hasModuleData(mods[mod.key])).length;
}

function buildMigratedModulesFromSchool(school, existingModules = {}) {
  if (!school) return { ...existingModules };
  const addrParts = String(school.address || "").split("·").map(p => p.trim()).filter(Boolean);
  const logradouro = addrParts[0] || "";
  const numeroBairro = addrParts[1] || "";
  const cep = addrParts[2] || "";

  const prevId = existingModules.identificacao_escola || {};
  const prevAddr = existingModules.endereco || {};
  const prevContact = existingModules.contatos || {};
  const prevManager = existingModules.dados_gestor || {};
  const prevOrg = existingModules.organizacao_ensino || {};

  return {
    ...existingModules,
    identificacao_escola: {
      ...prevId,
      nome_escola: prevId.nome_escola || school.name || "",
      codigo_inep: prevId.codigo_inep || school.inep_code || "",
      situacao_funcionamento: prevId.situacao_funcionamento || "Em atividade",
      dependencia_administrativa: prevId.dependencia_administrativa || "Municipal"
    },
    endereco: {
      ...prevAddr,
      cep: prevAddr.cep || cep,
      logradouro: prevAddr.logradouro || logradouro,
      numero_bairro: prevAddr.numero_bairro || numeroBairro
    },
    contatos: {
      ...prevContact,
      telefone_principal: prevContact.telefone_principal || school.phone || ""
    },
    dados_gestor: {
      ...prevManager,
      nome_gestor: prevManager.nome_gestor || school.manager_name || ""
    },
    organizacao_ensino: {
      ...prevOrg,
      etapas_ofertadas: prevOrg.etapas_ofertadas || school.curriculum_offer || ""
    }
  };
}

function getDefaultFieldValueForModule(modKey, fieldName, school) {
  if (!school) return "";
  const addrParts = String(school.address || "").split("·").map(p => p.trim()).filter(Boolean);
  if (modKey === "identificacao_escola" && fieldName === "nome_escola") return school.name || "";
  if (modKey === "identificacao_escola" && fieldName === "codigo_inep") return school.inep_code || "";
  if (modKey === "identificacao_escola" && fieldName === "situacao_funcionamento") return "Em atividade";
  if (modKey === "identificacao_escola" && fieldName === "dependencia_administrativa") return "Municipal";
  if (modKey === "endereco" && fieldName === "logradouro") return addrParts[0] || school.address || "";
  if (modKey === "endereco" && fieldName === "numero_bairro") return addrParts[1] || "";
  if (modKey === "endereco" && fieldName === "cep") return addrParts[2] || "";
  if (modKey === "contatos" && fieldName === "telefone_principal") return school.phone || "";
  if (modKey === "dados_gestor" && fieldName === "nome_gestor") return school.manager_name || "";
  if (modKey === "organizacao_ensino" && fieldName === "etapas_ofertadas") return school.curriculum_offer || "";
  return "";
}

async function ensureSchoolMigratedToCensus(school, year = getSelectedCensusYear(), forceOverwrite = false) {
  if (!school?.id) return null;
  const existing = getCurrentCensusEntry(school.id, year);
  const migratedModules = buildMigratedModulesFromSchool(school, existing?.modules || {});

  const entry = {
    id: `censo-${school.id}-${year}`,
    school_id: school.id,
    school_name: school.name,
    census_year: year,
    operating_status: (!forceOverwrite && existing?.operating_status) ? existing.operating_status : "Em atividade",
    offered_stages: (!forceOverwrite && existing?.offered_stages)
      ? existing.offered_stages
      : (school.curriculum_offer || migratedModules.organizacao_ensino?.etapas_ofertadas || "Comum"),
    infrastructure_notes: (!forceOverwrite && existing?.infrastructure_notes)
      ? existing.infrastructure_notes
      : (migratedModules.computadores_internet?.acesso_internet || ""),
    validation_status: (!forceOverwrite && existing?.validation_status) ? existing.validation_status : "Em conferência",
    modules: migratedModules
  };

  if (!existing || forceOverwrite) {
    await persistCensusEntry(entry);
  } else {
    entry.modules = migratedModules;
  }

  return entry;
}

function populateCensusFormWithSchool(school, year = getSelectedCensusYear()) {
  if (!school) return;
  const existing = getCurrentCensusEntry(school.id, year);
  const migratedModules = buildMigratedModulesFromSchool(school, existing?.modules || {});

  if ($("census-school")) {
    $("census-school").value = school.id;
    $("census-school").disabled = true;
  }
  if ($("census-year-input")) {
    $("census-year-input").value = year;
  }
  if ($("census-operating-status")) {
    $("census-operating-status").value = existing?.operating_status || migratedModules.identificacao_escola?.situacao_funcionamento || "Em atividade";
  }
  if ($("census-offered-stages")) {
    $("census-offered-stages").value = existing?.offered_stages || school.curriculum_offer || migratedModules.organizacao_ensino?.etapas_ofertadas || "";
  }
  if ($("census-infrastructure-notes")) {
    $("census-infrastructure-notes").value = existing?.infrastructure_notes || migratedModules.computadores_internet?.acesso_internet || migratedModules.acessibilidade?.recursos_acessibilidade || "";
  }
  if ($("census-validation-status")) {
    $("census-validation-status").value = existing?.validation_status || "Pendente";
  }
}

function renderCensusModulesGrid() {
  const blocksSection = $("census-school-blocks-section");
  const grid = $("census-modules-grid");
  if (!blocksSection || !grid) return;

  if (!canAccessCensus()) {
    blocksSection.classList.add("hidden");
    activeCensusModuleKey = null;
    $("census-module-editor")?.classList.add("hidden");
    return;
  }

  const schoolId = getSelectedCensusSchoolId();
  const school = cachedSchools.find(s => s.id === schoolId);

  if (!school) {
    blocksSection.classList.add("hidden");
    activeCensusModuleKey = null;
    $("census-module-editor")?.classList.add("hidden");
    return;
  }

  blocksSection.classList.remove("hidden");
  if ($("census-blocks-hint")) {
    const idLabel = school.school_code ? ` · ID ${school.school_code}` : "";
    const inepLabel = school.inep_code ? ` · INEP ${school.inep_code}` : "";
    $("census-blocks-hint").textContent = `Unidade vinculada: ${school.name}${idLabel}${inepLabel}. Clique em qualquer bloco para editar ou atualizar as informações.`;
  }

  const year = getSelectedCensusYear();
  const entry = getCurrentCensusEntry(schoolId, year);
  const modulesData = buildMigratedModulesFromSchool(school, entry?.modules || {});

  grid.innerHTML = CENSUS_MODULES.map(mod => {
    const savedMod = modulesData[mod.key] || {};
    const hasData = hasModuleData(savedMod);
    const isActive = activeCensusModuleKey === mod.key;

    return `<button
      type="button"
      data-census-module="${escapeHtml(mod.key)}"
      style="background:${isActive ? "#d3e8ca" : (hasData ? "#dcefd4" : "#e3f1dc")};color:#2c3e28;border:${isActive ? "2px solid #4c833c" : "1px solid #c9dfbe"};border-radius:8px;padding:12px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;text-align:center;">
      <span style="font-size:1.15rem;line-height:1;">${escapeHtml(mod.icon)}</span>
      <strong style="font-size:0.82rem;font-weight:600;">${escapeHtml(mod.label)}</strong>
      <span style="font-size:0.72rem;font-weight:${hasData ? "600" : "400"};color:${hasData ? "#255e1e" : "#5c6b58"};">${hasData ? "Preenchido · Editar" : "Disponível"}</span>
    </button>`;
  }).join("");
}

function openCensusModuleEditor(modKey) {
  if (!canAccessCensus()) {
    notice("Apenas Secretário escolar e Gestor escolar podem editar os blocos do Censo.", true);
    return;
  }

  const mod = CENSUS_MODULES.find(m => m.key === modKey);
  const editor = $("census-module-editor");
  const fieldsContainer = $("census-module-fields");
  if (!mod || !editor || !fieldsContainer) return;

  const schoolId = getSelectedCensusSchoolId();
  const year = getSelectedCensusYear();
  const school = cachedSchools.find(s => s.id === schoolId);
  if (!school) {
    notice("Seu perfil não possui uma unidade escolar vinculada para editar os blocos do Censo.", true);
    return;
  }

  activeCensusModuleKey = modKey;
  renderCensusModulesGrid();

  const entry = getCurrentCensusEntry(schoolId, year);
  const migratedModules = buildMigratedModulesFromSchool(school, entry?.modules || {});
  const savedMod = migratedModules[modKey] || {};

  if ($("census-editor-title")) $("census-editor-title").textContent = `${mod.icon} ${mod.label}`;
  if ($("census-editor-subtitle")) {
    $("census-editor-subtitle").textContent = `Unidade: ${school.name} · Ano: ${year} · Perfil: ${roleNames[currentProfile?.role] || currentProfile?.role || ""}`;
  }

  fieldsContainer.innerHTML = mod.fields.map(field => {
    const rawSaved = savedMod[field.name];
    const fallbackVal = getDefaultFieldValueForModule(modKey, field.name, school);
    const val = (rawSaved !== undefined && String(rawSaved).trim() !== "") ? rawSaved : fallbackVal;

    if (Array.isArray(field.options)) {
      return `<label>${escapeHtml(field.label)}
        <select data-census-field="${escapeHtml(field.name)}">
          ${field.options.map(opt => `<option value="${escapeHtml(opt)}"${opt === val ? " selected" : ""}>${escapeHtml(opt)}</option>`).join("")}
        </select>
      </label>`;
    }

    return `<label>${escapeHtml(field.label)}
      <input type="text" maxlength="250" data-census-field="${escapeHtml(field.name)}" value="${escapeHtml(val || "")}" placeholder="${escapeHtml(field.placeholder || "")}">
    </label>`;
  }).join("") + `<label style="grid-column: 1 / -1;">Observações complementares do bloco
    <input type="text" maxlength="300" data-census-field="observacoes" value="${escapeHtml(savedMod.observacoes || "")}" placeholder="Anotações adicionais para conferência do Censo">
  </label>`;

  editor.classList.remove("hidden");
}

function renderCensus() {
  if (!$("census-body") || !canAccessCensus()) return;
  const effectiveId = getSelectedCensusSchoolId();
  const school = cachedSchools.find(s => s.id === effectiveId);
  const year = getSelectedCensusYear();
  const scopedSchools = getScopedSchools();
  const scopedStudents = getScopedStudents();
  const scopedEnrollments = getScopedEnrollments();
  const validStudents = scopedStudents.filter(s => s.full_name && s.birth_date && s.school_id);
  const activeStudentIds = new Set(
    scopedEnrollments
      .filter(e => e.status === "ativa" && e.student_id)
      .map(e => e.student_id)
  );

  if (school) {
    populateCensusFormWithSchool(school, year);
  }

  const visibleCensus = effectiveId
    ? cachedCensus.filter(c => c.school_id === effectiveId)
    : [];

  if ($("censo-schools-count")) $("censo-schools-count").textContent = scopedSchools.length;
  if ($("censo-students-count")) $("censo-students-count").textContent = validStudents.length;
  if ($("censo-enrollments-count")) $("censo-enrollments-count").textContent = activeStudentIds.size;

  renderCensusModulesGrid();

  $("census-body").innerHTML = visibleCensus.map(row => {
    const linkedSchool = cachedSchools.find(s => s.id === row.school_id) || school;
    const mergedRow = {
      ...row,
      modules: buildMigratedModulesFromSchool(linkedSchool, row.modules || {})
    };
    const filledCount = countFilledCensusModules(mergedRow);
    return `<tr>
      <td>${escapeHtml(linkedSchool?.name || row.school_name || "—")}</td>
      <td>${escapeHtml(linkedSchool?.inep_code || "Sem INEP")}</td>
      <td>${escapeHtml(String(row.census_year))}</td>
      <td>${escapeHtml(row.operating_status)}</td>
      <td>${escapeHtml(row.offered_stages)}</td>
      <td>${filledCount} / ${CENSUS_MODULES.length}</td>
      <td>${escapeHtml(row.validation_status)}</td>
      <td><button type="button" class="secondary small" data-edit-census-year="${escapeHtml(String(row.census_year))}">Editar</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="8">Nenhum mapeamento do Censo Escolar registrado para sua unidade ainda.</td></tr>';
}

$("census-body")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-edit-census-year]");
  if (!btn || !canAccessCensus()) return;
  const targetYear = Number(btn.dataset.editCensusYear) || getSelectedCensusYear();
  if ($("census-year-input")) $("census-year-input").value = targetYear;
  const school = cachedSchools.find(s => s.id === getSelectedCensusSchoolId());
  if (school) {
    populateCensusFormWithSchool(school, targetYear);
    renderCensusModulesGrid();
    openCensusModuleEditor(activeCensusModuleKey || "identificacao_escola");
  }
});

$("census-sync-school-data")?.addEventListener("click", async () => {
  if (!canAccessCensus()) return;
  const school = cachedSchools.find(s => s.id === getSelectedCensusSchoolId());
  if (!school) {
    notice("Nenhuma unidade escolar vinculada ao seu perfil.", true);
    return;
  }
  const year = getSelectedCensusYear();
  await ensureSchoolMigratedToCensus(school, year, true);
  populateCensusFormWithSchool(school, year);
  renderCensus();
  if (activeCensusModuleKey) openCensusModuleEditor(activeCensusModuleKey);
  notice(`Informações da escola "${school.name}" migradas para o Censo (${year}).`);
});

$("census-modules-grid")?.addEventListener("click", e => {
  const card = e.target.closest("[data-census-module]");
  if (!card) return;
  openCensusModuleEditor(card.dataset.censusModule);
});

$("census-close-editor")?.addEventListener("click", () => {
  activeCensusModuleKey = null;
  $("census-module-editor")?.classList.add("hidden");
  renderCensusModulesGrid();
});

$("census-year-input")?.addEventListener("change", () => {
  if (!canAccessCensus()) return;
  const school = cachedSchools.find(s => s.id === getSelectedCensusSchoolId());
  if (school) populateCensusFormWithSchool(school, getSelectedCensusYear());
  renderCensusModulesGrid();
  if (activeCensusModuleKey) openCensusModuleEditor(activeCensusModuleKey);
});

async function persistCensusEntry(entry) {
  cachedCensus = [entry, ...cachedCensus.filter(x => x.id !== entry.id)];
  saveLocalJson(getScopedStorageKey(CENSUS_STORAGE_KEY), cachedCensus);

  if (supabase) {
    try {
      const { error } = await supabase.from("school_census_mappings").upsert({
        school_id: entry.school_id,
        census_year: entry.census_year,
        operating_status: entry.operating_status,
        offered_stages: entry.offered_stages,
        infrastructure_notes: entry.infrastructure_notes || null,
        validation_status: entry.validation_status,
        modules_data: entry.modules || {},
        updated_by: currentProfile?.id || null
      }, { onConflict: "school_id,census_year" });
      if (error) {
        console.warn("Sincronização remota do Censo não aplicada:", formatSupabaseError(error));
      }
    } catch (err) {
      console.warn("Sincronização remota do Censo falhou:", formatSupabaseError(err));
    }
  }
}

async function syncSchoolRecordFromCensusModules(school, modulesData, formData = {}) {
  if (!supabase || !school?.id) return;
  const idMod = modulesData.identificacao_escola || {};
  const addrMod = modulesData.endereco || {};
  const contactMod = modulesData.contatos || {};
  const managerMod = modulesData.dados_gestor || {};
  const orgMod = modulesData.organizacao_ensino || {};

  const nextName = String(idMod.nome_escola || school.name || "").trim();
  const nextInep = String(idMod.codigo_inep ?? school.inep_code ?? "").trim() || null;
  const nextCurriculum = String(formData.offered_stages || orgMod.etapas_ofertadas || school.curriculum_offer || "Comum").trim() || "Comum";
  const mergedAddress = [addrMod.logradouro, addrMod.numero_bairro, addrMod.cep]
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .join(" · ") || school.address || null;
  const nextPhone = String(contactMod.telefone_principal ?? school.phone ?? "").trim() || null;
  const nextManager = String(managerMod.nome_gestor ?? school.manager_name ?? "").trim() || null;

  const updatePayload = {
    name: nextName || school.name,
    inep_code: nextInep,
    curriculum_offer: nextCurriculum,
    address: mergedAddress,
    phone: nextPhone,
    manager_name: nextManager
  };

  try {
    const { data: updatedSchool, error } = await supabase
      .from("schools")
      .update(updatePayload)
      .eq("id", school.id)
      .select()
      .single();
    if (!error && updatedSchool) {
      cachedSchools = cachedSchools.map(s => s.id === school.id ? updatedSchool : s);
      updateHomeSchoolCard();
      updateRoleLabel();
    } else if (error) {
      console.warn("Atualização espelhada de schools não aplicada:", formatSupabaseError(error));
    }
  } catch (err) {
    console.warn("Não foi possível atualizar os dados espelhados da escola:", formatSupabaseError(err));
  }
}

$("census-save-module")?.addEventListener("click", async () => {
  if (!canAccessCensus()) {
    notice("Apenas Secretário escolar e Gestor escolar podem salvar blocos do Censo.", true);
    return;
  }
  if (!activeCensusModuleKey) return;
  const schoolId = getSelectedCensusSchoolId();
  const year = getSelectedCensusYear();
  const school = cachedSchools.find(s => s.id === schoolId);
  if (!school) {
    notice("Seu perfil não possui uma unidade escolar vinculada.", true);
    return;
  }

  const modValues = {};
  document.querySelectorAll("#census-module-fields [data-census-field]").forEach(el => {
    modValues[el.dataset.censusField] = String(el.value || "").trim();
  });

  const existing = getCurrentCensusEntry(schoolId, year);
  const baseModules = buildMigratedModulesFromSchool(school, existing?.modules || {});
  const currentModules = { ...baseModules, [activeCensusModuleKey]: modValues };

  const entry = {
    id: `censo-${school.id}-${year}`,
    school_id: school.id,
    school_name: currentModules.identificacao_escola?.nome_escola || school.name,
    census_year: year,
    operating_status: currentModules.identificacao_escola?.situacao_funcionamento || existing?.operating_status || $("census-operating-status")?.value || "Em atividade",
    offered_stages: existing?.offered_stages || currentModules.organizacao_ensino?.etapas_ofertadas || $("census-offered-stages")?.value || school.curriculum_offer || "Comum",
    infrastructure_notes: existing?.infrastructure_notes || currentModules.computadores_internet?.acesso_internet || $("census-infrastructure-notes")?.value || "",
    validation_status: existing?.validation_status || $("census-validation-status")?.value || "Em conferência",
    modules: currentModules
  };

  await persistCensusEntry(entry);
  await syncSchoolRecordFromCensusModules(school, currentModules, { offered_stages: entry.offered_stages });
  const modLabel = CENSUS_MODULES.find(m => m.key === activeCensusModuleKey)?.label || "Bloco";
  renderCensus();
  openCensusModuleEditor(activeCensusModuleKey);
  notice(`Bloco "${modLabel}" salvo e atualizado para ${school.name} (${year}).`);
});

$("census-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!canAccessCensus()) {
    notice("Apenas Secretário escolar e Gestor escolar podem salvar o mapeamento do Censo.", true);
    return;
  }
  const data = formObject(e.target);
  const targetSchoolId = getSelectedCensusSchoolId();
  const school = cachedSchools.find(s => s.id === targetSchoolId);
  if (!school) {
    notice("Seu perfil não possui uma unidade escolar vinculada para o Censo.", true);
    return;
  }
  const year = Number(data.census_year) || new Date().getFullYear();
  const existing = getCurrentCensusEntry(school.id, year);
  const mergedModules = buildMigratedModulesFromSchool(school, existing?.modules || {});

  if (mergedModules.identificacao_escola) {
    mergedModules.identificacao_escola.situacao_funcionamento = data.operating_status;
  }
  if (mergedModules.organizacao_ensino && data.offered_stages) {
    mergedModules.organizacao_ensino.etapas_ofertadas = String(data.offered_stages || "").trim();
  }

  const entry = {
    id: `censo-${school.id}-${year}`,
    school_id: school.id,
    school_name: mergedModules.identificacao_escola?.nome_escola || school.name,
    census_year: year,
    operating_status: data.operating_status,
    offered_stages: String(data.offered_stages || "").trim(),
    infrastructure_notes: String(data.infrastructure_notes || "").trim(),
    validation_status: data.validation_status,
    modules: mergedModules
  };

  await persistCensusEntry(entry);
  await syncSchoolRecordFromCensusModules(school, mergedModules, data);
  renderCensus();
  notice(`Mapeamento do Censo salvo para ${school.name}.`);
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
    console.error("Erro ao excluir usuário:", formatSupabaseError(err), err);
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
      school_id: payload.school_id || null,
      municipality_id: currentProfile?.municipality_id || null
    };

    try {
      await callUserFunction(body);
      userForm.reset();
      const effectiveId = getEffectiveSchoolId();
      if (effectiveId && $("user-school")) $("user-school").value = effectiveId;
      notice("Usuário cadastrado com sucesso.");
      await loadProfiles();
    } catch (err) {
      console.error("Erro ao cadastrar usuário:", formatSupabaseError(err), err);
      notice(err.message || "Erro ao cadastrar usuário. Verifique se a Edge Function create-user está publicada no Supabase.", true);
    }
  });
}

function resetClassFormDefaults(form, schoolId) {
  form.reset();
  document.querySelectorAll('input[name="school_year"]').forEach(x => x.value = new Date().getFullYear());
  if ($('input[name="census_year"]')) $('input[name="census_year"]').value = new Date().getFullYear();
  if (form.elements["max_students"]) form.elements["max_students"].value = "30";
  if (form.elements["inep_code"]) {
    form.elements["inep_code"].value = "";
    form.elements["inep_code"].readOnly = true;
    form.elements["inep_code"].disabled = true;
  }
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
      if (form.elements["race_color"]) form.elements["race_color"].value = "Não declarada";
      if (form.elements["is_pcd"]) form.elements["is_pcd"].value = "false";
      if (form.elements["uses_school_transport"]) form.elements["uses_school_transport"].value = "false";
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
      const detail = formatSupabaseError(err);
      console.error(`Erro ao salvar em ${table}:`, detail, err);
      if (isAuth401Error(err)) {
        notice("Erro de autenticação (HTTP 401) ao salvar. Verifique a chave pública do Supabase em assets/app.js.", true);
        return;
      }
      if (err?.code === "23505" && table === "students") {
        notice("Já existe um aluno cadastrado com este CPF.", true);
        return;
      }
      if (err?.code === "22023") {
        notice(err.message || "CPF inválido: informe 11 dígitos numéricos.", true);
        return;
      }
      notice(`Não foi possível salvar (${detail}).`, true);
    }
  });
}

insertForm(
  "student-form",
  "students",
  x => ({
    ...x,
    cpf: validateAndNormalizeCpf(x.cpf, "CPF do aluno").cpf,
    race_color: String(x.race_color || "Não declarada").trim() || "Não declarada",
    is_pcd: x.is_pcd === "true" || x.is_pcd === true,
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
    notice("Apenas Gestor escolar e Secretário escolar vinculados a uma unidade podem criar turmas.", true);
    return;
  }

  const raw = formObject(e.target);
  const targetSchoolId = getEffectiveSchoolId();
  if (!targetSchoolId) {
    notice("Seu perfil precisa estar vinculado a uma unidade escolar para criar turmas.", true);
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

  const classCode = generateFourDigitClassCode();

  try {
    const { error } = await supabase.from("classes").insert({
      class_code: classCode,
      name: String(raw.name || "").trim(),
      max_students: Number(raw.max_students) || 30,
      class_complement: String(raw.class_complement || "").trim() || null,
      inep_code: null,
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
    notice(`Turma criada com sucesso! Código da turma: ${classCode}.`);
    await loadAll();
  } catch (err) {
    const detail = formatSupabaseError(err);
    console.error("Erro ao criar turma:", detail, err);
    notice(`Não foi possível criar a turma (${detail}).`, true);
  }
});

$("enrollment-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!canManageClassesAndEnrollments()) {
    notice("Apenas Gestor escolar e Secretário escolar vinculados a uma unidade podem enturmar alunos.", true);
    return;
  }

  const raw = formObject(e.target);
  const studentId = raw.student_id;
  const classId = raw.class_id;
  const schoolYear = Number(raw.school_year);
  const usesSchoolTransport = raw.uses_school_transport === "true" || raw.uses_school_transport === true;
  const status = raw.status || "ativa";

  const allowedStudents = new Set(getScopedStudents().map(s => s.id));
  const allowedClasses = new Set(getScopedClasses().map(c => c.id));

  if (!allowedStudents.has(studentId) || !allowedClasses.has(classId)) {
    notice("Selecione um aluno e uma turma da unidade escolar vinculada.", true);
    return;
  }

  const targetClass = cachedClasses.find(c => c.id === classId);
  const targetIsAee = isAeeClass(targetClass);

  const sameYearEnrollments = cachedEnrollments.filter(
    en => en.student_id === studentId && Number(en.school_year) === schoolYear && en.status !== "cancelada"
  );

  if (sameYearEnrollments.some(en => en.class_id === classId)) {
    notice("Este aluno já possui matrícula registrada nesta turma para o ano letivo informado.", true);
    return;
  }

  const sameCategoryCount = sameYearEnrollments.filter(en => {
    const existingClass = cachedClasses.find(c => c.id === en.class_id);
    return isAeeClass(existingClass) === targetIsAee;
  }).length;

  if (sameCategoryCount >= 1) {
    notice(
      targetIsAee
        ? "O aluno já está matriculado em uma turma de AEE neste ano letivo."
        : "O aluno já está matriculado em uma turma regular neste ano letivo.",
      true
    );
    return;
  }

  try {
    const { error } = await supabase.from("enrollments").insert({
      student_id: studentId,
      class_id: classId,
      school_year: schoolYear,
      uses_school_transport: usesSchoolTransport,
      status
    });
    if (error) throw error;

    e.target.reset();
    if (e.target.elements["uses_school_transport"]) {
      e.target.elements["uses_school_transport"].value = "false";
    }
    document.querySelectorAll('input[name="school_year"]').forEach(x => x.value = new Date().getFullYear());
    notice(targetIsAee ? "Aluno enturmado na turma de AEE com sucesso." : "Aluno enturmado na turma regular com sucesso.");
    await loadAll();
  } catch (err) {
    const detail = formatSupabaseError(err);
    console.error("Erro ao enturmar aluno:", detail, err);
    notice(`Não foi possível enturmar o aluno (${detail}).`, true);
  }
});

insertForm(
  "lesson-form",
  "lessons",
  x => ({
    ...x,
    teacher_id: currentProfile?.id
  }),
  null,
  raw => {
    if (!canAccessDiary()) {
      return { ok: false, message: "Apenas perfis vinculados à unidade escolar podem registrar aulas no diário." };
    }
    const allowedClasses = new Set(getScopedClasses().map(c => c.id));
    if (!allowedClasses.has(raw.class_id)) {
      return { ok: false, message: "Selecione uma turma da sua unidade escolar." };
    }
    return { ok: true };
  }
);

async function loadLessons() {
  if (!$("lessons-body") || !canAccessDiary()) return;
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("class_id,lesson_date,subject,content,classes(name,school_id)")
      .order("lesson_date", { ascending: false })
      .limit(50);
    if (error) throw error;
    const effectiveId = getEffectiveSchoolId();
    const rows = (data || []).filter(l => effectiveId && l.classes?.school_id === effectiveId);
    $("lessons-body").innerHTML = rows.map(l =>
      `<tr><td>${escapeHtml(l.lesson_date)}</td><td>${escapeHtml(l.classes?.name || "—")}</td><td>${escapeHtml(l.subject)}</td><td>${escapeHtml(l.content)}</td></tr>`
    ).join("") || '<tr><td colspan="4">Nenhuma aula registrada.</td></tr>';
  } catch (e) {
    console.error("Erro ao carregar aulas:", formatSupabaseError(e), e);
  }
}

$("load-attendance")?.addEventListener("click", async () => {
  if (!canAccessDiary()) {
    notice("Apenas perfis vinculados à unidade escolar podem acessar o diário.", true);
    return;
  }
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
    console.error("Erro ao carregar frequência:", formatSupabaseError(e), e);
    notice("Não foi possível carregar a lista de alunos.", true);
  }
});

$("save-attendance")?.addEventListener("click", async () => {
  if (!canAccessDiary()) return;
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
    console.error("Erro ao salvar frequência:", formatSupabaseError(e), e);
    notice("Não foi possível salvar a frequência. Verifique as permissões.", true);
  }
});

if ($("attendance-date")) $("attendance-date").value = getTodayIso();
document.querySelectorAll('input[name="school_year"]').forEach(x => {
  x.value = new Date().getFullYear();
});
if ($('input[name="census_year"]')) {
  $('input[name="census_year"]').value = new Date().getFullYear();
}
