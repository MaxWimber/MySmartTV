# SmartTV

Компьютер с Windows как настоящий Google TV: Play Маркет, YouTube, RUTUBE, VK Видео и любые приложения для Android TV. Управлять можно с телефона по Wi-Fi.

```
desktop/   SmartTV для Windows (Electron): запускает Google TV и связывает его с пультом
android/   пульт для Android (Kotlin + Jetpack Compose)
docs/      протокол связи пульта и ПК
```

## Как это устроено

Внутри работает настоящий **Google TV (Android 14)** в официальном эмуляторе Android от Google. Приложения из Play Маркета видят обычный Android TV.

SmartTV при запуске:

1. включает Google TV и разворачивает его на весь экран;
2. принимает команды пульта с телефона и передаёт их в Google TV;
3. показывает свою панель (QR-код для пульта, подключённые телефоны) во время загрузки и по запросу.

## Установка

Нужны Node.js 20+, JDK 17+ и Android SDK. Android Studio не обязательна.

**1. Виртуализация Windows.** В PowerShell от имени администратора выполните команду и перезагрузите компьютер:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
```

**2. Эмулятор и образ Google TV** (около 2,5 ГБ):

```bash
sdkmanager "platform-tools" "emulator" "system-images;android-34;google-tv;x86"
```

**3. Виртуальный телевизор** `SmartTV_GoogleTV`:

```bash
avdmanager create avd -n SmartTV_GoogleTV -k "system-images;android-34;google-tv;x86" -d tv_1080p
```

Затем в `%USERPROFILE%\.android\avd\SmartTV_GoogleTV.avd\config.ini` поменяйте:

```ini
PlayStore.enabled=yes
hw.ramSize=4096M
hw.cpu.ncore=4
hw.gpu.enabled=yes
hw.gpu.mode=host
hw.keyboard=yes
disk.dataPartition.size=16G
hw.initialOrientation=landscape
showDeviceFrame=no
```

**4. SmartTV:**

```bash
cd desktop
npm install
npm start
```

При первом запуске:

- Windows спросит доступ к сети: разрешите его для **частных сетей**, иначе телефон не увидит ПК.
- Google TV загружается около минуты, потом за несколько секунд.
- Google TV попросит войти в Google-аккаунт. После этого откроются главный экран и Play Маркет.

Установщик для Windows (`desktop/dist/`): `npm run dist`.

**5. YouTube.** Официальное приложение YouTube в эмуляторе не запускается: пишет «YouTube is not supported on this device», потому что эмулятор не сертифицирован YouTube. Вместо него поставьте [SmartTube](https://github.com/yuliskov/SmartTube) — открытый клиент YouTube для Android TV. Возьмите из релизов сборку `SmartTube_stable_*_x86.apk` и выполните:

```bash
adb -s emulator-5554 install SmartTube_stable_x86.apk
adb -s emulator-5554 shell pm disable-user --user 0 com.google.android.youtube.tv
```

Вторая команда прячет нерабочий официальный YouTube. Вернуть его: `pm enable com.google.android.youtube.tv`. Ссылки YouTube, отправленные с телефона, SmartTV сам открывает в SmartTube.

## Управление

Когда на экране Google TV, клавиатура ПК работает как пульт: стрелки, Enter — OK, Esc — назад.

| Где | Что |
|---|---|
| `Ctrl+Alt+S` | панель SmartTV: QR-код для пульта, телефоны, перезапуск Google TV (повторное нажатие — обратно в Google TV) |
| Значок в трее | Google TV, «Подключить пульт», «Перезапустить Google TV», «Выход» |
| Esc в панели | вернуться в Google TV |

**«Выход»** в трее или кнопка «Выключить SmartTV» сохраняют состояние Google TV (Quick Boot), поэтому следующий запуск быстрый.

## Android-пульт

Готовый APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Скопируйте его на телефон и откройте. Android попросит разрешить установку из этого источника.

Сборка (нужен Android SDK с platform 35):

```bash
cd android
./gradlew assembleDebug
```

Подключение:

1. На ПК откройте панель SmartTV (`Ctrl+Alt+S` или значок в трее → «Подключить пульт»). Во время загрузки Google TV она открыта сама.
2. В приложении на телефоне нажмите **«Сканировать QR-код»**. Или выберите ПК в списке «В этой сети» и введите PIN.
3. Телефон запомнится и при следующем запуске подключится сам. Если у ПК сменится IP, пульт найдёт его в сети заново.

Что умеет пульт:

- крестовина, OK, Назад, Домой, пауза и перемотка — прямо в Google TV;
- громкость, в том числе **кнопками громкости телефона**. В Google TV меняется громкость самого Google TV, и он показывает свой ползунок. Громкость Windows — это её потолок. В панели SmartTV меняется громкость Windows;
- тачпад-мышь: тап — клик, двумя пальцами — прокрутка;
- ввод текста в поле на ТВ, включая русский;
- **«Поделиться → Открыть на ТВ»** из YouTube, браузера и других приложений: ссылка открывается в подходящем приложении Google TV.

### Веб-пульт без установки

Если отсканировать QR-код обычной камерой телефона, откроется пульт в браузере. Функции те же, но без кнопок громкости телефона и без «Поделиться».

## Технические подробности

- Кнопки пульта уходят в Google TV командой `input keyevent` через постоянное соединение adb (около 25 мс на нажатие). Ссылки открываются через `am start`.
- Латинский текст печатается командой `input text`. Русский идёт через буфер обмена, общий у Windows и эмулятора, и вставляется в поле.
- Окно эмулятора разворачивается на весь экран через системный API Windows: фоновый процесс PowerShell, никаких нативных модулей. Тем же процессом двигается мышь и меняется громкость.
- Настройки SmartTV лежат в `%APPDATA%\smarttv\config.json`.
- Протокол связи с пультом описан в [docs/protocol.md](docs/protocol.md).

## Известные ограничения

- Официальный YouTube не работает (см. шаг 5 установки), вместо него SmartTube.
- Видео в эмуляторе декодирует процессор, а не видеокарта. 1080p тянет без проблем, 4K — вряд ли.
- Сервисы с защитой видео (Netflix и похожие) в эмуляторе могут не работать или показывать низкое качество.
- Если YouTube в вашей сети недоступен без VPN, нужен VPN на компьютере: Google TV выходит в интернет через сеть Windows.
