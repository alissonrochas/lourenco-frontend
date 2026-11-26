# Horários e bloqueios da agenda — Etapa 8

## Diagnóstico e contratos

O backend existente já possui agenda única, funcionamento semanal, múltiplos intervalos, bloqueios semanais de uma hora e exceções por data. O motor de disponibilidade lê esses dados em snapshot consistente e exclui ocupação por reservas confirmadas. O frontend público continua usando exclusivamente a resposta da API, sem reproduzir suas regras.

| Operação | Endpoint existente | Contrato |
| --- | --- | --- |
| Ler semana | GET `/api/admin/booking-settings` | `{data:{timezone,slotDurationMinutes,days}}`, sete dias ISO, de segunda=1 a domingo=7 |
| Alterar semana | PATCH `/api/admin/booking-settings` | `{days:[{weekday,isActive,opensAtMinute,closesAtMinute,breaks,slotBlocks}]}`; somente o dia editado |
| Consultar exceções | GET `/api/admin/calendar-exceptions?from=YYYY-MM-DD&to=YYYY-MM-DD` | `{data:{dateBlocks,slotBlocks}}`; API aceita até 93 dias inclusivos |
| Bloquear/liberar | POST `/api/admin/calendar-exceptions` | `{localDate,dayBlock?:{isBlocked,reason?},slotBlocks?:[{startsAtMinute,isBlocked,reason?}]}` |

Todos retornam HTTP 200 na operação válida e usam sessão/adminAuth. PATCH/POST mantêm CSRF. Não foram criados endpoints novos. A interface consulta exceções de **uma data por vez**, embora a API também aceite intervalos.

Persistência existente: `booking_settings`, `weekly_opening_hours`, `weekly_breaks`, `weekly_slot_blocks`, `date_blocks` e `date_slot_blocks`. Exceções não dependem de FK para a configuração semanal; sobrevivem à mudança da semana e podem existir em datas fechadas. Liberações usam `isBlocked:false` no mesmo registro. Intervalos removidos da lista ativa são desativados pelo contrato semanal; não há DELETE na interface.

## Dependência backend

O frontend depende da [PR #15 do backend](https://github.com/alissonrochas/lourenco-backend/pull/15), que acrescenta ETag/If-Match sem mudar corpos JSON, models, schema ou duração. Integrar/publicar esse contrato antes de disponibilizar o novo painel. Um backend anterior, proxy que remova ETag ou CORS desatualizado deixa a seção bloqueada com erro de revisão; não há fallback de escrita sem precondição.

A leitura fornece uma revisão forte entre aspas. Toda escrita do painel envia `If-Match`; o backend compara depois de adquirir a trava SQLite e antes de modificar dados. Uma revisão semanal cobre todos os dias; uma revisão de exceções cobre a data exata consultada. Mudança concorrente resulta em 409 e exige recarregar.

O contrato legado aceita escritores sem precondição para manter compatibilidade; estes não recebem a garantia contra edição desatualizada. A proteção de reservas é obrigatória para todos os escritores, independentemente de If-Match. Detalhes backend em `docs/calendar-concurrency.md` de sua PR.

## Funcionamento semanal

Em `/admin`, escolher **Horários**, selecionar o dia da semana e editar os valores carregados. Nenhum horário de exemplo é aplicado como padrão da barbearia. Dias ausentes vêm do backend como fechados e não configurados.

- Atendimento ativo/inativo; abertura e encerramento em horas cheias.
- Abertura entre 00:00 e 23:00, encerramento até 24:00; início anterior ao fim. Não há expediente atravessando a meia-noite.
- Um ou vários intervalos ativos, dentro do expediente, sem sobreposição. Intervalos adjacentes são permitidos. Os intervalos históricos inativos ficam preservados pelo backend e não são reenviados fora do expediente atual.
- Bloqueios semanais de uma hora podem ser selecionados dentro do expediente. Ao reduzir o expediente, remover/desmarcar intervalos e bloqueios ativos que ficarem fora dele; a UI não os apaga silenciosamente.
- Fechar um dia preserva seus horários configurados. Um dia não configurado pode continuar fechado com limites nulos e sem intervalos/bloqueios ativos.

Salvar envia a configuração efetiva do dia, com arrays de intervalos e bloqueios ativos; o contrato substitui a seleção ativa desses arrays e mantém registros históricos. A revisão evita sobrescrever filhos alterados por outro editor com precondição.

## Exceções e liberação

Consultar uma data carrega registros existentes, incluindo liberados, em ordem da API. A interface mostra motivo administrativo e estado, separados por dia inteiro ou faixa de uma hora. Os motivos não são enviados para endpoints públicos, URLs, storage ou logs.

Escolher Bloquear/Liberar e Dia inteiro/Horários selecionados, marcar uma ou várias horas e informar motivo opcional (até 500 caracteres após trim). Motivo em branco é **omitido** para preservar o anterior; num registro novo permanece nulo. A UI não oferece limpeza de motivo nesta etapa.

Exemplo de bloqueio parcial:

```json
{
  "localDate": "2028-02-29",
  "slotBlocks": [
    {"startsAtMinute":660,"isBlocked":true,"reason":"Compromisso"},
    {"startsAtMinute":960,"isBlocked":true,"reason":"Compromisso"}
  ]
}
```

Liberar usa a mesma chave de negócio e `isBlocked:false`, sem excluir o registro. A interface permite alterar datas de hoje ou futuras; datas passadas são somente consulta. Datas são strings locais canônicas, validadas pelo calendário gregoriano, inclusive anos bissextos. Não são convertidas para instantes UTC.

## Precedência, duração e reservas

O MVP mantém **60 minutos efetivos**, independentemente da duração descritiva dos serviços. Somente horas cheias são configuráveis. Faixas como 10:30–11:30 são rejeitadas, não arredondadas. O motor existente usa interseção de intervalos e não oferece bloco que atravesse almoço ou encerramento.

Fechamento semanal ou excepcional prevalece. Liberar uma exceção não abre dia fechado, não ignora intervalos, bloqueios semanais, outras exceções ou reservas confirmadas. Alterações aparecem após nova consulta da API pública; não foi implementado polling nem regra paralela no frontend público.

Nenhuma configuração cancela, exclui, desloca ou altera reservas automaticamente. O backend já verifica reservas confirmed ainda não encerradas, incluindo as em curso, sob a mesma trava de escrita usada na criação de reservas. Conflito recebe 409 e rollback integral. Snapshots, status e auditoria permanecem iguais.

ETag resolve edições desatualizadas entre escritores participantes; a trava e a proteção de reservas resolvem a disputa entre configuração e criação de reserva. São garantias diferentes, ambas verificadas no servidor. Não houve mudança arquitetural ou migration.

## Interface, acessibilidade e segurança

Agenda, Serviços e Horários compartilham sessão e navegação. A seção só monta depois da confirmação administrativa. Logout ou 401/403 de autorização desmonta os dados privados. 403 CSRF é distinguido pelo código `E_BAD_CSRF_TOKEN`, sem afirmar logout.

Toda escrita exige revisão e confirmação explícita. O diálogo nativo contém o foco, inicia na opção de voltar, fecha por Escape antes do envio e devolve foco ao controle de origem; quando ele não existe mais, usa o título da seção. Labels estão explicitamente associados aos controles. A lista de horas, formulários e navegação se adaptam ao mobile.

Há lock síncrono contra cliques repetidos e bloqueio de navegação entre seções durante a escrita. Respostas antigas são descartadas por abort e geração. Recarregar, consultar outra data ou trocar o dia descarta o formulário não salvo, conforme aviso visível.

401/403 de autorização retiram dados; 422 mantém revisão para correção; 429 respeita Retry-After ou o fallback já existente; 404/409 exigem recarregar. Rede, timeout, 5xx ou sucesso com contrato/revisão inválidos bloqueiam outra escrita até **reconciliação bem-sucedida**. Nenhuma operação incerta é reenviada automaticamente. Uma leitura que falha não desbloqueia o painel.

Reutiliza `apiFetch`, cookies `credentials:include`, bootstrap compartilhado de CSRF e `X-XSRF-TOKEN`. Não usa localStorage/sessionStorage, não acrescenta autenticação, dependências, migrations ou configurações locais. CORS backend apenas permite If-Match e expõe ETag às origens anteriormente autorizadas; a limitação antiga de Retry-After permanece.

## Testes e execução

```bash
npm test
npm run lint
npm run typecheck
npm run build
# Backend da PR #15 com dependências instaladas em ../backend:
E2E_BROWSER_CHANNEL=chrome npm run test:e2e
# Somente os novos fluxos:
E2E_BROWSER_CHANNEL=chrome npm run test:e2e -- --grep 'T[1-6] —'
```

A infraestrutura da PR #6 é mantida: cópias descartáveis, migrations reais, SQLite novo e backend reiniciado por cenário, cookies isolados e cleanup. Não apontar o teste ao banco de desenvolvimento. `E2E_BACKEND_PATH` permite selecionar outro checkout compatível sem mudar .env.

| Cenário real | Evidência |
| --- | --- |
| T1 | Abertura/encerramento, pausas adjacentes, rejeição de sobreposição, persistência, fechar/reabrir dia e consulta pública real |
| T2 | Bloqueios parcial/integral, várias horas, liberação, precedência de outros fechamentos e preservação de IDs/criação |
| T3 | 409 de alteração semanal/data/horário ocupado; rollback e comparação de **todos os campos** da reserva, incluindo snapshots/status/auditoria |
| T4 | Dois navegadores editando a mesma revisão: segunda escrita recusada e primeiro estado preservado |
| T5 | GET anônimo 401, PATCH/POST sem CSRF 403 e limpeza da UI após revogação real |
| T6 | POST real executado e gravado; apenas a resposta é descartada; reconciliação falha e depois passa, sem duplicar/repetir a escrita |

As verificações públicas usam HTTP real contra o motor; configuração e confirmações são feitas no navegador. T6 injeta falha de transporte com `route.fetch/abort`, sem JSON simulado. Os testes anteriores continuam cobrindo usuário comum, sessão invalidada, prevenção de reserva duplicada, concorrência de reservas e os fluxos de serviços. Testes frontend de componentes usam mocks e são classificados separadamente; testes backend de conexões independentes não são apresentados como testes de navegador.

## Resultados e limitações

Validação com Node 24.19.0, Playwright 1.65.1 e Chrome 155.0.8059.79. Frontend: **216 aprovados, zero reprovados** em 11 arquivos. Backend: **100 unitários + 169 funcionais aprovados**, zero reprovados na execução final. E2E: **44 aprovados, zero reprovados** (22 cenários × 2 viewports). As capturas reais desktop/mobile foram inspecionadas, com verificação automatizada de ausência de overflow horizontal. Mobile representa viewport do Chrome, não dispositivo físico.

Lint e build dos dois projetos e typecheck frontend passam. O backend mantém os oito diagnósticos preexistentes do Inertia em marketing/signup, relativos a rotas new_account e campos antigos; nenhum erro novo atribuído à etapa. O frontend mantém o aviso Fast Refresh anterior.

O primeiro recorte encontrou uma ambiguidade entre rótulos e opções dos selects; a associação explícita foi corrigida sem remover a validação de foco/teclado. O isolamento dos novos testes backend também reinicia o contador de rate limiting, como os demais grupos, sem alterar o limite da aplicação. Uma execução em paralelo com navegador/Vitest/builds teve dois timeouts em testes antigos de migrations; a repetição sequencial mantém as asserções e limites originais. O teste de CORS utiliza a origem configurada no ambiente, sem presumir porta ou hostname.

Os hashes de ambientes, lockfiles, shim local e banco original são comparados com a inspeção inicial; o runner gera `test-results/preservation.json`. Banco de desenvolvimento preservado: SHA-256 `cea95f27de3c157bff456a5aab8152c26b88de8ead86008c4edf2bea74ffdbe6`. Capturas fictícias, traces e logs ficam ignorados pelo Git. Nenhuma branch antiga é removida.

Limites: consulta visual por uma data, sem agenda mensal; horas cheias/blocos de 60 minutos; versões globais da semana podem gerar conflitos conservadores; escritores legados sem If-Match não têm proteção otimista; a configuração de produção deve preservar ETag/If-Match no proxy. Permanecem HTTPS/Secure, TRUST_PROXY, navegadores/dispositivos físicos e rate limiting distribuído como validações/evoluções separadas. Não foram implementados reagendamento, duração variável, profissionais ou notificações.
