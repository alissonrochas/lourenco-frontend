# Gestão administrativa de serviços — Etapa 7

A área autenticada `/admin` oferece as seções **Agenda** e **Serviços**. A Agenda mantém consulta e cancelamento de reservas; Serviços permite listar ativos/inativos, cadastrar, editar nome/descrição/preço/duração e ativar/desativar. Não há exclusão, tela de horários, alteração de autenticação ou dependências novas.

## Contrato utilizado

O contrato foi conferido nos controllers, validators VineJS, transformer e documentação reais do backend, base `cbffde26b30777d16cfc782557229743267c11fc`.

| Operação | Endpoint | Contrato |
| --- | --- | --- |
| Listar | GET `/api/admin/services` | 200 `{ data: Service[] }`, ativos/inativos em ordem de ID da API |
| Cadastrar | POST `/api/admin/services` | Cinco campos de negócio; 201 `{ data: Service }` |
| Editar ou mudar estado | PATCH `/api/admin/services/:id` | Apenas campos alterados; 200 `{ data: Service }` |

O GET individual existente não é necessário para este fluxo: o editor parte da última listagem consultada. O frontend não inventa endpoints, paginação, nomes de campos ou controle de versão que não existem na API.

`Service` contém `id`, `name`, `description`, `priceCents`, `durationMinutes`, `isActive`, `createdAt` e `updatedAt`. A resposta é validada antes do uso; IDs duplicados, tipos ou envelope inesperados impedem edição. A listagem é sempre recarregada do servidor após uma escrita confirmada.

Exemplo de criação:

```json
{
  "name": "Corte com tesoura",
  "description": null,
  "priceCents": 4590,
  "durationMinutes": 45,
  "isActive": true
}
```

Editar apenas o preço envia `{"priceCents":5000}`; desativar envia `{"isActive":false}` e reativar envia `{"isActive":true}`. Não são enviados ID, timestamps ou outros campos do objeto recebido. Não há atualização em massa de reservas.

## Validação e dinheiro

- Nome obrigatório: 2–120 caracteres após trim.
- Descrição opcional: até 1.000 caracteres após trim; vazio vira `null`, inclusive para remover a descrição na edição.
- Preço digitado em reais, com vírgula ou ponto decimal e até duas casas; sem sinal negativo, notação exponencial ou separador de milhares. Exemplo `45,90` vira o número JSON `4590`.
- Conversão e formatação usam inteiros/BigInt para não perder centavos, inclusive no limite `Number.MAX_SAFE_INTEGER` do backend. O JSON final contém um número inteiro seguro, nunca BigInt ou string.
- Duração inteira de 5–480 minutos; estado é booleano. Serviços novos começam ativos, mas podem ser cadastrados inativos.
- PATCH sem alterações não é enviado. O backend continua sendo a autoridade de validação e autorização.

A duração do catálogo não altera o calendário: o MVP permanece com blocos fixos de 60 minutos. O formulário explica isso ao administrador.

## Confirmação, acessibilidade e estados

Todos os cadastros, edições e mudanças de estado passam por confirmação explícita com resumo, impacto na oferta pública e aviso de preservação do histórico. Desativação informa que o serviço sairá das opções de novas reservas. Fechar ou pressionar Escape antes do envio não grava nada.

O diálogo nativo modal contém foco e restringe o fundo; o foco inicial é o botão de voltar, que é a opção segura. Ao fechar, retorna ao controle que abriu o diálogo, capturado **antes** de desabilitar o formulário; quando esse controle deixa de existir, usa o título da seção. O formulário recebe foco no primeiro campo ao abrir, mantém labels e usa alertas/status acessíveis. Cards, formulários e navegação se adaptam a telas pequenas, sem tabela horizontal.

Durante a escrita, campos e confirmação ficam bloqueados; um lock síncrono evita submissões duplicadas antes mesmo do próximo render. As seções também ficam bloqueadas durante a escrita. O logout existente permanece disponível e desmonta os dados privados. Não há polling.

## Segurança e resultados incertos

A seção só monta depois da confirmação da sessão pelo `useAdminSession`. Reutiliza `apiFetch`, `credentials: include`, bootstrap compartilhado de CSRF e header `X-XSRF-TOKEN` em POST/PATCH. GET não depende de XSRF. Nenhuma regra backend ou middleware foi alterado.

401 e 403 de autorização removem os dados e devolvem o login. 403 com `E_BAD_CSRF_TOKEN` e 419 mantêm a distinção de CSRF, sem afirmar logout e sem repetir a escrita. 422 mantém o erro no diálogo para revisão; 429 respeita Retry-After (ou a espera conservadora existente quando o CORS não expõe o header). 404/409 exigem consulta nova. Falhas de rede, timeout, 5xx ou resposta de sucesso com formato inesperado exigem reconciliação antes de outra escrita.

O estado incerto remove o formulário e bloqueia novas operações. O administrador deve atualizar a lista e conferir os dados; somente uma consulta **bem-sucedida** reabilita escrita. Uma consulta que falha continua bloqueando. A criação não tem chave de idempotência: não é seguro reenviar automaticamente apenas porque a resposta foi perdida. A listagem permite verificar se o cadastro já existe.

Consultas anteriores são abortadas e também verificadas por geração, protegendo contra transportes que ignorem abort. A desmontagem cancela trabalhos pendentes e elimina listas/drafts da seção. Não há logs de payload, uso de localStorage/sessionStorage ou tokens próprios.

## Histórico e concorrência

A UI altera somente `services`. As reservas persistem `service_name_snapshot` e `service_price_cents_snapshot`; a Agenda usa os campos históricos retornados pelo endpoint de reservas. Alterar nome, descrição, preço, duração e estado não deve tocar a reserva, seu status ou auditoria.

O E2E cria uma reserva real, edita o serviço, desativa e reativa, compara **todos os campos** da reserva no SQLite com o registro original e confere nome/preço antigos na Agenda. Também verifica ausência do serviço inativo no fluxo público e reaparecimento após ativação. O teste não simula esses endpoints.

O PATCH envia somente diferenças para preservar campos não editados. O backend não oferece ETag ou versão para detectar dois administradores editando o mesmo campo: continua valendo a última escrita aceita. Essa limitação está documentada; não foi criado controle de concorrência fictício no frontend.

## Organização

- `AdminPage`: sessão/login/logout e escolha de seção.
- `ServicesDashboard`, `ServiceEditor`, `ServiceChangeDialog`: cards, formulário e confirmação.
- `useAdminServices`: ciclo de consulta/escrita, cancelamento, bloqueios, rate limiting e reconciliação.
- `adminService`: tipos, validação, conversão exata e diferenças de PATCH.
- `api.ts`: transporte existente, endpoints novos e classificação de resultado incerto.

## Executar e validar

```bash
npm test
npm run lint
npm run typecheck
npm run build
# Dependências do backend instaladas em ../backend, ou E2E_BACKEND_PATH:
E2E_BROWSER_CHANNEL=chrome npm run test:e2e
# Apenas os cenários novos:
E2E_BROWSER_CHANNEL=chrome npm run test:e2e -- --grep 'S[1-4] —'
```

A infraestrutura real da PR #6 mantém SQLite, sessões, usuários e processos isolados por cenário; nenhuma migration é executada no banco original. Consulte [real-e2e-integration.md](real-e2e-integration.md) para setup e limitações. A pequena extensão de `tsconfig.e2e.json` disponibiliza tipos DOM para a verificação real de largura da página; não altera configuração de banco/servidores.

S1 cobre criação, erro de preço, confirmação, Escape/Enter, foco e oferta pública; S2 cobre edição, ativação/desativação, snapshots SQL e Agenda; S3 cobre autenticação, CSRF e revogação; S4 perde somente a resposta de uma criação real já gravada e comprova reconciliação sem duplicidade. Os quatro rodam em desktop e viewport mobile. Uma captura do painel com dados fictícios é produzida em `test-results/` por viewport; não entra no Git. Mobile aqui representa viewport do Chrome, não dispositivo físico.

Os testes de componentes/validação usam respostas simuladas e cobrem também payloads, null, campos inválidos, respostas atrasadas, 409/422/429/503, logout, ausência de storage e proteção contra cliques repetidos. São evidência complementar, distinta do E2E real.

## Resultados e pendências

Nesta etapa, Node 24.19.0, Playwright 1.65.1 e Chrome 155.0.8059.79:

- Frontend: 174 testes aprovados em 9 arquivos; zero reprovados.
- Backend: 100 unitários e 161 funcionais aprovados; zero reprovados, em cópia com SQLite de teste.
- E2E completo: 32 aprovados, zero reprovados (16 cenários × 2 viewports), incluindo as 24 regressões anteriores. As capturas reais de desktop/mobile foram inspecionadas visualmente; o teste também verifica ausência de overflow horizontal. Isso não equivale a auditoria completa de acessibilidade ou teste de dispositivo físico.
- Lint e build dos dois projetos aprovados; frontend mantém somente o aviso Fast Refresh anterior em `src/components/ui/button.tsx`.
- Typecheck frontend aprovado. Backend mantém os **8 diagnósticos preexistentes** do Inertia em `marketing.tsx`/`signup.tsx`, envolvendo rotas `new_account.create/store` e campos antigos do formulário; não foram atribuídos a esta etapa nem corrigidos fora do escopo.

O primeiro recorte E2E identificou a falha real de restauração de foco após Escape; a implementação foi corrigida preservando a asserção. Na versão final, o teste continua verificando foco e reabertura por Enter.

Os hashes dos `.env`, lockfiles dos dois repositórios, shim local do backend e banco original foram comparados com a inspeção inicial. O runner também emite `test-results/preservation.json`. O SHA-256 do banco de desenvolvimento permaneceu `cea95f27de3c157bff456a5aab8152c26b88de8ead86008c4edf2bea74ffdbe6`. Não há dependências novas, migration, modificação backend ou exclusão de branches antigas.

Para etapas futuras: configuração de horários, UX de conflitos entre administradores e idempotência de criação dependem de contratos próprios. Permanecem as limitações anteriores de HTTPS/proxy em produção, rate limiting em memória e exposição CORS de Retry-After. Não há funcionalidade de horários nesta entrega.
