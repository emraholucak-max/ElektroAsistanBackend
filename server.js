
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

if (!process.env.GEMINI_API_KEY) {
  console.error("HATA: GEMINI_API_KEY tanımlı değil.");
  process.exit(1);
}

app.get("/", (req, res) => {
  res.json({
    durum: "ok",
    mesaj: "ElektroAsistan Gemini Backend çalışıyor."
  });
});

// ARIZA ANALİZİ
app.post("/api/ariza-analiz", async (req, res) => {
  try {
    const {
      marka = "",
      model = "",
      arizaKodu = "",
      belirti = "",
      fotografBase64 = "",
      fotografMimeType = "image/jpeg",
      projeGorselBase64 = "",
      projeGorselMimeType = "image/jpeg"
    } = req.body ?? {};

    const metinBilgisiVar = [marka, model, arizaKodu, belirti]
      .some(v => String(v).trim());

    const fotografVar =
      typeof fotografBase64 === "string" &&
      fotografBase64.trim().length > 0;

    const projeGorselVar =
      typeof projeGorselBase64 === "string" &&
      projeGorselBase64.trim().length > 0;

    if (!metinBilgisiVar && !fotografVar) {
      return res.status(400).json({
        basarili: false,
        hata: "Analiz için en az bir bilgi girin veya fotoğraf ekleyin."
      });
    }

    const desteklenenMimeTurleri = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    const guvenliMimeType =
      desteklenenMimeTurleri.includes(fotografMimeType)
        ? fotografMimeType
        : "image/jpeg";

    const guvenliProjeMimeType =
      desteklenenMimeTurleri.includes(projeGorselMimeType)
        ? projeGorselMimeType
        : "image/jpeg";

    const prompt = `
Sen ElektroAsistan adlı CNC bakım, elektrik ve endüstriyel otomasyon arıza uygulamasının teknik yapay zekâ asistanısın.
Kullanıcının verdiği metin bilgilerini ve varsa yüklediği fotoğrafı birlikte değerlendir.

KURALLAR:
- Yanıtı Türkçe ver.
- Marka, model, arıza kodu ve belirtileri birlikte değerlendir.
- Fotoğraf varsa yalnızca fotoğrafta gerçekten görülebilen unsurları değerlendir.
- Kesin teşhis koyduğunu iddia etme.
- Olası nedenleri önem sırasına göre belirt.
- Güvenli doğrulama ve kontrol adımlarını sırala.
- Elektriksel kontrollerde uygun iş güvenliği prosedürlerinin uygulanmasını belirt.

YANIT BAŞLIKLARI:
1. Arıza Özeti
2. Fotoğrafta Tespit Edilenler
3. Olası Nedenler
4. Güvenli Kontrol Adımları
5. Olası Çözüm Önerileri
6. Ek Bilgi / Doğrulama Gereksinimi

KULLANICI BİLGİLERİ:
Marka: ${marka || "Belirtilmedi"}
Model: ${model || "Belirtilmedi"}
Arıza kodu: ${arizaKodu || "Belirtilmedi"}
Belirti / açıklama: ${belirti || "Belirtilmedi"}
Fotoğraf: ${fotografVar ? "Kullanıcı tarafından fotoğraf eklendi." : "Fotoğraf eklenmedi."}
`.trim();

    const parts = [{ text: prompt }];

    if (fotografVar) {
      parts.push({
        inlineData: {
          mimeType: guvenliMimeType,
          data: fotografBase64
        }
      });
    }

    if (projeGorselVar) {
      parts.push({
        text: "Aşağıdaki görüntü, kullanıcının makinesine ait elektrik/hidrolik proje şemalarının ilgili sayfalarının birleşimidir. Arızayla ilişkili olabilecek bileşenleri analiz et."
      });

      parts.push({
        inlineData: {
          mimeType: guvenliProjeMimeType,
          data: projeGorselBase64
        }
      });
    }

    const modelName =
      process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000
        }
      })
    });

    const rawResponse = await geminiResponse.text();
    let data;

    try {
      data = JSON.parse(rawResponse);
    } catch (e) {
      return res.status(502).json({
        basarili: false,
        hata: "Gemini servisinden geçersiz bir yanıt alındı."
      });
    }

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({
        basarili: false,
        hata: data?.error?.message ||
          "Gemini API isteği başarısız oldu."
      });
    }

    const analiz = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!analiz) {
      return res.status(502).json({
        basarili: false,
        hata: "Gemini'den analiz metni alınamadı."
      });
    }

    return res.json({
      basarili: true,
      analiz: analiz
    });

  } catch (error) {
    console.error("Arıza analiz hatası:", error);

    return res.status(500).json({
      basarili: false,
      hata: "Yapay zekâ analizi sırasında bir hata oluştu."
    });
  }
});

// ARIZA CANLI SOHBET
app.post("/api/ariza-sohbet", async (req, res) => {
  try {
    const {
      mesajGecmisi = [],
      yeniMesaj = "",
      ilkAnaliz = ""
    } = req.body ?? {};

    if (!yeniMesaj.trim()) {
      return res.status(400).json({
        basarili: false,
        hata: "Gönderilecek mesaj boş olamaz."
      });
    }

    const contents = [];

    if (ilkAnaliz.trim()) {
      contents.push({
        role: "user",
        parts: [{
          text: `Aşağıdaki metin, bu arıza hakkında yapılan ilk teknik analiz raporudur:

${ilkAnaliz}

Lütfen sonraki tüm sorularımı bu analize dayanarak ve teknik bir uzman olarak yanıtla.`
        }]
      });

      contents.push({
        role: "model",
        parts: [{
          text: "Anladım. Arıza analiz raporunu ve detaylarını inceledim. Süreçte size yardımcı olmaya hazırım."
        }]
      });
    }

    mesajGecmisi.forEach(m => {
      contents.push({
        role: m.gonderenAI ? "model" : "user",
        parts: [{ text: m.icerik }]
      });
    });

    contents.push({
      role: "user",
      parts: [{ text: yeniMesaj }]
    });

    const modelName =
      process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1500
        }
      })
    });

    const rawResponse = await geminiResponse.text();
    let data;

    try {
      data = JSON.parse(rawResponse);
    } catch (e) {
      return res.status(502).json({
        basarili: false,
        hata: "Gemini servisinden geçersiz yanıt alındı."
      });
    }

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({
        basarili: false,
        hata: data?.error?.message ||
          "Gemini API isteği başarısız oldu."
      });
    }

    const cevap = data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("")
      .trim();

    if (!cevap) {
      return res.status(502).json({
        basarili: false,
        hata: "Gemini'den yanıt alınamadı."
      });
    }

    return res.json({
      basarili: true,
      cevap: cevap
    });

  } catch (error) {
    console.error("Sohbet hatası:", error);

    return res.status(500).json({
      basarili: false,
      hata: "Sohbet sırasında bir hata oluştu."
    });
  }
});

// YENİ: AKILLI METİN OKUMA / OCR
app.post("/api/akilli-metin-oku", async (req, res) => {
  try {
    const {
      fotografBase64 = "",
      fotografMimeType = "image/jpeg",
      ekTalimat = ""
    } = req.body ?? {};

    if (
      typeof fotografBase64 !== "string" ||
      !fotografBase64.trim()
    ) {
      return res.status(400).json({
        basarili: false,
        hata: "Fotoğraf verisi gönderilmedi."
      });
    }

    const desteklenenMimeTurleri = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!desteklenenMimeTurleri.includes(fotografMimeType)) {
      return res.status(400).json({
        basarili: false,
        hata: "Desteklenmeyen fotoğraf biçimi."
      });
    }

    const prompt = `
Sen ElektroAsistan uygulamasının akıllı belge ve teknik çizim okuma asistanısın.

Görevin, gönderilen fotoğrafı dikkatlice inceleyerek içeriğini Türkçe ve düzenli biçimde metne aktarmaktır.

GENEL KURALLAR:
- Görseldeki yazıları mümkün olduğunca aynen oku.
- Başlıkları, alt başlıkları, numaralandırmaları ve madde işaretlerini koru.
- Tablo varsa satır ve sütun düzenini Markdown tablo olarak aktar.
- El yazısı varsa okuyabildiğin bölümleri aktar.
- Emin olmadığın kelime veya rakamları tahmin ederek tamamlamaya çalışma; [okunamadı] olarak belirt.
- Sayısal değerleri, ölçü birimlerini, parça numaralarını ve teknik kodları değiştirme.
- Görselde bulunmayan bilgi ekleme.

TEKNİK ÇİZİM VE ŞEMA KURALLARI:
- Elektrik, elektronik, hidrolik, pnömatik veya mekanik şema varsa bunu ayrıca incele.
- Görünen eleman adlarını, sembol numaralarını, klemensleri ve bağlantı etiketlerini aktar.
- Bağlantıların hangi elemanlar arasında olduğunu, yalnızca görselden anlaşılabildiği ölçüde açıkla.
- Röle, kontaktör, sigorta, sensör, motor, sürücü ve benzeri elemanları ayırt etmeye çalış.
- Okunamayan sembol veya bağlantıları kesin bilgi gibi sunma.
- Şemanın kendisini yeniden çizdiğini iddia etme; bağlantı yapısını metinle tarif et.

YANIT DÜZENİ:

1. GÖRSELDEKİ METİNLER
Görünen yazıları ve sayısal bilgileri sırayla aktar.

2. TABLOLAR
Varsa tabloları satır ve sütun düzeniyle yaz.

3. TEKNİK ŞEMA / ÇİZİM ANALİZİ
Varsa sembolleri, elemanları ve bağlantı ilişkilerini açıkla.

4. OKUNAMAYAN VE BELİRSİZ ALANLAR
Net olmayan bölümleri belirt.

5. GENEL AÇIKLAMA
Görselin ne içerdiğini kısa şekilde özetle.

${ekTalimat ? `KULLANICININ EK TALİMATI:\n${ekTalimat}` : ""}
`.trim();

    const modelName =
      process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: fotografMimeType,
                data: fotografBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 3000
        }
      })
    });

    const rawResponse = await geminiResponse.text();
    let data;

    try {
      data = JSON.parse(rawResponse);
    } catch (e) {
      return res.status(502).json({
        basarili: false,
        hata: "Gemini servisinden geçersiz bir yanıt alındı."
      });
    }

    if (!geminiResponse.ok) {
      console.error("OCR Gemini hatası:", data?.error);

      return res.status(geminiResponse.status).json({
        basarili: false,
        hata: data?.error?.message ||
          "Fotoğraf okunurken Gemini API hatası oluştu."
      });
    }

    const metin = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!metin) {
      return res.status(502).json({
        basarili: false,
        hata: "Fotoğraftan metin okunamadı."
      });
    }

    return res.json({
      basarili: true,
      metin: metin
    });

  } catch (error) {
    console.error("Akıllı metin okuma hatası:", error);

    return res.status(500).json({
      basarili: false,
      hata: "Fotoğraf metne dönüştürülürken bir hata oluştu."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ElektroAsistan Gemini Backend: http://localhost:${PORT}`);
});
