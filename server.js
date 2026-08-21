package com.elektroasistan.app.screens

import android.Manifest
import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.rememberAsyncImagePainter
import com.elektroasistan.app.data.ArizaViewModel
import com.elektroasistan.app.data.AppDatabase
import com.elektroasistan.app.data.AkilliPdfProjeAnaliz
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.net.HttpURLConnection
import java.net.URL

data class AsistanMesaj(
    val id: String = System.currentTimeMillis().toString(),
    val icerik: String,
    val gonderenAI: Boolean // true: Yapay Zeka, false: Kullanıcı
)

@Composable
fun YapayZekaAsistaniEkrani(
    paddingValues: PaddingValues,
    arizaViewModel: ArizaViewModel = viewModel(),
    pdfSayfasiAc: (pdfUri: String, sayfa: Int) -> Unit = { _, _ -> }
) {
    var makineAdi by rememberSaveable { mutableStateOf("") }
    var arizaKodu by rememberSaveable { mutableStateOf("") }
    var belirti by rememberSaveable { mutableStateOf("") }
    var sonuc by rememberSaveable { mutableStateOf("") }
    var yukleniyor by remember { mutableStateOf(false) }
    var kaydedildi by remember { mutableStateOf(false) }
    var fotografUri by remember { mutableStateOf<Uri?>(null) }
    var kameraUri by remember { mutableStateOf<Uri?>(null) }
    var yerelKayitBulundu by remember { mutableStateOf(false) }
    var bulunanPdfUri by remember { mutableStateOf<String?>(null) }

    // CANLI SOHBET STATE'LERİ
    var sohbetAktif by remember { mutableStateOf(false) }
    var mesajlar by remember { mutableStateOf(emptyList<AsistanMesaj>()) }
    var kullaniciMesaji by remember { mutableStateOf("") }
    var sohbetYukleniyor by remember { mutableStateOf(false) }

    var bulunanPdfSayfalari by remember {
        mutableStateOf<List<Int>>(emptyList())
    }
    var projeAramaMetni by rememberSaveable {
        mutableStateOf("")
    }
    var projeAramaSonuclari by remember {
        mutableStateOf<List<Pair<String, Int>>>(emptyList())
    }

    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val database = remember(context) {
        AppDatabase.getDatabase(context)
    }
    val arizaDao = remember(database) {
        database.arizaDao()
    }
    val elektrikProjesiDao = remember(database) {
        database.elektrikProjesiDao()
    }
    val kendiArizalarin by arizaDao.tumArizalariGetir()
        .collectAsState(initial = emptyList())

    val galeriLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            fotografUri = uri
            kaydedildi = false
            yerelKayitBulundu = false
        }
    }

    val kameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { basarili ->
        if (basarili) {
            fotografUri = kameraUri
            kaydedildi = false
        }
    }

    val kameraIzinLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { izinVerildi ->
        if (izinVerildi) {
            val yeniUri = yeniFotografUri(context)
            kameraUri = yeniUri
            kameraLauncher.launch(yeniUri)
        } else {
            sonuc = "Kamerayı kullanabilmek için kamera izni vermeniz gerekiyor."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(paddingValues)
            .padding(16.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Text("🤖 Yapay Zekâ Arıza Asistanı", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = makineAdi,
            onValueChange = {
                makineAdi = it
                kaydedildi = false
            },
            label = { Text("Makine Adı") },
            placeholder = { Text("Örn: DMC 835 V") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedTextField(arizaKodu, { arizaKodu = it; kaydedildi = false }, label = { Text("Arıza kodu") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            belirti, { belirti = it; kaydedildi = false },
            label = { Text("Arıza belirtisi / açıklama") },
            modifier = Modifier.fillMaxWidth(), minLines = 4
        )
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = projeAramaMetni,
            onValueChange = { projeAramaMetni = it },
            label = { Text("Projede Ara") },
            placeholder = {
                Text("Örn: X45, K12, M23, 24V")
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        Spacer(Modifier.height(8.dp))

        Button(
            onClick = {
                scope.launch {
                    val arananKelime = projeAramaMetni.trim()

                    if (makineAdi.isBlank()) {
                        sonuc = "⚠️ Önce makine adını girin."
                        projeAramaSonuclari = emptyList()
                        return@launch
                    }

                    if (arananKelime.isBlank()) {
                        sonuc = "⚠️ Projede aranacak kelimeyi girin."
                        projeAramaSonuclari = emptyList()
                        return@launch
                    }

                    try {
                        sonuc = "🔎 Proje aranıyor: $arananKelime"

                        val tumProjeler = elektrikProjesiDao.pdfOlanTumProjeleriGetir()

                        fun normalizeProjeMetni(metin: String): String =
                            metin
                                .trim()
                                .lowercase(Locale.getDefault())
                                .replace("ı", "i")
                                .replace("ğ", "g")
                                .replace("ü", "u")
                                .replace("ş", "s")
                                .replace("ö", "o")
                                .replace("ç", "c")
                                .replace(Regex("[^a-z0-9]"), "")

                        val arananMakine = normalizeProjeMetni(makineAdi)

                        val makineProjeleri = if (arananMakine.isBlank()) {
                            tumProjeler
                        } else {
                            tumProjeler.filter { proje ->
                                val projeMakine = normalizeProjeMetni(proje.makineAdi)
                                val projeBaslik = normalizeProjeMetni(proje.baslik)
                                val projeBirlesik = normalizeProjeMetni("${proje.makineAdi} ${proje.baslik}")

                                projeMakine.contains(arananMakine) ||
                                        arananMakine.contains(projeMakine) ||
                                        projeBaslik.contains(arananMakine) ||
                                        projeBirlesik.contains(arananMakine)
                            }
                        }

                        if (makineProjeleri.isEmpty()) {
                            sonuc = "❌ '$makineAdi' adına bağlı PDF proje bulunamadı."
                            projeAramaSonuclari = emptyList()
                            return@launch
                        }

                        val bulunan = mutableListOf<Pair<String, Int>>()

                        makineProjeleri.forEach { proje ->
                            val pdfUri = proje.pdfUri

                            if (!pdfUri.isNullOrBlank()) {
                                val sayfalar = AkilliPdfProjeAnaliz.projedeAra(
                                    context = context,
                                    pdfUri = pdfUri,
                                    arananKelime = arananKelime
                                )

                                sayfalar.forEach { sayfaSonucu ->
                                    bulunan.add(pdfUri to sayfaSonucu.sayfa)
                                }
                            }
                        }

                        projeAramaSonuclari = bulunan.distinct()

                        sonuc = if (projeAramaSonuclari.isNotEmpty()) {
                            "✅ '$makineAdi' projesinde '$arananKelime' için ${projeAramaSonuclari.size} sayfa bulundu."
                        } else {
                            "❌ '$makineAdi' projesinde '$arananKelime' bulunamadı."
                        }

                    } catch (e: Exception) {
                        sonuc = "❌ Proje aramasında hata: " + (e.localizedMessage ?: "Bilinmeyen hata")
                        projeAramaSonuclari = emptyList()
                    }
                }
            },
            enabled = projeAramaMetni.isNotBlank(),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("🔎 PROJEDE ARA")
        }

        Spacer(Modifier.height(12.dp))

        if (projeAramaSonuclari.isNotEmpty()) {
            Text(
                text = "📄 Bulunan Proje Sayfaları",
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(Modifier.height(8.dp))

            projeAramaSonuclari.forEach { (uri, sayfa) ->
                OutlinedButton(
                    onClick = { pdfSayfasiAc(uri, sayfa) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("📄 Sayfa $sayfa → AÇ")
                }

                Spacer(Modifier.height(6.dp))
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("📷 Arıza Fotoğrafı", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))

        Text(
            text = "📚 Kütüphanede ${kendiArizalarin.size} arıza kaydı kontrol edilecek.",
            style = MaterialTheme.typography.bodySmall
        )
        Spacer(Modifier.height(8.dp))

        Button(
            onClick = { kameraIzinLauncher.launch(Manifest.permission.CAMERA) },
            modifier = Modifier.fillMaxWidth()
        ) { Text("📷 Kameradan Fotoğraf Çek") }

        Spacer(Modifier.height(8.dp))

        OutlinedButton(
            onClick = { galeriLauncher.launch("image/*") },
            modifier = Modifier.fillMaxWidth()
        ) { Text("🖼️ Galeriden Fotoğraf Seç") }

        fotografUri?.let { uri ->
            Spacer(Modifier.height(16.dp))
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(8.dp)) {
                    Text("Analiz Edilecek Fotoğraf", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(8.dp))
                    Image(
                        painter = rememberAsyncImagePainter(uri),
                        contentDescription = "Arıza fotoğrafı",
                        modifier = Modifier.fillMaxWidth().height(250.dp),
                        contentScale = ContentScale.Fit
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { fotografUri = null; kaydedildi = false },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Fotoğrafı Kaldır") }
                }
            }
        }
        Spacer(Modifier.height(16.dp))

        Button(
            onClick = {
                if (makineAdi.isBlank()) {
                    sonuc = "Önce makine adını girin."
                } else if (arizaKodu.isBlank() && belirti.isBlank() && fotografUri == null) {
                    sonuc = "Arıza kodu veya açıklama/belirti girin ya da fotoğraf ekleyin."
                } else {
                    scope.launch {
                        yukleniyor = true
                        kaydedildi = false
                        sonuc = ""
                        sohbetAktif = false
                        try {
                            fun normalize(metin: String): String =
                                metin.lowercase(Locale.getDefault())
                                    .replace(Regex("[^a-z0-9çğıöşü]+"), " ")
                                    .trim()

                            val tumPdfProjeleri = elektrikProjesiDao.pdfOlanTumProjeleriGetir()

                            fun makineTemizle(metin: String): String =
                                metin
                                    .lowercase(Locale.getDefault())
                                    .replace("ı", "i")
                                    .replace("ğ", "g")
                                    .replace("ü", "u")
                                    .replace("ş", "s")
                                    .replace("ö", "o")
                                    .replace("ç", "c")
                                    .replace(Regex("[^a-z0-9]"), "")

                            fun sayisalParcalar(metin: String): Set<String> =
                                Regex("\\d+")
                                    .findAll(metin)
                                    .map { it.value.trimStart('0').ifBlank { "0" } }
                                    .filter { it.isNotBlank() }
                                    .toSet()

                            val arananTemiz = makineTemizle(makineAdi)
                            val arananSayilar = sayisalParcalar(makineAdi)

                            val eslesenPdfProjeleri = tumPdfProjeleri.filter { proje ->
                                val projeMakineTemiz = makineTemizle(proje.makineAdi)
                                val projeBirlesikTemiz = makineTemizle("${proje.makineAdi} ${proje.baslik}")
                                val projeSayilar = sayisalParcalar("${proje.makineAdi} ${proje.baslik}")

                                val tamVeyaIcerikEslesmesi = arananTemiz.isNotBlank() &&
                                        (projeMakineTemiz == arananTemiz ||
                                                projeMakineTemiz.contains(arananTemiz) ||
                                                arananTemiz.contains(projeMakineTemiz) ||
                                                projeBirlesikTemiz.contains(arananTemiz))

                                val makineNumarasiEslesiyor = arananSayilar
                                    .filter { it.length >= 3 }
                                    .any { arananNo ->
                                        projeSayilar.any { projeNo -> arananNo == projeNo }
                                    }

                                val kompaktEslesme = arananTemiz.length >= 3 &&
                                        (projeBirlesikTemiz.contains(arananTemiz) || arananTemiz.contains(projeMakineTemiz))

                                tamVeyaIcerikEslesmesi || makineNumarasiEslesiyor || kompaktEslesme
                            }

                            val akilliPdfSonuclari = mutableListOf<Pair<com.elektroasistan.app.data.ElektrikProjesi, com.elektroasistan.app.data.AkilliPdfSonuc>>()

                            eslesenPdfProjeleri.take(3).forEach { proje ->
                                val uri = proje.pdfUri
                                if (!uri.isNullOrBlank()) {
                                    val analiz = AkilliPdfProjeAnaliz.analizEt(
                                        context = context,
                                        pdfUri = uri,
                                        arizaKodu = arizaKodu,
                                        belirti = belirti
                                    )
                                    akilliPdfSonuclari.add(proje to analiz)
                                    if (analiz.onerilenSayfalar.isNotEmpty()) {
                                        bulunanPdfUri = uri
                                        bulunanPdfSayfalari = analiz.onerilenSayfalar
                                            .map { it.sayfa }
                                            .distinct()
                                            .take(5)
                                    }
                                }
                            }

                            val eslesen = kendiArizalarin
                                .map { kayit ->
                                    val kayitKodu = normalize(kayit.arizaKodu)
                                    val kayitMakine = normalize(kayit.makineAdi)
                                    val kayitAciklama = normalize(kayit.aciklama)
                                    val kayitCozum = normalize(kayit.cozum)

                                    val arananKod = normalize(arizaKodu)
                                    val arananBelirti = normalize(belirti)
                                    val arananMakine = normalize(makineAdi)

                                    val arananMetin = "$arananKod $arananBelirti".trim()
                                    val kayitMetni = "$kayitKodu $kayitAciklama $kayitCozum".trim()

                                    val makineEslesiyor = arananMakine.isNotBlank() &&
                                            kayitMakine.isNotBlank() &&
                                            (arananMakine.contains(kayitMakine) || kayitMakine.contains(arananMakine))

                                    fun eksenBul(metin: String): String? {
                                        return when {
                                            Regex("\\bx\\s*eksen\\b").containsMatchIn(metin) || Regex("\\bx\\s*axis\\b").containsMatchIn(metin) -> "x"
                                            Regex("\\by\\s*eksen\\b").containsMatchIn(metin) || Regex("\\by\\s*axis\\b").containsMatchIn(metin) -> "y"
                                            Regex("\\bz\\s*eksen\\b").containsMatchIn(metin) || Regex("\\bz\\s*axis\\b").containsMatchIn(metin) -> "z"
                                            else -> null
                                        }
                                    }

                                    val arananEksen = eksenBul(arananMetin)
                                    val kayitEkseni = eksenBul(kayitMetni)

                                    val yanlisEksen = arananEksen != null && kayitEkseni != null && arananEksen != kayitEkseni

                                    var kodPuani = 0
                                    if (arananKod.isNotBlank() && kayitKodu.isNotBlank()) {
                                        if (arananKod == kayitKodu) {
                                            kodPuani = 1000
                                        } else if (arananKod.contains(kayitKodu) || kayitKodu.contains(arananKod)) {
                                            kodPuani = 500
                                        }
                                    }

                                    val belirtiKelimeleri = arananBelirti
                                        .split(Regex("\\s+"))
                                        .map { it.trim() }
                                        .filter { it.length >= 3 && it !in listOf("eksen", "axis") }
                                        .distinct()

                                    var belirtiPuani = 0
                                    var eslesenKelimeSayisi = 0

                                    belirtiKelimeleri.forEach { kelime ->
                                        val koddaVar = kayitKodu.contains(kelime)
                                        val aciklamadaVar = kayitAciklama.contains(kelime)
                                        val cozumdeVar = kayitCozum.contains(kelime)

                                        if (koddaVar || aciklamadaVar || cozumdeVar) {
                                            eslesenKelimeSayisi++
                                            belirtiPuani += when {
                                                koddaVar -> 120
                                                aciklamadaVar -> 80
                                                cozumdeVar -> 40
                                                else -> 0
                                            }
                                        }
                                    }

                                    val belirtiEslesmesiVar = if (arananEksen != null) {
                                        if (belirtiKelimeleri.isEmpty()) {
                                            kayitEkseni == arananEksen
                                        } else {
                                            kayitEkseni == arananEksen && eslesenKelimeSayisi > 0
                                        }
                                    } else {
                                        belirtiKelimeleri.isNotEmpty() &&
                                                ((belirtiKelimeleri.size == 1 && eslesenKelimeSayisi == 1) ||
                                                        (belirtiKelimeleri.size > 1 && eslesenKelimeSayisi >= ((belirtiKelimeleri.size + 1) / 2)))
                                    }

                                    val kodEslesmesiVar = kodPuani >= 500
                                    val arizaGercektenEslesiyor = !yanlisEksen && (kodEslesmesiVar || belirtiEslesmesiVar)

                                    val toplamPuan = if (makineEslesiyor && arizaGercektenEslesiyor) {
                                        var puan = 250 + kodPuani + belirtiPuani
                                        if (arananEksen != null && kayitEkseni == arananEksen) {
                                            puan += 500
                                        }
                                        puan
                                    } else {
                                        0
                                    }

                                    kayit to toplamPuan
                                }
                                .filter { (_, puan) -> puan > 0 }
                                .maxByOrNull { (_, puan) -> puan }
                                ?.first

                            if (eslesen != null) {
                                yerelKayitBulundu = true

                                sonuc = buildString {
                                    append("📚 Kendi arıza kütüphanende bu arıza bulundu.\n\n")
                                    append("Makine: ${eslesen.makineAdi}\n")
                                    if (eslesen.arizaKodu.isNotBlank()) append("Arıza Kodu: ${eslesen.arizaKodu}\n")
                                    if (eslesen.tarih.isNotBlank()) append("Tarih: ${eslesen.tarih}\n")
                                    append("\nAçıklama:\n${eslesen.aciklama.ifBlank { "Açıklama girilmemiş." }}")
                                    append("\n\nÇözüm:\n${eslesen.cozum.ifBlank { "Çözüm girilmemiş." }}")
                                    append("\n\n${if (eslesen.cozuldu) "🟢 Durum: Çözüldü" else "🔴 Durum: Açık"}")
                                }
                            } else {
                                yerelKayitBulundu = false

                                val projeSayfalariJson = if (bulunanPdfUri != null && bulunanPdfSayfalari.isNotEmpty()) {
                                    AkilliPdfProjeAnaliz.pdfSayfalariniGorselJsonYap(
                                        context = context,
                                        pdfUri = bulunanPdfUri!!,
                                        sayfalar = bulunanPdfSayfalari
                                    )
                                } else {
                                    null
                                }

                                val yapayZekaSonucu = arizaAnalizEt(
                                    context = context,
                                    marka = "",
                                    model = makineAdi,
                                    arizaKodu = arizaKodu,
                                    belirti = belirti,
                                    fotografUri = fotografUri,
                                    projeSayfalariJson = projeSayfalariJson
                                )

                                sonuc = buildString {
                                    if (makineAdi.isNotBlank()) {
                                        if (eslesenPdfProjeleri.isNotEmpty()) {
                                            append("📄 Elektrik projesi bulundu\n")
                                            eslesenPdfProjeleri.take(3).forEach { proje ->
                                                append("Proje: ${proje.baslik}\n")
                                                append("Makine: ${proje.makineAdi.ifBlank { "Belirtilmemiş" }}\n")
                                                append("✅ PDF bağlı\n")

                                                val akilli = akilliPdfSonuclari.firstOrNull { it.first.id == proje.id }?.second
                                                if (akilli != null) {
                                                    append("🧠 Arıza bölümü: ${akilli.kategori}\n")
                                                    if (akilli.onerilenSayfalar.isNotEmpty()) {
                                                        append("📑 Öncelikli proje sayfaları:\n")
                                                        akilli.onerilenSayfalar.forEach { s ->
                                                            append("• Sayfa ${s.sayfa}")
                                                            val terimler = s.eslesenTerimler.filterNot { it.startsWith("alarm:") }.take(4)
                                                            if (terimler.isNotEmpty()) append(" — ${terimler.joinToString(", ")}")
                                                            append("\n")
                                                        }
                                                        append("📚 PDF toplam ${akilli.toplamSayfa} sayfa\n")
                                                        append(projeKontrolPlani(akilli.kategori, akilli.onerilenSayfalar))
                                                        append("\n")
                                                    }
                                                }
                                            }
                                            append("\n")
                                        }
                                    }
                                    append(yapayZekaSonucu)
                                }
                            }

                            sohbetAktif = true
                            mesajlar = listOf(
                                AsistanMesaj(icerik = "İlk analizi tamamladım. Yönlendirmeleri uygulayıp durumu bana buradan bildirebilirsiniz.", gonderenAI = true)
                            )

                        } catch (e: Exception) {
                            sonuc = "Analiz sırasında hata oluştu: ${e.message}"
                        } finally {
                            yukleniyor = false
                        }
                    }
                }
            },
            enabled = !yukleniyor,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(if (yukleniyor) "🤖 Analiz ediliyor..." else "🤖 Analiz Et")
        }

        if (yukleniyor) {
            Spacer(Modifier.height(12.dp))
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Text("Fotoğraf ve arıza bilgileri yapay zekâ tarafından inceleniyor...")
        }

        if (sonuc.isNotBlank()) {
            Spacer(Modifier.height(16.dp))
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("🤖 Yapay Zekâ Analizi", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text(sonuc)

                    if (bulunanPdfUri != null && bulunanPdfSayfalari.isNotEmpty()) {
                        Spacer(Modifier.height(16.dp))
                        HorizontalDivider()
                        Spacer(Modifier.height(12.dp))

                        Text(
                            text = "📖 Bulunan Proje Sayfalarını Aç",
                            style = MaterialTheme.typography.titleSmall
                        )

                        Spacer(Modifier.height(8.dp))

                        bulunanPdfSayfalari.forEach { sayfa ->
                            OutlinedButton(
                                onClick = {
                                    bulunanPdfUri?.let { uri -> pdfSayfasiAc(uri, sayfa) }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("📖 Sayfa $sayfa'yı Aç")
                            }

                            Spacer(Modifier.height(6.dp))
                        }
                    }
                }
            }

            // ==========================================
            // CANLI SOHBET ARAYÜZÜ (İlk Analiz Hafızalı)
            // ==========================================
            if (sohbetAktif) {
                Spacer(Modifier.height(16.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "💬 Yapay Zeka ile Canlı Soru - Cevap",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Aşamaları takip edip yapay zekaya geri bildirim verin.",
                            style = MaterialTheme.typography.bodySmall
                        )

                        Spacer(Modifier.height(12.dp))

                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(200.dp)
                        ) {
                            LazyColumn(
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.fillMaxSize()
                            ) {
                                items(mesajlar) { msg ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = if (msg.gonderenAI) Arrangement.Start else Arrangement.End
                                    ) {
                                        Surface(
                                            color = if (msg.gonderenAI) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.primary,
                                            shape = MaterialTheme.shapes.medium,
                                            modifier = Modifier.widthIn(max = 260.dp)
                                        ) {
                                            Text(
                                                text = msg.icerik,
                                                modifier = Modifier.padding(10.dp),
                                                color = if (msg.gonderenAI) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onPrimary,
                                                style = MaterialTheme.typography.bodyMedium
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        Spacer(Modifier.height(8.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = kullaniciMesaji,
                                onValueChange = { kullaniciMesaji = it },
                                placeholder = { Text("Örn: Kontrol ettim, sorun yok...") },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                enabled = !sohbetYukleniyor
                            )

                            Button(
                                onClick = {
                                    val giden = kullaniciMesaji.trim()
                                    if (giden.isNotBlank() && !sohbetYukleniyor) {
                                        scope.launch(Dispatchers.IO) {
                                            try {
                                                val guncelMesajlar = mesajlar + AsistanMesaj(icerik = giden, gonderenAI = false)
                                                withContext(Dispatchers.Main) {
                                                    mesajlar = guncelMesajlar
                                                    kullaniciMesaji = ""
                                                    sohbetYukleniyor = true
                                                }

                                                val url = URL("https://elektroasistan-backend.onrender.com/api/ariza-sohbet")
                                                val baglanti = (url.openConnection() as HttpURLConnection).apply {
                                                    requestMethod = "POST"
                                                    connectTimeout = 30000
                                                    readTimeout = 60000
                                                    doOutput = true
                                                    setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                                                }

                                                val jsonGecmis = JSONArray().apply {
                                                    guncelMesajlar.dropLast(1).forEach { m ->
                                                        put(JSONObject().apply {
                                                            put("icerik", m.icerik)
                                                            put("gonderenAI", m.gonderenAI)
                                                        })
                                                    }
                                                }

                                                val istekBody = JSONObject().apply {
                                                    put("ilkAnaliz", sonuc) // İLK ANALİZ METNİ HER İSTEKTE İLETİLİYOR
                                                    put("mesajGecmisi", jsonGecmis)
                                                    put("yeniMesaj", giden)
                                                }

                                                baglanti.outputStream.use {
                                                    it.write(istekBody.toString().toByteArray(Charsets.UTF_8))
                                                }

                                                val kod = baglanti.responseCode
                                                val stream = if (kod in 200..299) baglanti.inputStream else baglanti.errorStream
                                                val cevap = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                                                val cevapJson = try { JSONObject(cevap) } catch (e: Exception) { null }

                                                val aiCevap = if (kod in 200..299) {
                                                    cevapJson?.optString("cevap")?.takeIf { it.isNotBlank() } ?: "Yapay zekadan yanıt alınamadı."
                                                } else {
                                                    "Sunucu hatası ($kod): ${cevapJson?.optString("hata") ?: "Bilinmeyen hata"}"
                                                }

                                                withContext(Dispatchers.Main) {
                                                    mesajlar = mesajlar + AsistanMesaj(icerik = aiCevap, gonderenAI = true)
                                                    sohbetYukleniyor = false
                                                }
                                            } catch (e: Exception) {
                                                withContext(Dispatchers.Main) {
                                                    mesajlar = mesajlar + AsistanMesaj(icerik = "Bağlantı hatası: ${e.message}", gonderenAI = true)
                                                    sohbetYukleniyor = false
                                                }
                                            }
                                        }
                                    }
                                },
                                enabled = !sohbetYukleniyor
                            ) {
                                Text(if (sohbetYukleniyor) "..." else "Gönder")
                            }
                        }
                    }
                }
            }

            val kaydedilebilir = !sonuc.startsWith("Sunucu hatası") &&
                    !sonuc.startsWith("Bağlantı hatası") &&
                    !sonuc.startsWith("Analiz sırasında hata") &&
                    !sonuc.startsWith("Kamerayı kullanabilmek")

            if (kaydedilebilir && !yerelKayitBulundu) {
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = {
                        val tarih = SimpleDateFormat("dd.MM.yyyy", Locale.getDefault()).format(Date())

                        val tamCozumRaporu = buildString {
                            append(sonuc)
                            if (mesajlar.size > 1) {
                                append("\n\n--- Canlı Sohbet ve Geri Bildirimler ---\n")
                                mesajlar.drop(1).forEach { m ->
                                    append("${if (m.gonderenAI) "AI" else "Kullanıcı"}: ${m.icerik}\n")
                                }
                            }
                        }

                        arizaViewModel.arizaEkle(
                            makineAdi = makineAdi.trim().ifBlank { "Belirtilmedi" },
                            arizaKodu = arizaKodu.trim(),
                            aciklama = belirti.trim(),
                            cozum = tamCozumRaporu,
                            tarih = tarih,
                            fotografUri = fotografUri?.toString()
                        )
                        kaydedildi = true
                    },
                    enabled = !kaydedildi,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (kaydedildi) "✅ Arıza Kaydına Eklendi" else "💾 Çözümü Arıza Kaydına Ekle")
                }
            }
        }

        Spacer(Modifier.height(20.dp))
        Text(
            "⚠️ Yapay zekâ önerileri üretici teknik dokümanlarının ve yetkili servis talimatlarının yerine geçmez. " +
                    "Enerjili ekipmanda çalışmadan önce gerekli güvenlik prosedürlerini uygulayın.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}

private fun yeniFotografUri(context: Context): Uri {
    val klasor = File(context.cacheDir, "images")
    klasor.mkdirs()
    val dosya = File.createTempFile("ariza_", ".jpg", klasor)
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", dosya)
}

private fun fotografBase64Yap(context: Context, uri: Uri): String {
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        ?: throw Exception("Fotoğraf okunamadı.")
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
}

private fun fotografMimeTypeBul(context: Context, uri: Uri): String {
    return context.contentResolver.getType(uri) ?: "image/jpeg"
}

private fun projeKontrolPlani(
    kategori: String,
    sayfalar: List<com.elektroasistan.app.data.AkilliPdfSayfa>
): String {
    if (sayfalar.isEmpty()) return ""
    val sayfaListesi = sayfalar.joinToString(", ") { it.sayfa.toString() }
    return "\n\n📄 Öncelikli Proje Sayfaları: $sayfaListesi"
}

private suspend fun arizaAnalizEt(
    context: Context,
    marka: String,
    model: String,
    arizaKodu: String,
    belirti: String,
    fotografUri: Uri?,
    projeSayfalariJson: JSONArray? = null
): String = withContext(Dispatchers.IO) {
    var baglanti: HttpURLConnection? = null
    try {
        val fotografBase64 = if (fotografUri != null) fotografBase64Yap(context, fotografUri) else ""
        val fotografMimeType = if (fotografUri != null) fotografMimeTypeBul(context, fotografUri) else "image/jpeg"

        val url = URL("https://elektroasistan-backend.onrender.com/api/ariza-analiz")
        baglanti = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 30000
            readTimeout = 180000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        }

        val json = JSONObject().apply {
            put("marka", marka)
            put("model", model)
            put("arizaKodu", arizaKodu)
            put("belirti", belirti)
            put("fotografBase64", fotografBase64)
            put("fotografMimeType", fotografMimeType)

            if (projeSayfalariJson != null && projeSayfalariJson.length() > 0) {
                put("projeSayfalari", projeSayfalariJson)
            }
        }

        baglanti.outputStream.use {
            it.write(json.toString().toByteArray(Charsets.UTF_8))
        }

        val kod = baglanti.responseCode
        val stream = if (kod in 200..299) baglanti.inputStream else baglanti.errorStream
        val cevap = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        val cevapJson = try { JSONObject(cevap) } catch (e: Exception) { null }

        if (kod in 200..299) {
            cevapJson?.optString("analiz")?.takeIf { it.isNotBlank() }
                ?: cevap.ifBlank { "Analiz sonucu alınamadı." }
        } else {
            val hataMesaji = cevapJson?.optString("hata")?.takeIf { it.isNotBlank() }
                ?: cevap.ifBlank { "Bilinmeyen sunucu hatası" }
            "Sunucu hatası ($kod): $hataMesaji"
        }
    } catch (e: Exception) {
        "Bağlantı hatası: ${e.message}"
    } finally {
        baglanti?.disconnect()
    }
}
