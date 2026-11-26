# Painel administrativo de reservas

A rota `/admin` mantém a verificação de sessão por GET /api/admin/me, login e logout existentes. O painel só monta após uma sessão administrativa confirmada. A rota `/`, seu agendamento público e a página 404 permanecem independentes.

## Consulta e rotina diária

Ao abrir a agenda, De/Até recebem a data atual em America/Sao_Paulo. A consulta apresenta todas as reservas retornadas pela API, confirmed e cancelled, na ordem original. Mostra horário local, data/ID, cliente, telefone, nome e preço históricos do serviço, status e auditoria de cancelamento. O contato é o relacionamento Customer atual; nome/preço do serviço vêm dos snapshots da reserva.

O total exibido é `meta.total`, incluindo reservas canceladas, não faturamento ou comparecimento. Não há métricas financeiras, exportação, reagendamento ou edição de serviços/calendário.

Filtros aceitam datas reais YYYY-MM-DD e até **31 dias inclusivos**. De = Até consulta um único dia; datas passadas servem para histórico. Dia anterior/seguinte navega a partir do início da consulta e seleciona uma única data; Hoje retorna ao dia atual da barbearia. A aritmética gregoriana não converte essas strings em instantes UTC. O backend revalida tudo.

Paginação usa `page`, `perPage`, `total` e `lastPage` do servidor. Padrão: 50 registros; opções 25, 50 e 100. Filtros aplicados reiniciam na página 1. O limite de página 10000 é preservado. Resultados vazios, carregamento, falha e atualização manual são explícitos. Paginação por offset pode mudar entre chamadas concorrentes; recarregar após alterações. Não há snapshot persistente entre páginas nem ordenação artificial no cliente.

Cada consulta possui AbortController. Alterar filtros, desmontar ou sair aborta a leitura anterior e ignora respostas tardias, inclusive quando um mock ignora o sinal. Não há polling da API. Um relógio local atualiza a elegibilidade visual das ações, sem realizar requisições.

## Endpoints e tipos

`src/lib/adminBooking.ts` define AdminBooking, BookingFilters e AdminBookingList conforme `docs/admin-booking-management-api.md` do backend. `src/lib/api.ts` reutiliza o transporte e tratamento de erros originais; valida a estrutura essencial de registros, auditoria e metadados antes de exibi-los.

```http
GET /api/admin/bookings?from=2026-12-01&to=2026-12-07&page=1&perPage=50
```

Resposta: `{ data: AdminBooking[], meta: { page, perPage, total, lastPage } }`.

Cada registro contém id, customer `{name, phone}`, serviceName, priceCents, localDate, startsAtMinute, startsAtLocal, endsAtLocal, timezone, slotDurationMinutes, status e cancellation. Cancellation é null para confirmed; para cancelled contém cancelledAtUtc (Unix milliseconds), cancelledByUserId e reason. O painel não carrega catálogo atual para reconstruir reservas antigas.

Horários de início/fim incluem offset e são interpretados como instantes quando necessário. O horário apresentado e a data local permanecem os informados pela API; auditoria é formatada em America/Sao_Paulo. O bloco continua com 60 minutos.

## Cancelamento e confirmação

Somente confirmed com início estritamente futuro oferece ação. Na abertura do diálogo e no envio a regra é verificada novamente; o relógio do dispositivo é uma conveniência visual, não autorização. O backend é a autoridade temporal e pode responder 409 se a reserva tiver começado ou mudado de estado.

O diálogo nativo identifica ID, cliente, serviço, data/horário e pede motivo obrigatório de 1–500 caracteres após trim. Requer clique em Confirmar cancelamento; abrir ou dispensar o diálogo não realiza escrita. Escape e Manter reserva fecham antes do envio. Durante a escrita, controles ficam desabilitados e um ref impede submissão duplicada antes da próxima renderização. O foco vai ao motivo e retorna ao acionador; se ele deixou de estar disponível, retorna ao título da agenda.

```http
POST /api/admin/bookings/123/cancel
Content-Type: application/json
```

```json
{ "reason": "Cancelamento solicitado pelo cliente" }
```

Somente reason é enviado. Não há ator, timestamps, status, preço ou objeto de reserva copiado no corpo. Resposta válida deve ser HTTP 200, com o mesmo ID e status cancelled no envelope data. A mensagem de sucesso aparece depois dessa confirmação e a página corrente é consultada novamente. A reserva cancelada continua no histórico e no total; não há DELETE nem remoção otimista definitiva.

O backend torna repetição válida idempotente: se outro administrador já cancelou, o primeiro ator, instante e motivo retornados são mantidos. O frontend não substitui a auditoria pelo motivo digitado nem gera timestamps locais de cancelamento. A nova leitura é a fonte do histórico apresentado.

## Erros e reconciliação

- 401 ou 403 de autorização: remover o painel, seus registros e diálogo/motivo em memória e voltar ao login. A sessão é invalidada visualmente pelo hook existente.
- 403 com E_BAD_CSRF_TOKEN ou 419: manter a sessão e o motivo, mostrar erro de CSRF e orientar atualização. Não confundir com revogação do papel.
- 404/409 no cancelamento: fechar diálogo, informar mudança/conflito e bloquear cancelamentos até nova consulta bem-sucedida.
- 422: conservar diálogo/motivo para correção; filtros inválidos também recebem feedback sem consulta adicional.
- 429: aguardar Retry-After, desabilitando a ação correspondente e verificando o prazo na função. A contagem não dispara uma chamada ao terminar. O tratamento compartilhado admite segundos ou HTTP-date e espera 60 segundos se o header não estiver disponível.
- 503/500 durante escrita: informar indisponibilidade/resultado não confirmado e exigir consulta nova. Mesmo quando o backend normalmente reverte 503, adotamos reconciliação conservadora.
- Falha de rede, abort/timeout após despacho ou resposta de sucesso inesperada: não afirmar cancelamento nem reenviar automaticamente. Fechar diálogo e exigir atualização da lista. Falha comprovadamente anterior ao envio não é apresentada como cancelamento concluído.

Uma consulta de reconciliação que falha não libera as ações. Uma consulta bem-sucedida permite agir somente sobre os registros recém-lidos; se cancelled, não existe ação de cancelamento. O sinal de timeout do POST é 20 segundos; a preparação CSRF compartilhada mantém o ciclo original. Abort no navegador não garante rollback do servidor. Não há retry automático de leitura/escrita por erro; a única releitura automática é a atualização após 200 confirmado.

## Privacidade e sessão

Dados administrativos ficam apenas no estado de um componente autenticado. Logout começa removendo o painel; se falhar sem negar sessão, um novo painel faz nova consulta, sem reaproveitar registros antigos. Negação de sessão remove também diálogo e motivo. Respostas tardias após navegação não repovoam a tela.

Não há storage, URLs com nome/telefone/motivo, logs de contato/reservas ou exportação. URLs contêm apenas filtros/paginação ou o identificador exigido pela rota administrativa. A aplicação não persiste tokens; o mecanismo existente lê o cookie XSRF para cada escrita. A limpeza é do estado/visibilidade da aplicação, sem promessa de apagamento físico da memória do navegador.

Todas as chamadas usam credentials: include. GET não prepara CSRF e usa cache: no-store; POST reutiliza apiFetch, preparação compartilhada e X-XSRF-TOKEN. VITE_API_URL, cookies, CORS e hostname seguem [o fluxo público](public-booking-flow.md). A autorização efetiva permanece no backend; esconder botões não substitui adminAuth.

Limitação já existente: o CORS atual do backend não expõe Retry-After em outra origem. O frontend utiliza espera conservadora de 60 segundos quando o header é ilegível. Exibição do prazo exato requer proxy na mesma origem ou exposição explícita do header em PR separada; esta etapa não modifica o backend.

## Interface e testes

Cartões responsivos evitam tabelas horizontais em telas estreitas. Contatos/nomes/motivos longos quebram linha, status têm texto além da cor, e auditoria usa details/summary. Filtros possuem labels, ações áreas de toque e diálogo nativo oferece modalidade/teclado/foco sem dependências novas. Não há auditoria formal com leitor de tela ou teste em aparelho físico.

```bash
npm test
npm run lint
npm run build
npm run dev -- --host localhost
```

Vitest/Testing Library usam fetch simulado e cobrem sessão/login/logout, privacidade, filtros/limites/bissextos, paginação, respostas antigas, histórico, CSRF/cookies, confirmação, motivo, duplicação, início do atendimento, negação de papel, erros, reconciliação e auditoria idempotente. O ambiente jsdom recebe somente shims de showModal/close; foco modal e Escape também são verificados em Chrome real com respostas interceptadas.

Para validar com backend real, usar um ambiente de testes autorizado: entrar com admin, consultar dias/períodos e páginas, cancelar uma reserva futura com motivo, conferir status/auditoria na releitura, tentar disputa entre administradores e verificar 401/403/CSRF/409/503. Recarregar a disponibilidade pública deve refletir o cancelamento conforme as regras do calendário. Esses passos fazem escritas reais: não executá-los contra banco de desenvolvimento ou produção sem autorização.

A validação visual/interativa usa Chrome headless em desktop/mobile com todas as APIs simuladas, sem acesso ao banco real; não substitui integração ponta a ponta. Backend, migrations, banco, lockfile e arquivos de ambiente permanecem preservados.
