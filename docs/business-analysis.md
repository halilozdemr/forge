# Forge v3 — Business Analizi

## 1. Ürün Tanımı

Forge, terminalden çalışan bir **AI agent orkestrasyon platformu**dur. Tek bir komutla (`npx forge init`) ayağa kalkar ve lokal makinedeki Claude CLI'ı orkestre ederek **9 yapay zeka ajanından oluşan sanal bir yazılım ajansı** simüle eder.

Her ajan bir yazılım ajansındaki gerçek bir rolü üstlenir: müşteri ilişkileri, proje yönetimi, mimari tasarım, kod yazma, code review, hata ayıklama, DevOps, UI/UX tasarım ve süreç iyileştirme. Bu ajanlar birbirleriyle konuşarak, görev devrederek ve birbirlerinin çıktılarını denetleyerek yazılım geliştirme sürecini uçtan uca yönetir.

---

## 2. Problem Tanımı

### Mevcut durum
- Bir yazılım projesinde geliştirici, AI asistanı tek bir "sohbet" olarak kullanıyor
- Kod yazma, review, debug, planlama hep aynı context'te, aynı kalitede yapılıyor
- AI'ın ürettiği kod denetlenmeden merge ediliyor
- Sprint planlaması, retrospektif, mimari karar takibi manuel yapılıyor
- Birden fazla AI modeli kullanmak (ucuz model + pahalı model) koordinasyon gerektiriyor

### Forge'ün çözdüğü sorunlar
1. **Kalite kontrolsüz AI çıktısı** → Reviewer ajanı hiçbir kodu denetimsiz geçirmez
2. **Tek model bağımlılığı** → Ucuz işler ucuz modele (Kimi K2.5), kritik işler pahalı modele (Claude Sonnet) gider
3. **Plansız geliştirme** → PM sprint planlar, Architect tasarım yapar, Engineer ancak ondan sonra kod yazar
4. **Bilgi kaybı** → Memory sistemi kararları, pattern'leri, sorunları dosyalarda saklar
5. **Bütçe kontrolsüzlüğü** → Budget sistemi aylık harcamayı takip eder, limit aşılınca durdurur

---

## 3. Nasıl Çalışır — Uçtan Uca Akış

### 3.1 Kullanıcı bir feature talep eder

```
Kullanıcı: "Uygulamaya dark mode ekle"
```

### 3.2 CEO (İlk Temas)

CEO kullanıcının talebini alır. Yeterli bilgi varsa hemen bir **brief** yazar:

```
# Client Brief
## Request: Dark mode desteği eklenmesi
## Goal: Kullanıcı tema tercihini değiştirebilmeli
## Scope: Tema altyapısı, toggle switch, persistence
## Out of scope: Otomatik sistem teması takibi
## Priority: medium
```

Kullanıcıya sorar: "Brief doğru mu?" → Onay gelince PM'e devreder.

**Kural:** CEO asla kod yazmaz, asla teknik karar almaz. Sadece talebi yapılandırır.

### 3.3 PM (Sprint Planlama)

PM brief'i alır, projenin mevcut durumunu okur (context dosyaları), görevi parçalara ayırır:

```json
{
  "sprint": 1,
  "goal": "Dark mode desteği",
  "tasks": [
    { "id": "T01", "title": "Tema altyapısı", "agent": "architect", "complexity": 3 },
    { "id": "T02", "title": "Toggle switch UI", "agent": "designer", "complexity": 2 },
    { "id": "T03", "title": "Tema persistence", "agent": "architect", "complexity": 2 }
  ]
}
```

DevOps'a branch açtırır: `feature/sprint-1-dark-mode`. İlk görevi Architect'e gönderir.

**Kural:** PM asla doğrudan Engineer'a iş vermez. Her implementasyon görevi önce Architect'ten geçer.

### 3.4 Architect (Teknik Tasarım)

Architect görevi alır, mevcut kodu inceler, mimari karar alır ve implementasyon planı yazar:

```
## Implementation Plan — T01
### Approach: Compose theme wrapper pattern
### Files to create/modify:
- theme/AppTheme.kt: dark/light ColorScheme tanımla
- theme/ThemeManager.kt: DataStore ile persistence
### Key decisions: Material3 dynamic color kullanılMAyacak (API 31+ gerektirir)
```

Kararı `decisions.md`'ye kaydeder. Planla birlikte Engineer'a gönderir.

**Kural:** Architect SOLID/DRY/YAGNI'ye uymayan hiçbir tasarımı onaylamaz.

### 3.5 Engineer (Kod Yazma)

Engineer **sadece** Architect'in planını uygular. Plan yoksa çalışmaz.

- Kodu yazar
- Unit test yazar (happy path + error path)
- Dosyaları `// PATH: relative/path` formatıyla işaretler
- Bitince Reviewer'a gönderir

**Kural:** Engineer'ın 3 deneme hakkı var. 3. denemede hâlâ geçemediyse Architect'e escalate olur.

### 3.6 Reviewer (Kalite Kapısı)

Reviewer kodu sıkı bir checklist'ten geçirir:

- Test var mı? → Yoksa: **REJECTED**
- SOLID uyumlu mu?
- Tekrar eden kod var mı?
- Hardcoded string var mı? → Varsa: **REJECTED**
- Emoji icon olarak kullanılmış mı? → Varsa: **REJECTED**
- Layer violation var mı?

Sonuç:
- **APPROVED** → DevOps'a commit görevi gider
- **REJECTED** → Engineer'a geri döner, rejection nedenleri ile

3 kez reject olursa → Architect'e **escalation** gider. Architect yeniden tasarlar.

### 3.7 DevOps (Git & Deploy)

Her approved görev için:
```bash
git add [specific files]
git commit -m "feat(theme): add dark mode support [T01]"
```

Sprint bitince:
```bash
git merge --no-ff feature/sprint-1-dark-mode → develop
```

### 3.8 Scrum-Master (Retrospektif)

Tüm görevler bitince Scrum-Master devreye girer:
- Sprint'i analiz eder (kaç görev bitti, kaç escalation oldu)
- Retrospektif yazar
- Öğrenilen pattern'leri `patterns.md`'ye ekler
- Sorunları `problems.md`'ye ekler
- Backlog'a aksiyon maddesi ekler
- Sprint branch'ini develop'a merge ettirir

---

## 4. Diğer Akışlar

### 4.1 Bug Fix Akışı

```
Kullanıcı: "Login ekranı crash ediyor"
  → CEO: Bug tespit etti, doğrudan Debugger'a yönlendirdi (PM yok, sprint yok)
  → Debugger: Root cause analizi yaptı, minimum fix uyguladı, test yazdı
  → Reviewer: Hotfix review (aynı kalite kapısı)
  → DevOps: Hotfix branch → main merge → patch version bump → tag
```

**Fark:** Bug'larda sprint açılmaz. Doğrudan fast-path işler.

### 4.2 Refactor Akışı

```
Kullanıcı: "Auth modülünü temizle"
  → CEO: Refactor tespit etti, doğrudan Architect'e yönlendirdi
  → Architect: SOLID/DRY analizi, refactor planı yazdı (risk: low/medium/high)
  → Engineer: Sadece iç yapıyı değiştirdi, public API'ye dokunmadı
  → Reviewer: Ekstra kontrol — davranış değişmedi mi? Scope dışı dosya var mı?
  → DevOps: Commit
```

**Fark:** Yeni özellik eklenmez. Public API değişmez. Mevcut testler geçmek zorundadır.

### 4.3 Release Akışı

```
Kullanıcı: "AAB ver" / "Release çıkar"
  → CEO: Doğrudan DevOps'a yönlendirdi
  → DevOps: Version bump → develop→main merge → tag → AAB build
```

---

## 5. Agent Kadrosu

| Agent | Rol | Ne Zaman Çalışır | Model |
|-------|-----|-------------------|-------|
| **CEO** | İlk temas, brief yazma, yönlendirme | Her kullanıcı talebi | Ucuz (Kimi K2.5) |
| **PM** | Sprint planlama, görev parçalama | Feature request onaylandığında | Ucuz (DeepSeek V3.2) |
| **Architect** | Teknik tasarım, SOLID denetimi, escalation | PM'den gelen görevler, refactor, escalation | Pahalı (Claude Sonnet) |
| **Engineer** | Kod yazma, test yazma | Architect planı hazır olduğunda | Ucuz (Kimi K2.5) |
| **Reviewer** | Code review, kalite kapısı | Engineer kodu teslim ettiğinde | Pahalı (Claude Sonnet) |
| **Debugger** | Bug tespiti, hotfix | Bug raporu geldiğinde | Pahalı (Claude Sonnet) |
| **DevOps** | Git, branch, commit, release | Görev onaylandığında, sprint başı/sonu | Ucuz (Kimi K2.5) |
| **Designer** | UI spec, UX akışı, copy | PM'den UI görevi geldiğinde | Ucuz (Kimi K2.5) |
| **Scrum-Master** | Retrospektif, süreç iyileştirme | Sprint bittiğinde, periyodik heartbeat | Ucuz (Kimi K2.5) |

### Maliyet stratejisi

Kritik kalite kararları (mimari, review, debug) pahalı modele gider — çünkü hata maliyeti yüksektir.
Rutin işler (brief yazma, planlama, kod yazma, git işlemleri) ucuz modele gider — çünkü çıktıları zaten denetleniyor.

---

## 6. Agent Hiyerarşisi

```
ceo (root — kullanıcıyla konuşan tek ajan)
├── pm
│   └── architect
│       ├── engineer
│       │   └── reviewer
│       └── designer
├── debugger
├── devops
└── scrum-master
```

- **reportsTo**: Her ajanın bir üst yöneticisi var. Sorun çözülemezse zincir yukarı tırmanır.
- **Escalation**: Engineer 3 kez reject yediyse → Architect. Architect çözemezse → PM'e bilgi.
- **CEO root'tur**: Kullanıcıyla sadece CEO konuşur.

---

## 7. Hafıza Sistemi

Forge projenin `.firm/` dizininde kalıcı hafıza tutar:

| Dosya | İçerik | Kim Yazar | Kim Okur |
|-------|--------|-----------|----------|
| `context/project.md` | Proje stack, mimari, mevcut durum | init wizard | CEO, PM, Architect |
| `context/conventions.md` | Kod konvansiyonları | Kullanıcı/Architect | Engineer, Reviewer |
| `context/standards.md` | SOLID/DRY/YAGNI kuralları | Sabit | Architect, Engineer, Reviewer |
| `memory/decisions.md` | Mimari kararlar ve gerekçeleri | Architect | Architect, PM |
| `memory/patterns.md` | Keşfedilen tekrar eden çözümler | Scrum-Master | Architect, Engineer |
| `memory/problems.md` | Karşılaşılan sorunlar ve çözümleri | Debugger, Scrum-Master | Debugger, Architect |
| `memory/retrospectives/` | Sprint retrospektifleri | Scrum-Master | PM (sonraki sprint planı için) |
| `sprints/active_sprint.json` | Aktif sprint planı ve görev durumları | PM | Herkes |
| `sprints/backlog.json` | Bekleyen görevler | PM, Scrum-Master | PM |

**Hafıza yaşam döngüsü:**
- `problems.md` 150 satırı geçince → eski kayıtlar arşivlenir
- Her sprint retrospektifi `retrospectives/sprint_N.md` olarak saklanır
- Retrospektif aksiyonları backlog'a eklenir
- Sonraki sprint planlamasında PM son retrospektifi okur

---

## 8. Budget (Bütçe) Yönetimi

Ajanların çalışması maliyet üretir (API çağrıları). Budget sistemi bunu kontrol eder:

### Soft limit (varsayılan %80)
- Uyarı loglanır ama çalışma devam eder
- "Bütçenin %80'i kullanıldı" bildirimi

### Hard limit (varsayılan %100)
- Agent çalışması **durdurulur**
- Agent durumu `paused` yapılır
- Job reject edilir

### Maliyet kaynakları
- **Claude CLI (subscription)**: $0 — flat rate abonelik, token başı ücret yok
- **OpenRouter API**: Token başı ücret (model bağımlı)
- **Anthropic API**: Token başı ücret (model bağımlı)

### Tracking
Her agent çalışması sonrası `cost_events` tablosuna kayıt düşer:
- Hangi agent, hangi model, kaç token, kaç USD, kaç ms sürdü

---

## 9. Heartbeat (Periyodik Çalışma)

Bazı ajanlar belirli aralıklarla uyanarak bekleyen iş var mı kontrol eder:

| Agent | Cron | Ne Yapar |
|-------|------|----------|
| Scrum-Master | `0 */6 * * *` (6 saatte bir) | Tamamlanan sprint var mı → retrospektif başlat |
| CEO | (opsiyonel) | Stale open issue var mı → uyarı |

Heartbeat, BullMQ repeatable jobs ile çalışır — aynı cron tick'te birden fazla tetikleme olmaz (thundering herd yok).

---

## 10. Proje Scaffold'u

`forge init` komutu çalıştığında hedef projede şu yapı oluşturulur:

```
<proje-root>/
├── .firm/
│   ├── config.json              # Company, project, agent konfigürasyonu
│   ├── context/
│   │   ├── project.md           # Proje stack, mimari (wizard'dan gelir)
│   │   ├── conventions.md       # Kod kuralları
│   │   └── standards.md         # SOLID/DRY/YAGNI
│   ├── memory/
│   │   ├── decisions.md         # Mimari kararlar
│   │   ├── patterns.md          # Öğrenilen pattern'ler
│   │   ├── problems.md          # Sorunlar ve çözümleri
│   │   └── retrospectives/      # Sprint retrospektifleri
│   ├── sprints/
│   │   ├── active_sprint.json   # Aktif sprint
│   │   └── backlog.json         # Bekleyen görevler
│   ├── skills/                  # Agent skill dosyaları
│   └── agents/                  # Custom agent override'lar (opsiyonel)
├── README.md                    # CEO bu dosyayı okur
└── .gitignore                   # .firm/config.json (secrets) hariç tutulur
```

---

## 11. CLI Komutları

| Komut | Ne Yapar |
|-------|----------|
| `forge init` | Interactive wizard — proje, company, agent'lar, DB kurulumu |
| `forge start` | Server + Worker + Heartbeat başlat |
| `forge stop` | Graceful shutdown |
| `forge status` | Sistem durumu raporu |
| `forge company create/list` | Şirket yönetimi |
| `forge agent hire/fire/list/inspect` | Agent yönetimi |
| `forge issue create/list/show` | Görev yönetimi |
| `forge heartbeat run/enable/disable/list` | Periyodik çalışma yönetimi |
| `forge budget set/show/report` | Bütçe yönetimi |
| `forge sprint list/show/active` | Sprint yönetimi |

---

## 12. v1 ve v2'den Gelen Kanıtlanmış Mekanizmalar

### v1'den (bridge)
- Claude CLI'ı `spawn()` ile çağırma ve JSON envelope parse etme
- OpenAI-compatible `/v1/chat/completions` endpoint'i
- Review, Architect, Debug prompt engineer'ları
- 9 agent markdown sistemi ve pipeline akışları

### v2'den (SaaS altyapı)
- BullMQ ile async job queue (stale lock problemi yok)
- Prisma ile type-safe database erişimi
- FirmOrchestrator pipeline pattern'i
- SkillEngine (skill success rate tracking)
- Runner factory pattern (multi-provider)

### Paperclip'ten (kavramsal ilham)
- `reportsTo` hiyerarşisi ve escalation zinciri
- Heartbeat scheduler konsepti (ama BullMQ ile, setInterval değil)
- Budget enforcement (soft/hard limit)
- Agent lifecycle state machine
- Company isolation (multi-tenant)
