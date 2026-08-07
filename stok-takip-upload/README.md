# Stok Takip

Trendyol ve Hepsiburada mağazalarındaki stoklarını tek yerden takip eder. Stok kritik seviyeye düşünce ve satış olduğunda **Telegram üzerinden telefonuna** bildirim gönderir.

## Özellikler
- Trendyol ve Hepsiburada'dan stokları otomatik çeker (API)
- Her ürünün stokunu mağaza bazında gösterir (ör. "X ürünü Trendyol'da 4, Hepsiburada'da 12")
- Stok kritik seviyeye düşünce (varsayılan: 1 ve altı) bildirim atar
- Stok düşünce (satış olduğunu anlarsın) bildirim atar
- Kontrol sıklığı ayarlanabilir (varsayılan: 30 dakikada bir)
- Elle stok girme (API olmadan da çalışır)

## Bilgisayarında çalıştırma (test için)
1. `Stok-Takip-Baslat.bat` dosyasına çift tıkla.
2. Tarayıcıda `http://localhost:3000` aç.
3. Bitti: bu pencere kapanınca program kapanır.

> Not: Program bilgisayarında çalışırken bildirim gönderir. Bilgisayar kapalıyken çalışmaz.
> Bilgisayarın kapalı olsa bile 7/24 çalışması için aşağıdaki "Ücretsiz sunucuya kurulum" bölümünü yap.

## Telegram bildirimi kurma (telefonuna gelmesi için)

1. Telefonuna **Telegram** uygulamasını kur, hesap aç.
2. Telegram'da **BotFather**'ı ara (arama kutusuna `@BotFather` yaz).
3. `/newbot` yaz, Enter'a bas.
4. Botuna bir isim ver (ör: `Stok Takip Bot`), sonra bir kullanıcı adı iste (ör: `stoktakipbotim`). Sonunda **TOKEN** verir:
   ```
   1234567890:AAHdfkjsdhfkjsdhf...
   ```
   Bu TOKEN'ı kopyala.
5. Botun sohbetini aç, ona herhangi bir mesaj yaz (ör: `merhaba`). **Şart: önce mesaj atmalısın.**
6. Şimdi Chat ID'ni al. Tarayıcıda şurayı aç (TOKEN yerine kendi token'ını yaz):
   ```
   https://api.telegram.org/botTOKEN/getUpdates
   ```
   Sayfada `"chat":{"id":123456789` gibi bir sayı göreceksin. Bu sayı **Chat ID**'dir.
7. Programın **Ayarlar** sayfasında:
   - Bot Token: az önce aldığın TOKEN
   - Chat ID: az önce bulduğun sayı
   - "Telegram bildirimleri açık" kutusunu işaretle
   - **Ayarları Kaydet**, sonra **Test Bildirimi Gönder**'e bas.
   Telefonuna test mesajı gelirse her şey hazır.

> Ses açmak için: Botun sohbetini aç → botun adına dokun → Bildirimler → Sesi aç.

## API anahtarları (stokları otomatik çekmesi için)

API anahtarı olmadan program stokları çekemez; sadece elle girdiğin stokları gösterir ve elle girilen stokların bitişini/satışını bildirir. (Aslında satış bildirimi stok değişiminden algılanır, elle girilen stoklarda da işe yarar.)

### Trendyol API
1. [Trendyol Satıcı Paneli](https://merchants.trendyol.com)'ne gir.
2. **Hesap** → **Ayarlar** → **Entegrasyon Bilgileri** bölümüne git.
3. Burada **API Anahtarı**, **API Şifresi** ve **Satıcı Numarası** görünür.
4. Bu üçünü programın **Ayarlar** sayfasındaki "Trendyol API" kısmına yaz, kaydet.

### Hepsiburada API
1. [Hepsiburada Satıcı Paneli](https://ecom.hepsiburada.com)'ne gir.
2. **Entegrasyon** menüsünden API bilgilerini bul (Kullanıcı Adı = Merchant ID, Parola = API Key).
3. Programın **Ayarlar** sayfasındaki "Hepsiburada API" kısmına yaz, kaydet.

## Ücretsiz sunucuya kurulum (PC kapalıyken de 7/24 çalışır)

Bu adımlarla programı her zaman açık olan ücretsiz bir sunucuya kurarız.

### 1. GitHub hesabı aç
- [github.com](https://github.com) → Sign up. Ücretsiz.

### 2. Kodu GitHub'a yükle
- Bilgisayarda bu klasöre (stok-takip) git, adres çubuğuna `cmd` yazıp Enter'a bas.
- Şu komutları sırayla çalıştır (gerekirse [buraya bak](https://docs.github.com/en/get-started/getting-started-with-git/set-up-git)):
  ```
  git init
  git add .
  git commit -m "ilk surum"
  ```
- GitHub'da yeni bir repo oluştur (boş, adı ör: `stok-takip`).
- Koddaki komutlar reponu bağlar, sonra:
  ```
  git remote add origin https://github.com/KULLANICIADIN/stok-takip.git
  git branch -M main
  git push -u origin main
  ```

### 3. Render'a kur (ücretsiz)
1. [render.com](https://render.com) → "Sign up" → **GitHub ile devam et**, repo'na erişim izni ver.
2. **New +** → **Web Service** → `stok-takip` reposunu seç.
3. Aşağıdaki gibi doldur:
   - Name: `stok-takip`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: **Free**
4. **Create Web Service**'e bas.
5. Bitince sana `https://stok-takip.onrender.com` gibi bir adres verir. Bu adrese gir, program çalışıyor demektir.

### 4. Uyumazdan emin ol (Ücretsiz UptimeRobot)
Render'ın ücretsiz servisi 15 dakika işlem gelmezse uyur. Uyutmamak için:
1. [uptimerobot.com](https://uptimerobot.com) → ücretsiz hesap aç.
2. **Add New Monitor**:
   - Monitor Type: **HTTP(S)**
   - URL: `https://stok-takip.onrender.com/health`
   - Interval: **5 minutes**
   - **Create Monitor**
3. Artık site her 5 dakikada bir uyanık tutulur; program sürekli çalışır ve bildirim atar.

### Notlar
- Ayarlar (API anahtarları, Telegram) sunucudaki programın **Ayarlar** sayfasından girilir.
- Veriler `data/store.json` dosyasında saklanır. Render'ın ücretsiz planında sunucu yeniden başlayınca disk içeriği sıfırlanabilir; verilerini kaybetmemek için ileride ücretli plana geçilebilir veya Telegram bildirimleri yine de çalışır.
