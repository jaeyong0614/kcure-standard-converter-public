# K-CURE converter (LLM build) local server for PCs without Python.
# Serves only the *_LLM.html file in this folder at http://localhost:<Port>/ (GET only, this PC only).
# Ollama accepts requests from http://localhost by default, so OLLAMA_ORIGINS does not need to change.
param([int]$Port = 8770)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$page = Get-ChildItem -LiteralPath $dir -Filter '*_LLM.html' | Select-Object -First 1
if (-not $page) { Write-Host 'LLM html file not found next to this script.'; Read-Host 'Press Enter'; exit 1 }
$bytes = [System.IO.File]::ReadAllBytes($page.FullName)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Host "Port $Port is busy. Close the other server window and try again."; Read-Host 'Press Enter'; exit 1 }
Write-Host "K-CURE LLM server: http://localhost:$Port/  (close this window to stop)"
Start-Process "http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  if ($ctx.Request.HttpMethod -ne 'GET' -or $ctx.Request.Url.AbsolutePath -ne '/') { $res.StatusCode = 404; $res.Close(); continue }
  $res.ContentType = 'text/html; charset=utf-8'
  $res.Headers.Add('Cache-Control', 'no-store')
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}
