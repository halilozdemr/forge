export function SkeletonRow(cols: number = 4): HTMLElement {
  const tr = document.createElement('tr');
  for (let i = 0; i < cols; i++) {
    const td = document.createElement('td');
    td.innerHTML = `<div class="skeleton skeleton-text" style="width: ${60 + Math.random() * 30}%"></div>`;
    tr.appendChild(td);
  }
  return tr;
}

export function SkeletonRows(count: number, cols: number = 4): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) frag.appendChild(SkeletonRow(cols));
  return frag;
}

export function SkeletonCard(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card stat-card';
  el.innerHTML = `
    <div class="skeleton skeleton-badge" style="width:50px; margin-bottom:12px"></div>
    <div class="skeleton" style="height:28px; width:70%; margin-bottom:8px; border-radius:4px"></div>
    <div class="skeleton skeleton-text" style="width:50%"></div>
  `;
  return el;
}

export function SkeletonIssueCard(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card issue-card';
  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:8px">
      <div class="skeleton skeleton-badge"></div>
      <div class="skeleton" style="height:11px; width:30px; border-radius:3px"></div>
    </div>
    <div class="skeleton skeleton-text" style="margin-bottom:6px"></div>
    <div class="skeleton skeleton-text" style="width:70%"></div>
  `;
  return el;
}
