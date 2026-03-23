import { Issue } from '../../store/store';
import { esc } from '../../api/utils';

const TYPE_COLOR: Record<string, string> = {
  feature:  'blue',
  bug:      'red',
  refactor: 'purple',
  release:  'green',
  chore:    'gray',
};

const STEP_LABEL: Record<string, string> = {
  pm: 'Planning',
  'devops-branch': 'Branching',
  architect: 'Architecture',
  builder: 'Implementation',
  reviewer: 'Review',
  'devops-merge': 'Merge',
  debugger: 'Debugging',
  devops: 'Delivery',
  'devops-build': 'Build',
  'devops-release': 'Release',
  scrum_master: 'Retrospective',
  direct: 'Direct Run',
};

const PIPELINE_STATUS_COLOR: Record<string, string> = {
  running: 'amber',
  queued: 'amber',
  pending: 'gray',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
};

function formatAgentLabel(slug?: string | null) {
  if (!slug) return 'Waiting';
  return slug.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function IssueCard(issue: Issue) {
  const card = document.createElement('div');
  card.className = 'card issue-card';
  card.draggable = true;
  card.dataset.id = issue.id;

  const typeColor = TYPE_COLOR[issue.type] ?? 'gray';
  const idShort = issue.id.slice(0, 6).toUpperCase();
  const activeAgent = issue.pipeline?.activeAgentSlug ?? issue.executionAgentSlug ?? issue.assignedAgent?.slug ?? null;
  const activeStep = issue.pipeline?.activeStepKey ?? null;
  const activeStatus = issue.pipeline?.activeStatus ?? issue.pipeline?.status ?? null;
  const progress = issue.pipeline
    ? `${issue.pipeline.completedSteps}/${issue.pipeline.totalSteps}`
    : null;
  const pipelineColor = PIPELINE_STATUS_COLOR[activeStatus ?? 'pending'] ?? 'gray';
  const stepLabel = activeStep ? (STEP_LABEL[activeStep] ?? activeStep) : null;
  const activeExcerpt = issue.pipeline?.activeExcerpt?.trim();

  card.innerHTML = `
    <div class="issue-card-header">
      <span class="badge badge-${typeColor}">${esc(issue.type)}</span>
      <span class="issue-id">${esc(idShort)}</span>
    </div>
    <div class="issue-card-title">${esc(issue.title)}</div>
    ${issue.pipeline ? `
      <div class="issue-card-pipeline">
        <div class="issue-card-pipeline-main">
          <span class="badge badge-${pipelineColor}">${esc(formatAgentLabel(activeAgent))}</span>
          <span class="issue-pipeline-step">${esc(stepLabel ?? 'Queued')}</span>
        </div>
        <div class="issue-card-pipeline-meta">
          <span>${esc(progress ?? '0/0')} steps</span>
          <span>${esc(activeStatus ?? issue.pipeline.status)}</span>
        </div>
        ${activeExcerpt ? `<div class="issue-pipeline-excerpt">${esc(activeExcerpt)}</div>` : ''}
      </div>
    ` : ''}
    <div class="issue-card-footer">
      <span class="issue-assignee">${esc(issue.assignedAgent?.name || 'Unassigned')}</span>
    </div>
  `;

  return card;
}
