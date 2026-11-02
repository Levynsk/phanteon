# Relatório de auditoria — melhorias no sistema

Varredura do sistema inteiro (server, cliente, UI, Electron, qualidade) seguida de correções.
Cada item foi verificado no código antes de ser corrigido. "Falha antes?" indica se o teste
de regressão foi executado contra o código antigo e falhou.

## Segurança e privilégio

| # | Local | Problema | Correção | Falha antes? |
|---|-------|----------|----------|--------------|
| S1 | `apps/server/src/services/guilds.ts` (`updateChannel`) | Override de canal de voz aceitava qualquer `roleId`, inclusive de outro servidor, e um usuário com `ManageChannels` (sem ser dono) podia conceder permissões que não tinha — escalada de privilégio | Valida cargo do próprio servidor, rejeita repetição e bloqueia `allow` fora das permissões do autor; `@everyone` continua aceito | Sim (`channel-overrides.test.ts`, 3 casos) |
| S2 | `apps/desktop/electron/window.ts` | O handler da janela abria **qualquer** URL em `shell.openExternal` (`file://`, `smb://`, protocolos customizados), ignorando o filtro http/https de `main.ts` | `electron/external-links.ts` centraliza a regra; usada nos dois handlers | Sim (`external-links.test.ts`) |
| S3 | `apps/server/src/db/mappers.ts` | `toPublicUser` sempre incluía o e-mail; qualquer pessoa podia obtê-lo pedindo amizade e lendo o push | `toPublicUser` não tem e-mail; novo `toSelfUser` só para o próprio usuário (login, `/me`, perfil próprio) | Sim (`user-email.test.ts`) |
| S4 | `apps/server/src/services/guilds.ts` (`joinGuildByInvite`) | Resgate de convite não transacional: `maxUses` e ban verificados fora da escrita | UPDATE condicional reivindica o uso; ban re-checado na mesma transação | Não reproduzível no Bun (SQLite serializa transações) — código correto, teste documenta |
| S5 | `apps/server/src/services/messages.ts` (`listMessages`) | Alegação do audit: histórico ignorava `ViewChannel` | **Não reproduzível** — `assertChannelAccess` já barra canal privado | N/A (teste de regressão adicionado) |
| S6 | `apps/desktop/src/features/settings/ChannelsTab.tsx` | Salvar categoria antes do editor carregar enviava o rascunho vazio e **apagava o acesso de todos os cargos** | `categoryUpdatePayload` só envia acesso quando já carregado; editor avisa via `onLoaded` | Sim (payload antigo incluía `roleIds: []`) |

## Cliente — comportamento

| # | Local | Problema | Correção | Falha antes? |
|---|-------|----------|----------|--------------|
| C1 | `apps/desktop/src/app/stores/chat.ts` (`voice:sync`) | Reconciliação da malha de voz só rodava se a própria linha viesse no sync, então peers que saíram enquanto offline continuavam tocando | Reconcilia sempre que estou em chamada | Sim |
| C2 | `apps/desktop/src/app/stores/chat.ts` (`upsertMember`) | Quem entrava no servidor aparecia offline para todos (evento montado da visão do próprio entrante) | Um membro que chega está conectado: `online: true` | Sim |
| C3 | `apps/desktop/src/components/modals/ChannelModals.tsx` | Desfazer deny de Connect/Speak não tinha efeito (não enviava nada quando tudo era permitido) | Sempre envia o override `@everyone` com `allow`/`deny` corretos | Sim (helper) + teste ponta a ponta no servidor |
| C4a | `chat.ts` (`typing`) | Indicador de digitação sumia 6 s após o **primeiro** pacote, mesmo digitando | Timer por usuário re-armado a cada pacote; `reset()` limpa timers pendentes | Sim |
| C4b | `apps/desktop/src/pages/AppPage.tsx` | Falha de rede/5xx ao abrir servidor redirecionava para `/app` (parece logout) | Só 403/404 mandam para casa (`shouldLeaveGuildOnError`) | Função nova (testada) |
| C4c | `apps/desktop/src/app/stores/auth.ts` | Logout não limpava estado do chat: outra conta via dados da anterior | `logout` chama `chat.reset()` | Sim |
| C5 | `apps/desktop/src/features/channels/ChannelSidebar.tsx` | Arrastar canal sempre caía na zona "topo" (drop borbulhava e este era tratado primeiro) | A origem do arrasto consome o drop; drop solto em área vazia não muda nada | Manual (precisa de DOM real) |

## Qualidade

| # | Problema | Correção |
|---|----------|----------|
| Q1 | `package.json` da raiz era cópia do desktop: sem workspaces, `bun run` na raiz rodava o app | Raiz real com `workspaces` e scripts `test`, `typecheck`, `build`, `dev`, `start` delegando aos pacotes (verificado com `bun run test` e `bun run typecheck`) |
| Q2 | `tsconfig.json` da raiz não tipava nada; desktop com caminhos mortos de `welcome-ui` | Base estrita (`strict` + `noUncheckedIndexedAccess`) confirmada com 0 erros no desktop; raiz limitada a `server.ts`; `typecheck:electron` adicionado |
| Q3 | `test2.zip` (6,5 MB) e `apps/server/test.zip` versionados | Removidos; `.gitignore` reescrito e coerente |

## Validação final

- `bun run typecheck` na raiz: 5 etapas (shared, server, desktop, **electron**, raiz) — todas `Exited with code 0`
- `bun run test` na raiz: servidor **74 pass / 0 fail** (eram 58), desktop **37 pass / 0 fail** (eram 13)

## Pendências / decisões

- **Contrato de `email`:** `PublicUser.email` passou a opcional; `GET /api/users/:id` de outra pessoa antes devolvia `email: ""` e agora omite o campo.
- **C5** precisa de verificação manual com mouse (drag real).
- **S4** não pode ser provado por teste no Bun sem quebrar a serialização das transações.
- **Fora do escopo deste relatório:** furos menores ainda abertos pelos audits (SSRF por redirect no unfurl, upload carregado inteiro em memória, virtualização da lista de mensagens).
- **Sem versionamento:** o diretório não tem `.git`, então "remover do repositório" foi aplicado ao disco; a higiene só tem efeito a partir do primeiro commit.
