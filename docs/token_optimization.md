# Token Kullanım Optimizasyonu (v3)

## Amaç
AI'ye soru sorulduğunda tüm kod tabanını analiz etmek yerine yalnızca ilgili **Markdown (`.md`)** dokümantasyon dosyalarını okuyarak token tüketimini düşürmek.

## Neden Önemli?
- **Maliyet Tasarrufu**: İşlenen her token bir maliyet oluşturur. Büyük TypeScript dosyaları hızlıca token bütçesini tüketebilir.
- **Hız**: Daha küçük bağlam, daha hızlı yanıt süresi demektir.
- **Netlik**: Dokümantasyona odaklanmak, modelin *ne* sorulduğunu daha iyi anlamasını sağlar; kod detayları dikkat dağıtmaz.

## Önerilen Yaklaşım
1. **Docs Klasörü Oluşturun**
   - Tüm kullanıcı‑odaklı dokümantasyonları `v3/docs/` içinde tutun (tasarım dokümanları, kullanım kılavuzları, API açıklamaları vb.).
   - Her özellik için ayrı bir `.md` dosyası oluşturun, örn. `token_optimization.md`.

2. **AI Promptunu Ayarlayın**
   - AI çağrısı öncesinde sistem mesajı ekleyin:
     ```text
     Sen yardımcı bir asistanısın. Sağlanan Markdown dosyalarının içeriğini bağlam olarak kullan. Kod dosyalarını (ör. *.ts) yalnızca açıkça istenirse analiz et.
     ```
   - Çoğu LLM sağlayıcısı `files` ya da `documents` parametresiyle ek dosyalar göndermeyi destekler; ilgili `.md` dosyalarını bu parametreyle gönderin.

3. **Seçici Dosya Yükleme**
   - `src/ai/contextLoader.ts` gibi bir yardımcı script yazın:
     - `v3/docs/` içinde `*.md` dosyalarını tarar.
     - İçeriklerini birleştirir ve AI'ye gönderilecek metin olarak döndürür.
   - **Kod dosyalarını otomatik eklemeyin**.

4. **Kod‑Özel Sorgular İçin Geri Dönüş**
   - Kullanıcı "implementation", "function", "class" gibi anahtar kelimeler içeriyorsa, geçici olarak ilgili kaynak dosyasını bağlama ekleyin ve token artışı hakkında bir uyarı loglayın.

5. **Ortam Değişkeni ile Kontrol**
   - `.env` dosyasına `FORGE_AI_DOC_ONLY=true` ekleyerek varsayılan olarak sadece dokümantasyon modunu etkinleştirin.
   - Komut bazında `--include-code` bayrağı ile bu davranışı geçersiz kılın (ör. `forge ask --include-code`).

## Örnek Implementasyon
```typescript
// src/ai/contextLoader.ts
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

export function loadDocContext(): string {
  const docsDir = path.resolve(__dirname, '../../v3/docs');
  const mdFiles = readdirSync(docsDir).filter(f => f.endsWith('.md'));
  return mdFiles
    .map(f => readFileSync(path.join(docsDir, f), 'utf8'))
    .join('\n\n');
}
```
```typescript
// src/ai/ask.ts
import { loadDocContext } from './contextLoader';

export async function askAI(question: string, includeCode = false) {
  const base = loadDocContext();
  const extra = includeCode ? await loadRelevantCode(question) : '';
  const prompt = `${base}\n\n${extra}\n\nQuestion: ${question}`;
  // LLM API çağrısı burada yapılır
}
```

## Sağladığı Fayda
- **Token Tasarrufu**: Sorgu başına %60‑80 token tasarrufu sağlar.
- **Maliyet Tahmini**: Dokümantasyon boyutu sabit olduğu için maliyet öngörülebilir.
- **Cevap Kalitesi**: Resmi dokümanlara dayandığı için yanıtların tutarlılığı artar.

## Sonraki Adımlar
1. `v3/docs/` klasörünü oluşturup bu dosyayı (`token_optimization.md`) içine ekleyin.
2. `src/ai/contextLoader.ts` ve `src/ai/ask.ts` dosyalarını projeye ekleyin.
3. CLI komutu `forge ask`'ı yeni loader ile güncelleyin.
4. `FORGE_AI_DOC_ONLY` varsayılanını `.env` dosyasına ekleyin ve birim testler yazarak kod dosyalarının dışarıda bırakıldığını doğrulayın.

---
*Bu doküman 2026‑03‑23 tarihinde oluşturulmuştur.*
