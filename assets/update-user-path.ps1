param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Add', 'Remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$PathEntry
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-PathEntry {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Value
  )

  $trimmed = $Value.Trim().Trim('"')
  if (-not $trimmed) {
    return ''
  }

  try {
    return [System.IO.Path]::GetFullPath($trimmed)
  } catch {
    return $trimmed
  }
}

$resolvedPathEntry = Normalize-PathEntry -Value $PathEntry
if (-not $resolvedPathEntry) {
  exit 0
}

$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$segments = @()

if ($currentPath) {
  $segments = $currentPath -split ';'
}

$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$filteredSegments = New-Object 'System.Collections.Generic.List[string]'

foreach ($segment in $segments) {
  $trimmedSegment = $segment.Trim()
  if (-not $trimmedSegment) {
    continue
  }

  $normalizedSegment = Normalize-PathEntry -Value $trimmedSegment
  if ($normalizedSegment -eq $resolvedPathEntry) {
    continue
  }

  if ($seen.Add($normalizedSegment)) {
    [void]$filteredSegments.Add($trimmedSegment)
  }
}

if ($Action -eq 'Add' -and -not $seen.Contains($resolvedPathEntry)) {
  [void]$filteredSegments.Add($resolvedPathEntry)
}

$nextPath = ($filteredSegments -join ';')
[Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')

Add-Type -Namespace Native -Name User32 -MemberDefinition @'
using System;
using System.Runtime.InteropServices;

public static class User32 {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    uint Msg,
    UIntPtr wParam,
    string lParam,
    uint fuFlags,
    uint uTimeout,
    out UIntPtr lpdwResult
  );
}
'@

$result = [UIntPtr]::Zero
[void][Native.User32]::SendMessageTimeout(
  [IntPtr]0xffff,
  0x001A,
  [UIntPtr]::Zero,
  'Environment',
  0x0002,
  5000,
  [ref]$result
)
