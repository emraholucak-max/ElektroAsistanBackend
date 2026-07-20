import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

if (!process.env.GEMINI_API_KEY) {
  console.error("HATA: GEMINI_API_KEY .env dosyasında tanımlı değil.");
  process.exit(1);
}

app.get("/", (req, res) => {
  res.json({ durum: "ok", mesaj: "ElektroAsistan Gemini Backend çalışıyor." });
});

app.post("/api/ariza-analiz", async (req, res) => {
  try {
    const { marka = "", model = "", arizaKodu = "", belirti = "" } = req.body ?? {};

    if (![marka, model, arizaKodu, belirti].some(v => String(v).trim())) {
      return res.status(400).json({ hata: "Analiz için en az bir bilgi girilmelidir." });
    }

    const prompt = `
Sen ElektroAsistan adlı CNC bakım ve elektrik arıza uygulamasının teknik arıza analiz asistanısın.

KURALLAR:
- Yanıtı Türkçe ver.
- Marka, model ve arıza kodunu birlikte değerlendir.
- Emin olmadığın arıza kodunu kesin bilgiymiş gibi uydurma.
- Aynı kod farklı marka veya modellerde farklı anlama gelebiliyorsa belirt.
- Teşhis koyduğunu iddia etme; olası nedenleri ve doğrulama adımlarını sırala.
- Tehlikeli şekilde koruma devrelerini atlatmayı veya enerjili ekipmanda işlem yapmayı önerme.
- Gerektiğinde üreticinin resmi teknik dokümanından doğrulama yapılmasını öner.

Yanıt başlıkları:
1. Arıza Özeti
2. Olası Nedenler
3. Güvenli Kontrol Adımları
4. Olası Çözüm Önerileri
5. Ek Bilgi / Doğrulama Gereksinimi

KULLANICI BİLGİLERİ:
Marka: ${marka || "Belirtilmedi"}
Model: ${model || "Belirtilmedi"}
Arıza kodu: ${arizaKodu || "Belirtilmedi"}
Belirti / açıklama: ${belirti || "Belirtilmedi"}
`.trim();

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1800
        }
      })
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API hatası:", data);
      return res.status(geminiResponse.status).json({
        basarili: false,
        hata: data?.error?.message || "Gemini API isteği başarısız oldu."
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

    res.json({ basarili: true, analiz });
  } catch (error) {
    console.error("Backend hatası:", error);
    res.status(500).json({
      basarili: false,
      hata: "Yapay zekâ analizi sırasında bir hata oluştu.",
      detay: process.env.NODE_ENV === "development" ? error?.message : undefined
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ElektroAsistan Gemini Backend: http://localhost:${PORT}`);
});
