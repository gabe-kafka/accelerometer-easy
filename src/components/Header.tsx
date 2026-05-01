import './Header.css';

interface HeaderProps {
  route: 'dashboard' | 'explore' | 'charts';
}

export function Header({ route }: HeaderProps) {
  return (
    <header className="header">
      <a href="#/" className="header__title">PR-SHM DATA VIEWER</a>
      <nav className="header__nav">
        <a
          href="#/"
          className={`header__link ${route === 'dashboard' ? 'header__link--active' : ''}`}
        >
          Dashboard
        </a>
        <a
          href="#/explore"
          className={`header__link ${route === 'explore' ? 'header__link--active' : ''}`}
        >
          Explorer
        </a>
        <a
          href="#/charts"
          className={`header__link ${route === 'charts' ? 'header__link--active' : ''}`}
        >
          Charts
        </a>
      </nav>
    </header>
  );
}
