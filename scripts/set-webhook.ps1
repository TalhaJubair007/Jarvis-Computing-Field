$ErrorActionPreference = 'Stop'
$BotTokenSecure = Read-Host 'BotFather bot token (input is hidden)' -AsSecureString
$TokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($BotTokenSecure)
try { $BotToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPtr) }
$GatewayUrl = (Read-Host 'Gateway URL (example: https://jarvis-telegram-gateway.YOUR-SUBDOMAIN.workers.dev)').TrimEnd('/')
$WebhookSecret = Read-Host 'TELEGRAM_WEBHOOK_SECRET configured in Cloudflare'
if (-not $BotToken -or -not $GatewayUrl.StartsWith('https://') -or -not $WebhookSecret) {
  throw 'Bot token, HTTPS gateway URL and webhook secret are required.'
}
if ($WebhookSecret -notmatch '^[A-Za-z0-9_-]{32,256}$') {
  throw 'Webhook secret must be 32-256 characters using only letters, digits, underscore or hyphen.'
}
$Body = @{
  url = "$GatewayUrl/telegram"
  secret_token = $WebhookSecret
  allowed_updates = '["message"]'
  max_connections = '5'
}
$Result = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$BotToken/setWebhook" -Body $Body
if (-not $Result.ok) { throw 'Telegram did not accept the webhook.' }
Write-Host 'Telegram webhook configured.' -ForegroundColor Green
Write-Host "Gateway health: $GatewayUrl/health"
Write-Host 'Next: send /start to your bot.'
