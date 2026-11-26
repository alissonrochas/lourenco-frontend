# Lourenço Barbearia — frontend

React 19 + TypeScript + Vite 8. Nesta fase, a experiência pública e a gestão usam URLs separadas, preservando o contrato do backend.

## Rotas e arquitetura

- `/`: agendamento público em cinco etapas, consumindo serviços e disponibilidade reais; confirmação somente após POST /api/bookings com resposta 201 válida. Consulte [o contrato e roteiro completo](docs/public-booking-flow.md).
- `/admin`: verifica a sessão com `GET /api/admin/me`. Sem sessão válida, mostra login; com sessão administrativa, oferece agenda por data/período, paginação, histórico e cancelamento futuro com motivo, além de logout. Consulte [o painel administrativo](docs/admin-booking-dashboard.md).
- Outros caminhos: página não encontrada, sem redirecionamento silencioso para a área pública.

```text
src/
├── App.tsx                  # Declaração de rotas
├── main.tsx                 # BrowserRouter e StrictMode
├── layouts/SiteLayout.tsx   # Marca, navegação e espaço das páginas
├── pages/                   # PublicPage, AdminPage e NotFoundPage
├── components/              # FormField, Feedback e componentes de UI existentes
├── hooks/                  # Sessão, fluxo público e contador de Retry-After
├── lib/api.ts               # Transporte, CSRF, erros e operações da API
├── lib/booking.ts          # Tipos, datas locais e formatação
└── test/setup.ts            # Limpeza do DOM e cookies nos testes
```

### Escolha do roteamento

Foi escolhido [React Router no modo declarativo](https://reactrouter.com/start/declarative/installation), usando somente `react-router` com `BrowserRouter`, `Routes`, `Route`, `NavLink` e `Outlet`. A versão instalada é compatível com React 19 e o Vite atual, sem migrar o projeto para outro framework.

As opções avaliadas foram History API manual (menos dependências, mas navegação, histórico e correspondência de rotas teriam manutenção própria), `HashRouter` (dispensa fallback no servidor, mas produz URLs com `#`) e o modo declarativo (URLs `/` e `/admin`, links e histórico com uma dependência de execução). Os modos Data/Framework não são necessários para estas duas páginas.

## Executar localmente

Use Node.js compatível com as dependências; a validação foi feita com **Node 24.19**.

```bash
npm ci
npm run dev -- --host localhost
```

Abra `http://localhost:5173/` ou diretamente `http://localhost:5173/admin`. Preserve seu `.env` local. A variável pública `VITE_API_URL` deve apontar para o backend existente (por exemplo, `http://localhost:3333`). Sem essa variável, as chamadas usam a mesma origem do frontend; isso pressupõe um proxy para `/api`.

O backend deve estar disponível e permitir a origem do frontend em sua configuração de CORS com credenciais. Use o mesmo hostname nas duas aplicações (`localhost` em ambas, por exemplo), para que o cookie XSRF seja legível no frontend conforme o modelo atual. A aplicação continua dependendo das configurações corretas de cookies, HTTPS e `TRUST_PROXY` do backend. Não coloque credenciais em variáveis `VITE_*`, que são públicas no bundle.

### Atualização direta e hospedagem

O Vite fornece fallback de SPA durante desenvolvimento e preview. Em produção, o servidor estático deve servir `index.html` para URLs da aplicação como `/admin`. Exemplo de regra Nginx para o frontend:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Se a API compartilhar a origem, `/api` deve ter sua própria regra de proxy, anterior ao fallback. Não encaminhe erros da API para `index.html`. Esta fase não altera configurações de hospedagem nem arquivos do backend.

Recarregar `/admin` consulta novamente `/api/admin/me` e mantém uma sessão válida através dos cookies existentes. O frontend não executa logout ao montar, desmontar ou navegar, nem salva tokens, senhas ou um indicador de autenticação em localStorage/sessionStorage. A proteção efetiva das rotas da API continua sendo responsabilidade do backend.

## API e comportamento de segurança

`src/lib/api.ts` preserva `credentials: 'include'` em todas as chamadas. Apenas POST, PUT, PATCH e DELETE leem o cookie `XSRF-TOKEN`, preparam CSRF quando necessário e enviam `X-XSRF-TOKEN`. Escritas simultâneas compartilham apenas a preparação em andamento; os tokens são sempre relidos do cookie, inclusive depois de login/logout. Se o token continuar ausente após a preparação, a escrita não é enviada. GET (incluindo `/api/admin/me`), HEAD e OPTIONS não dependem de cookie XSRF, não chamam `/api/csrf` e não enviam o header do token; a autenticação por sessão continua sendo validada pelo backend. Requisições POST enviam `Content-Type: application/json` quando têm corpo JSON.

O módulo trata 401, 403 (incluindo `E_BAD_CSRF_TOKEN`), 419 e 429 com `Retry-After`, validações e respostas não JSON. Não repete automaticamente um POST depois de falha de CSRF, evitando duplicar operações.

A verificação inicial tem estado de carregamento. Falha de rede, CSRF ou servidor permite tentar novamente, sem presumir que a sessão acabou. O logout bem-sucedido volta ao formulário de login. Se a API já negar a sessão com 401/403 de autorização, a tela também volta ao login; se o logout falhar por CSRF, limite ou erro de servidor, a tela não afirma que a sessão terminou.

O fluxo público usa GET /api/services, GET /api/availability e POST /api/bookings. Não faz cadastro de cliente separado nem exige login. O layout usa azul-marinho/dourado e controles responsivos. A área administrativa mantém sua sessão e login/logout, com painel administrativo de reservas. Configuração de calendário e cancelamento público continuam fora do escopo. A seção Serviços permite gerenciar o catálogo administrativo.

## Testar e validar

```bash
npm test
npm run lint
npm run build
npm run preview -- --host localhost
```

Os testes usam Vitest, jsdom e Testing Library, com `fetch` simulado; não exigem backend nem acessam seu banco. Cobrem URLs, links, voltar/avançar, entrada direta e remontagem de `/admin` com sessão válida, login/logout, falhas transitórias, erros HTTP, CSRF, credenciais e o fluxo público completo, conflitos, prazos e resultado incerto sem retry de POST. Não substituem um teste ponta a ponta com servidor real.

Roteiro manual com o backend existente:

1. Em backend de teste autorizado, abra `/`, escolha serviço, data, slot e contato; revise e confirme uma única vez. Confira os dados reais da resposta 201. O roteiro completo, incluindo erros e ausência de idempotência, está em [docs/public-booking-flow.md](docs/public-booking-flow.md).
2. Navegue para Gestão; sem sessão, deve aparecer login.
3. Faça login com uma conta administrativa existente; deve aparecer a área administrativa.
4. Atualize `/admin`, abra essa URL em outra aba e navegue entre Cliente e Gestão: uma sessão válida deve continuar ativa.
5. Clique em Sair da gestão; deve voltar ao login. Atualize `/admin` para confirmar o encerramento.
6. Confira voltar/avançar do navegador e uma URL inexistente.

O aviso de Fast Refresh em `src/components/ui/button.tsx` já existia antes desta fase e não foi alterado.

Nome e telefone ficam somente em memória; não são persistidos em storage pela aplicação. Uma resposta perdida após POST pode representar uma reserva criada: não há idempotência ou recuperação pública. A interface bloqueia reenvio no estado incerto e orienta contato com a barbearia.

Limitação atual: o CORS do backend não expõe Retry-After em outra origem. O frontend aguarda conservadoramente 60 segundos quando o header não é legível; para o contador exato, usar proxy de mesma origem ou tratar a exposição do header em PR separada do backend.

A agenda administrativa monta apenas após a confirmação de sessão. Registros, contato e motivo ficam em memória; logout/negação de acesso remove esses dados da tela. Uma falha de rede no cancelamento exige consulta nova antes de outra tentativa, sem retry automático. Veja [docs/admin-booking-dashboard.md](docs/admin-booking-dashboard.md) para contratos, limites, privacidade e roteiro de validação.

## Integração E2E real

A suíte Playwright inicia cópias descartáveis do frontend e backend, com migrations reais e SQLite temporário. Requer dependências instaladas nos dois projetos e Chromium (`npx playwright install chromium`), ou Chrome instalado (`E2E_BROWSER_CHANNEL=chrome npm run test:e2e`). Execute `npm run test:e2e`; não precisa iniciar servidores nem usar seu `.env`. O backend é procurado em `../backend`, configurável por `E2E_BACKEND_PATH`.

Consulte [docs/real-e2e-integration.md](docs/real-e2e-integration.md) para cenários, distinção entre navegador/HTTP/concorrência, isolamento, preservação, comandos e limitações. Relatórios e evidências em `playwright-report/` e `test-results/` não entram no Git. `npm run typecheck` verifica também a infraestrutura TypeScript de E2E.


## Gestão de serviços

Após autenticar em `/admin`, escolha **Serviços** para listar ativos e inativos, cadastrar, editar ou alterar o estado de um serviço. Todas as escritas exigem revisão e confirmação; alterações no catálogo preservam os dados históricos das reservas. Agenda e Serviços compartilham a mesma sessão, cliente HTTP e CSRF.

Veja [docs/admin-service-management.md](docs/admin-service-management.md) para contrato, validação de preços, reconciliação após falha de rede, segurança, histórico, testes reais e limitações de concorrência. Os quatro novos cenários E2E ampliam a suíte para 32 execuções entre desktop e viewport mobile, sem dependências novas.
