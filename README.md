# Gestão Escolar Municipal — pacote inicial

Este pacote contém uma aplicação web inicial para gestão de rede municipal, com:
- Painel de indicadores;
- Cadastro de escolas;
- Cadastro de alunos;
- Cadastro de turmas;
- Matrículas;
- Diário de classe (registro de aula);
- Frequência por aluno;
- Estrutura de banco PostgreSQL no Supabase com autenticação e políticas RLS.

## Arquivos
- `index.html`: telas da aplicação.
- `assets/styles.css`: identidade visual responsiva.
- `assets/app.js`: integração com Supabase.
- `database/schema.sql`: tabelas, funções e políticas de segurança iniciais.

## Requisitos
- Conta Supabase;
- Conta Cloudflare;
- Conta GitHub (opcional, mas recomendada);
- Um responsável técnico para revisar e manter o ambiente.

## Etapa 1 — Criar o banco no Supabase
1. Acesse https://supabase.com/ e crie um projeto.
2. Guarde a senha do banco em local seguro. Não a compartilhe.
3. Abra SQL Editor > New query.
4. Copie todo o conteúdo de `database/schema.sql`, cole e execute.
5. Em Project Settings > API, copie a Project URL e a chave `anon`/publishable.
6. Abra `assets/app.js` e substitua:
   - `COLE_AQUI_A_URL_DO_PROJETO`
   - `COLE_AQUI_A_CHAVE_ANON_PUBLIC`
   Use somente a chave pública anon/publishable no navegador. NUNCA use `service_role` no frontend.

## Etapa 2 — Publicar os arquivos no Cloudflare Pages
1. Acesse https://github.com/ e crie um repositório privado para guardar o código.
2. Envie a pasta do projeto para o repositório.
3. Acesse https://dash.cloudflare.com/ e crie/acesse sua conta.
4. Entre em Workers & Pages > Create > Pages > Connect to Git.
5. Escolha o repositório.
6. Framework preset: None.
7. Build command: deixe vazio.
8. Build output directory: `/` (ou `.` se a interface solicitar).
9. Clique em Save and Deploy.
10. O Cloudflare fornecerá um endereço `*.pages.dev`.

Alternativa para teste: Cloudflare Pages > Direct Upload e envie os arquivos do projeto (a pasta que contém `index.html`, `assets` e `database`).

## Etapa 3 — Configurar autenticação
1. No Supabase, abra Authentication > URL Configuration.
2. Configure Site URL com o endereço `https://SEU-PROJETO.pages.dev`.
3. Adicione esse endereço em Redirect URLs.
4. Em Authentication > Users, crie o primeiro usuário administrador.
5. O cadastro em `auth.users` não cria automaticamente o perfil da aplicação. Depois de criar o usuário, execute no SQL Editor, substituindo os valores:

```sql
insert into public.profiles (id, full_name, role, school_id)
values ('UUID_DO_USUARIO_AUTH', 'Administrador da Secretaria', 'secretaria', null);
```

6. Crie os demais usuários em Authentication > Users e cadastre seus perfis:
   - `secretaria`: Secretaria Municipal, `school_id` nulo;
   - `gestor`: direção/gestão de uma escola, informar `school_id`;
   - `secretario_escolar`: secretaria escolar, informar `school_id`;
   - `professor`: professor, informar `school_id`.
7. Para vincular professor a uma turma, atualize `classes.teacher_id` com o UUID do perfil correspondente.

## Etapa 4 — Primeiro uso
1. Entre com o usuário da Secretaria.
2. Cadastre as escolas.
3. Cadastre os perfis dos gestores, secretários escolares e professores.
4. Cadastre alunos e turmas.
5. Faça as matrículas vinculando aluno e turma.
6. Atribua professores às turmas.
7. Professores poderão registrar aulas e frequência.

## Domínio próprio
No Cloudflare Pages, abra Custom domains e adicione um domínio que a Prefeitura controle, por exemplo `educacao.seumunicipio.ba.gov.br`. O responsável pelo domínio/DNS deverá autorizar os registros indicados pelo Cloudflare. Não use domínio sem autorização formal da Prefeitura.

## MUITO IMPORTANTE — antes de usar dados reais
Este é um MVP inicial para implantação assistida, não um sistema homologado nem uma solução pronta para produção crítica. Antes de inserir dados reais de estudantes:
- Contrate/indique responsável técnico para revisar todas as políticas RLS e testar acessos com contas de cada perfil;
- Defina formalmente controlador, operador, bases legais, finalidade, transparência, retenção e atendimento aos direitos dos titulares conforme LGPD e regras específicas de crianças e adolescentes;
- Faça avaliação de impacto/risco quando aplicável;
- Configure MFA para administradores, política de senhas e recuperação de conta;
- Configure backups, teste restauração e plano de continuidade;
- Não armazene documentos, laudos, dados de saúde ou outros dados sensíveis sem necessidade e controles específicos;
- Não disponibilize listas nominais publicamente;
- Restrinja exportações e registre operações administrativas;
- Faça teste de segurança e validação pedagógica/administrativa antes da implantação.

O código inicial cobre o cadastro e a rotina básica. Ainda precisam ser desenvolvidos e homologados: boletim, fechamento de período, conselho de classe, histórico escolar oficial, transferência formal, relatórios legais, importação/exportação, gestão documental, trilha de auditoria detalhada, notificações, recuperação de senha com fluxo institucional e fluxos de aprovação.

## Observação sobre o diário
O módulo inicial registra aula e frequência. O campo de notas/avaliações possui tabela no banco, mas a interface de lançamento de notas ainda precisa ser implementada e testada antes do uso oficial.

## Suporte técnico
A aplicação depende de conexão à internet e do projeto Supabase configurado. Guarde o acesso administrativo e as credenciais em cofre institucional, nunca em planilhas públicas ou mensagens.
