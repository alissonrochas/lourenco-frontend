# Agendamento público

A rota `/` consome o backend Adonis existente sem criar conta de cliente. O formulário temporário de cadastro foi substituído por cinco etapas: serviço, data, horário, dados de contato e revisão. Somente uma resposta HTTP 201 válida apresenta a confirmação.

## Contratos e organização

- `src/lib/booking.ts`: tipos explícitos de serviço, disponibilidade, slot, payload e confirmação; calendário local, formato BRL e validação básica de contato.
- `src/lib/api.ts`: único cliente HTTP, CSRF compartilhado e chamadas `getPublicServices`, `getPublicAvailability`, `createPublicBooking`. Valida a estrutura essencial das respostas antes de usá-las; resposta de sucesso malformada nunca vira confirmação.
- `src/hooks/usePublicBooking.ts`: seleção, etapas, carregamento, invalidação, erros, submissão e proteção contra respostas antigas/desmontagem.
- `src/hooks/useRetryCountdown.ts`: assinatura do relógio para respeitar os prazos de Retry-After sem polling da API.
- `PublicPage`, `BookingSummary` e `SiteLayout`: apresentação e navegação, com controles nativos rotulados, seleção por rádio, feedback acessível e adaptação mobile.

`GET /api/services` retorna `{ data: PublicService[] }`, com id, name, description nullable, priceCents, durationMinutes, isActive e timestamps. São apresentados somente os ativos; o catálogo pode ficar vazio ou falhar, com atualização manual. A duração do catálogo não determina a duração da reserva: o bloco do MVP tem 60 minutos.

`GET /api/availability?date=YYYY-MM-DD` retorna `{ data: { localDate, weekday, timezone, slotDurationMinutes, slots } }`. Cada slot contém startsAtMinute, endsAtMinute, horários locais de parede, instantes ISO UTC e offsets. O frontend mostra os minutos retornados e não gera uma grade própria. Datas são strings locais canônicas; a seleção nunca é convertida com new Date('YYYY-MM-DD').toISOString(). O mínimo do seletor usa a data atual em America/Sao_Paulo, independentemente do fuso do dispositivo; o backend permanece a autoridade final.

Mudanças de serviço/data invalidam a seleção de horário. Cada consulta tem AbortController e verificação da geração/data atual: resposta antiga não substitui a nova, mesmo que o transporte simulado ignore abort. Não há polling nem retry automático. Voltar às etapas mantém os dados enquanto a página estiver montada; a retomada da etapa de horários consulta novamente a disponibilidade.

O POST é enviado diretamente para `/api/bookings`, sem cadastro separado em `/api/customers`:

```json
{
  "serviceId": 7,
  "localDate": "2026-12-28",
  "startsAtMinute": 540,
  "name": "Cliente Exemplo",
  "phone": "71999999999"
}
```

Os valores vêm das seleções reais. O cliente HTTP projeta explicitamente os cinco campos, sem preço, duração, status, UTC ou auditoria. Nome recebe trim e limite de 2–120 caracteres; telefone admite as mesmas formas básicas do cadastro, com 10–15 dígitos, até 30 caracteres formatados. O backend valida/normaliza novamente e resolve o Customer.

A confirmação 201 tem `{ data: { id, serviceName, priceCents, localDate, startsAtMinute, startsAtLocal, endsAtLocal, timezone, slotDurationMinutes, status: 'confirmed' } }`. Nome/preço e horários apresentados vêm exclusivamente dessa resposta; o preço do catálogo/revisão não é usado como confirmação. Os horários dessa resposta incluem offset, diferentemente dos horários de parede da disponibilidade. Nenhum dado pessoal adicional é esperado ou exibido. Nome/telefone do formulário são removidos do estado após sucesso.

## CSRF, cookies e ambiente

Todas as chamadas mantêm `credentials: 'include'`. GET não exige nem prepara XSRF. POST passa pelo mesmo `apiFetch`: lê XSRF-TOKEN, compartilha somente a preparação CSRF em andamento quando necessária e envia X-XSRF-TOKEN. Não há segundo cliente HTTP, armazenamento de token ou repetição de escrita após erro. Falha comprovadamente anterior ao despacho do POST informa que nenhuma reserva foi enviada.

Definir `VITE_API_URL` para a API, sem barra final obrigatória; variável ausente usa `/api` da própria origem e exige proxy. As variáveis VITE_* são públicas: não colocar chaves privadas, senhas ou APP_KEY nelas. O backend precisa permitir a origem exata do frontend e credenciais no CORS, incluindo exposição de Retry-After se a API estiver em outra origem. Use o mesmo hostname nas duas aplicações para permitir leitura do cookie XSRF conforme o contrato atual, por exemplo localhost nas portas 5173 e 3333. Cookies/HTTPS/SameSite devem ser configurados no backend para o ambiente real; esta PR não altera essa configuração.

### Limitação de CORS identificada

O backend atual usa `exposeHeaders: []`. Em chamadas de outra origem (inclusive portas distintas), o navegador não disponibiliza Retry-After ao JavaScript. Nesse cenário, o contador usa **60 segundos**, conservadoramente cobrindo a janela de 60 segundos dos limites atuais de consulta/criação; não tenta inferir headers privados nem contorna CORS/CSRF.

Para exibir o prazo exato retornado pelo servidor, usar um proxy `/api` na mesma origem do frontend ou, em outra PR autorizada do backend, expor explicitamente `Retry-After` no CORS. Esta PR não altera o backend ou a hospedagem. O consumo direto cross-origin permanece dependente de CORS/cookies corretos e do prazo conservador enquanto o header não estiver exposto.

## Erros e resultado incerto

- 409: invalidar o slot e pedir atualização manual dos horários. Preserva serviço, data e contato; não reapresenta o slot antigo como selecionado.
- 422: voltar à seleção de serviço e pedir revisão/atualização. Preserva contato e invalida o horário.
- 429: respeitar Retry-After em segundos ou HTTP-date; sem valor válido, aguardar 60 segundos. Catálogo, disponibilidade e confirmação têm prazos separados, coerentes com os orçamentos independentes do backend. O botão correspondente fica desabilitado e a função também verifica o prazo. O fim do contador não dispara requisição.
- 503: mensagem de indisponibilidade temporária, permitindo nova tentativa manual.
- 403/419 de CSRF: manter o tratamento existente e orientar atualização da página; não reenviar o POST automaticamente.
- Erro de rede/abort/timeout após despacho, resposta de sucesso inválida ou 500 inesperado: exibir resultado incerto e bloquear novo POST nesta instância do fluxo.

A confirmação tem sinal de timeout de 20 segundos. A preparação CSRF compartilhada mantém o ciclo original e não é abortada globalmente para outros consumidores. A navegação/desmontagem aborta a operação local e ignora atualizações tardias; isso **não garante rollback no servidor**.

**Não há idempotência no backend.** Se a conexão cair após o envio, a reserva pode ter sido criada sem a resposta chegar. A interface não afirma sucesso nem falha, não repete automaticamente e orienta contato com a barbearia pelo canal já conhecido, sem inventar número. Sair/recarregar perde o estado local e pode esconder essa incerteza: o cliente deve verificar com a barbearia antes de enviar novamente. Não há recuperação pública por telefone/ID nem token de cancelamento nesta etapa.

Um ref bloqueia submissões simultâneas antes da próxima renderização; botões/fieldset ficam desabilitados durante o POST. A confirmação não dispara outra reserva. Nome e telefone não são gravados em localStorage, sessionStorage, URL ou logs pela aplicação. O preenchimento automático do navegador pode ser oferecido pelos campos nativos e fica sob controle do usuário.

## Validar localmente

```bash
npm test
npm run lint
npm run build
npm run dev -- --host localhost
```

Vitest/Testing Library usam fetch simulado conforme os transformers reais: cobrem catálogo, seleção, datas/passado, respostas antigas, contato, revisão, payload, CSRF/cookies, 201, submissão duplicada, erros, prazos e incerteza. As regressões de `/admin`, sessão direta, login/logout e 404 permanecem. A UI usa rádios nativos, labels, fieldsets/legends, aria-current e alert/status, foco de etapas, alvos de toque e layouts para mobile/desktop. Não há auditoria formal com leitor de tela nesta PR.

A checagem interativa em Chrome headless utiliza interceptação local das APIs em desktop (1440×1000) e mobile (390×844), incluindo seleção, revisão, confirmação, acesso a `/admin`, ausência de rolagem horizontal e POST único. Essas respostas são simuladas; não se afirma integração ponta a ponta com banco real. Não foram feitas chamadas ao backend de desenvolvimento que possam persistir sessão ou reserva.

Roteiro com backend real, **em ambiente de testes autorizado**:

1. Configurar VITE_API_URL, CORS e hostname/cookies. Disponibilizar serviços ativos e calendário futuro nesse ambiente.
2. Abrir `/`, selecionar serviço/data e conferir que somente slots reais aparecem.
3. Escolher horário, preencher contato, voltar entre etapas e revisar todos os valores.
4. Confirmar uma única vez; conferir 201, ID, preço/serviço/horário do servidor e remoção da vaga numa nova consulta de disponibilidade.
5. Simular disputa de vaga para verificar 409 e atualização manual, mantendo os dados.
6. Testar 429 com Retry-After, 422, 503 e interrupção da resposta após POST; conferir que não há retry automático nem confirmação inventada.
7. Testar `/admin`, sessão persistida, login/logout, voltar/avançar e 404.
8. Repetir em mobile, com teclado, foco, zoom e nomes/descrições longos.

O roteiro de confirmação cria reservas no ambiente escolhido. Não executá-lo contra o banco de desenvolvimento/produção sem autorização. Não há mudanças no backend, migrations, gestão administrativa de reservas, cancelamento público, pagamentos, notificações, múltiplos profissionais ou laboratório 3D nesta etapa.
