import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/*
  CONFIGURAÇÃO: substitua pelos dados do projeto Supabase.
  Não coloque a chave service_role neste arquivo. Use somente a chave anon/public.
*/
const SUPABASE_URL = "COLE_AQUI_A_URL_DO_PROJETO";
const SUPABASE_ANON_KEY = "COLE_AQUI_A_CHAVE_ANON_PUBLIC";

const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("COLE_AQUI") && !SUPABASE_ANON_KEY.includes("COLE_AQUI");
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentProfile = null;
let cachedSchools = [], cachedStudents = [], cachedClasses = [];
let attendanceRows = [];

const $ = (id) => document.getElementById(id);
const today = new Date().toISOString().slice(0,10);
const roleNames = {secretaria:"Secretaria de Educação",gestor:"Gestor escolar",secretario_escolar:"Secretário escolar",professor:"Professor"};

function notice(message, bad=false) {
  const el=$("notice"); el.textContent=message; el.classList.remove("hidden","bad"); if(bad) el.classList.add("bad");
  window.scrollTo({top:0,behavior:"smooth"});
  setTimeout(()=>el.classList.add("hidden"),5500);
}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function formObject(form){return Object.fromEntries(new FormData(form).entries());}
function showApp(profile,user){
  currentProfile=profile;
  $("login-view").classList.add("hidden"); $("app-view").classList.remove("hidden");
  $("user-name").textContent=profile.full_name || user.email; $("user-role").textContent=roleNames[profile.role] || profile.role;
  $("avatar").textContent=(profile.full_name || user.email).charAt(0).toUpperCase();
  document.querySelectorAll("[data-roles]").forEach(el=>{
    const roles=el.dataset.roles.split(","); el.classList.toggle("hidden",!roles.includes(profile.role));
  });
  go("inicio"); loadAll();
}
function go(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  $("page-"+page)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.page===page));
  $("page-title").textContent=({inicio:"Painel inicial",escolas:"Unidades escolares",alunos:"Cadastro de alunos",matriculas:"Matrículas",turmas:"Turmas",diario:"Diário de classe",relatorios:"Relatórios"})[page]||"Gestão Escolar";
  if(page==="diario") loadLessons();
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.goto)));

async function requireConfig(){
  if(!configured){$("login-error").textContent="Configure a URL e a chave pública do Supabase em assets/app.js antes de entrar.";return false;}
  return true;
}
$("login-form").addEventListener("submit",async e=>{
  e.preventDefault(); $("login-error").textContent="";
  if(!await requireConfig()) return;
  const {data,error}=await supabase.auth.signInWithPassword({email:$("email").value,password:$("password").value});
  if(error){$("login-error").textContent="Não foi possível entrar. Confira o e-mail e a senha ou fale com o administrador.";return;}
  await loadProfile(data.user);
});
async function loadProfile(user){
  const {data,error}=await supabase.from("profiles").select("*").eq("id",user.id).single();
  if(error||!data){$("login-error").textContent="Usuário autenticado, mas sem perfil institucional. Solicite ao administrador a liberação do acesso.";await supabase.auth.signOut();return;}
  showApp(data,user);
}
$("logout").addEventListener("click",async()=>{if(supabase) await supabase.auth.signOut(); location.reload();});
if(supabase) supabase.auth.getSession().then(({data})=>{if(data.session) loadProfile(data.session.user);});

async function fetchRows(table,select="*"){
  const {data,error}=await supabase.from(table).select(select).order("created_at",{ascending:false}).limit(500);
  if(error) throw error; return data||[];
}
async function loadAll(){
  try{
    const [schools,students,classes,enrollments]=await Promise.all([
      fetchRows("schools"),fetchRows("students","*, schools(name)"),fetchRows("classes","*, schools(name)"),fetchRows("enrollments","*, students(full_name), classes(name)")
    ]);
    cachedSchools=schools;cachedStudents=students;cachedClasses=classes;
    $("stat-escolas").textContent=schools.length;$("stat-alunos").textContent=students.length;
    $("stat-turmas").textContent=classes.length;$("stat-matriculas").textContent=enrollments.filter(x=>x.status==="ativa").length;
    $("report-students").textContent=students.length;$("report-classes").textContent=classes.length;$("report-enrollments").textContent=enrollments.filter(x=>x.status==="ativa").length;
    renderSchools();renderStudents();renderClasses();renderEnrollments(enrollments);fillSelects();
  }catch(e){notice("Não foi possível carregar os dados. Verifique as políticas de acesso e a conexão com o banco.",true);console.error(e);}
}
function fillSelect(id,items,labelFn,placeholder="Selecione"){
  const el=$(id);if(!el)return;const old=el.value;
  el.innerHTML=`<option value="">${placeholder}</option>`+items.map(x=>`<option value="${x.id}">${escapeHtml(labelFn(x))}</option>`).join("");
  if(items.some(x=>x.id===old))el.value=old;
}
function fillSelects(){
  fillSelect("student-school",cachedSchools,x=>x.name);
  fillSelect("class-school",cachedSchools,x=>x.name);
  fillSelect("enrollment-student",cachedStudents,x=>x.full_name);
  fillSelect("enrollment-class",cachedClasses,x=>`${x.name} — ${x.grade_level}`);
  fillSelect("diary-class",cachedClasses,x=>`${x.name} — ${x.grade_level}`);
  fillSelect("attendance-class",cachedClasses,x=>`${x.name} — ${x.grade_level}`);
  fillSelect("class-teacher",[],x=>x.full_name,"Cadastre/atribua professor pelo administrador");
}
function renderSchools(){ $("schools-body").innerHTML=cachedSchools.map(s=>`<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.inep_code||"—")}</td><td>${escapeHtml(s.address||"—")}</td><td>${escapeHtml(s.phone||"—")}</td></tr>`).join("")||'<tr><td colspan="4">Nenhuma escola cadastrada.</td></tr>'; }
function renderStudents(){ $("students-body").innerHTML=cachedStudents.map(s=>`<tr><td>${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.birth_date||"—")}</td><td>${escapeHtml(s.guardian_name||"—")}</td><td>${escapeHtml(s.schools?.name||"—")}</td></tr>`).join("")||'<tr><td colspan="4">Nenhum aluno cadastrado.</td></tr>'; }
function renderClasses(){ $("classes-body").innerHTML=cachedClasses.map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.grade_level)}</td><td>${escapeHtml(c.shift)}</td><td>${c.school_year}</td><td>${escapeHtml(c.schools?.name||"—")}</td></tr>`).join("")||'<tr><td colspan="5">Nenhuma turma cadastrada.</td></tr>'; }
function renderEnrollments(rows){ $("enrollments-body").innerHTML=rows.map(e=>`<tr><td>${escapeHtml(e.students?.full_name||"—")}</td><td>${escapeHtml(e.classes?.name||"—")}</td><td>${e.school_year}</td><td>${escapeHtml(e.status)}</td></tr>`).join("")||'<tr><td colspan="4">Nenhuma matrícula cadastrada.</td></tr>'; }

async function insertForm(formId,table,transform=(x)=>x){
  const form=$(formId);form.addEventListener("submit",async e=>{
    e.preventDefault();const obj=transform(formObject(form));
    try{const {error}=await supabase.from(table).insert(obj);if(error)throw error;form.reset();notice("Registro salvo com sucesso.");await loadAll();}
    catch(err){console.error(err);notice("Não foi possível salvar. Verifique os campos obrigatórios e suas permissões.",true);}
  });
}
insertForm("school-form","schools");
insertForm("student-form","students",x=>({...x,birth_date:x.birth_date||null,guardian_name:x.guardian_name||null,guardian_phone:x.guardian_phone||null,notes:x.notes||null}));
insertForm("class-form","classes",x=>({...x,school_year:Number(x.school_year),teacher_id:x.teacher_id||null}));
insertForm("enrollment-form","enrollments",x=>({...x,school_year:Number(x.school_year)}));
insertForm("lesson-form","lessons",x=>({...x,teacher_id:currentProfile?.id}));

async function loadLessons(){
  try{
    const {data,error}=await supabase.from("lessons").select("lesson_date,subject,content,classes(name)").order("lesson_date",{ascending:false}).limit(30);
    if(error)throw error;
    $("lessons-body").innerHTML=(data||[]).map(l=>`<tr><td>${l.lesson_date}</td><td>${escapeHtml(l.classes?.name||"—")}</td><td>${escapeHtml(l.subject)}</td><td>${escapeHtml(l.content)}</td></tr>`).join("")||'<tr><td colspan="4">Nenhuma aula registrada.</td></tr>';
  }catch(e){console.error(e);}
}
$("load-attendance").addEventListener("click",async()=>{
  const classId=$("attendance-class").value,date=$("attendance-date").value;
  if(!classId||!date){notice("Selecione uma turma e uma data.",true);return;}
  try{
    const {data,error}=await supabase.from("enrollments").select("student_id,students(id,full_name)").eq("class_id",classId).eq("school_year",Number(date.slice(0,4))).eq("status","ativa");
    if(error)throw error;
    attendanceRows=(data||[]).map(x=>({student_id:x.student_id,name:x.students.full_name,status:"presente"}));
    $("attendance-list").innerHTML=attendanceRows.map((x,i)=>`<div class="attendance-row"><strong>${escapeHtml(x.name)}</strong><select data-attendance="${i}"><option value="presente">Presente</option><option value="falta">Falta</option><option value="justificada">Falta justificada</option></select></div>`).join("")||"<p class='muted'>Não há alunos ativos nesta turma/ano.</p>";
    $("attendance-list").querySelectorAll("select").forEach(s=>s.addEventListener("change",()=>attendanceRows[Number(s.dataset.attendance)].status=s.value));
    $("save-attendance").classList.toggle("hidden",attendanceRows.length===0);
  }catch(e){console.error(e);notice("Não foi possível carregar a lista de alunos.",true);}
});
$("save-attendance").addEventListener("click",async()=>{
  const classId=$("attendance-class").value,date=$("attendance-date").value;
  try{
    const payload=attendanceRows.map(x=>({class_id:classId,student_id:x.student_id,attendance_date:date,status:x.status,recorded_by:currentProfile.id}));
    const {error}=await supabase.from("attendance").upsert(payload,{onConflict:"class_id,student_id,attendance_date"});
    if(error)throw error;notice("Frequência salva com sucesso.");
  }catch(e){console.error(e);notice("Não foi possível salvar a frequência. Verifique as permissões.",true);}
});
$("attendance-date").value=today;
document.querySelectorAll('input[name="school_year"]').forEach(x=>x.value=new Date().getFullYear());
