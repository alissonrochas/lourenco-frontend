# Lourenço Barbearia — frontend

React 19 + TypeScript + Vite 8. Nesta fase, a experiência pública e a gestão usam URLs separadas, preservando o contrato do backend.

## Rotas e arquitetura

- `/`: formulário público temporário com nome e telefone. A resposta é apenas `Solicitação recebida.`; não confirma criação de cliente nem agendamento.
- `/admin`: verifica a sessão com `GET /api/admin/me`. Sem sessão válida, mostra login; com sessão administrativa, mostra uma tela inicial com logout.
- Outros caminhos: página não encontrada, sem redirecionamento silencioso para a área pública.

```text
src/
├── App.tsx                  # Declaração de rotas
├── main.tsx                 # BrowserRouter e StrictMode
├── layouts/SiteLayout.tsx   # Marca, navegação e espaço das páginas
├── pages/                   # PublicPage, AdminPage e NotFoundPage
├── components/              # FormField, Feedback e componentes de UI existentes
├── hooks/useAdminSession.ts # Verificação e estado visual da sessão
├── lib/api.ts               # Transporte, CSRF, erros e operações da API
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

Nenhum agendamento, catálogo de serviços, cadastro de profissionais ou alteração no modelo de autenticação foi implementado.

## Testar e validar

```bash
npm test
npm run lint
npm run build
npm run preview -- --host localhost
```

Os testes usam Vitest, jsdom e Testing Library, com `fetch` simulado; não exigem backend nem acessam seu banco. Cobrem URLs, links, voltar/avançar, entrada direta e remontagem de `/admin` com sessão válida, login/logout, falhas transitórias, erros HTTP, CSRF, credenciais e o formulário público com mensagem genérica. Não substituem um teste ponta a ponta com servidor real.

Roteiro manual com o backend existente:

1. Abra `/`, envie nome e telefone e confira somente `Solicitação recebida.`.
2. Navegue para Gestão; sem sessão, deve aparecer login.
3. Faça login com uma conta administrativa existente; deve aparecer a área administrativa.
4. Atualize `/admin`, abra essa URL em outra aba e navegue entre Cliente e Gestão: uma sessão válida deve continuar ativa.
5. Clique em Sair da gestão; deve voltar ao login. Atualize `/admin` para confirmar o encerramento.
6. Confira voltar/avançar do navegador e uma URL inexistente.

O aviso de Fast Refresh em `src/components/ui/button.tsx` já existia antes desta fase e não foi alterado.
