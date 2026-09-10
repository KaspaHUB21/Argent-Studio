// Group existing controls without duplicating actions or application state.
export function organizeToolbar(toolbar, buildbar, views, language) {
  const find = id => document.getElementById(id);
  const text = (node, de, en) => {
    node.dataset.de = de; node.dataset.en = en;
    node.textContent = language === 'en' ? en : de;
    return node;
  };
  const nav = document.createElement('nav');
  nav.className = 'app-navigation';
  const menus = [];
  function menu(id, de, en, controls) {
    const details = document.createElement('details');
    details.className = 'app-menu'; details.id = `menu-${id}`;
    const summary = text(document.createElement('summary'), de, en);
    const content = document.createElement('div'); content.className = 'app-menu-content';
    for (const control of controls) content.append(typeof control === 'string' ? find(control) : control);
    details.append(summary, content); nav.append(details); menus.push(details);
    summary.addEventListener('click', () => { for (const other of menus) if (other !== details) other.open = false; });
    summary.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      for (const other of menus) if (other !== details) other.open = false;
      details.open = true;
      content.querySelector('button:not(:disabled), summary, input:not(:disabled)')?.focus();
    });
    content.addEventListener('click', event => {
      if (!event.target.closest('button:not(:disabled)')) return;
      details.open = false;
      for (const nested of content.querySelectorAll('details[open]')) nested.open = false;
    });
    return content;
  }
  const examples = toolbar.querySelector('.examples-menu');
  menu('project', 'Projekt', 'Project', ['new-project', 'open-project', 'duplicate-project', document.createElement('hr'), examples]);
  menu('file', 'Datei', 'File', ['new-file', 'close']);
  const entry = find('entry-label');
  const entryContext = document.createElement('div'); entryContext.className = 'build-context';
  entryContext.append(text(document.createElement('span'), 'Build-Datei:', 'Build entry:'), entry);
  menu('build', 'Build', 'Build', ['inspect', 'compiler', document.createElement('hr'), buildbar]);
  buildbar.classList.add('build-options');
  buildbar.querySelector('.separator')?.remove();
  const appLabel = buildbar.querySelector('.app-label'); appLabel.htmlFor = 'app-name';
  menu('view', 'Ansicht', 'View', ['panel-project', 'panel-results', 'panel-assistant']);
  text(find('help'), 'Dokumentation', 'Documentation');
  menu('help', 'Hilfe', 'Help', ['help', 'check-updates']);
  const primary = document.createElement('div'); primary.className = 'primary-actions';
  primary.append(find('save'), find('compile'), find('cancel'), find('settings'));
  toolbar.append(nav, primary);
  views.append(entryContext);
  find('save').title = 'Ctrl/Cmd+S'; find('compile').title = 'F5';
  find('open-project').title = 'Ctrl/Cmd+O'; find('close').title = 'Ctrl/Cmd+W';
  document.addEventListener('pointerdown', event => {
    for (const details of menus) if (!details.contains(event.target)) details.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.target.closest('dialog')) return;
    const open = menus.find(details => details.open);
    if (!open) return;
    event.preventDefault(); open.open = false; open.querySelector('summary').focus();
  });
  document.addEventListener('focusin', event => {
    for (const details of menus) if (!details.contains(event.target)) details.open = false;
  });
}
