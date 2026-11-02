# Relatório de correções — sistema de calls (voz/WebRTC)

Cada defeito abaixo foi reproduzido com um teste de regressão, confirmado falhando
no código antigo e passando após a correção.

## Servidor (`apps/server`)

| # | Local | Sintoma | Causa | Correção |
|---|-------|---------|-------|----------|
| 1 | `src/services/voice.ts:196-201` | Quem tem só "Silenciar membros" (`MuteMembers`) não consegue ensurdecer ninguém, mesmo o Discord deixando | O gate exigia `MuteMembers` para todo `serverDeaf` também | `serverDeaf` aceita `MuteMembers` **ou** `MoveMembers`; `serverMute` segue exigindo `MuteMembers`; `disconnect` exige `MoveMembers` |
| 2 | `src/services/voice.ts:174` | Membro com `serverDeaf` consegue se desensurdecer localmente | `updateSelfVoice` considerava só `serverMute`, nunca `serverDeaf` | `serverDeaf` agora força `selfDeaf = true` (e mute) |
| 3 | `src/services/voice.ts:174` | Usuário ensurdecido continua transmitindo áudio (o microfone não segue o ensurdecimento) | Mexer em `selfDeaf` não mexia em `selfMute` | Ensurdecer implica mudo (`selfMute = selfDeaf ? true : …`) |
| 4 | `src/services/voice.ts:134` | Trocar de canal de voz perde o mute/ensurdecido do usuário | `selfMute: existing?.selfMute \|\| !canSpeak` copiava `selfMute` mas mantinha `selfDeaf` do estado anterior, deixando os dois inconsistentes | Estado recalculado a partir de `existing.selfDeaf` (que implica mute); `selfMute` antigo não é mais reaproveitado |
| 5 | `src/services/voice.ts:58` | Ao reconectar, o cliente não sabe quem ouve quem (overrides de `Speak` mudam sem evento) | `voice:sync` só carregava `states` | Novo `voice:sync.audience` (canal × usuário com `Speak`), montado por `currentCallAudience` → `hub.voiceAudience` |

## Cliente (`apps/desktop`)

| # | Local | Sintoma | Causa | Correção |
|---|-------|---------|-------|----------|
| 6 | `src/app/stores/chat.ts` (`voice:state`) | Par de call com `serverDeaf` volta a ser ouvido quando ele mexe no próprio som | `if (serverMute \|\| serverDeaf) true else selfDeaf` — o flag de servidor era sobrescrito | `serverMute \|\| serverDeaf \|\| selfDeaf` |
| 7 | `src/app/stores/chat.ts` (reconnect) | Qualquer `voice:sync` sem a própria linha derrubava `myVoice`, encerrando a call | `myVoice` era sempre reescrito como `null` quando ausente | Sync sem a própria linha mantém a call; saída explícita continua via `voice:leave` |
| 8 | `src/app/stores/chat.ts` (`voice:sync`) | Quem já estava ensurdecido antes do reconnect nunca ficava mudo localmente | Sync não aplicava `setPlaybackMuted` | Sync passa por todos os pares; e refaz o diff da malha |
| 9 | `src/app/stores/chat.ts` (`voice:state`) | Entrar numa call que a pessoa não abriu (ou outro visualizando o mesmo canal) ficava sem áudio entre os dois | `syncVoiceMesh` só era chamado em `joinVoice`; nenhum evento conectava peers tardios | `reconcileVoiceMesh` ao receber `voice:state` de um peer no meu canal |
| 10 | `src/app/stores/chat.ts` (`voice:leave`) | Peer que sai/sai por queda continua tocando áudio até o próximo join | `voice:leave` só limpava o roster, a conexão RTC continuava | `disconnectVoicePeer` no `voice:leave` de outro usuário |

## Suporte novo

- `VoiceRtc.connectedPeers()` (`src/lib/voice-rtc.ts`)
- `reconcileVoiceMesh(channelId, peerIds)` / `disconnectVoicePeer(userId)` (`src/lib/voice-session.ts`)
- `ServerEvent 'voice:sync'` ganhou `audience?` (`packages/shared/src/events.ts`)

## Testes de regressão

- `apps/server/test/voice-logic.test.ts` — 7 casos
- `apps/desktop/test/voice-store.test.ts` — 8 casos

## Correção pendente (decisão sua)

- **Áudio da tela ignora mute/ensurdecimento:** `VoiceRtc.setSelfMuted` só desabilita as faixas de
  microfone (`localStream`), então quem compartilha tela com áudio continua sendo ouvido mesmo mutado.
  Corrigir exige decidir se mutar deve calar também o áudio da tela (mudança de comportamento de produto),
  por isso não foi alterado sem sua confirmação.

## Estado final

- `apps/server`: 65 testes passando, `tsc --noEmit` limpo
- `apps/desktop`: 21 testes passando, `tsc --noEmit` limpo
