import { healthStore } from '../../store/store';

export function Topbar() {
  const header = document.createElement('header');
  header.className = 'topbar';
  
  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'breadcrumb';
  breadcrumb.innerText = 'Forge v3 / Overview'; // Dynamic breadcrumb placeholder
  
  const statusBadge = document.createElement('div');
  statusBadge.className = 'health-badge';
  
  healthStore.subscribe(status => {
    if (!status) {
      statusBadge.innerHTML = '<span class="badge badge-amber">Checking...</span>';
    } else {
      const color = status.status === 'healthy' ? 'green' : (status.status === 'degraded' ? 'amber' : 'red');
      statusBadge.innerHTML = `<span class="badge badge-${color}">${status.status.toUpperCase()}</span>`;
    }
  });

  header.appendChild(breadcrumb);
  header.appendChild(statusBadge);
  
  return header;
}
