# Paperclip Reference

**Kaynak:** https://github.com/paperclipai/paperclip (MIT Lisans)
**Versiyon:** v2026.x (calendar versioning)
**Dil:** TypeScript, Node.js 20+, pnpm workspaces monorepo
**ORM:** Drizzle ORM (Prisma değil)
**DB:** PostgreSQL (embedded-postgres veya harici)

---

## 1. Ne Yapar

Paperclip, AI agent'lardan oluşan sanal bir şirketi yöneten **self-hosted bir kontrol düzlemidir**. Chatbot değil, workflow builder değil — bir şirketi modeller: org chart, goals, projects, issues, budget, governance, cost tracking. Sonra AI agent'ları bu şirkette çalıştırır.

**Tek satır kurulum:**
```bash
npx paperclipai onboard --yes
```

---

## 2. Monorepo Yapısı

```
paperclipai/paperclip/
├── server/          # Express REST API + tüm orchestration servisleri
│   └── src/
│       ├── services/    # heartbeat, budget, cron, agents, issues, costs, ...
│       ├── routes/      # Route handler'ları
│       ├── middleware/  # Auth, error handler, guards
│       └── adapters/    # Process, HTTP adapter execution
├── ui/              # React + Vite board UI
├── cli/             # paperclipai CLI
│   └── src/commands/    # onboard, run, doctor, heartbeat-run, configure, ...
├── packages/
│   ├── db/          # Drizzle ORM schema, migrations, DB client (38 tablo)
│   ├── shared/      # Shared types, constants, validators, API paths
│   ├── adapter-utils/   # Billing, session compaction
│   └── adapters/    # claude-local, codex-local, cursor, gemini, opencode, pi, openclaw
├── plugins/         # Plugin SDK + örnek pluginler
└── docs/            # Mintlify dokümantasyon
```

---

## 3. Database Schema (38 Tablo, Drizzle ORM)

### Temel Tablolar

**`companies`**
```
id, name, description
status: active | paused | archived
pauseReason: manual | budget | system
issuePrefix: "PAP" (issue identifier prefix: PAP-42)
issueCounter: integer (otomatik artar)
budgetMonthlyCents, spentMonthlyCents
requireBoardApprovalForNewAgents: boolean
brandColor
```

**`agents`**
```
id, companyId, name, role, title, icon
status: active | paused | idle | running | error | pending_approval | terminated
reportsTo: uuid (self-FK — hiyerarşi)
adapterType: process | http | claude_local | codex_local | opencode_local | cursor | gemini_local | pi_local | openclaw_gateway
adapterConfig: jsonb (adapter'a özel config)
runtimeConfig: jsonb
budgetMonthlyCents, spentMonthlyCents
pauseReason: manual | budget | system
permissions: jsonb
lastHeartbeatAt: timestamp
capabilities, metadata
```

**`issues`** (core task entity)
```
id, companyId, projectId, goalId
parentId: uuid (self-FK — sub-task hiyerarşisi)
title, description
status: backlog | todo | in_progress | in_review | done | blocked | cancelled
priority: critical | high | medium | low
assigneeAgentId, assigneeUserId
identifier: text unique (e.g. "PAP-42")
issueNumber: integer

-- Atomik checkout için:
checkoutRunId: FK heartbeat_runs
executionRunId: FK heartbeat_runs
executionAgentNameKey: text
executionLockedAt: timestamp

requestDepth: integer (derinlik takibi)
executionWorkspaceId, executionWorkspaceSettings
startedAt, completedAt, cancelledAt
```

**`heartbeat_runs`**
```
id, companyId, agentId
invocationSource: timer | assignment | on_demand | automation
triggerDetail: manual | ping | callback | system
status: queued | running | succeeded | failed | cancelled | timed_out
startedAt, finishedAt
error, exitCode, signal
usageJson: token usage
resultJson: adapter result payload
sessionIdBefore, sessionIdAfter (session persistence)
stdoutExcerpt, stderrExcerpt
contextSnapshot: jsonb (issueId, taskKey, wakeReason, companyContext, ...)
logStore, logRef, logBytes (log storage)
```

**`budget_policies`**
```
id, companyId
scopeType: company | agent | project
scopeId: uuid (hangi agent/project, null = company)
metric: billed_cents
windowKind: calendar_month_utc | lifetime
amount: integer (limit in cents)
warnPercent: 80 (soft limit %)
hardStopEnabled: boolean
notifyEnabled: boolean
isActive: boolean
```

**`budget_incidents`**
```
id, companyId, policyId
scopeType, scopeId
thresholdType: soft | hard
amountLimit, amountObserved: integer
status: open | resolved | dismissed
approvalId: FK approvals (hard incident → otomatik approval request oluşturur)
windowStart, windowEnd
```

**`cost_events`**
```
id, companyId, agentId, issueId, projectId, heartbeatRunId
provider, biller, billingType, model
inputTokens, cachedInputTokens, outputTokens
costCents: integer
occurredAt
```

**`goals`**
```
id, companyId, title, description
level: company | team | agent | task
status: planned | active | achieved | cancelled
parentId (self-FK — goal hiyerarşisi)
ownerAgentId
```

**`projects`**
```
id, companyId, goalId, name, description
status: backlog | planned | in_progress | completed | cancelled
leadAgentId, targetDate
pauseReason, pausedAt
executionWorkspacePolicy: jsonb
```

**`approvals`**
```
id, companyId
type: hire_agent | approve_ceo_strategy | budget_override_required
status: pending | revision_requested | approved | rejected | cancelled
```

**`agent_api_keys`**
```
id, agentId
keyHash: SHA-256 (düz metin saklanmaz)
prefix: "pcp_" + ilk 8 hex char (loglarda tanınabilirlik)
```

**`agent_runtime_state`** — Agent-level session persistence
**`agent_task_sessions`** — Task-scoped session persistence
**`agent_config_revisions`** — Tüm config değişikliklerinin versiyonlanmış geçmişi

**`activity_log`** — Immutable, tüm mutasyonlar kaydedilir

### Diğer Tablolar
```
company_memberships, principal_permission_grants, invites, join_requests
workspace_operations, workspace_runtime_services
project_workspaces, execution_workspaces
issue_work_products, labels, issue_labels, issue_approvals, issue_comments
issue_read_states, assets, issue_attachments
documents, document_revisions, issue_documents
company_secrets, company_secret_versions
plugins, plugin_config, plugin_company_settings, plugin_state
plugin_entities, plugin_jobs, plugin_job_runs, plugin_webhook_deliveries, plugin_logs
auth tablolar: users, sessions, accounts, verifications
instance_settings, instance_user_roles
```

---

## 4. Heartbeat — Çekirdek Orchestration Motoru

Paperclip'te agent'lar **heartbeat** ile çalışır: zamanlı veya event-driven uyanışlar.

### Bir Heartbeat Run'ın Adımları

```
1. Budget gate check
   → getInvocationBlock(companyId, agentId)
   → Scope paused/over-budget? → budget incident yarat, run'ı atla

2. Agent start lock
   → withAgentStartLock(agentId, fn)
   → Per-agent promise chain ile concurrent wakeup serialize edilir

3. Max concurrent runs check
   → Varsayılan: 1 concurrent run/agent (max 10)

4. Context snapshot enrichment
   → issueId, taskKey, wakeReason, wakeSource, companyContext, issueGoalChain
   → Session info, workspace hints enjekte edilir

5. Session resolution
   → Task-scoped: agentTaskSessions
   → Agent-level: agentRuntimeState
   → Session compaction policy kontrol: rotate eğer çok uzun/eski

6. Workspace resolution
   → project_primary > task_session > agent_home_dir
   → Git clone/checkout gerekiyorsa yapılır

7. Adapter invocation
   → getServerAdapter(adapterType).execute(...)
   → Context: prompt, cwd, env (secrets dahil), session params, JWT token

8. Live streaming
   → heartbeat.run.log event'leri yayınlanır (real-time UI)

9. Usage/cost accounting
   → Adapter result'tan token usage parse edilir
   → cost_events kaydı oluşturulur
   → budgetService.evaluateCostEvent() çağrılır

10. Session state persistence
    → agentRuntimeState ve agentTaskSessions güncellenir

11. Issue checkout release (eğer issue check-out'u ise)

12. Activity log
```

### Session Compaction (Rotation)

Session çok uzun/eski olduğunda döndürülür:
- `maxSessionRuns` aşıldı
- `maxRawInputTokens` aşıldı
- `maxSessionAgeHours` aşıldı

Rotation sırasında yeni run'a handoff markdown notu enjekte edilir.

### Heartbeat Scheduler (`server/src/services/cron.ts`)

Paperclip'in cron scheduler'ı **sıfırdan yazılmış**, harici library kullanmaz:

```typescript
parseCron(expression: string): ParsedCron
validateCron(expression: string): string | null
nextCronTick(cron: ParsedCron, after: Date): Date | null
```

5-field standart cron destekler. Güvenlik limiti: 4 yıl (2.1M iterasyon).

**Bilinen Bug #1241 (Thundering Herd):** Paperclip'in custom setInterval-based polling'i, birden fazla agent aynı anda uyanırsa çakışma yaratır. Cooldown mekanizması yok.

---

## 5. Budget Enforcement

### Akış

```
1. Her heartbeat run öncesi: getInvocationBlock()
   → Scope paused? → run engelle
   → Over budget? → run engelle

2. Her run sonrası: evaluateCostEvent(event)
   → Tüm aktif policy'leri kontrol et (company + agent + project scope)
   → observedAmount = costCents SUM (bu ay, bu scope)
   → >= warnPercent → soft incident (sadece bildirim)
   → >= amount (hard limit) → hard incident + scope PAUSE + approval request oluştur
```

### Scope Pause Davranışı

| Scope | Nasıl Pause Edilir |
|-------|-------------------|
| company | `companies.status = "paused"`, `pauseReason = "budget"` |
| agent | `agents.status = "paused"`, `pauseReason = "budget"` |
| project | `projects.pausedAt` set, `pauseReason = "budget"` |

### Hard Limit Sonrası Kaldırma

Hard incident → `budget_override_required` approval oluşturulur → Board onaylamalı → `resolveIncident()` → scope unpaused.

**Bilinen Bug #1256 (403 Flood):** Hard limit → agent paused → ama bazı in-flight checkout'lar devam ediyor → 403 hatası → infinite retry döngüsü.

---

## 6. Atomic Issue Execution

Issue'nun aynı anda sadece bir agent tarafından çalıştırılmasını sağlar:

```sql
-- Checkout işlemi atomik:
UPDATE issues SET
  executionAgentNameKey = 'architect',
  executionLockedAt = NOW(),
  checkoutRunId = 'run-id',
  status = 'in_progress'
WHERE id = 'issue-id'
  AND executionLockedAt IS NULL  -- başka kimse checkout yapmamış
```

**Bilinen Bug #1245 (Stale Lock):** Run başarısız bittiğinde `executionRunId` temizlenmiyor. Issue sonsuza kadar locked kalıyor.

---

## 7. CLI Komutları

```bash
npx paperclipai onboard [--yes]     # First-run setup wizard
npx paperclipai run                 # Onboard + doctor + server başlat
npx paperclipai doctor              # Diagnostic kontroller + repair
npx paperclipai env                 # Env variable'ları yazdır
npx paperclipai configure           # Config güncelle
npx paperclipai db:backup           # DB backup

# Subcommand grupları:
paperclipai heartbeat run <agentId> # Tek agent heartbeat, live logs
paperclipai company list/get/create/delete
paperclipai issue list/get/create/update/assign
paperclipai agent list/get/create/update/delete/local-cli
paperclipai approval list/get/approve/reject
paperclipai activity list
paperclipai dashboard show
paperclipai worktree provision/enter/exit
paperclipai plugin list/install/uninstall
paperclipai auth bootstrap-ceo      # İlk admin invite URL'i
```

### `onboard` Wizard'ı

- `--yes` flag'i ile tüm promptları atla, default'ları kullan
- 30+ `PAPERCLIP_*` env var ile Docker/CI override desteği
- Yapılandırılan bölümler: database, LLM provider, logging, server, storage, secrets
- Config yazıldığı yer: `~/.paperclip/instances/default/paperclip.json`

---

## 8. Adapter Sistemi

Her adapter: bir agent tool'unu (Claude CLI, Codex, Cursor vb.) Paperclip'e bağlar.

| Adapter | Ne Çalıştırır |
|---------|--------------|
| `claude_local` | Claude Code CLI (local) |
| `codex_local` | OpenAI Codex CLI |
| `cursor` | Cursor IDE agent |
| `gemini_local` | Google Gemini CLI |
| `opencode_local` | OpenCode CLI |
| `openclaw_gateway` | OpenClaw via gateway |
| `process` | Herhangi bir process (stdin/stdout) |
| `http` | HTTP endpoint çağrısı |

Her adapter paketi şunları içerir:
- `src/server/execute.ts` — Server-side execution (process spawn / HTTP call)
- `src/cli/index.ts` — CLI output formatter
- `src/cli/quota-probe.ts` — Tool mevcut mu / quota var mı kontrol
- `src/ui/build-config.ts` — Runtime config builder

---

## 9. Agent Rolleri (shared constants)

```typescript
AGENT_ROLES = [
  "ceo", "cto", "cmo", "cfo",
  "engineer", "designer", "pm", "qa", "devops",
  "researcher", "general"
]
```

---

## 10. Deployment

```bash
# Docker
docker-compose up

# Lokal dev
pnpm install
pnpm dev              # API + UI (embedded PG otomatik başlar)
pnpm dev:once         # File watching olmadan
pnpm db:migrate       # Migration'ları uygula

# Health check
curl http://localhost:3100/api/health

# Local data:
~/.paperclip/instances/default/
├── paperclip.json       # Config
├── db/                  # Embedded PG data
├── data/storage/        # File storage
├── logs/
├── backups/
└── workspaces/          # Agent çalışma dizinleri
```

---

## 11. Bilinen Buglar

| Bug | Issue | Root Cause |
|-----|-------|-----------|
| Stale Lock | #1245 | `executionRunId` başarısız run'dan sonra temizlenmiyor, issue sonsuza lock'lu kalıyor |
| Thundering Herd | #1241 | Custom `setInterval` polling + cooldown yok, aynı anda çok fazla agent uyanıyor |
| drizzle-orm missing | #1243 | Package dependency boşluğu, fresh install'da `drizzle-orm` bulunamıyor |
| 403 Flood | #1256 | Checkout expire olunca → infinite retry → log flood |

---

## 12. Temel Engineering Kuralları

1. **Company-scoped:** Her entity tek bir company'ye ait. Cross-company erişim route level'da engellenir.
2. **Single assignee:** Issue'ların tek assignee'si var. `in_progress` geçişi atomik.
3. **Budget hard-stop auto-pause:** Hard limit → scope anında pause + approval request.
4. **Approval gates:** Agent hire (configurable), CEO strategy, budget override board onayı gerektirir.
5. **Activity log immutability:** Tüm mutasyonlar loglanır, kayıtlar insert-only.
6. **Config revisioning:** Agent config değişiklikleri versiyonlanır, rollback desteklenir.
7. **Session persistence:** Sessioned adapter'lar (claude_local, codex_local) session'ı heartbeat'ler arası korur.
8. **Goal ancestry:** Task'lar tam goal zincirini taşır — agent her zaman "neden" bilir.
9. **Secret redaction:** Hassas değerler log, revisions, API response'lardan çıkarılır.
