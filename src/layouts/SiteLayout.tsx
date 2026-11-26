import { NavLink, Outlet, useLocation } from 'react-router'

export function SiteLayout() {
  const publicRoute = useLocation().pathname === '/'
  return (
    <div className={`site-shell ${publicRoute ? 'site-shell-public' : ''}`}>
      <header className="site-header">
        <NavLink
          to="/"
          className="site-brand"
          aria-label="Lourenço Barbearia, início"
        >
          <span className="brand-monogram" aria-hidden="true">
            L
          </span>
          <span>
            LOURENÇO<small>BARBEARIA</small>
          </span>
        </NavLink>
        <nav aria-label="Navegação principal">
          <NavLink to="/" end>
            Agendar
          </NavLink>
          <NavLink to="/admin">Gestão</NavLink>
        </nav>
      </header>
      <main className="site-content">
        {publicRoute && (
          <aside className="booking-intro">
            <p className="booking-eyebrow">A tradição encontra o seu estilo</p>
            <h1>
              Um cuidado <br />à sua altura.
            </h1>
            <p>
              Um momento para você. Escolha seu serviço e encontre o melhor
              horário, com a atenção que cada detalhe merece.
            </p>
            <div className="intro-detail">
              <span aria-hidden="true">✦</span>
              <p>
                Seu horário exclusivo.
                <br />
                <strong>60 minutos de cuidado.</strong>
              </p>
            </div>
            <p className="intro-caption">
              LOURENÇO BARBEARIA · ESTILO & CUIDADO
            </p>
          </aside>
        )}
        <section className={publicRoute ? 'booking-panel' : 'admin-panel admin-panel-agenda'}>
          <Outlet />
        </section>
      </main>
      <footer className="site-footer">
        Lourenço Barbearia <span>Feito para cuidar do seu tempo.</span>
      </footer>
    </div>
  )
}
