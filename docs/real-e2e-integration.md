# Integração real com Playwright

Esta suíte inicia React/Vite e AdonisJS reais e usa um arquivo SQLite descartável, migrations Lucid e models/services existentes. Não usa respostas simuladas nos endpoints de serviços, disponibilidade, reservas, login, sessão, consulta ou cancelamento. Os testes Vitest existentes continuam separados e usam `fetch` simulado; seus resultados não comprovam integração.

## Executar

Pré-requisitos: Node compatível com ambos os projetos (validação com Node 24.19), dependências instaladas nos dois repositórios e backend compatível com os contratos atuais, normalmente na pasta irmã `../backend`.

```bash
# No frontend, após npm ci nos dois projetos:
npx playwright install chromium
npm run test:e2e
# Alternativa com Google Chrome instalado, usada nesta validação:
E2E_BROWSER_CHANNEL=chrome npm run test:e2e
# Backend em outro diretório:
E2E_BACKEND_PATH=/caminho/backend npm run test:e2e
# Recorte para diagnóstico:
E2E_BROWSER_CHANNEL=chrome npm run test:e2e -- --project=desktop --grep 'A —'
```

Não inicie backend ou frontend manualmente. Não aponte o Playwright diretamente para servidores externos: a configuração exige contexto e token gerados pelo orquestrador. As portas são dinâmicas; não dependem de 3333/5173. O comando não instala dependências, executa `npm ci` ou faz migrations nos projetos originais.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

O relatório HTML fica em `playwright-report/`; `test-results/` recebe evidências de preservação, revisões e, em falhas, traces, capturas e logs. Ambos são ignorados pelo Git. Para abrir o relatório após a execução: `npx playwright show-report`. Traces podem conter cookies e dados fictícios; não publique artefatos indiscriminadamente.

## Isolamento e ciclo de vida

`scripts/run-real-e2e.mjs` cria uma pasta `lourenco-real-e2e-*` em `os.tmpdir()`, copia o código dos dois projetos sem `.git`, `.env*`, bancos, builds ou artefatos anteriores e referencia os `node_modules` já instalados. Define variáveis próprias, chave de aplicação aleatória e origem CORS exata, com servidores vinculados somente a `127.0.0.1`.

O comando Ace de fixture existe apenas na cópia descartável: o arquivo-fonte de suporte é `e2e/backend-fixture.stub`. Antes de qualquer escrita, ele verifica diretório, marcador/token, caminho físico esperado do SQLite, store de sessão `database` resolvido pelo `configProvider` instalado e configuração CSRF original habilitada. Models que dependem de serviços como hash são carregados depois do boot do Adonis. A fixture executa o `MigrationRunner` real e cria usuários pelo model com hashing real, serviços, calendário e exceções. A paginação usa 51 reservas criadas pelo serviço real; uma fixture separada cria uma reserva histórica pelo model.

A configuração atual do backend usa `:memory:` quando `app.inTest` é verdadeiro, determinado por `NODE_ENV=test`. Como o processo Ace e o servidor precisam acessar o mesmo arquivo, a cópia usa **`NODE_ENV=development`**, sem editar a configuração de banco. Isso é um ambiente de integração isolado, não uma simulação de produção. O SQLite fica exclusivamente em `<pasta descartável>/backend/tmp/db.sqlite3`.

Cada cenário começa com arquivo novo, migrations reais, dados novos, processo backend novo (reinicia rate limiting em memória) e contextos de navegador/cookies novos. Um worker executa sequencialmente. A inspeção SQL abre apenas conexões readonly. As alterações de papel e invalidação de sessões usam o comando guardado na cópia, nunca o banco de desenvolvimento. O cenário de sessão remove registros do store para invalidá-la; não aguarda duas horas nem comprova sozinho o vencimento natural por relógio.

Os processos são encerrados e a pasta descartável é removida em `finally`, inclusive quando testes falham. SIGINT/SIGTERM acionam encerramento. Como em qualquer processo, SIGKILL/queda da máquina não permite garantir cleanup: uma pasta temporária pode restar e deve ser inspecionada antes de eventual remoção manual. O runner só remove a pasta que ele próprio criou.

## Cobertura e evidência

São 12 cenários, executados em desktop 1440×1000 e viewport mobile 390×844: 24 execuções. Ambos usam Chromium/Chrome com timezone `America/Sao_Paulo`; a execução mobile não é um teste de dispositivo físico ou Safari.

| Cenário | Navegador real | Verificação adicional real |
| --- | --- | --- |
| A | Serviço, data, horários, contato, revisão, confirmação | POST 201; SQL da reserva/cliente/snapshot/intervalo UTC; cookies; fechamento excepcional; consulta sem nova sessão |
| B | Primeira reserva | Segunda tentativa HTTP 409; SQL garante um confirmado e rollback do cliente perdedor |
| C | Login, filtro, página 1/2, contato e preço | 51 reservas pelo serviço real, metadados de paginação e contagem SQL |
| D | Cancelamento explícito, motivo, recarga e histórico | POST 200; SQL de status/auditoria; HTTP disponibilidade liberada; repetição preserva primeira auditoria |
| E1 | Login de usuário comum negado | HTTP anônimo 401 e login 403 |
| E2 | Login administrativo válido | HTTP sem header CSRF recebe 403; SQL inalterado |
| E3/E4 | Tela privada removida após revogação/invalidação de sessão | Alteração de papel/remoção do store somente na fixture descartável |
| E5 | Reserva histórica sem ação de cancelar | POST real 409 e status SQL preservado |
| E6 | Dois contextos confirmam o mesmo horário simultaneamente | Um 201, outro 409 ou 503; apenas um confirmado no SQLite |
| E7 | Resposta perdida, estado incerto e sem reenvio | `route.fetch()` executa o POST real e somente então `route.abort()` descarta a resposta; SQL confirma gravação |
| E8 | 60 consultas reais, erro de rate limiting e bloqueio visual | HTTP 429 com Retry-After; navegador não consegue ler o header por CORS atual |

O E7 faz **injeção de falha de transporte**, não fornece JSON falso: o servidor conclui a reserva antes da resposta ser descartada. Os demais endpoints não são interceptados. A corrida E6 cobre dois clientes de navegador e um processo real de servidor; não representa teste de carga, vários processos de produção ou todos os interleavings. A suíte existente do backend contém testes adicionais de concorrência/transação e usa SQLite isolado; eles são evidência separada, não cenários de navegador.

Os fixtures usam datas locais calculadas a partir do dia da execução na barbearia (sete dias à frente), sem fixar datas que vencerão. O servidor usa TZ=UTC e o navegador São Paulo, exercitando a separação entre data local e instantes UTC. São exercitados almoço, bloqueio semanal, exceção de horário e fechamento de dia; as regras completas permanecem cobertas no motor e nos testes backend.

## Configuração e segurança verificadas

`VITE_API_URL` aponta para a URL dinâmica do backend. As aplicações usam o mesmo hostname com portas diferentes e CORS com origem explícita/credenciais; não há wildcard. A UI usa o cliente HTTP existente, `credentials: include`, cookie legível `XSRF-TOKEN` e header `X-XSRF-TOKEN` para POST. Uma escrita autenticada sem CSRF continua recusada. O cookie `adonis-session` é HttpOnly, SameSite=Lax e Secure=false no HTTP de desenvolvimento. Nenhuma proteção foi desabilitada; não há credenciais de produção nos fixtures.

O backend responde Retry-After, mas seu CORS atual não expõe o header ao JavaScript de outra origem. O teste comprova essa limitação real e o tratamento conservador de 60 segundos já existente. Não altera CORS para fazer testes passarem. Produção deve adotar proxy de mesma origem ou avaliar exposição explícita em PR própria.

Não foram encontradas falhas de contrato exigindo alterações de produto nesta etapa. Os ajustes necessários foram no bootstrap da infraestrutura: resolver a configuração de sessão pelo provider instalado e importar os models dependentes de hash após o boot.

## Preservação e limites para produção

Cada execução compara SHA-256 antes/depois de `.env` e variantes conhecidas, SQLite original (incluindo WAL/SHM) e lockfiles, sem publicar conteúdo. `test-results/preservation.json` registra `preserved: true` quando são idênticos; `revisions.json` registra os HEADs usados. O lockfile do frontend muda somente pela dependência Playwright adicionada antes da execução. O lockfile preexistente do backend, o shim local de tipos e branches antigas não integram esta PR.

HTTPS, cookies Secure=true, reverse proxy/TRUST_PROXY, origens finais, navegadores Firefox/WebKit e múltiplas instâncias devem ser validados no ambiente de implantação. O rate limiting atual é em memória por processo. A reserva pública não tem chave de idempotência/recuperação: resposta perdida pode corresponder a gravação concluída; a UI não reenvia automaticamente. Nenhuma reserva, notificação ou funcionalidade nova foi implementada por esta suíte.

Referências da infraestrutura: [fixtures Playwright](https://playwright.dev/docs/test-fixtures), [route.fetch](https://playwright.dev/docs/api/class-route#route-fetch) e [injeção de falhas de rede](https://playwright.dev/docs/network).

## Resultados desta etapa — 26/11/2026

Base frontend `569eed9efd48a063cf3d8905a713cf57299c5de8`; backend `cbffde26b30777d16cfc782557229743267c11fc`. Node v24.19.0, Playwright 1.65.1 e Google Chrome 155.0.8059.79 em Linux. Nenhum endpoint de sucesso usa mock.

| Verificação | Resultado |
| --- | --- |
| Playwright, 12 cenários × 2 viewports | 24 aprovados, 0 reprovados |
| Frontend Vitest/Testing Library | 125 aprovados, 0 reprovados em 6 arquivos (respostas simuladas) |
| Backend unitários | 100 aprovados, 0 reprovados |
| Backend funcionais | 161 aprovados, 0 reprovados |
| Frontend lint | Sem erros; aviso Fast Refresh preexistente em `src/components/ui/button.tsx` |
| Backend lint | Aprovado |
| Frontend typecheck (aplicação e E2E) | Aprovado |
| Backend typecheck | Backend passa; etapa Inertia falha com 8 diagnósticos preexistentes |
| Builds frontend/backend | Aprovados |
| Arquivos protegidos e branches antigas | Preservados |

O typecheck completo do backend foi repetido em uma cópia de `git archive HEAD` da main, conservando o shim de tipos local apenas na cópia. Reproduziu os mesmos 8 diagnósticos em `inertia/layouts/marketing.tsx` e `inertia/pages/auth/signup.tsx`: rotas removidas `new_account.create/store` e campos antigos `fullName/passwordConfirmation`. É uma pendência anterior, sem relação com Playwright; não foi ocultada, corrigida fora do escopo ou incluída em commit de backend.

A validação backend foi feita em cópia temporária, `NODE_ENV=test`, com o guard existente confirmando SQLite `:memory:` antes de migrations; cada teste que exige arquivo usa seu SQLite temporário já configurado. Nenhuma migration foi executada no banco original. As execuções E2E registraram `preserved: true`, com SHA-256 do banco de desenvolvimento inalterado: `cea95f27de3c157bff456a5aab8152c26b88de8ead86008c4edf2bea74ffdbe6`. `.env`, lockfile do backend e `types/better_sqlite3.d.ts` também permaneceram iguais à inspeção inicial.

Durante a preparação, uma primeira execução completa identificou um erro no próprio teste de `Retry-After` (variável fora do escopo de `page.evaluate`): 22 passaram e 2 falharam. O argumento passou a ser enviado explicitamente ao contexto do navegador, sem mudar a aplicação ou enfraquecer a asserção. A execução completa seguinte passou. Foram acrescentadas asserções explícitas de origem CORS, credenciais, header CSRF e correspondência do painel com os dados SQL, novamente verificadas na suíte final.
