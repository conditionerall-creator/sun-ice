# remove-send-stock.ps1 — прибирає ТИМЧАСОВУ напівручну відправку залишків.
#
# КОЛИ ЗАПУСКАТИ: коли 1С почне вивантажувати залишки сама (обробка .epf + Планувальник на сервері),
# тобто коли в журналі синхронізації з'являться записи не від цього комп'ютера.
# Поки автоматики немає — НЕ запускати, інакше наявність у застосунку перестане оновлюватись.
#
# ЩО ПРИБИРАЄ: завдання Планувальника, ярлик на робочому столі, сам скрипт.
# ЩО НЕ ЧІПАЄ: C:\Sunice\token.txt (потрібен і для автоматики) та архів надісланих файлів.
#
# Запуск:  powershell -ExecutionPolicy Bypass -File remove-send-stock.ps1

$ErrorActionPreference = 'Stop'
$TaskName = 'SunIce - вiдправка залишкiв'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    "Завдання Планувальника видалено: $TaskName"
} else {
    "Завдання Планувальника не знайдено (можливо, вже видалене)."
}

$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sun-ice — відправити залишки.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force; "Ярлик з робочого столу видалено." }

if (Test-Path 'C:\Sunice\send-stock.ps1') { Remove-Item 'C:\Sunice\send-stock.ps1' -Force; "Скрипт C:\Sunice\send-stock.ps1 видалено." }

"Залишились (навмисно): C:\Sunice\token.txt і папка C:\Sunice\stock з архівом надісланого."
