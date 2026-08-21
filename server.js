import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());

// Fotoğraf Base64 olarak geleceği için limiti yükselttik.
app.use(express.json({ limit: "15mb" }));

if (!process.env.GEMINI_API_KEY) {
  console.error("HATA: GEMINI_API_KEY tanımlı değil.");
  process.exit(1);
}

// Backend kontrol adresi
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

    const metinBilgisiVar = [
      marka,
      model,
      arizaKodu,
      belirti
    ].some(v => String(v).trim());

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

    const prompt = `
Sen ElektroAsistan adlı CNC bakım, elektrik ve endüstriyel otomasyon
arıza uygulamasının teknik yapay zekâ asistanısın.

Kullanıcının verdiği metin bilgilerini ve varsa yüklediği fotoğrafı
birlikte değerlendir.

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
          mimeType: projeGorselMimeType,
          data: projeGorselBase64
        }
      });
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
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
        hata: data?.error?.message || "Gemini API isteği başarısız oldu."
      });
    }

    const analiz = data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();

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
    return res.status(500).json({
      basarili: false,
      hata: "Yapay zekâ analizi sırasında bir hata oluştu."
    });
  }
});

// ARIZA CANLI SOHBET (YENİ EKLENEN GERÇEK SOHBET UÇ NOKTASI)
app.post("/api/ariza-sohbet", async (req, res) => {
  try {
    const { mesajGecmisi = [], yeniMesaj = "" } = req.body ?? {};

    if (!yeniMesaj.trim()) {
      return res.status(400).json({
        basarili: false,
        hata: "Gönderilecek mesaj boş olamaz."
      });
    }

    const contents = mesajGecmisi.map(m => ({
      role: m.gonderenAI ? "model" : "user",
      parts: [{ text: m.icerik }]
    }));

    contents.push({
      role: "user",
      parts: [{ text: yeniMesaj }]
    });

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
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
        hata: data?.error?.message || "Gemini API isteği başarısız oldu."
      });
    }

    const cevap = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();

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
    return res.status(500).json({
      basarili: false,
      hata: "Sohbet sırasında bir hata oluştu."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ElektroAsistan Gemini Backend: http://localhost:${PORT}`);
});
