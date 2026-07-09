# Signals the Chrome extension to scrape usage data immediately.
# Called by Rainmeter when the user clicks "Refresh".
Set-Content -Path (Join-Path $PSScriptRoot "refresh_requested.txt") -Value "1" -Encoding UTF8
