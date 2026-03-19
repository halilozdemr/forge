# Forge v3 — Teknik Analiz

## 1. Mimari Genel Bakış

```
┌─────────────────────────────────────────────────────────┐
│                     CLI (commander)                      │
│  init | start | stop | status | agent | issue | budget  │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐     ┌────────────────────┐
│      Fastify HTTP Server     │     │   BullMQ Worker     │
│  :3131                       │     │   concurrency: 3    │
│                              │     │                     │
│  /health                     │     │  agent-tasks queue  │
│  /v1/chat/completions        │◄───►│                     │
│  /v1/agents, /v1/issues      │     │  Budget Gate        │
│  /api/review, /api/architect │     │  Cost Tracker       │
│  /v1/budget                  │     │  Job Mirror (PG)    │
└──────────────┬───────────────┘     └──────┬─────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────────────┐     ┌────────────────────┐
│     PostgreSQL (Prisma)      │     │   Runner Factory    │
│     15 tablo                 │     │                     │
│                              │     │  ┌──────────────┐  │
│  companies, agents, issues   │     │  │ Claude CLI    │  │
│  sprints, cost_events        │     │  │ spawn + JSON  │  │
│  budget_policies, queue_jobs │     │  ├──────────────┤  │
│  heartbeat_runs, skills      │     │  │ OpenRouter    │  │
│  activity_logs, config       │     │  │ HTTP API      │  │
│  memory_entries              │     │  ├──────────────┤  │
└──────────────────────────────┘     │  │ Anthropic API │  │
                                     │  │ HTTP API      │  │
┌──────────────────────────────┐     │  └──────────────┘  │
│     Redis (BullMQ backend)   │     └────────────────────┘
│     job queue, repeatable    │
│     jobs (heartbeat)         │
└──────────────────────────────┘
```

---

## 2. Execution Engine — Agent Nasıl Çalıştırılır

### 2.1 Claude CLI Runner (Birincil Mekanizma)

v1'in kanıtlanmış bridge yaklaşımı. Claude CLI'ı child process olarak spawn eder:

```
spawn(claudePath, [
  "-p",                          // prompt mode (stdin'den oku)
  "--output-format", "json",     // JSON envelope döndür
  "--model", "sonnet",           // model seçimi
  "--system-prompt", "...",      // agent'ın system prompt'u
  "--allowedTools", "Read,Grep,Glob"  // agent izinlerine göre
])

stdin  → prompt yazılır
stdout → JSON envelope: { result: "...", input_tokens: N, output_tokens: N }
```

**JSON envelope parse:**
```
stdout → JSON.parse → envelope.result (string) → agent çıktısı
```

**Timeout:** Bridge işlemleri 2 dk, tam agent görevleri 5 dk, chat completions 15 dk.

**İzin kontrolü (allowedTools):**
| Agent permission | CLI --allowedTools |
|------------------|--------------------|
| read: true       | Read, Grep, Glob   |
| edit: true       | Edit               |
| write: true      | Write              |
| bash: true       | Bash               |

Her agent en az `Read, Grep, Glob` alır (kodu anlayabilmesi için).

### 2.2 OpenRouter Runner

HTTP POST ile OpenRouter API'ye istek atar:

```
POST https://openrouter.ai/api/v1/chat/completions
Headers: Authorization: Bearer $OPENROUTER_API_KEY
Body: { model: "moonshotai/kimi-k2.5", messages: [...] }
```

Response'dan `choices[0].message.content` ve `usage.prompt_tokens / completion_tokens` parse edilir.

### 2.3 Anthropic API Runner

Doğrudan Anthropic Messages API:

```
POST https://api.anthropic.com/v1/messages
Headers: x-api-key: $ANTHROPIC_API_KEY, anthropic-version: 2023-06-01
Body: { model: "claude-sonnet-4-20250514", system: "...", messages: [...] }
```

### 2.4 Runner Factory

Agent'ın `modelProvider` field'ına göre doğru runner seçilir:

```
modelProvider: "claude-cli"    → ClaudeCliRunner
modelProvider: "openrouter"    → OpenRouterRunner
modelProvider: "anthropic-api" → AnthropicApiRunner
```

---

## 3. Job Queue — BullMQ İş Akışı

### 3.1 Neden BullMQ

| Problem | Önceki Çözüm | BullMQ Çözümü |
|---------|--------------|---------------|
| Max 1 concurrent CLI (v1) | Manual acquireSlot/releaseSlot | Worker concurrency: 3 (ayarlanabilir) |
| Stale lock (Paperclip #1245) | Manual lock temizleme | Job lifecycle otomatik, stall detection dahili |
| Thundering herd (Paperclip #1241) | setInterval polling | Repeatable jobs — sorted set, tam olarak bir kez ateşler |
| 403 flood (Paperclip #1256) | Sonsuz retry | Exponential backoff, max 3 attempt |

### 3.2 Job Yaşam Döngüsü

```
1. İstek gelir (CLI veya HTTP)
     ↓
2. Queue'ya job eklenir
   queue.add("agent:architect", jobData, { attempts: 3, backoff: { type: "exponential", delay: 2000 } })
     ↓
3. Worker job'ı alır
     ↓
4. BudgetGate.check(companyId, agentSlug)
   → Hard limit aşıldı? → Job REJECT, agent → paused
   → Soft limit aşıldı? → Warning log, devam
   → OK? → Devam
     ↓
5. Issue status → "in_progress"
     ↓
6. QueueJob mirror → PostgreSQL'e job kaydı (SQL query için)
     ↓
7. Runner.run(config) → Claude CLI spawn / API call
     ↓
8. CostEvent → token kullanım ve maliyet kaydı
     ↓
9. Issue status → "done" | "failed"
     ↓
10. nextAction var mı? → Sonraki agent'ı queue'ya ekle (pipeline zinciri)
```

### 3.3 Job Data Yapısı

```typescript
{
  companyId: string       // hangi şirket
  agentSlug: string       // hangi agent çalışacak
  agentModel: string      // model adı (sonnet, kimi-k2.5, ...)
  modelProvider: string   // runner seçimi (claude-cli, openrouter, anthropic-api)
  systemPrompt: string    // agent'ın prompt'u
  input: string           // görev içeriği
  permissions: {}         // allowedTools için
  projectPath: string     // CLI cwd'si
  issueId?: string        // ilişkili issue
  timeoutMs?: number      // timeout override
  nextAction?: {          // pipeline zincirindeki sonraki adım
    agentSlug: string
    input: string
  }
}
```

### 3.4 Retry Stratejisi

- **Max attempts:** 3
- **Backoff:** Exponential — 2s, 4s, 8s
- **Stall detection:** BullMQ dahili (30s heartbeat, worker cevap vermezse stalled)
- **Failed job:** 3 denemeden sonra failed, `queue_jobs` tablosuna hata kaydedilir

---

## 4. Database Şeması (PostgreSQL, 15 Tablo)

### 4.1 Tablo İlişkileri

```
Company (1) ──→ (*) Agent
Company (1) ──→ (*) Project
Company (1) ──→ (*) BudgetPolicy
Company (1) ──→ (*) CostEvent
Company (1) ──→ (*) ActivityLog
Company (1) ──→ (*) Skill
Company (1) ──→ (*) MemoryEntry
Company (1) ──→ (*) ConfigEntry
Company (1) ──→ (*) QueueJob
Company (1) ──→ (*) HeartbeatRun

Project (1) ──→ (*) Sprint
Project (1) ──→ (*) Issue

Sprint  (1) ──→ (*) Issue
Agent   (1) ──→ (*) Issue (assigned)
Agent   (1) ──→ (*) CostEvent
Agent   (1) ──→ (*) AgentApiKey

Issue   (1) ──→ (*) Issue (sub-issues, self-referencing)
Issue   (1) ──→ (*) SkillExecution
Issue   (1) ──→ (*) QueueJob

Skill   (1) ──→ (*) SkillExecution
```

### 4.2 Tablo Detayları

**companies** — Şirket izolasyonu. Tüm veri company-scoped.
- `slug` (unique) — URL-safe tanımlayıcı

**agents** — Agent tanımları.
- `companyId + slug` (unique) — her şirkette bir "architect" olabilir
- `modelProvider` — runner seçimi
- `reportsTo` — üst agent slug (hiyerarşi)
- `status` — state machine: pending_approval → idle ↔ active ↔ paused → terminated
- `heartbeatCron` — periyodik çalışma cron ifadesi (null = heartbeat yok)
- `permissions` (JSON) — { task: true, bash: true, read: true, ... }
- `promptFile` — custom .md dosya yolu (null = built-in default)

**agent_api_keys** — Agent authentication.
- `keyHash` (SHA-256) — düz metin key saklanmaz
- `prefix` — ilk 8 karakter: "firm_abc..." (log'larda tanınabilirlik için)

**issues** — Görevler (v2'deki Tasks yerine, daha git-like).
- `type` — feature | bug | refactor | release | chore
- `status` — open → in_progress → review → done | failed | escalated
- `parentIssueId` — sub-task desteği (self-referencing)
- `metadata` (JSON) — { iteration: 2, architectPlan: "...", rejectionReasons: [...] }

**sprints** — Sprint yönetimi.
- `projectId + number` (unique)
- `status` — planning → active → completed | cancelled

**cost_events** — Maliyet takibi. Her agent çalışması sonrası bir kayıt.
- `costUsd` (Decimal 10,6) — 6 ondalık hassasiyet
- Index: `[companyId, createdAt]` — aylık toplam sorguları için

**budget_policies** — Bütçe limitleri.
- `scope` — "company" (tüm şirket) veya "agent" (tek agent)
- `scopeId` — scope=agent ise agent slug
- `softLimitPct` — %80'de uyar
- `hardLimitPct` — %100'de durdur
- `action` — warn | pause | block

**queue_jobs** — BullMQ job mirror'ı (SQL ile sorgulanabilirlik).
- `bullmqJobId` (unique) — BullMQ ile eşleştirme
- BullMQ'nun Redis-only state'ini PG'de de tutar

**heartbeat_runs** — Heartbeat çalışma geçmişi.
- `status` — triggered → completed | failed | skipped

**config_entries** — Key-value konfigürasyon.
- `companyId` null = global config

---

## 5. Agent Lifecycle State Machine

```
                    ┌─────────────────┐
                    │ pending_approval │
                    └────────┬────────┘
                             │
                    approve  │  terminate
                    ┌────────┴────────┐
                    ▼                 ▼
               ┌────────┐      ┌────────────┐
          ┌───►│  idle  │      │ terminated │ (terminal)
          │    └───┬────┘      └────────────┘
          │        │                 ▲
   done/  │ assign │  terminate     │
   pause  │        │                │
   resume │        ▼                │
          │    ┌────────┐           │
          └────│ active │───────────┘
               └───┬────┘
                   │
             pause │
                   ▼
               ┌────────┐
               │ paused │──────── resume → idle
               └────────┘──────── terminate → terminated
```

**Geçiş kuralları:**
- `pending_approval` → `idle`, `terminated`
- `idle` → `active`, `paused`, `terminated`
- `active` → `idle`, `paused`, `terminated`
- `paused` → `idle`, `terminated`
- `terminated` → (geri dönüş yok)

**Otomatik geçişler:**
- Job başladığında: idle → active
- Job bittiğinde: active → idle
- Budget hard limit: active → paused
- Agent fire: * → terminated

---

## 6. HTTP Server Route Tablosu

| Method | Path | Kaynak | İşlev |
|--------|------|--------|-------|
| GET | `/health` | Yeni | DB + Redis + Worker durum kontrolü |
| POST | `/v1/chat/completions` | v1 | OpenAI-compatible bridge (Claude CLI) |
| GET | `/v1/agents` | v2 | Company'deki tüm agent'ları listele |
| POST | `/v1/agents` | v2 | Yeni agent hire et |
| GET | `/v1/agents/:slug` | v2 | Agent detay + escalation chain |
| PUT | `/v1/agents/:slug` | v2 | Agent güncelle / status değiştir |
| DELETE | `/v1/agents/:slug` | v2 | Agent terminate et |
| GET | `/v1/agents/hierarchy` | Yeni | Hiyerarşi ağacı |
| GET | `/v1/issues` | Yeni | Issue listele (filter: project, status) |
| POST | `/v1/issues` | Yeni | Issue oluştur |
| GET | `/v1/issues/:id` | Yeni | Issue detay (sub-issues, sprint, agent) |
| PUT | `/v1/issues/:id` | Yeni | Issue güncelle |
| GET | `/v1/sprints` | v2 | Sprint listele |
| POST | `/v1/sprints` | v2 | Sprint oluştur |
| GET | `/v1/sprints/:id` | v2 | Sprint detay + issues |
| PUT | `/v1/sprints/:id` | v2 | Sprint güncelle |
| GET | `/v1/queue/status/:jobId` | v2 | BullMQ job durumu |
| GET | `/v1/queue/result/:jobId` | v2 | BullMQ job sonucu |
| POST | `/api/review` | v1 | Bridge: code review (Claude CLI) |
| POST | `/api/architect` | v1 | Bridge: architecture review |
| POST | `/api/debug` | v1 | Bridge: root cause analysis |
| GET | `/v1/budget/policies` | Yeni | Budget policy listele |
| POST | `/v1/budget/policies` | Yeni | Budget policy oluştur/güncelle |
| GET | `/v1/budget/usage` | Yeni | Aylık kullanım raporu |

---

## 7. Budget Enforcement Akışı

```
Job geldi
  ↓
BudgetGate.check(companyId, agentSlug)
  ↓
Policy lookup:
  1. Agent-level policy var mı? (scope=agent, scopeId=agentSlug)
  2. Yoksa company-level policy var mı? (scope=company, scopeId=null)
  3. Hiç policy yoksa → unlimited, devam et
  ↓
Bu ayki toplam maliyet hesapla:
  SELECT SUM(costUsd) FROM cost_events
  WHERE companyId = X AND createdAt >= ayın ilk günü
  [AND agentId = Y, eğer agent-level policy ise]
  ↓
percentUsed = (currentUsage / monthlyLimit) * 100
  ↓
≥ hardLimitPct (100%) → BLOCKED
  - Job reject edilir
  - Agent status → paused
  - ActivityLog: "budget.exceeded"
  ↓
≥ softLimitPct (80%) → WARNING
  - Log: "budget.warning"
  - Job devam eder
  ↓
< softLimitPct → OK
  - Job devam eder
```

### Maliyet hesaplama

```
Claude CLI (subscription) → $0.00 (flat rate)
OpenRouter → (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000
Anthropic API:
  - Opus:   input $15/M, output $75/M
  - Sonnet: input $3/M,  output $15/M
  - Haiku:  input $0.25/M, output $1.25/M
```

---

## 8. Heartbeat Scheduler

### Mekanizma

BullMQ repeatable jobs kullanır:

```
queue.add("heartbeat:companyId:agentSlug", data, {
  repeat: { pattern: "0 */6 * * *" },    // cron ifadesi
  jobId: "heartbeat:companyId:agentSlug"  // deduplication key
})
```

**BullMQ repeatable job garantileri:**
- Sorted set ile yönetilir — aynı cron tick'te sadece 1 kez ateşlenir
- Worker down iken biriken cron tick'ler birleştirilir (thundering herd yok)
- jobId ile deduplication — aynı agent için çift job oluşmaz

### Agent başına heartbeat davranışı

| Agent | Heartbeat Aksiyonu |
|-------|--------------------|
| scrum-master | Tamamlanan sprint var mı? → Retrospektif başlat |
| ceo | 24 saatten eski open issue var mı? → Uyarı log'u |
| pm | Backlog'da yüksek öncelikli bekleyen var mı? → Bildirim |

### Heartbeat run kaydı

Her tetiklemede `heartbeat_runs` tablosuna kayıt düşer:
- `status: triggered` → çalışma başladı
- `status: completed` → başarıyla bitti
- `status: failed` → hata oluştu
- `status: skipped` → yapacak iş yoktu

---

## 9. Orchestrator — Pipeline Dispatch

### 9.1 Pipeline Tanımları

**Feature Pipeline:**
```
CEO → PM → DevOps(branch) → Architect → Engineer → Reviewer → DevOps(commit)
  [eğer tüm görevler bittiyse] → Scrum-Master(retrospektif)
```

**Bug Fix Pipeline:**
```
CEO → Debugger → Engineer(fix) → Reviewer → DevOps(hotfix merge)
```

**Refactor Pipeline:**
```
CEO → Architect → Engineer → Reviewer → DevOps(commit)
```

**Release Pipeline:**
```
CEO → DevOps(version bump, merge, tag, build)
```

### 9.2 Pipeline zincirlemesi

Her job'ın `nextAction` field'ı bir sonraki adımı belirler:

```
Job A (architect) tamamlandı
  → result'tan plan çıkarıldı
  → nextAction: { agentSlug: "engineer", input: "Implement this plan: ..." }
  → Queue'ya yeni job eklendi
  → Worker job B'yi (engineer) aldı
  → ...devam eder
```

### 9.3 Escalation mekanizması

```
Engineer 1. deneme → Reviewer REJECTED
Engineer 2. deneme → Reviewer REJECTED
Engineer 3. deneme → Reviewer REJECTED
  → Reviewer escalation tetikler
  → Issue metadata.iteration = 3
  → nextAction: { agentSlug: "architect", input: "Escalation: 3 kez reject..." }
  → Architect yeniden tasarlar
  → Engineer'a yeni plan ile gönderir (iteration sıfırlanır)
```

---

## 10. Skill Engine

### Konsept
Skill = tekrar kullanılabilir, versiyonlanmış prompt/template.

Örnek: "auth_flow" skill'i → authentication implementasyonu için Engineer'a verilen detaylı talimatlar.

### Akış

```
1. Görev geldi
2. SkillEngine.selectSkill(task, availableSkills)
   → Success rate'e göre en iyi skill seç
   → Hiç skill yoksa → null (agent kendi prompt'uyla çalışır)
3. Skill varsa → agent prompt'una ek context olarak enjekte et
4. Görev bitti
5. SkillEngine.recordExecution(skillId, issueId, result)
   → success/failed/timeout kaydet
6. Periyodik: SkillEngine.analyzeFailures(skillId)
   → %30+ failure rate → iyileştirme önerisi
   → Skill content güncelle, version++
```

---

## 11. Agent Prompt Yükleme Sırası

Bir agent çalıştırılacağında prompt şu sırayla çözülür:

```
1. Agent'ın promptFile field'ı set mi?
   → Evet: o dosyayı oku (custom override)
   → Hayır: devam et

2. src/agents/defaults/{slug}.md dosyası var mı?
   → Evet: built-in prompt'u kullan
   → Hayır: generic fallback "You are the {name} at Forge."

3. Proje context'i enjekte et:
   → .firm/context/project.md içeriği
   → .firm/context/standards.md (architect, engineer, reviewer için)
   → .firm/context/conventions.md (engineer, reviewer için)
```

Agent markdown dosya formatı (gray-matter):
```yaml
---
id: architect
name: Lead Architect
description: "Technical decisions, architecture design"
model: bridge/claude-cli-sonnet       # provider/model
mode: subagent
temperature: 0.2
reportsTo: pm
heartbeatCron: null
permission:
  task: allow
  bash: allow
  read: allow
  edit: deny
---

[prompt content — markdown formatında agent talimatları]
```

Model string parse kuralı:
- `bridge/claude-cli-sonnet` → provider: `claude-cli`, model: `sonnet`
- `openrouter/moonshotai/kimi-k2.5` → provider: `openrouter`, model: `moonshotai/kimi-k2.5`
- `anthropic/claude-sonnet-4-20250514` → provider: `anthropic-api`, model: `claude-sonnet-4-20250514`

---

## 12. Dosya Taşıma Haritası (v1/v2 → v3)

| Kaynak | Hedef | İşlem |
|--------|-------|-------|
| `web/server.ts` — buildReviewerPrompt (91-134) | `src/server/routes/bridge.ts` | Taşı |
| `web/server.ts` — buildArchitectPrompt (136-168) | `src/server/routes/bridge.ts` | Taşı |
| `web/server.ts` — buildDebuggerPrompt (170-193) | `src/server/routes/bridge.ts` | Taşı |
| `web/server.ts` — runAgentViaCli (607-684) | `src/bridge/runners/claude-cli.ts` | Yeniden yaz |
| `web/server.ts` — /v1/chat/completions (698-755) | `src/server/routes/completions.ts` | Taşı |
| `web/server.ts` — collectStream (80-88) | `src/utils/stream.ts` | Taşı |
| `web/server.ts` — acquireSlot/releaseSlot (61-78) | **Kaldır** — BullMQ concurrency ile değiştirildi | — |
| `v2/packages/agent-core/src/orchestrator.ts` | `src/orchestrator/index.ts` | Adapte et |
| `v2/packages/agent-core/src/skill-engine.ts` | `src/orchestrator/skill-engine.ts` | Taşı |
| `v2/apps/bridge/src/runners/openrouter-runner.ts` | `src/bridge/runners/openrouter.ts` | Taşı |
| `v2/apps/bridge/src/runners/claude-cli-runner.ts` | `src/bridge/runners/claude-cli.ts` | Birleştir (v1 + v2) |
| `v2/apps/bridge/src/worker.ts` | `src/bridge/worker.ts` | Adapte et (budget gate ekle) |
| `v2/packages/db/prisma/schema.prisma` | `prisma/schema.prisma` | Genişlet (11 → 15 tablo) |
| `~/.config/opencode/agents/*.md` | `src/agents/defaults/*.md` | Taşı, frontmatter güncelle |

---

## 13. Bağımlılıklar ve Gerekçeleri

| Paket | Neden |
|-------|-------|
| `fastify` | v2'de kanıtlanmış, Express'ten hızlı, schema validation dahili |
| `@fastify/cors` | Cross-origin (dashboard, OpenCode entegrasyonu) |
| `bullmq` | Redis-backed job queue — stale lock yok, repeatable jobs, retry dahili |
| `ioredis` | BullMQ'nun Redis client'ı |
| `@prisma/client` | Type-safe ORM, v2'de kanıtlanmış, migration dahili |
| `commander` | CLI framework — subcommand desteği, help generation |
| `@clack/prompts` | Interactive terminal UI (init wizard) |
| `gray-matter` | YAML frontmatter parser (agent .md dosyaları) |
| `pino` | Structured JSON logging, hızlı |
| `handlebars` | Template engine (README.md, scaffold dosyaları) |

---

## 14. Uygulama Sırası (Build Order)

### Faz 1 — Çekirdek
1. `v3/` dizini, `package.json`, `tsconfig.json`
2. Prisma schema (15 tablo) + migration
3. CLI skeleton: `commander` + `@clack/prompts`
4. `forge init` komutu + scaffold templates
5. `forge start/stop` (Fastify + basic health)

### Faz 2 — Bridge
6. `ClaudeCliRunner` (v1'den spawn mekanizması)
7. `OpenRouterRunner` (v2'den HTTP client)
8. BullMQ queue + worker setup
9. `/v1/chat/completions` endpoint
10. `/api/review`, `/api/architect`, `/api/debug` endpoints

### Faz 3 — Agent System
11. Agent markdown loader (gray-matter)
12. 9 default agent .md dosyası
13. Agent lifecycle state machine
14. Agent hiyerarşisi (reportsTo, escalation chain)
15. CRUD routes: `/v1/agents`

### Faz 4 — Orchestration
16. FirmOrchestrator (pipeline dispatch)
17. 4 pipeline: feature, bugfix, refactor, release
18. SkillEngine
19. Issue ve Sprint CRUD routes

### Faz 5 — Budget & Heartbeat
20. BudgetGate + CostEvent tracking
21. Token cost estimator
22. Budget CLI komutları
23. Heartbeat scheduler (BullMQ repeatable)
24. Heartbeat CLI komutları

### Faz 6 — Polish
25. `forge status` tam implementasyon
26. Activity logging
27. Error handling + graceful shutdown
28. Test coverage

---

## 15. Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `DATABASE_URL` | — | PostgreSQL bağlantı string'i |
| `REDIS_URL` | `redis://localhost:6379` | Redis bağlantı string'i |
| `FIRM_PORT` | `3131` | HTTP server port |
| `FIRM_HOST` | `0.0.0.0` | HTTP server host |
| `FIRM_CONCURRENCY` | `3` | BullMQ worker concurrency |
| `CLAUDE_PATH` | auto-detect | Claude CLI binary path |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (ucuz model'ler için) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (opsiyonel direct API) |
| `LOG_LEVEL` | `info` | pino log level |
