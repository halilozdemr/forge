# Forge v3 — Geliştirme Planı

Bu doküman Forge v3'ün mevcut durumunu, kırık noktaları ve tam vizyona ulaşmak için yapılacakları tanımlar. Antigravity bu dokümanı referans alarak çalışır.

---

## Mevcut Durum Analizi

### Çalışan Kısımlar
- `forge start` — SQLite, sıfır Docker ✅
- `forge init` — proje scaffold ✅
- `forge login / logout` ✅
- DB schema + migration ✅
- SQLite queue + worker ✅
- Heartbeat scheduler ✅
- Sync outbox ✅
- Agent/Issue/Sprint/Budget HTTP API (CRUD) ✅

### Kırık / Eksik Kısımlar

**1. Company ID sorunu (kritik UX kırığı)**
Tüm CLI komutları `--company <id>` gerektirir ama kullanıcı company ID'sini bilmez. `.forge/config.json`'da `slug` var, ID yok. `forge agent list` çalışmıyor çünkü kullanıcı ID giremez.

**2. forge init → forge start arası kopukluk**
`forge init` `.forge/config.json` yazar. `forge start` bunu okuyup DB'ye seed eder. Ama `forge start` zaten çalışıyorken `forge init` yapılırsa DB güncellenmez. Ayrıca init sırasında agent'ların DB'ye yazılıp yazılmadığı belli değil.

**3. Issue → Agent çalışma akışı kopuk**
Issue oluşturulup agent'a atandığında hiçbir şey olmaz. Heartbeat'in issue'yu pickup etmesi için cron'un gelmesi gerekiyor. Manuel tetikleme yok. `forge issue run <id>` komutu yok.

**4. forge status anlamsız çıktı**
Çalışan worker sayısı, queue durumu, bağlı company bilgisi gösterilmiyor.

**5. WebUI agent/issue göstermiyor**
WebUI mevcut ama API'ye hangi companyId ile sorgu atacağını bilmiyor. Company context yok.

**6. Agent prompt dosyaları DB'ye bağlı değil**
`loader.ts` markdown dosyalarından agent okur ama bunlar DB ile sync edilmez. `forge init` sonrası default agent'lar DB'de mi yoksa sadece dosyada mı belli değil.

**7. `forge agent hire` UX kötü**
Role parametresi name'den kopyalanıyor (`role: opts.name`). Heartbeat cron, provider, model interaktif seçilemiyor.

**8. Eksik runner'lar**
Paperclip'in 8 adapter'ına karşı Forge'da 3 runner var. gemini-cli, codex-cli, opencode-cli, cursor, process, http eksik.

---

## Faz 0 — Temel Akışı Çalıştır

> Önce sistem uçtan uca çalışmalı. Yeni feature yok, sadece kırıklar düzeltilir.

### 0.1 — Company Context Otomasyonu

**Problem:** Her komut `--company <id>` istiyor.

**Çözüm:** `.forge/config.json` içindeki `company.slug`'ı kullanarak company'i otomatik resolve et.

`src/utils/company.ts` — YENİ DOSYA:
```typescript
// Önce --company flag'ine bak
// Yoksa .forge/config.json'dan slug oku
// slug ile DB'den ID bul
// Yoksa "No company found. Run forge init first." hata ver
export async function resolveCompany(flagValue?: string): Promise<string>
```

Tüm CLI komutlarında (`agent.ts`, `issue.ts`, `sprint.ts`, `budget.ts`, `status.ts`):
- `--company <id>` opsiyonel hale gelir
- Verilmezse `resolveCompany()` ile otomatik bulunur

### 0.2 — forge init → DB Sync

**Problem:** `forge init` sadece dosya yazar, DB'ye yazmaz. `forge start` çalışırken init DB'yi güncellemez.

**Çözüm:** `forge init` sonunda `http://localhost:3131/v1/init` endpoint'ine POST atar (forge çalışıyorsa). Çalışmıyorsa "Run forge start to apply changes" mesajı verir.

`/v1/init` POST endpoint'i `src/server/routes/` altına eklenir:
- `.forge/config.json` okur
- Company upsert
- Project upsert
- Default agent'ları upsert (seed mantığı buraya taşınır)
- Heartbeat scheduler sync tetikler

### 0.3 — forge issue run

**Problem:** Issue oluşturulduğunda agent çalışmaz, heartbeat'i beklemek gerekir.

**Çözüm:** Yeni CLI komutu.

```bash
forge issue run <issueId>          # Direkt agent'a gönder
forge issue run <issueId> --agent builder  # Agent override
```

`src/cli/commands/issue.ts` içine `run` subcommand'ı eklenir:
- Issue'yu DB'den çeker
- `assignedAgentId` varsa o agent'ı kullanır
- `enqueueAgentJob()` çağırır
- Job ID'yi log'a yazar
- `forge queue status <jobId>` ile takip edilebilir

### 0.4 — forge status düzeltmesi

`forge status` şunları göstermeli:

```
Forge v3 — Running
───────────────────────────────
Company:    My Forge (slug: my-forge)
Project:    my-project
DB:         ~/.forge/forge.db (2.3 MB)
Cloud:      http://localhost:4000 ✓ / not configured

Queue
  Pending:    3
  Running:    1
  Failed:     0

Agents (9)
  idle:       7
  running:    1
  paused:     1

Heartbeat
  Scheduled:  1 agent (scrum_master)
  Next run:   in 4h 12m
```

`src/cli/commands/status.ts` API'den bu bilgileri çekecek şekilde güncellenir.
`/v1/status` endpoint'i güncellenir: queue istatistikleri, agent sayıları, heartbeat bilgisi döner.

### 0.5 — WebUI Company Context

WebUI açıldığında ilk olarak `/v1/companies` çağırır, dönen ilk company'i seçer. Tüm API çağrıları bu `companyId` ile yapılır. Company switcher UI'a eklenir (ileride).

### 0.6 — Agent Prompt DB Sync

`seedDatabase()` çalışırken her agent için prompt dosyasını `src/agents/defaults/{slug}.md`'den okur ve `promptFile` alanına path yazar. `AgentRegistry.resolvePrompt()` önce DB'deki `promptFile`'a bakar, yoksa default'u yükler.

---

## Faz 1 — Tam Agent Yaşam Döngüsü

> Agent oluşturma, çalıştırma, izleme akışı tam çalışmalı.

### 1.1 — forge agent hire İnteraktif Mod

```bash
forge agent hire              # interaktif wizard
forge agent hire builder      # slug verip wizard
forge agent hire builder --name "Builder" --provider claude-cli --model sonnet  # flag'lerle direkt
```

İnteraktif wizard (@clack/prompts):
1. Slug (zorunlu)
2. Display name
3. Role (select: engineer | designer | pm | qa | devops | researcher | general)
4. Model provider (select: claude-cli | anthropic-api | openrouter | gemini-cli | codex-cli)
5. Model (provider'a göre değişir)
6. Reports to (mevcut agent'lardan select, opsiyonel)
7. Heartbeat cron (opsiyonel, örnek: `0 */6 * * *`)

### 1.2 — forge agent run

```bash
forge agent run <slug> --input "Refactor the auth module"
forge agent run <slug> --issue <issueId>
```

Agent'ı direkt çalıştırır, terminal'de output'u stream eder.

### 1.3 — forge heartbeat run

```bash
forge heartbeat run <slug>    # Tek agent heartbeat, terminal'de live log
```

Paperclip'teki `paperclipai heartbeat run <agentId>` karşılığı.

### 1.4 — Issue Atomic Checkout

Issue aynı anda sadece bir agent tarafından çalıştırılabilmeli.

Schema'ya eklenir:
```prisma
model Issue {
  // mevcut alanlar...
  executionLockedAt DateTime?
  executionAgentSlug String?
  executionJobId     String?
}
```

`enqueueAgentJob()` çağrılmadan önce atomik checkout:
```typescript
// Transaction içinde:
// WHERE executionLockedAt IS NULL → UPDATE SET executionLockedAt = now()
// Başarısızsa "Issue already being executed by {agent}" hatası ver
```

Job tamamlanınca/başarısız olunca lock kaldırılır (worker'da).

### 1.5 — forge queue status

```bash
forge queue status             # Tüm queue
forge queue status --job <id>  # Tek job
```

```
Queue Status
───────────────────────────────
ID          Agent       Issue     Status    Duration
abc123      builder     ISS-42    running   2m 14s
def456      reviewer    ISS-41    pending   —
ghi789      debugger    —         failed    1m 03s
```

---

## Faz 2 — Yeni Runner'lar (Paperclip Parité)

> Tüm adapter tipleri eklenir.

### 2.1 — gemini-cli Runner

```typescript
// src/bridge/runners/gemini-cli.ts
// Komut: gemini -p "{input}" --output-format text
// Auth: GEMINI_API_KEY env var veya gcloud auth
// Token usage: output parse edilir
```

### 2.2 — codex-cli Runner

```typescript
// src/bridge/runners/codex-cli.ts
// Komut: codex --full-auto --quiet "{input}"
// Auth: OPENAI_API_KEY env var
```

### 2.3 — opencode-cli Runner

```typescript
// src/bridge/runners/opencode-cli.ts
// Komut: opencode run --print "{input}"
```

### 2.4 — process Runner

```typescript
// src/bridge/runners/process.ts
// Herhangi bir binary: stdin'e input yaz, stdout'tan output oku
// Agent config'de: { "command": "/usr/local/bin/my-agent", "args": ["--quiet"] }
```

### 2.5 — http Runner

```typescript
// src/bridge/runners/http.ts
// POST {url} { input, systemPrompt, model }
// Response: { output, tokenUsage }
// Agent config'de: { "url": "http://localhost:8080/run" }
```

### 2.6 — cursor Runner

```typescript
// src/bridge/runners/cursor.ts
// Cursor IDE agent endpoint'i (HTTP)
// Cursor'ın background agent API'si üzerinden
```

### 2.7 — Runner Config (adapterConfig)

Her runner'ın ek config'i için `Agent` modeline alan eklenir:

```prisma
model Agent {
  // mevcut alanlar...
  adapterConfig String @default("{}")   // JSON — runner'a özel config
}
```

Örnek: `process` runner için `{ "command": "/usr/bin/my-agent" }`, `http` runner için `{ "url": "http://..." }`.

---

## Faz 3 — Goals Hiyerarşisi

> Agent'lar her zaman "neden yapıyorum" bilir.

### 3.1 — Schema

```prisma
model Goal {
  id          String  @id @default(cuid())
  companyId   String
  title       String
  description String?
  level       String  @default("task")   // company | team | agent | task
  status      String  @default("planned") // planned | active | achieved | cancelled
  parentId    String?
  ownerAgentSlug String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company  Company @relation(...)
  parent   Goal?   @relation("GoalTree", fields: [parentId], references: [id])
  children Goal[]  @relation("GoalTree")
  issues   Issue[]

  @@map("goals")
}

// Issue modeline eklenir:
model Issue {
  goalId String?
  goal   Goal? @relation(...)
}
```

### 3.2 — CLI

```bash
forge goal create --title "Launch v1" --level company
forge goal list
forge goal link <issueId> --goal <goalId>
```

### 3.3 — Context Injection

Agent çalıştırılırken input'a goal chain enjekte edilir:

```
[CONTEXT]
Goal: Launch v1 (company) → Ship auth module (team) → Implement JWT (task)
Issue: ISS-42 — Add refresh token support
[/CONTEXT]

{original input}
```

---

## Faz 4 — Execution Workspaces

> Her issue izole ortamda çalışır.

### 4.1 — Schema

```prisma
model ExecutionWorkspace {
  id            String    @id @default(cuid())
  issueId       String    @unique
  agentSlug     String
  policy        String    @default("shared")  // shared | per_task | git_worktree
  workspacePath String
  branchName    String?
  status        String    @default("active")  // active | completed | cleaned
  createdAt     DateTime  @default(now())
  cleanedAt     DateTime?

  issue Issue @relation(...)
  @@map("execution_workspaces")
}
```

### 4.2 — Workspace Policies

**shared (default):** Mevcut davranış, `process.cwd()` kullanılır.

**per_task:**
- `~/.forge/workspaces/{issueId}/` oluşturulur
- Proje dosyaları kopyalanır (rsync benzeri, .gitignore ile)
- Agent bu dizinde çalışır
- Tamamlanınca değişiklikler merge edilir

**git_worktree:**
- `git worktree add ~/.forge/workspaces/{issueId}/ -b forge/issue-{issueId}`
- Agent bu branch'ta çalışır
- Issue tamamlanınca otomatik PR açılır (GitHub/GitLab API)
- Worktree temizlenir

### 4.3 — Config

Project veya Agent seviyesinde ayarlanır:

```json
// .forge/config.json
{
  "workspace": {
    "policy": "git_worktree",
    "autoPr": true
  }
}
```

---

## Faz 5 — Session Persistence

> Agent'lar heartbeatlar arası context'i hatırlar.

### 5.1 — Schema

```prisma
model AgentRuntimeState {
  id          String   @id @default(cuid())
  agentId     String   @unique
  sessionId   String?
  tokenCount  Int      @default(0)
  runCount    Int      @default(0)
  lastUsedAt  DateTime @updatedAt

  agent Agent @relation(...)
  @@map("agent_runtime_state")
}

model AgentTaskSession {
  id         String    @id @default(cuid())
  agentId    String
  issueId    String
  sessionId  String
  tokenCount Int       @default(0)
  createdAt  DateTime  @default(now())
  closedAt   DateTime?

  @@unique([agentId, issueId])
  @@map("agent_task_sessions")
}
```

### 5.2 — Session Kullanımı

Claude CLI runner'da `-r {sessionId}` flag'i ile session devam ettirilir. Diğer runner'lar için session bilgisi context'e enjekte edilir.

**Session Rotation:**
```typescript
// Şu koşullarda yeni session açılır:
const shouldRotate =
  state.runCount >= agent.maxSessionRuns ||      // default: 20
  state.tokenCount >= agent.maxSessionTokens ||  // default: 100_000
  lastUsedAt < 24 hours ago;

// Rotation'da handoff notu eklenir:
// "Previous session summary: {summary}"
```

### 5.3 — Agent Config Alanları

```prisma
model Agent {
  maxSessionRuns   Int @default(20)
  maxSessionTokens Int @default(100000)
  maxSessionAgeHours Int @default(24)
}
```

---

## Faz 6 — Config Revisioning

> Agent config değişiklikleri versiyonlanır.

### 6.1 — Schema

```prisma
model AgentConfigRevision {
  id         String   @id @default(cuid())
  agentId    String
  revision   Int
  config     String   // JSON snapshot
  changeNote String?
  createdAt  DateTime @default(now())

  agent Agent @relation(...)
  @@unique([agentId, revision])
  @@map("agent_config_revisions")
}
```

### 6.2 — Davranış

Her `PUT /v1/agents/:slug` çağrısında:
1. Mevcut config JSON olarak snapshot alınır
2. Yeni `AgentConfigRevision` oluşturulur (revision artar)
3. Update uygulanır

```bash
forge agent revisions <slug>        # Tüm revision'ları listele
forge agent rollback <slug> --rev 3 # Belirli revision'a dön
```

---

## Faz 7 — Company Secrets

> API key'ler ve hassas config şifreli saklanır.

### 7.1 — Schema

```prisma
model CompanySecret {
  id          String   @id @default(cuid())
  companyId   String
  name        String   // "ANTHROPIC_API_KEY"
  description String?
  value       String   // AES-256 encrypted
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company Company @relation(...)
  @@unique([companyId, name])
  @@map("company_secrets")
}
```

### 7.2 — Encryption

AES-256-GCM. Encryption key: `~/.forge/master.key` (ilk `forge start`'ta generate edilir, .gitignore'a eklenir).

### 7.3 — Kullanım

Agent prompt'larında `{{secrets.ANTHROPIC_API_KEY}}` ile inject edilir. Worker çalıştırırken decrypt eder, env variable olarak geçer. Log'larda `[REDACTED]` gösterilir.

```bash
forge secret set ANTHROPIC_API_KEY sk-ant-...
forge secret list
forge secret delete ANTHROPIC_API_KEY
```

---

## Faz 8 — Approval Gates

> Bazı aksiyonlar onay gerektirir.

### 8.1 — Schema

```prisma
model Approval {
  id          String   @id @default(cuid())
  companyId   String
  type        String   // hire_agent | budget_override | ceo_strategy
  status      String   @default("pending")  // pending | approved | rejected | cancelled
  requestedBy String   // agent slug veya "user"
  metadata    String   @default("{}")  // JSON — bağlam bilgisi
  requestedAt DateTime @default(now())
  reviewedAt  DateTime?

  company Company @relation(...)
  @@map("approvals")
}
```

### 8.2 — Akış

**hire_agent:** Company config'de `requireApprovalForNewAgents: true` ise `forge agent hire` direkt oluşturmaz, approval oluşturur. Forge Cloud dashboard'dan veya CLI'dan onaylanır.

**budget_override:** Hard limit aşılınca agent otomatik pause olur, approval oluşturulur. Onaylanınca agent tekrar çalışır.

```bash
forge approval list
forge approval approve <id>
forge approval reject <id> --reason "Budget exceeded"
```

### 8.3 — Company Config

```prisma
model Company {
  requireApprovalForNewAgents Boolean @default(false)
  // diğer alanlar...
}
```

---

## Faz 9 — Issue Comments ve Work Products

> Agent çıktıları yapılandırılmış olarak saklanır.

### 9.1 — Schema

```prisma
model IssueComment {
  id        String   @id @default(cuid())
  issueId   String
  authorSlug String  // agent slug veya "user"
  content   String
  createdAt DateTime @default(now())

  issue Issue @relation(...)
  @@map("issue_comments")
}

model IssueWorkProduct {
  id        String   @id @default(cuid())
  issueId   String
  agentSlug String
  type      String   // code | doc | test | pr | analysis
  title     String
  content   String
  filePath  String?
  createdAt DateTime @default(now())

  issue Issue @relation(...)
  @@map("issue_work_products")
}
```

### 9.2 — Worker Entegrasyonu

Job tamamlanınca worker agent output'unu parse ederek work product oluşturur:
- Kod blokları → `type: "code"`
- Dosya path'i varsa → `filePath` doldurulur
- Genel analiz → `type: "analysis"`

```bash
forge issue products <issueId>   # Work product'ları listele
forge issue comments <issueId>   # Comment'leri listele
```

---

## Faz 10 — Labels

```prisma
model Label {
  id        String @id @default(cuid())
  companyId String
  name      String
  color     String @default("#6b7280")

  company     Company      @relation(...)
  issueLabels IssueLabel[]
  @@unique([companyId, name])
  @@map("labels")
}

model IssueLabel {
  issueId String
  labelId String
  @@id([issueId, labelId])
  @@map("issue_labels")
}
```

```bash
forge label create "bug" --color "#ef4444"
forge issue label <issueId> bug urgent
```

---

## Faz 11 — WebSocket Live Events

> Gerçek zamanlı akış.

### 11.1 — Server

Fastify'a `@fastify/websocket` eklenir. `/ws` endpoint'i açılır.

Event tipleri:
```typescript
type ForgeEvent =
  | { type: "agent.status.changed"; agentSlug: string; status: string }
  | { type: "issue.updated"; issueId: string; status: string }
  | { type: "heartbeat.log"; agentSlug: string; line: string }
  | { type: "queue.job.started"; jobId: string; agentSlug: string }
  | { type: "queue.job.completed"; jobId: string; success: boolean }
  | { type: "budget.threshold"; scope: string; percent: number }
```

### 11.2 — Event Emission

Worker, heartbeat handler ve budget gate'de event'ler emit edilir:

```typescript
// src/events/emitter.ts
export function emit(event: ForgeEvent): void
// Tüm bağlı WebSocket client'larına gönderir
```

### 11.3 — Live Log Streaming

Claude CLI runner çalışırken stdout satır satır okunur, `heartbeat.log` event'i olarak emit edilir. Terminal'de:

```bash
forge agent run builder --input "..." --stream
# Gerçek zamanlı output akışı görülür
```

---

## Faz 12 — Company Portability

```bash
forge export                    # → forge-export-2026-03-23.zip
forge export --output my.zip

forge import my.zip             # Yeni makinede restore
forge import my.zip --company new-slug  # Farklı slug ile import
```

Export içeriği:
- `company.json` — company + agents + budget policies
- `projects/` — project config'leri
- `issues/` — tüm issue'lar
- `sprints/` — sprint'ler
- `memory/` — memory entry'leri
- `activity_log.json`

---

## Faz 13 — Forge Cloud

> Yukarıdaki her şey tamamlandıktan sonra Forge Cloud build edilir.

`v3/forge-cloud/` altında ayrı proje. Spec: `docs/forge-cloud-spec.md`.

Eklemeler (mevcut spec'e göre):
- WebSocket proxy: local Forge'dan gelen event'leri cloud dashboard'a iletir
- Approval management: cloud dashboard'dan approval approve/reject
- Multi-runner credential management: her kullanıcı kendi API key'lerini cloud'da saklar (company secrets cloud versiyonu)

---

## Build Öncelik Sırası

| Faz | Kapsam | Öncelik |
|-----|--------|---------|
| **Faz 0** | Temel akış düzeltmeleri | 🔴 Kritik |
| **Faz 1** | Tam agent yaşam döngüsü | 🔴 Kritik |
| **Faz 2** | Yeni runner'lar | 🟡 Yüksek |
| **Faz 3** | Goals | 🟡 Yüksek |
| **Faz 4** | Execution workspaces | 🟡 Yüksek |
| **Faz 5** | Session persistence | 🟡 Yüksek |
| **Faz 6** | Config revisioning | 🟢 Normal |
| **Faz 7** | Company secrets | 🟢 Normal |
| **Faz 8** | Approval gates | 🟢 Normal |
| **Faz 9** | Comments + work products | 🟢 Normal |
| **Faz 10** | Labels | 🟢 Normal |
| **Faz 11** | WebSocket | 🟢 Normal |
| **Faz 12** | Company portability | 🔵 Düşük |
| **Faz 13** | Forge Cloud | 🔵 Düşük |

---

## Antigravity İçin Prompt Şablonu

Her faz için:

```
Forge v3 projesini aşağıdaki spec'e göre güncelle.

Plan dosyası: v3/docs/development-plan.md
Faz: [X] — [Faz Adı]

Bu faz kapsamındaki tüm değişiklikleri yap:
[Fazın maddeleri]

Kapsam dışına çıkma. tsc --noEmit ile TypeScript hatasız derlenmeli.
```
