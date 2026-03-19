# Forge vs Paperclip

Forge, Paperclip'in MIT lisanslı kaynak kodundan ilham alarak **sıfırdan yeniden yazılmış** bir AI agent orchestration platformudur. Fork değildir — Paperclip'in iyi fikirlerini alır, bilinen buglarını tasarımda çözer, karmaşıklığını azaltır.

---

## 1. Ne Alıyoruz

| Paperclip Konsepti | Forge'daki Karşılığı | Notlar |
|-------------------|---------------------|--------|
| `npx paperclipai onboard --yes` | `npx forge init` | Interactive wizard, aynı fikir |
| `reportsTo` field (agent hiyerarşisi) | `reportsTo` field | Birebir alındı |
| Heartbeat scheduler (agent uyanışları) | BullMQ repeatable jobs | Aynı fikir, farklı implementasyon |
| Budget enforcement (soft/hard limit) | BudgetGate + BudgetPolicy | Aynı mantık, Prisma ile |
| Agent lifecycle state machine | Aynı state'ler | pending_approval → idle → active → paused → terminated |
| Agent API keys (SHA-256 hashed) | AgentApiKey tablosu | `pcp_` prefix → `frg_` prefix |
| Company isolation (multi-tenant) | Company tablosu | Tüm veri company-scoped |
| Activity log (immutable) | ActivityLog tablosu | Insert-only |
| Cost events tracking | CostEvent tablosu | costCents → costUsd (Decimal) |
| `issues` → tek assignee, atomik checkout | Issue tablosu | Aynı fikir |
| `heartbeat_runs` tablosu | HeartbeatRun tablosu | Basitleştirilmiş |
| Session persistence | Runner'da model bazlı | Claude CLI için `-r sessionId` flag |
| Config revisioning | Yok (MVP scope dışı) | İleride eklenebilir |

---

## 2. Ne Almıyoruz ve Neden

| Paperclip Özelliği | Neden Almıyoruz |
|-------------------|----------------|
| **Plugin sistemi** (50+ capability, worker sandbox) | 71 servis dosyası, aşırı karmaşık. MVP scope dışı. |
| **38 tablo** DB schema | Forge 15 tablo ile aynı değeri üretiyor |
| **Drizzle ORM** | Prisma v2'de kanıtlanmış, migration + type safety daha iyi DX |
| **Embedded PostgreSQL** (pglite) | Opsiyonel tutuyoruz — kullanıcı kendi PG'sini getiriyor |
| **Issue approval workflow** | `hire_agent`, `ceo_strategy`, `budget_override` approval'ları MVP dışı |
| **Goals hiyerarşisi** (company/team/agent/task level) | İlk sürümde sadece sprint ve issue var |
| **Execution workspaces** (Git clone, Docker) | v1 bridge yeterli, workspace management sonraki fazda |
| **Better-auth** authentication | Local/trusted mode yeterli (single user, local machine) |
| **Plugin jobs, plugin state, plugin entities** | Plugin sistemi yok |
| **WebSocket live events** | BullMQ job status polling yeterli |
| **Company portability** (export/import) | Scope dışı |
| **Board approval gates** | Scope dışı |
| **`requireBoardApprovalForNewAgents`** | Scope dışı |

---

## 3. Paperclip Buglarını Nasıl Çözüyoruz

### Bug #1245 — Stale Lock
**Paperclip problemi:** `executionRunId` başarısız run'dan sonra temizlenmiyor. Issue sonsuza kadar `in_progress` kalıyor, başka agent checkout yapamıyor.

**Forge çözümü:** BullMQ job lifecycle. Job failed/completed olduğunda worker otomatik issue status'unu `failed` yapar. Manual lock management yok, stale state imkânsız.

---

### Bug #1241 — Thundering Herd
**Paperclip problemi:** Custom `setInterval` polling + cooldown mekanizması yok. Birden fazla agent aynı cron tick'te uyanıyor, sistem bunalıyor.

**Forge çözümü:** BullMQ repeatable jobs. Redis sorted set ile yönetilir. Aynı `jobId` için tek job. Worker down iken biriken tick'ler birleştirilir. Thundering herd yapısal olarak imkânsız.

---

### Bug #1243 — drizzle-orm missing
**Paperclip problemi:** `drizzle-orm` package dependency boşluğu, fresh install'da crash.

**Forge çözümü:** Drizzle kullanmıyoruz. Prisma ile devam ediyoruz (v2'de kanıtlanmış, dependency sağlam).

---

### Bug #1256 — 403 Flood
**Paperclip problemi:** Checkout expire → agent 403 alıyor → retry → sonsuz döngü.

**Forge çözümü:** BullMQ `attempts: 3` + exponential backoff (`2s, 4s, 8s`). 3 denemeden sonra job `failed` state'e giriyor, döngü durur.

---

## 4. Mimari Farklar

| Konu | Paperclip | Forge |
|------|-----------|-------|
| Dil | TypeScript, Express | TypeScript, Fastify |
| ORM | Drizzle | Prisma |
| Job queue | Custom setInterval + DB polling | BullMQ (Redis) |
| Agent execution | Adapter sistemi (8 adapter tipi) | Runner factory (claude-cli, openrouter, anthropic-api) |
| Agent tanımı | DB'de config + adapterConfig JSON | DB + Markdown dosyaları (gray-matter YAML frontmatter) |
| Kurulum | `~/.paperclip/` + embedded PG | `~/.forge/` + kullanıcının PG |
| Auth | better-auth (session, OAuth) | Yok (local/trusted mode) |
| UI | React + Vite board | Yok (CLI-first, ileride eklenebilir) |
| Plugin sistemi | Tam plugin SDK | Yok |
| Tablo sayısı | 38 | 15 |
| Servis dosyası | 71+ | ~20 |
| Agent rolleri | `ceo, cto, cmo, cfo, engineer, designer, pm, qa, devops, researcher, general` | `ceo, pm, architect, engineer, reviewer, debugger, devops, designer, scrum-master` |

---

## 5. Agent İsimlendirme Farkı

Paperclip generic iş dünyası rolleri kullanır (`ceo, cto, cfo, researcher, general`).
Forge **yazılım ajansı** rolleri kullanır — her agent'ın yazılım geliştirme sürecindeki somut bir görevi var:

| Forge Agent | Yazılım Sürecindeki Yeri |
|-------------|------------------------|
| CEO | Müşteri ile tek temas noktası, brief yazar, yönlendirir |
| Project Manager | Sprint planlar, görevi parçalar, orchestrate eder |
| Architect | SOLID/DRY/YAGNI uygular, implementasyon planı yazar |
| Engineer | Kodu yazar, test yazar |
| Reviewer | Code review, kalite kapısı |
| Debugger | Root cause analizi, hotfix |
| DevOps | Git workflow, commit, release |
| Designer | UI spec, UX akışı, copy |
| Scrum-Master | Retrospektif, hafıza, süreç iyileştirme |

---

## 6. Özet

Forge = Paperclip'in **iyi fikirleri** + **temiz implementasyon** + **yazılım ajansı DNA'sı**.

Paperclip genel amaçlı bir "AI şirketi" platform. Forge özelleşmiş bir **yazılım geliştirme ajansı** — her agent'ın rolü, pipeline'ı, kalite kapısı ve hafıza sistemi yazılım geliştirme sürecine özel tasarlanmış.
