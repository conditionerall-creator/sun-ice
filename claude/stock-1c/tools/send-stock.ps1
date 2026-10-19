# send-stock.ps1 — відправляє файли залишків з 1С у застосунок Sun-ice.
#
# ЩО РОБИТЬ: дивиться в папку OUTBOX, бере кожен .xlsx і надсилає POST-запитом на stock-sync.
#   Прийнято   -> файл переїжджає в \sent
#   Відхилено  -> файл переїжджає в \rejected (причина — в журналі)
#   5xx        -> файл лишається на місці, спробуємо наступного разу
# Усе пишеться в send-stock.log поруч зі скриптом. Токен на екран ніколи не виводиться.
#
# НАЛАШТУВАННЯ (один раз):
#   1. Створити папку C:\Sunice\stock (або свою — див. $Outbox нижче).
#   2. Покласти поруч зі скриптом файл token.txt з токеном (більше нічого в ньому).
#   3. Перевірити вручну:  powershell -ExecutionPolicy Bypass -File send-stock.ps1 -DryRun
#   4. Поставити в Планувальник Windows на кожні 5 хвилин (без -DryRun).

param(
    [switch]$DryRun,                                   # перевірка без запису в базу застосунку
    [string]$Outbox    = 'C:\Sunice\stock',
    [string]$TokenFile = (Join-Path $PSScriptRoot 'token.txt'),
    [string]$Url       = 'https://pwyeifgjfyymhhvzigcg.supabase.co/functions/v1/stock-sync'
)

$ErrorActionPreference = 'Stop'
$LogFile = Join-Path $PSScriptRoot 'send-stock.log'

function Write-Log([string]$Text) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Output $line
}

try {
    if (-not (Test-Path $TokenFile)) { throw "Немає файлу з токеном: $TokenFile" }
    $token = (Get-Content $TokenFile -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($token)) { throw "Файл з токеном порожній: $TokenFile" }

    foreach ($sub in @($Outbox, (Join-Path $Outbox 'sent'), (Join-Path $Outbox 'rejected'))) {
        if (-not (Test-Path $sub)) { New-Item -ItemType Directory -Path $sub -Force | Out-Null }
    }

    # Тимчасові файли Excel (~$...) і щойно створені (ще дописуються) не чіпаємо.
    $files = Get-ChildItem -Path $Outbox -Filter '*.xlsx' -File |
             Where-Object { $_.Name -notlike '~$*' -and $_.LastWriteTime -lt (Get-Date).AddSeconds(-15) } |
             Sort-Object LastWriteTime

    if ($files.Count -eq 0) { exit 0 }     # мовчки виходимо, щоб не засмічувати журнал

    $target = if ($DryRun) { "$Url`?dry_run=1" } else { $Url }

    foreach ($f in $files) {
        $bodyFile = [System.IO.Path]::GetTempFileName()
        try {
            $code = & curl.exe -s -S -m 120 -o $bodyFile -w '%{http_code}' `
                        -X POST $target `
                        -H "Authorization: Bearer $token" `
                        -H 'Content-Type: application/octet-stream' `
                        --data-binary "@$($f.FullName)" 2>&1

            $body = if (Test-Path $bodyFile) { (Get-Content $bodyFile -Raw) } else { '' }
            Write-Log ("{0} -> HTTP {1} {2}" -f $f.Name, $code, $body.Trim())

            if ($DryRun) { continue }      # у пробному режимі файли не чіпаємо

            if ($code -eq '200') {
                Move-Item $f.FullName (Join-Path $Outbox ('sent\' + $f.Name)) -Force
            }
            elseif ($code -match '^[45]' -and $code -notmatch '^5') {
                # 400/401/413/422 — повторювати тим самим файлом немає сенсу
                Move-Item $f.FullName (Join-Path $Outbox ('rejected\' + $f.Name)) -Force
            }
            # 5xx або порожній код (мережа) — лишаємо файл на місці до наступного запуску
        }
        finally {
            Remove-Item $bodyFile -ErrorAction SilentlyContinue
        }
    }
}
catch {
    Write-Log ("ПОМИЛКА: " + $_.Exception.Message)
    exit 1
}
