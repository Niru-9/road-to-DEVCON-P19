# Bounded runtime smoke check for P1 (PowerShell 5.1).
#
#   pwsh -File scripts/smoke-server.ps1          # default deadline 30 s
#   pwsh -File scripts/smoke-server.ps1 -DeadlineSeconds 45
#
# Why this exists: a long-running server is SUPPOSED to stay alive, so "the process has not
# exited" is not evidence of a hang. The only reliable signal is its documented health
# endpoint. This script therefore:
#
#   1. starts `npm start` DETACHED (Start-Process without -NoNewWindow) so the calling shell
#      is never held open by the child - that was the actual cause of the earlier "it looks
#      like it hangs" report, not a server fault;
#   2. captures stdout and stderr to separate log files;
#   3. polls /api/health until it answers or an EXPLICIT deadline passes - the loop is bounded
#      by a wall-clock deadline, never by iteration count alone;
#   4. reports exactly one of READY / FAILED / TIMED OUT, with the observed latency;
#   5. always stops the process tree it started, and verifies the port was released.
#
# Secrets: every setting is passed through the process environment. Nothing is written to a
# tracked file, and no .env file is created, read for values, or overwritten. The RPC default
# used here is a PUBLIC endpoint, which is not a credential.
#
# This exercises the clearly labelled sample/fixture path (ALLOW_DEMO_FIXTURES=true). It is
# NOT live ENS verification.

param(
  [int]$DeadlineSeconds = 30,
  # Leaves the server up after the health check, for an interactive UI review. The process is
  # still DETACHED with logs captured, and -StopServer tears it down again.
  [switch]$KeepRunning,
  # Stops a server previously left running by -KeepRunning. Touches nothing else.
  [switch]$StopServer
)

$ErrorActionPreference = 'Continue'

function Stop-P1Server {
  $stopped = 0
  # Matched on the server entrypoint only, so nothing else in this repo can be hit.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*src/server/index.ts*' } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $stopped++ } catch {}
    }
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
    Where-Object { $_.CommandLine -like '*npm*start*' -and $_.CommandLine -like '*node*' } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $stopped++ } catch {}
    }
  Start-Sleep -Seconds 1
  return $stopped
}

if ($StopServer) {
  $n = Stop-P1Server
  $held = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
  Write-Output ("stopped {0} process(es); port 8787 {1}" -f $n, $(if ($held) { 'STILL HELD' } else { 'released' }))
  exit $(if ($held) { 1 } else { 0 })
}

$repo = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $env:TEMP ("p1-smoke-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$outLog = Join-Path $tmp 'server.out.log'
$errLog = Join-Path $tmp 'server.err.log'

# Public Sepolia RPC - not a secret. Override in the environment if you prefer another.
if (-not $env:SEPOLIA_RPC_URL) { $env:SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com' }
# Exercises the labelled fixture path only. Never counts as live ENS evidence.
$env:ALLOW_DEMO_FIXTURES = 'true'

Write-Output "repo            : $repo"
Write-Output "logs            : $tmp"
Write-Output "deadline        : $DeadlineSeconds s"
Write-Output ''

# Detached on purpose. -NoNewWindow would keep the child attached to this console and make a
# healthy server look like a hung command.
$proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $repo `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden

$started  = Get-Date
$deadline = $started.AddSeconds($DeadlineSeconds)
$ready    = $false
$timedOut = $false
$lastErr  = ''

while ((Get-Date) -lt $deadline) {
  if ($proc.HasExited) { break }
  try {
    $health = Invoke-RestMethod -Uri 'http://localhost:8787/api/health' -TimeoutSec 3
    $ready = $true
    break
  } catch {
    $lastErr = $_.Exception.Message
    Start-Sleep -Milliseconds 400
  }
}
if (-not $ready -and -not $proc.HasExited) { $timedOut = $true }
$elapsed = [int]((Get-Date) - $started).TotalMilliseconds

Write-Output '---------------- RESULT ----------------'
if ($ready) {
  Write-Output ("verdict         : READY after {0} ms" -f $elapsed)
  Write-Output ("ok={0} chain={1} chainId={2}" -f $health.ok, $health.chain, $health.chainId)
  Write-Output ("providerHost={0} model={1} timeoutMs={2} hasApiKey={3}" -f `
    $health.config.providerHost, $health.config.model, $health.config.timeoutMs, $health.config.hasApiKey)
  Write-Output ("rpcHost={0} samplesEnabled={1}" -f $health.config.rpcHost, $health.config.allowDemoFixtures)
} elseif ($proc.HasExited) {
  Write-Output ("verdict         : FAILED - process exited with code {0} after {1} ms" -f $proc.ExitCode, $elapsed)
} else {
  Write-Output ("verdict         : TIMED OUT - never healthy within {0} s" -f $DeadlineSeconds)
  Write-Output ("last error      : {0}" -f $lastErr)
}
Write-Output ''
Write-Output '---------------- server stdout ----------------'
if (Test-Path $outLog) { Get-Content $outLog }
Write-Output '---------------- server stderr ----------------'
if (Test-Path $errLog) { Get-Content $errLog }

if ($KeepRunning) {
  Write-Output ''
  Write-Output 'kept running   : yes - left up for the UI review'
  Write-Output ("logs            : {0}" -f $tmp)
  Write-Output 'stop it with   : powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-server.ps1 -StopServer'
} else {
  $n = Stop-P1Server
  Write-Output ''
  Write-Output ("teardown        : stopped {0} process(es)" -f $n)
  $stillListening = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
  if ($stillListening) { Write-Output 'teardown        : FAILED - port 8787 still held' } else { Write-Output 'teardown        : clean - port 8787 released' }
}

if ($ready) { exit 0 } else { exit 1 }