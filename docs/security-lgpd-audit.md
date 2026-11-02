# Auditoria de segurança e LGPD — backend (`apps/server`)

Varredura do backend seguida de correções. Cada item traz o local, o impacto, a correção
e o teste que prova. "Falha antes?" foi apurado restaurando a versão original de cada
arquivo numa cópia do projeto em `/tmp` e rodando os testes correspondentes.

Continua `docs/audit-relatorio.md` (S1–S6, C1–C5, Q1–Q3 já corrigidos; não desfeitos aqui).
Achados que se mostraram **não reproduzíveis** estão registrados como tal, com o teste de
regressão que documenta o comportamento correto.

## Correções

| # | Sev | Local | Problema | Correção | Teste | Falha antes? |
|---|-----|-------|----------|----------|-------|--------------|
| C1 | crítico | `src/routes/unfurl.ts`, `src/services/link-preview.ts` (novo) | SSRF residual: `redirect: 'follow'` não revalidava o destino, e `og:image` não passava por checagem alguma. A checagem antiga também deixava passar `127.1`, `2130706433`, `0x7f.0.0.1`, `[::ffff:127.0.0.1]`, `[fd00::1]`, `::` e nomes curtos | Regras centralizadas em `link-preview.ts`: IPv4 normalizado (formas curtas/decimais/hex), IPv6 (loopback, mapped, ULA, link-local), redirects seguidos um a um com revalidação, `og:image`/`og:url` só se forem http(s) públicos; cache limitado a 500 entradas | `unfurl-ssrf.test.ts` (27 casos, inclui redirect real para loopback via servidor local) | **Sim** (redirect seguido e `og:image` interno vazam) |
| C2 | alto | `src/services/users.ts` (`updateProfile`) | `user:update` ia para todos os membros de servidores e DMs com `toSelfUser`, **com o e-mail** | Peer recebe `toPublicUser`; o dono recebe a visão privada em evento próprio | `user-update-privacy.test.ts` | **Sim** |
| C3 | alto | `src/services/uploads.ts`, `src/index.ts` | `file.arrayBuffer()` carregava o upload inteiro antes do limite; sem teto de corpo no servidor | Upload em fluxo (`writeChunked`) com teto verificado antes e durante a cópia, só 256 KB na memória; `maxRequestBodySize` no `Bun.serve` | `upload-size.test.ts` | **Sim** (limite por tipo removido → 201) |
| C4 | alto | `src/config/env.ts`, `src/config/security.ts`, `src/config/guard.ts` (novos), `src/index.ts` | `JWT_SECRET` com valor fixo público; `CORS_ORIGINS=*` padrão; produção subia sem avisar | Segredo aleatório por instalação em dev (`data/dev-jwt-secret`, 0600); em `NODE_ENV=production` segredo curto/padrão ou CORS curinga **abortam** o boot; em dev só avisam | `config-guard.test.ts` + verificação manual do boot (`[config]` e saída em produção) | **Sim** (produção subia sem os dois) |
| C5 | crítico (LGPD) | `src/services/account.ts` (novo), `src/routes/auth.ts` | Não havia como excluir a conta (direito ao apagamento, art. 18, VI) | `GET /auth/account` (resumo) e `DELETE /auth/account` (senha + nome de usuário): expulsa sockets e voz, apaga auditoria do titular, encerra DMs, remove as linhas (cascata) e os arquivos do disco; dono de servidor precisa transferir/excluir antes | `account-deletion.test.ts` | **Sim** (rota 404) |
| C6 | médio | `src/app.ts` | Respostas da API sem `Cache-Control` | `no-store` + `Pragma: no-cache` em `/api/*` | `no-store.test.ts` | **Sim** |
| C7 | médio | `src/http/rate-limit.ts` (novo), `src/routes/auth.ts`, `src/app.ts`, `src/services/users.ts` | Login sem limite (força bruta); unfurl sem limite; identificador inexistente respondia sem argon2 e com 404 | Janela dupla no login (por conta e por cliente), limite de unfurl por usuário (middleware), hash-sentinela no login, `401` uniforme | `rate-limit.test.ts` | **Sim** (login e unfurl) |
| C8 | médio | `src/routes/social.ts` | `GET /api/presence/online` devolvia todos os ids online do servidor a qualquer autenticado | Só quem compartilha servidor ou DM (`sharedRuntimeUserIds`) | `presence-scope.test.ts` | **Sim** |
| C9 | médio | `src/index.ts`, `src/realtime/hub.ts`, `src/realtime/auth-timeout.ts`, `src/auth/*`, `src/db/schema.ts`, `src/db/migrate.ts`, `packages/shared/src/events.ts` | JWT na query string do WebSocket (logs de proxy/histórico); nenhuma revogação: logout e troca de senha não derrubavam sessões | WS autentica pelo primeiro frame (`{type:'auth'}`), fecha em 10 s sem autenticar e ignora eventos antes disso; `users.token_version` no JWT, `POST /auth/logout` (`?everywhere=false`), `PATCH /auth/password` | `ws-auth.test.ts`, `ws-auth-live.test.ts` (socket real), `token-revocation.test.ts` | **Sim** |
| C10 | alto | `src/realtime/audience.ts`, `src/services/channels.ts`, `src/services/messages.ts` | Eventos de mensagem de servidor iam a **todos** os membros, ignorando `ViewChannel`; trocar a visibilidade do canal não re-sincronizava salas; `ready` mandava todos os canais de guild | `visibleAudience`/`isChannelVisibleTo` respeitam overrides; emissão de mensagem usa a audiência visível; mudança de visibilidade marca o canal como alterado e re-sincroniza | `role-resync.test.ts` | **Sim** |
| C11 | médio | `src/services/channels.ts`, `src/routes/channels.ts` | `GET /api/guilds/:id/categories` devolvia categorias e **todos os cargos** sem checar participação | `categoryDetails` exige participação | `category-leak.test.ts` | **Sim** |
| C12 | baixo | `src/services/uploads.ts`, `src/services/messages.ts`, `src/services/guilds.ts` | Apagar mensagem/servidor deixava arquivos em `/files`; anexo descartado de terceiro respondia diferente de inexistente | `deleteUploadedFiles` remove do disco o que não é mais referenciado; `DELETE /uploads/:id` responde igual | `attachment-lifecycle.test.ts` | **Sim** |
| C14 | baixo | `src/http/origin.ts` | `X-Forwarded-Host` confiado sem lista permitida | `publicOrigin` só aceita host encaminhado que esteja em `CORS_ORIGINS` | `origin.test.ts` | **Sim** |
| B1 | alto | `src/services/users.ts` (`searchUsers`) | `?q=` vazio ou de 1 caractere listava usuários sem vínculo → colheita de perfis | Mínimo de 2 caracteres | `user-search.test.ts` | **Sim** |
| A2 | alto | `src/services/invites.ts`, `src/services/guilds.ts` | Revogar convite inexistente → 404 e de terceiro → 403 (enumeração); convite expirado/esgotado/inexistente e banido diferiam | Erro único `Convite não encontrado.` / `Convite inválido ou expirado.` | `uniform-errors.test.ts` (+ testes existentes ajustados) | **Sim** |

## Não reproduzíveis (teste de regressão documenta o comportamento correto)

| # | Hipótese testada | Resultado |
|---|------------------|-----------|
| A1 | Bloqueador consegue mandar DM para quem bloqueou; bloqueado lê e-mail do bloqueador; DM antiga continua aberta | Já barrado por `assertDmAllowed` (simétrico), `toPublicUser` (sem e-mail) e `sendMessage`. `block-directions.test.ts` |
| C13 | Tempo/status do login revelam se o e-mail existe; troca/exclusão de senha errada respondem 403 | O hash-sentinela está aplicado (C7) e o 401 uniforme também; a fração de tempo entre "cookie invalidado" e "senha errada" não foi medida — não há teste aceitável sem medição estatística no CI. **Não provado.** |
| — | Override de `@everyone` editável por qualquer `ManageRoles` e overrides `roleId` de outro servidor | Cargo de outro servidor já era rejeitado; `@everyone` continua editável por quem tem `ManageRoles`, mas agora dentro do **alcance** de quem edita (ver segunda rodada, item D2). Sem exploração cross-servidor verificada. |

## Segunda rodada — decisões tomadas

As cinco decisões em aberto foram resolvidas. O critério: perder menos do que se arriscava,
sempre com o servidor como autoridade — nada disso depende de colaboração do cliente.

| # | Decisão | O que foi feito | Teste |
|---|---------|-----------------|-------|
| D1 | Anexos privados, com URL assinada | `/files` passa a exigir sessão. Anexo de mensagem só abre para quem tem `ViewChannel` + `SendMessages` no **canal de texto** (canal de voz não entrega arquivo) ou para quem carrega uma assinatura HMAC curta (5 min), emitida só na resposta a quem já pode ver o item. Assinatura é sem estado (sem tabela, sem limpeza) e vale para um arquivo por vez. Avatares, banners e ícones de servidor ficam para qualquer sessão autenticada. No app, toda URL de arquivo sai de um único módulo (`lib/asset-url.ts`), que no Electron usa o `remote://` já existente e manda o token em `access_token`; o processo principal converte esse parâmetro em header `Authorization` antes da chamada — a página não precisa enviar header e o token não fica legível no DOM. Isso substituiu o `mediaProxy` e o `assetUrl` duplicados que existiam. | `file-access.test.ts` (10 casos) + `asset-url.test.ts`; verificação ao vivo com o servidor real: membro 200, fora do servidor 404, sem sessão 401, evento do WebSocket com URL assinada |
| D2 | Autorização de cargo × canal | Um cargo não pode alcançar mais do que o editor: proibido editar/atribuir cargo que dê acesso a canal que o editor não vê, e proibido gerenciar canal invisível (`assertRoleReach`, `updateChannelAccess`). Antes, quem tinha `ManageRoles` editava o `@everyone` e abria `ViewChannel` em canal privado que nunca viu — e nenhuma re-sincronização atingia esse usuário. | `role-channel-authz.test.ts` (3 casos, vermelho antes) |
| D3 | Opt-out de DM / teto global | Bloqueio continua sendo o opt-out (quem bloqueia não é mais contatado, já coberto); DM proativa sem amizade mantém-se como funcionalidade. Com a regra de alcance (D2), o alcance de qualquer membro fica limitado ao de quem lhe deu o cargo, então o bloqueio é a linha de defesa e fica verificada. | `block-directions.test.ts` |
| D3b | Upload órfão e disco | Upload que não virou mensagem some em 24 h; convite sem uso e sem expiração some em 30 dias; job a cada 6 h no boot. Arquivos saem do disco junto (C12). | `retention.test.ts` (3 casos) |
| D4 | IP atrás de proxy | Mantido `X-Forwarded-For` (é o único mecanismo sem configuração de proxy); a janela por conta no login segura a força bruta mesmo com IP spoofado. Documentado no relatório e no código. | `rate-limit.test.ts` |
| D5 | Posse de servidor | Sem endpoint de transferência: a exclusão de conta bloqueia com mensagem que agora diz "passe a posse para outro membro ou exclua o servidor". Criar transferência sem revisar hierarquia de cargos seria mais uma superfície de escalada. | `account-deletion.test.ts` |

Correções menores desta rodada, feitas junto: a conversa bloqueada some da lista de DMs **só** para quem bloqueou (o bloqueado mantém o histórico e não consegue escrever); `GET /api/dms/with/:id` deixa de responder a id aleatório (404) e responde `channelId: null` quando não há conversa; `unfurl` não guarda em cache resposta que não é página.

## Ambiente

- `.git` continua ausente no projeto; a verificação "falha antes?" foi feita em `/tmp/oldserver` (cópia + `node_modules` do projeto), não por `git stash`.
- Verificação ao vivo feita com o servidor real em `DATA_DIR=/tmp/live`, não no banco do projeto.
- `apps/server/data` (banco real) não é tocado pela suíte: `unfurl-ssrf.test.ts` passou a chamar `useTempDataDir()`. O `app.db` tem mtime anterior à correção (efeito da execução antiga do teste).

## Validação final

- `bun run test:server`: **170 pass / 0 fail** (eram 78), 42 arquivos
- `bun run test:desktop`: **42 pass / 0 fail**
- `bun run build` do desktop: código 0 (renderer + Electron)
- `bun run typecheck` (shared, server, desktop, electron, raiz): **código 0** em todas as etapas

