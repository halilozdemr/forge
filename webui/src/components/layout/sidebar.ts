export function Sidebar() {
  const nav = document.createElement('nav');
  nav.className = 'sidebar';
  nav.innerHTML = `
    <div class="sidebar-logo">
      <strong>Forge v3</strong>
    </div>
    <ul class="sidebar-links">
      <li><a href="#/">Overview</a></li>
      <li><a href="#/agents">Agents</a></li>
      <li><a href="#/issues">Issues</a></li>
      <li><a href="#/sprints">Sprints</a></li>
      <li><a href="#/queue">Queue</a></li>
      <li><a href="#/budget">Budget</a></li>
    </ul>
  `;
  return nav;
}
