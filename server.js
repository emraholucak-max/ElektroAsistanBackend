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
      fotografMimeType = "image/jpeg"
    } = req.body ?? {};

    // Metin veya fotoğraftan en az biri olmalı
    const metinBilgisiVar = [
      marka,
      model,
      arizaKodu,
      belirti
    ].some(v => String(v).trim());

    const fotografVar =
      typeof fotografBase64 === "string" &&
      fotografBase64.trim().length > 0;

    if (!metinBilgisiVar && !fotografVar) {
      return res.status(400).json({
        basarili: false,
        hata: "Analiz için en az bir bilgi girin veya fotoğraf ekleyin."
      });
    }

    // Güvenlik için desteklenen görsel türlerini sınırla
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
- Fotoğraftaki hata kodu, alarm mesajı, cihaz etiketi, ekran yazısı,
  LED durumu veya bağlantı gibi teknik ayrıntıları tespit etmeye çalış.
- Görüntü net değilse bunu açıkça belirt.
- Fotoğraftan kesin olarak belirlenemeyen marka, model veya parçayı uydurma.
- Emin olmadığın arıza kodunu kesin bilgiymiş gibi sunma.
- Aynı hata kodu farklı marka veya modellerde farklı anlama gelebiliyorsa belirt.
- Kesin teşhis koyduğunu iddia etme.
- Olası nedenleri önem sırasına göre belirt.
- Güvenli doğrulama ve kontrol adımlarını sırala.
- Tehlikeli şekilde koruma devrelerini atlatmayı önerme.
- Enerjili ekipmanda tehlikeli işlem yapılmasını önerme.
- Elektriksel kontrollerde uygun iş güvenliği prosedürlerinin uygulanmasını belirt.
- Gerektiğinde üreticinin resmi teknik dokümanından doğrulama yapılmasını öner.

YANIT BAŞLIKLARI:

1. Arıza Özeti

2. Fotoğrafta Tespit Edilenler
(Fotoğraf yoksa "Fotoğraf eklenmedi" yaz.)

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

    // Gemini'ye gönderilecek parçalar
    const parts = [
      {
        text: prompt
      }
    ];

    // Fotoğraf varsa Gemini isteğine ekle
    if (fotografVar) {
      parts.push({
        inlineData: {
          mimeType: guvenliMimeType,
          data: fotografBase64
        }
      });
    }

    const modelName =
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${modelName}:generateContent?key=` +
      `${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        contents: [
          {
            parts: parts
          }
        ],

        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000
        }
      })
    });

    // Önce düz metin olarak oku.
    // Gemini bazen JSON olmayan bir hata döndürürse backend çökmesin.
    const rawResponse =
      await geminiResponse.text();

    let data;

    try {
      data = JSON.parse(rawResponse);
    } catch (e) {
      console.error(
        "Gemini JSON olmayan cevap:",
        rawResponse
      );

      return res.status(502).json({
        basarili: false,
        hata: "Gemini servisinden geçersiz bir yanıt alındı."
      });
    }

    // Gemini API hatası
    if (!geminiResponse.ok) {
      console.error(
        "Gemini API hatası:",
        data
      );

      return res
        .status(geminiResponse.status)
        .json({
          basarili: false,

          hata:
            data?.error?.message ||
            "Gemini API isteği başarısız oldu."
        });
    }

    // Analiz metnini birleştir
    const analiz =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!analiz) {
      return res.status(502).json({
        basarili: false,
        hata: "Gemini'den analiz metni alınamadı."
      });
    }

    // Android uygulamasına sonucu gönder
    return res.json({
      basarili: true,
      analiz: analiz
    });

  } catch (error) {
    console.error(
      "Backend hatası:",
      error
    );

    return res.status(500).json({
      basarili: false,

      hata:
        "Yapay zekâ analizi sırasında bir hata oluştu.",

      detay:
        process.env.NODE_ENV === "development"
          ? error?.message
          : undefined
    });
  }
});

// SUNUCU
const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `ElektroAsistan Gemini Backend: http://localhost:${PORT}`
  );
});
