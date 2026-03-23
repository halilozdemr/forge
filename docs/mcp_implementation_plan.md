# Forge v3 + Claude Code Integration

Forge v3'ü Claude Code ile entegre etmek için 5 ana değişiklik: (1) HTTP adapter doğrulama, (2) forge-mcp MCP server, (3) Claude Code konfigürasyonu, (4) OpenCode agent'larını Forge DB'ye taşıma, (5) CLAUDE.md yazma.

## User Review Required

> [!IMPORTANT]
> **forge-mcp**, Claude Code'un Forge REST API'sine native MCP tool olarak erişmesini sağlayacak. Bu, [web/server.ts](file:///Users/halilozdemir/Desktop/claude-cli-bridge/web/server.ts) bridge'in yerini alır. Mevcut [.claude/settings.local.json](file:///Users/halilozdemir/Desktop/claude-cli-bridge/.claude/settings.local.json)'daki diğer izinler korunacak.

> [!IMPORTANT]
> **Receptionist kararı**: Claude Code'un kendisi = Receptionist. CLAUDE.md'de receptionist logic tanımlanır. Seed script'e receptionist eklenmez — 8 agent taşınır (pm, architect, builder, reviewer, debugger, designer, devops, scrum_master).

> [!IMPORTANT]
> **companyId çözümü**: MCP server başlarken `GET /v1/companies` ile ilk company'yi otomatik alır ve tüm tool çağrılarında default olarak kullanır. Kullanıcının companyId bilmesi gerekmez.

> [!IMPORTANT]
> **Agent provider mapping**: Model/provider değerleri init sırasında
> kullanıcı tarafından dinamik olarak ayarlanır. Tablodaki değerler
> (openrouter/kimi-k2.5, claude-cli/sonnet vb.) yalnızca init wizard'ının
> göstereceği default önerilerdir — hardcode değil.

---

## Proposed Changes

### 1. HTTP Adapter / OpenRouter Runner Doğrulama

Mevcut [openrouter.ts](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/bridge/runners/openrouter.ts) runner zaten OpenRouter API'yi doğrudan çağırıyor — OpenCode bridge'e gerek kalmadan. Bu runner PM/Builder gibi OpenRouter agent'ları için yeterli.

[claude-cli.ts](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/bridge/runners/claude-cli.ts) runner ise Architect/Reviewer gibi lokal Claude CLI kullanan agent'lar için zaten mevcut.

**Sonuç:** Yeni bir "http adapter" yazmaya gerek yok. Mevcut `openrouter` ve `claude-cli` runner'ları zaten istenen mimariyi karşılıyor.

#### [MODIFY] [factory.ts](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/bridge/runners/factory.ts)
- Değişiklik yok — mevcut runner'lar (openrouter, claude-cli, http) zaten kayıtlı.

---

### 2. forge-mcp Server

Claude Code'un Forge REST API'sini MCP tool olarak kullanmasını sağlayan yeni bir MCP server.

#### [NEW] [index.ts](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/mcp/index.ts)

MCP server ana dosyası. `@modelcontextprotocol/sdk` kullanarak:

**Tools:**

| MCP Tool | HTTP Endpoint | Açıklama |
|----------|---------------|----------|
| `forge_list_agents` | `GET /v1/agents` | Agent'ları listele |
| `forge_get_agent` | `GET /v1/agents/:slug` | Agent detayı |
| `forge_hire_agent` | `POST /v1/agents` | Yeni agent oluştur |
| `forge_update_agent` | `PUT /v1/agents/:slug` | Agent güncelle |
| `forge_fire_agent` | `DELETE /v1/agents/:slug` | Agent sil |
| `forge_list_issues` | `GET /v1/issues` | Issue listesi |
| `forge_get_issue` | `GET /v1/issues/:id` | Issue detayı |
| `forge_create_issue` | `POST /v1/issues` | Yeni issue |
| `forge_update_issue` | `PUT /v1/issues/:id` | Issue güncelle |
| `forge_run_issue` | `POST /v1/issues/:id/run` | Issue'yu agent'a ata ve çalıştır |
| `forge_list_sprints` | `GET /v1/sprints` | Sprint listesi |
| `forge_create_sprint` | `POST /v1/sprints` | Yeni sprint |
| `forge_get_status` | `GET /v1/status` | Sistem durumu |
| `forge_get_budget` | `GET /v1/budget` | Bütçe durumu |
| `forge_list_queue` | `GET /v1/queue` | Kuyruk durumu |
| `forge_get_job` | `GET /v1/queue/:id` | Tek job durumu (polling) |

Her tool Forge REST API'ye `fetch()` ile HTTP çağrısı yapar. Base URL: `http://localhost:3131`.

**Async job handling:** `forge_run_issue` anında `jobId` döner. Claude Code `forge_get_job` ile polling yaparak job'ın tamamlanmasını takip eder. CLAUDE.md'deki Receptionist logic Claude Code'a "run sonrası job status kontrol et" talimatını verir.

#### [NEW] [forge-mcp.ts](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/bin/forge-mcp.ts)

MCP server'ı stdio transport ile başlatan entry point:
```typescript
#!/usr/bin/env node
import { startMcpServer } from "../src/mcp/index.js";
startMcpServer();
```

#### [MODIFY] [package.json](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/package.json)

- `@modelcontextprotocol/sdk` dependency eklenir
- `bin.forge-mcp` eklenir (`./dist/bin/forge-mcp.js`)
- `scripts.mcp` eklenir (`tsx bin/forge-mcp.ts`)

---

### 3. Claude Code Konfigürasyonu

#### [MODIFY] [settings.local.json](file:///Users/halilozdemir/Desktop/claude-cli-bridge/.claude/settings.local.json)

```json
{
  "mcpServers": {
    "forge": {
      "command": "npx",
      "args": ["tsx", "/Users/halilozdemir/Desktop/claude-cli-bridge/v3/bin/forge-mcp.ts"]
    }
  }
}
```

Mevcut `permissions` korunur, sadece `mcpServers` eklenir.

---

### 4. Agent Migration

#### [NEW] [seed-agents.ts](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/scripts/seed-agents.ts)

8 OpenCode agent'ını Forge DB'ye taşıyan script. Her agent için:
- OpenCode frontmatter'ından [id](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/server/routes/bridge.ts#112-209), `name`, `model`, `mode`, `permission`, `temperature` parse edilir
- Forge [Agent](file:///Users/halilozdemir/Desktop/claude-cli-bridge/v3/src/bridge/runners/types.ts#27-30) tablosuna insert edilir
- `systemPrompt` → agent'ın markdown body'si → `promptFile` olarak dosya yolu veya inline saklanır

Script, model/provider değerlerini hardcode etmez. Bu değerleri `~/.forge/config.json` veya init wizard çıktısından okur. Dosya yoksa script hata verir ve kullanıcıyı `forge init` çalıştırmaya yönlendirir.

Agent mapping tablosu:

| OpenCode Agent | Forge slug | modelProvider | model | role |
|---------------|------------|---------------|-------|------|
| pm | pm | openrouter | deepseek/deepseek-v3.2 | pm |
| architect | architect | claude-cli | sonnet | architect |
| builder | builder | openrouter | moonshotai/kimi-k2.5 | engineer |
| reviewer | reviewer | claude-cli | sonnet | qa |
| debugger | debugger | claude-cli | sonnet | engineer |
| designer | designer | openrouter | moonshotai/kimi-k2.5 | designer |
| devops | devops | openrouter | moonshotai/kimi-k2.5 | devops |
| scrum_master | scrum_master | openrouter | moonshotai/kimi-k2.5 | pm |

**Not:** Receptionist taşınmıyor — Claude Code'un kendisi receptionist rolünü üstleniyor (CLAUDE.md ile).

---

### 5. CLAUDE.md

#### [NEW] [CLAUDE.md](file:///Users/halilozdemir/Desktop/claude-cli-bridge/CLAUDE.md)

Claude Code'un otomatik okuduğu proje context dosyası:

- Forge v3 sistemi açıklaması
- Receptionist logic (ilk karşılama, brief, handoff kuralları)
- MCP tool kullanım rehberi
- Agent pipeline açıklaması
- Model konfigürasyonu tablosu
- Dizin yapısı referansı

---

## Verification Plan

### Automated Tests

1. **TypeScript compilation:**
```bash
cd /Users/halilozdemir/Desktop/claude-cli-bridge/v3 && npx tsc --noEmit
```

2. **MCP server starts and lists tools:**
```bash
cd /Users/halilozdemir/Desktop/claude-cli-bridge/v3 && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | npx tsx bin/forge-mcp.ts
```
Beklenen: Tool listesi döner (15 tool).

### Manual Verification

1. **Forge server başlat** (`npm run dev`), sonra MCP server'ı Claude Code içinden çağır:
   - Claude Code'da `forge_list_agents` tool'unu çalıştır
   - `forge_get_status` tool'unu çalıştır
   - Sonuçların Forge REST API ile tutarlı olduğunu doğrula

2. **Agent seed script çalıştır:**
```bash
cd /Users/halilozdemir/Desktop/claude-cli-bridge/v3 && npx tsx scripts/seed-agents.ts
```
   - Forge API'den agent listesini kontrol et: `curl http://localhost:3131/v1/agents?companyId=<id>`
   - 9 agent'ın doğru model/provider ile kayıtlı olduğunu doğrula
