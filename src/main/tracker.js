const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const { execFile, fork } = require('child_process');
const { promisify } = require('util');
const { getDomain } = require('tldts');

const DATA_VERSION = 3;
const POLL_INTERVAL_MS = 5000;
const SAVE_DEBOUNCE_MS = 1200;
const BROWSER_EVENT_TTL_MS = 65000;
const BROWSER_EXTENSION_HEARTBEAT_TTL_MS = 125000;
const MAX_BRIDGE_REQUEST_BYTES = 16 * 1024;
const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = 32123;
const BRIDGE_SHARED_HEADER_NAME = 'x-app-usage-tracker-bridge';
const BRIDGE_SHARED_HEADER_VALUE = 'usage-tracker-extension';
const BRIDGE_ENDPOINT_BROWSER_EVENT = '/v1/browser-event';
const BRIDGE_ENDPOINT_EXTENSION_HEARTBEAT = '/v1/extension-heartbeat';
const ALLOWED_BRIDGE_ORIGIN_PREFIXES = ['chrome-extension://', 'moz-extension://'];
const SMTC_COMMAND_TIMEOUT_MS = 4500;
const SMTC_MAX_BUFFER_BYTES = 256 * 1024;
const WASAPI_COMMAND_TIMEOUT_MS = 6500;
const WASAPI_MAX_BUFFER_BYTES = 256 * 1024;
const MEDIA_HELPER_RESTART_DELAY_MS = 1500;
const SMTC_PLAYBACK_STATUS_PLAYING = 'Playing';
const SMTC_PLAYBACK_TYPE_MUSIC = 'Music';
const AUDIO_SESSION_STATE_ACTIVE = 'Active';
let activeWinLoader = null;
const execFileAsync = promisify(execFile);
const WINDOWS_POWERSHELL_PATH = process.platform === 'win32'
  ? path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : '';
const MEDIA_SESSION_HELPER_PATH = path.join(__dirname, 'media-session-helper.js');

const SMTC_SNAPSHOT_COMMAND = Buffer.from(`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await-WinRt($Operation, $ResultType) {
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1

  $netTask = $asTaskMethod.MakeGenericMethod(@($ResultType)).Invoke($null, @($Operation))
  $netTask.Wait(${SMTC_COMMAND_TIMEOUT_MS}) | Out-Null
  return $netTask.GetType().GetProperty('Result').GetValue($netTask)
}

try {
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType=WindowsRuntime]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media, ContentType=WindowsRuntime]
  $manager = Await-WinRt ($managerType::RequestAsync()) $managerType
  $result = @()

  if ($manager) {
    foreach ($session in @($manager.GetSessions())) {
      try {
        $playbackInfo = $session.GetPlaybackInfo()
        $mediaProps = Await-WinRt ($session.TryGetMediaPropertiesAsync()) $propsType

        $result += [ordered]@{
          sourceAppUserModelId = [string]$session.SourceAppUserModelId
          playbackStatus = [string]$playbackInfo.PlaybackStatus
          playbackType = [string]$mediaProps.PlaybackType
          title = [string]$mediaProps.Title
          artist = [string]$mediaProps.Artist
          albumTitle = [string]$mediaProps.AlbumTitle
        }
      } catch {
        # Ignore projection failures for individual sessions.
      }
    }
  }

  if ($result.Count -eq 0) {
    '[]'
  } else {
    ConvertTo-Json -Compress -Depth 4 -InputObject @($result)
  }
} catch {
  '[]'
}
`, 'utf16le').toString('base64');

const WASAPI_SNAPSHOT_COMMAND = Buffer.from(`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$source = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class WasapiSessionProbe
{
    public static List<AudioSessionSnapshot> Collect()
    {
        var result = new List<AudioSessionSnapshot>();
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice device;
        int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
        if (hr != 0 || device == null)
        {
            return result;
        }

        string endpointId = string.Empty;
        try { device.GetId(out endpointId); } catch { }

        object managerObject;
        var managerGuid = typeof(IAudioSessionManager2).GUID;
        if (device.Activate(ref managerGuid, CLSCTX.ALL, IntPtr.Zero, out managerObject) != 0 || managerObject == null)
        {
            return result;
        }

        var manager = (IAudioSessionManager2)managerObject;
        IAudioSessionEnumerator sessionEnumerator;
        if (manager.GetSessionEnumerator(out sessionEnumerator) != 0 || sessionEnumerator == null)
        {
            return result;
        }

        int sessionCount;
        sessionEnumerator.GetCount(out sessionCount);
        for (int sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++)
        {
            IAudioSessionControl sessionControl;
            if (sessionEnumerator.GetSession(sessionIndex, out sessionControl) != 0 || sessionControl == null)
            {
                continue;
            }

            AudioSessionState state;
            sessionControl.GetState(out state);

            string displayName = string.Empty;
            string iconPath = string.Empty;
            try { sessionControl.GetDisplayName(out displayName); } catch { }
            try { sessionControl.GetIconPath(out iconPath); } catch { }

            uint processId = 0;
            string sessionIdentifier = string.Empty;
            string sessionInstanceIdentifier = string.Empty;
            var sessionControl2 = sessionControl as IAudioSessionControl2;
            if (sessionControl2 != null)
            {
                try { sessionControl2.GetProcessId(out processId); } catch { }
                try { sessionControl2.GetSessionIdentifier(out sessionIdentifier); } catch { }
                try { sessionControl2.GetSessionInstanceIdentifier(out sessionInstanceIdentifier); } catch { }
            }

            float peakValue = 0;
            var meter = sessionControl as IAudioMeterInformation;
            if (meter != null)
            {
                try { meter.GetPeakValue(out peakValue); } catch { }
            }

            bool isMuted = false;
            var volume = sessionControl as ISimpleAudioVolume;
            if (volume != null)
            {
                try { volume.GetMute(out isMuted); } catch { }
            }

            string processName = string.Empty;
            string executablePath = string.Empty;
            if (processId > 0)
            {
                try
                {
                    var process = Process.GetProcessById((int)processId);
                    processName = process.ProcessName ?? string.Empty;
                    try { executablePath = process.MainModule != null ? (process.MainModule.FileName ?? string.Empty) : string.Empty; } catch { }
                }
                catch { }
            }

            result.Add(new AudioSessionSnapshot
            {
                EndpointId = endpointId ?? string.Empty,
                State = state.ToString(),
                PeakValue = peakValue,
                IsMuted = isMuted,
                ProcessId = processId,
                ProcessName = processName ?? string.Empty,
                ExecutablePath = executablePath ?? string.Empty,
                SessionIdentifier = sessionIdentifier ?? string.Empty,
                SessionInstanceIdentifier = sessionInstanceIdentifier ?? string.Empty,
                DisplayName = displayName ?? string.Empty,
                IconPath = iconPath ?? string.Empty
            });
        }

        return result;
    }
}

public class AudioSessionSnapshot
{
    public string EndpointId { get; set; }
    public string State { get; set; }
    public float PeakValue { get; set; }
    public bool IsMuted { get; set; }
    public uint ProcessId { get; set; }
    public string ProcessName { get; set; }
    public string ExecutablePath { get; set; }
    public string SessionIdentifier { get; set; }
    public string SessionInstanceIdentifier { get; set; }
    public string DisplayName { get; set; }
    public string IconPath { get; set; }
}

public enum EDataFlow
{
    eRender,
    eCapture,
    eAll,
    EDataFlow_enum_count
}

public enum ERole
{
    eConsole,
    eMultimedia,
    eCommunications,
    ERole_enum_count
}

public enum AudioSessionState
{
    Inactive = 0,
    Active = 1,
    Expired = 2
}

public enum CLSCTX : uint
{
    INPROC_SERVER = 0x1,
    INPROC_HANDLER = 0x2,
    LOCAL_SERVER = 0x4,
    REMOTE_SERVER = 0x10,
    ALL = INPROC_SERVER | INPROC_HANDLER | LOCAL_SERVER | REMOTE_SERVER
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject
{
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out object ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, CLSCTX dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.Interface)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    [PreserveSig] int GetState(out uint pdwState);
}

[Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager
{
    [PreserveSig] int GetAudioSessionControl(ref Guid AudioSessionGuid, uint StreamFlags, out IAudioSessionControl SessionControl);
    [PreserveSig] int GetSimpleAudioVolume(ref Guid AudioSessionGuid, uint StreamFlags, out ISimpleAudioVolume AudioVolume);
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager2 : IAudioSessionManager
{
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
    [PreserveSig] int RegisterSessionNotification(IntPtr SessionNotification);
    [PreserveSig] int UnregisterSessionNotification(IntPtr SessionNotification);
    [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionID, IntPtr duckNotification);
    [PreserveSig] int UnregisterDuckNotification(IntPtr duckNotification);
}

[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEnumerator
{
    [PreserveSig] int GetCount(out int SessionCount);
    [PreserveSig] int GetSession(int SessionCount, out IAudioSessionControl Session);
}

[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl
{
    [PreserveSig] int GetState(out AudioSessionState pRetVal);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    [PreserveSig] int GetGroupingParam(out Guid pRetVal);
    [PreserveSig] int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr NewNotifications);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr NewNotifications);
}

[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl2 : IAudioSessionControl
{
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    [PreserveSig] int GetProcessId(out uint pRetVal);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISimpleAudioVolume
{
    [PreserveSig] int SetMasterVolume(float fLevel, ref Guid EventContext);
    [PreserveSig] int GetMasterVolume(out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation
{
    [PreserveSig] int GetPeakValue(out float pfPeak);
    [PreserveSig] int GetMeteringChannelCount(out int pnChannelCount);
    [PreserveSig] int GetChannelsPeakValues(int u32ChannelCount, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] float[] afPeakValues);
    [PreserveSig] int QueryHardwareSupport(out int pdwHardwareSupportMask);
}
"@

try {
  Add-Type -TypeDefinition $source -Language CSharp
  $result = [WasapiSessionProbe]::Collect()
  if ($result.Count -eq 0) {
    '[]'
  } else {
    ConvertTo-Json -Compress -Depth 4 -InputObject @($result)
  }
} catch {
  '[]'
}
`, 'utf16le').toString('base64');

const BROWSER_APP_PATTERNS = [
  { family: 'Chrome', names: ['chrome', 'google chrome'] },
  { family: 'Edge', names: ['msedge', 'microsoft edge'] },
  { family: 'Brave', names: ['brave', 'brave browser'] },
  { family: 'Opera', names: ['opera'] },
  { family: 'Firefox', names: ['firefox'] }
];

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function getDayKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.replace(/\s+/g, ' ').trim() || fallback;
}

function toIdSegment(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function getColorFromKey(key) {
  const colors = ['#1c8cff', '#22c55e', '#ef4444', '#f59e0b', '#a855f7', '#06b6d4', '#fb7185'];
  const value = parseInt(hashString(key).slice(0, 2), 16);
  return colors[value % colors.length];
}

function ensureArray24(source) {
  const result = new Array(24).fill(0);
  if (Array.isArray(source)) {
    for (let index = 0; index < Math.min(source.length, 24); index += 1) {
      result[index] = Number(source[index]) || 0;
    }
  }

  return result;
}

function normalizeUrl(rawUrl) {
  try {
    const value = new URL(rawUrl);
    value.hash = '';
    return value;
  } catch {
    return null;
  }
}

function isIpHost(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function getRootDomain(hostname) {
  const normalized = sanitizeText(hostname).toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return '';
  }

  if (normalized === 'localhost' || isIpHost(normalized)) {
    return normalized;
  }

  return getDomain(normalized, { allowPrivateDomains: true }) || normalized;
}

function isAllowedBridgeOrigin(origin) {
  const normalizedOrigin = sanitizeText(origin).toLowerCase();
  if (!normalizedOrigin) {
    return false;
  }

  return ALLOWED_BRIDGE_ORIGIN_PREFIXES.some((prefix) => normalizedOrigin.startsWith(prefix));
}

function getBridgeResponseHeaders(origin, extraHeaders = {}) {
  const headers = {
    Vary: 'Origin',
    ...extraHeaders
  };

  if (isAllowedBridgeOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function hasJsonContentType(contentType) {
  return sanitizeText(contentType).toLowerCase().startsWith('application/json');
}

function isBridgeRequestAuthorized(headers) {
  return isAllowedBridgeOrigin(headers?.origin)
    && headers?.[BRIDGE_SHARED_HEADER_NAME] === BRIDGE_SHARED_HEADER_VALUE
    && hasJsonContentType(headers?.['content-type']);
}

function getDomainDisplayName(hostname) {
  const rootDomain = getRootDomain(hostname);
  if (!rootDomain) {
    return '网页';
  }

  const [firstLabel] = rootDomain.split('.');
  return sanitizeText(firstLabel, rootDomain).toLowerCase();
}

function normalizeComparableToken(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function getExecutableName(executablePath) {
  const normalized = sanitizeText(executablePath);
  if (!normalized) {
    return '';
  }

  try {
    return path.basename(normalized).toLowerCase();
  } catch {
    const segments = normalized.split(/[\\/]/);
    return sanitizeText(segments[segments.length - 1]).toLowerCase();
  }
}

function stripExecutableExtension(value) {
  return sanitizeText(value).replace(/\.(exe|app)$/i, '');
}

function getExecutableToken(value) {
  const executableName = getExecutableName(value) || sanitizeText(value);
  return normalizeComparableToken(stripExecutableExtension(executableName));
}

function getSourceAppUserModelIdToken(value) {
  return normalizeComparableToken(sanitizeText(value).split('!')[0]);
}

function buildMediaSubtitle({ title, artist, fallback = '' }) {
  const normalizedTitle = sanitizeText(title);
  const normalizedArtist = sanitizeText(artist);
  if (normalizedArtist && normalizedTitle) {
    return `${normalizedArtist} - ${normalizedTitle}`;
  }

  return normalizedTitle || normalizedArtist || sanitizeText(fallback);
}

function humanizeMusicAppName(value) {
  const rawValue = sanitizeText(value);
  if (!rawValue) {
    return '音乐播放';
  }

  const withoutAppId = rawValue.split('!')[0];
  const baseName = withoutAppId.split(/[\\/]/).pop() || withoutAppId;
  const withoutExtension = stripExecutableExtension(baseName);
  const candidate = withoutExtension.split('.').filter(Boolean).pop() || withoutExtension;
  const spaced = candidate
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();

  return spaced || rawValue;
}

const SERVICE_PROFILES = [
  {
    id: 'chatgpt',
    displayLabel: 'ChatGPT',
    domains: ['chatgpt.com'],
    appNames: ['chatgpt', 'openai chatgpt'],
    executables: ['chatgpt.exe']
  },
  {
    id: 'bilibili',
    displayLabel: 'bilibili',
    domains: ['bilibili.com'],
    appNames: ['bilibili', '哔哩哔哩'],
    executables: ['bilibili.exe']
  }
].map((profile) => ({
  ...profile,
  appTokens: profile.appNames.map((value) => normalizeComparableToken(value)).filter(Boolean),
  executableTokens: profile.executables.map((value) => normalizeComparableToken(value)).filter(Boolean)
}));

const MUSIC_APP_PROFILES = [
  {
    id: 'qqmusic',
    displayLabel: 'QQ音乐',
    aliases: ['QQMusic', 'QQ 音乐', 'QQ音乐', 'QQMusic.exe']
  },
  {
    id: 'netease-cloud-music',
    displayLabel: '网易云音乐',
    aliases: ['CloudMusic', 'Netease Cloud Music', '网易云音乐', 'cloudmusic.exe']
  },
  {
    id: 'spotify',
    displayLabel: 'Spotify',
    aliases: ['Spotify', 'spotify.exe']
  },
  {
    id: 'apple-music',
    displayLabel: 'Apple Music',
    aliases: ['Apple Music', 'AppleMusic', 'AppleMusic.exe', 'AppleMusicWin']
  },
  {
    id: 'kugou',
    displayLabel: '酷狗音乐',
    aliases: ['KuGou', 'KuGou Music', '酷狗音乐', 'KuGou.exe']
  },
  {
    id: 'kuwo',
    displayLabel: '酷我音乐',
    aliases: ['Kuwo', 'Kuwo Music', '酷我音乐', 'KwMusic.exe']
  },
  {
    id: 'foobar2000',
    displayLabel: 'foobar2000',
    aliases: ['foobar2000', 'foobar2000.exe']
  },
  {
    id: 'musicbee',
    displayLabel: 'MusicBee',
    aliases: ['MusicBee', 'MusicBee.exe']
  },
  {
    id: 'aimp',
    displayLabel: 'AIMP',
    aliases: ['AIMP', 'AIMP.exe']
  }
].map((profile) => ({
  ...profile,
  matchTokens: [...new Set(profile.aliases.map((value) => normalizeComparableToken(stripExecutableExtension(value))).filter(Boolean))]
}));

function getBrowserFamily(appName) {
  const normalized = sanitizeText(appName).toLowerCase();
  const match = BROWSER_APP_PATTERNS.find((pattern) => pattern.names.includes(normalized));
  return match ? match.family : null;
}

function isBrowserApp(appName) {
  return Boolean(getBrowserFamily(appName));
}

function isBrowserSourceAppUserModelId(sourceAppUserModelId) {
  const normalized = getSourceAppUserModelIdToken(sourceAppUserModelId);
  if (!normalized) {
    return false;
  }

  return BROWSER_APP_PATTERNS.some((pattern) => pattern.names.some((name) => normalized.includes(normalizeComparableToken(name))));
}

function findMusicAppProfile(entry) {
  if (!entry) {
    return null;
  }

  const tokens = new Set([
    normalizeComparableToken(entry.appName),
    normalizeComparableToken(entry.label),
    normalizeComparableToken(entry.processName),
    normalizeComparableToken(entry.displayName),
    getExecutableToken(entry.executablePath),
    getExecutableToken(entry.sourceAppUserModelId)
  ].filter(Boolean));
  const sourceAppToken = getSourceAppUserModelIdToken(entry.sourceAppUserModelId);

  return MUSIC_APP_PROFILES.find((profile) => profile.matchTokens.some((token) => {
    if (tokens.has(token)) {
      return true;
    }

    return Boolean(sourceAppToken) && sourceAppToken.includes(token);
  })) || null;
}

function findServiceProfile(entry) {
  if (!entry) {
    return null;
  }

  const normalizedUrl = normalizeUrl(entry.url || '');
  const rootDomain = getRootDomain(entry.host || normalizedUrl?.hostname || '');
  const tokens = new Set([
    normalizeComparableToken(entry.appName),
    normalizeComparableToken(entry.label),
    normalizeComparableToken(getExecutableName(entry.executablePath))
  ].filter(Boolean));

  return SERVICE_PROFILES.find((profile) => {
    if (rootDomain && profile.domains.includes(rootDomain)) {
      return true;
    }

    return profile.appTokens.some((token) => tokens.has(token))
      || profile.executableTokens.some((token) => tokens.has(token));
  }) || null;
}

function canonicalizeEntry(entry) {
  const profile = findServiceProfile(entry);
  if (!profile) {
    return entry;
  }

  const key = `service:${profile.id}`;
  const isBrowserBacked = isBrowserApp(entry.appName) || Boolean(entry.browserFamily);
  return {
    ...entry,
    key,
    kind: 'service',
    label: profile.displayLabel,
    appName: profile.displayLabel,
    host: sanitizeText(entry.host, profile.domains[0] || ''),
    executablePath: isBrowserBacked ? '' : sanitizeText(entry.executablePath),
    color: getColorFromKey(key)
  };
}

function cloneItem(item) {
  return {
    ...item,
    hourly: [...item.hourly]
  };
}

function clonePlaybackCandidate(item) {
  return {
    ...item,
    providers: Array.isArray(item?.providers) ? [...item.providers] : []
  };
}

function clonePlaybackCandidateList(items) {
  return (Array.isArray(items) ? items : []).map((item) => clonePlaybackCandidate(item));
}

async function getActiveWindow() {
  if (!activeWinLoader) {
    activeWinLoader = import('active-win').then((module) => {
      if (typeof module.activeWindow === 'function') {
        return module.activeWindow;
      }

      if (module.default && typeof module.default.activeWindow === 'function') {
        return module.default.activeWindow;
      }

      if (typeof module.default === 'function') {
        return module.default;
      }

      throw new Error('active-win 导出格式不符合预期');
    });
  }

  const resolver = await activeWinLoader;
  return resolver();
}

class BrowserEventCache {
  constructor({
    eventTtlMs = BROWSER_EVENT_TTL_MS,
    heartbeatTtlMs = BROWSER_EXTENSION_HEARTBEAT_TTL_MS
  } = {}) {
    this.eventTtlMs = eventTtlMs;
    this.heartbeatTtlMs = heartbeatTtlMs;
    this.events = new Map();
    this.extensionStates = new Map();
  }

  upsert(payload) {
    const browserFamily = sanitizeText(payload.browserFamily, 'Chrome');
    const receivedAt = Date.now();
    this.markExtensionSeen({
      browserFamily,
      extensionVersion: payload.extensionVersion,
      sentAt: payload.sentAt,
      receivedAt,
      source: 'browser-event'
    });

    const normalizedUrl = normalizeUrl(payload.url);
    if (!normalizedUrl) {
      return null;
    }

    const key = browserFamily.toLowerCase();
    this.events.set(key, {
      browserFamily,
      pageTitle: sanitizeText(payload.pageTitle, normalizedUrl.hostname),
      url: normalizedUrl.toString(),
      host: normalizedUrl.hostname,
      rootDomain: getRootDomain(normalizedUrl.hostname),
      displayName: getDomainDisplayName(normalizedUrl.hostname),
      path: normalizedUrl.pathname || '/',
      receivedAt
    });

    return this.events.get(key);
  }

  upsertHeartbeat(payload) {
    return this.markExtensionSeen({
      browserFamily: sanitizeText(payload.browserFamily, 'Chrome'),
      extensionVersion: payload.extensionVersion,
      sentAt: payload.sentAt,
      receivedAt: Date.now(),
      source: 'heartbeat'
    });
  }

  markExtensionSeen({
    browserFamily,
    extensionVersion = '',
    sentAt = 0,
    receivedAt = Date.now(),
    source = ''
  }) {
    const normalizedBrowserFamily = sanitizeText(browserFamily, 'Chrome');
    if (!normalizedBrowserFamily) {
      return null;
    }

    const key = normalizedBrowserFamily.toLowerCase();
    const existing = this.extensionStates.get(key);
    const normalizedSentAt = Number(sentAt) || receivedAt;
    this.extensionStates.set(key, {
      browserFamily: normalizedBrowserFamily,
      extensionVersion: sanitizeText(extensionVersion, existing?.extensionVersion || ''),
      lastSeenAt: Number(receivedAt) || Date.now(),
      lastSentAt: normalizedSentAt,
      source: sanitizeText(source, existing?.source || '')
    });

    return this.extensionStates.get(key);
  }

  getFresh(browserFamily) {
    const key = sanitizeText(browserFamily).toLowerCase();
    const event = this.events.get(key);
    if (!event) {
      return null;
    }

    if (Date.now() - event.receivedAt > this.eventTtlMs) {
      this.events.delete(key);
      return null;
    }

    return event;
  }

  getExtensionStatus() {
    const now = Date.now();
    const browsers = [...this.extensionStates.values()]
      .map((entry) => ({
        browserFamily: entry.browserFamily,
        extensionVersion: entry.extensionVersion,
        lastSeenAt: Number(entry.lastSeenAt) || 0,
        lastSentAt: Number(entry.lastSentAt) || 0,
        source: entry.source,
        ageMs: Math.max(now - (Number(entry.lastSeenAt) || 0), 0),
        isActive: now - (Number(entry.lastSeenAt) || 0) <= this.heartbeatTtlMs
      }))
      .sort((left, right) => {
        if (right.lastSeenAt !== left.lastSeenAt) {
          return right.lastSeenAt - left.lastSeenAt;
        }

        return left.browserFamily.localeCompare(right.browserFamily, 'en');
      });

    const activeBrowsers = browsers
      .filter((entry) => entry.isActive)
      .map((entry) => entry.browserFamily);

    return {
      status: activeBrowsers.length ? 'connected' : 'missing',
      staleAfterMs: this.heartbeatTtlMs,
      activeBrowsers,
      seenBrowsers: browsers.map((entry) => entry.browserFamily),
      latestHeartbeatAt: browsers[0]?.lastSeenAt || 0,
      browsers
    };
  }
}

function createEmptyData() {
  return { version: DATA_VERSION, days: {} };
}

function cloneStoredItem(item) {
  return {
    ...item,
    hourly: ensureArray24(item.hourly),
    totalMs: Number(item.totalMs) || 0,
    lastSeenAt: Number(item.lastSeenAt) || 0,
    trackingMode: sanitizeText(item.trackingMode),
    trackingSource: sanitizeText(item.trackingSource),
    sourceAppUserModelId: sanitizeText(item.sourceAppUserModelId),
    mediaTitle: sanitizeText(item.mediaTitle),
    mediaArtist: sanitizeText(item.mediaArtist),
    mediaAlbumTitle: sanitizeText(item.mediaAlbumTitle),
    playbackStatus: sanitizeText(item.playbackStatus),
    playbackType: sanitizeText(item.playbackType),
    processId: Number(item.processId) || 0,
    processName: sanitizeText(item.processName),
    audioSessionState: sanitizeText(item.audioSessionState),
    audioPeakValue: Number(item.audioPeakValue) || 0,
    audioIsMuted: Boolean(item.audioIsMuted),
    audioEndpointId: sanitizeText(item.audioEndpointId),
    audioSessionIdentifier: sanitizeText(item.audioSessionIdentifier),
    audioSessionInstanceIdentifier: sanitizeText(item.audioSessionInstanceIdentifier)
  };
}

function isBrowserUsageItem(item) {
  if (!item) {
    return false;
  }

  if (item.kind === 'page' || item.kind === 'site') {
    return true;
  }

  return Boolean(item.browserFamily || isBrowserApp(item.appName || item.label || ''));
}

function hasWebsiteMetadata(item) {
  return Boolean(sanitizeText(item.host) || sanitizeText(item.url) || sanitizeText(item.pageTitle));
}

function buildSiteEntry(item, inferredHost = '') {
  const normalizedUrl = normalizeUrl(item.url || '');
  const rawHost = sanitizeText(inferredHost || item.host || normalizedUrl?.hostname || '');
  const rootDomain = getRootDomain(rawHost);
  if (!rootDomain) {
    return null;
  }

  const key = `site:${hashString(rootDomain)}`;
  const pageTitle = sanitizeText(item.pageTitle || item.label || item.subtitle || '');
  return {
    key,
    kind: 'site',
    label: getDomainDisplayName(rootDomain),
    subtitle: pageTitle || rootDomain,
    appName: sanitizeText(item.appName, item.label || 'Browser'),
    browserFamily: sanitizeText(item.browserFamily, getBrowserFamily(item.appName || item.label || '') || ''),
    pageTitle,
    windowTitle: sanitizeText(item.windowTitle, pageTitle || item.subtitle || rootDomain),
    url: sanitizeText(item.url),
    host: rootDomain,
    path: sanitizeText(item.path, normalizedUrl?.pathname || '/'),
    executablePath: sanitizeText(item.executablePath),
    totalMs: Number(item.totalMs) || 0,
    hourly: ensureArray24(item.hourly),
    color: getColorFromKey(key),
    lastSeenAt: Number(item.lastSeenAt) || 0
  };
}

function mergeStoredItems(target, source) {
  target.totalMs += Number(source.totalMs) || 0;
  target.hourly = target.hourly.map((value, index) => value + ((source.hourly && source.hourly[index]) || 0));

  const sourceSeenAt = Number(source.lastSeenAt) || 0;
  const targetSeenAt = Number(target.lastSeenAt) || 0;
  if (sourceSeenAt >= targetSeenAt) {
    target.label = source.label || target.label;
    target.subtitle = source.subtitle || target.subtitle;
    target.appName = source.appName || target.appName;
    target.browserFamily = source.browserFamily || target.browserFamily;
    target.pageTitle = source.pageTitle || target.pageTitle;
    target.windowTitle = source.windowTitle || target.windowTitle;
    target.url = source.url || target.url;
    target.host = source.host || target.host;
    target.path = source.path || target.path;
    target.executablePath = source.executablePath || target.executablePath;
    target.trackingMode = source.trackingMode || target.trackingMode;
    target.trackingSource = source.trackingSource || target.trackingSource;
    target.sourceAppUserModelId = source.sourceAppUserModelId || target.sourceAppUserModelId;
    target.mediaTitle = source.mediaTitle || target.mediaTitle;
    target.mediaArtist = source.mediaArtist || target.mediaArtist;
    target.mediaAlbumTitle = source.mediaAlbumTitle || target.mediaAlbumTitle;
    target.playbackStatus = source.playbackStatus || target.playbackStatus;
    target.playbackType = source.playbackType || target.playbackType;
    target.processId = Number(source.processId) || target.processId || 0;
    target.processName = source.processName || target.processName;
    target.audioSessionState = source.audioSessionState || target.audioSessionState;
    target.audioPeakValue = Math.max(Number(source.audioPeakValue) || 0, Number(target.audioPeakValue) || 0);
    target.audioIsMuted = typeof source.audioIsMuted === 'boolean' ? source.audioIsMuted : target.audioIsMuted;
    target.audioEndpointId = source.audioEndpointId || target.audioEndpointId;
    target.audioSessionIdentifier = source.audioSessionIdentifier || target.audioSessionIdentifier;
    target.audioSessionInstanceIdentifier = source.audioSessionInstanceIdentifier || target.audioSessionInstanceIdentifier;
    target.lastSeenAt = sourceSeenAt;
  }
}

function normalizeSmtcSession(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    sourceAppUserModelId: sanitizeText(item.sourceAppUserModelId),
    playbackStatus: sanitizeText(item.playbackStatus),
    playbackType: sanitizeText(item.playbackType),
    title: sanitizeText(item.title),
    artist: sanitizeText(item.artist),
    albumTitle: sanitizeText(item.albumTitle)
  };
}

function parseSmtcSnapshotOutput(stdout) {
  const rawOutput = sanitizeText(stdout);
  if (!rawOutput) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawOutput);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => normalizeSmtcSession(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeWasapiSession(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    endpointId: sanitizeText(item.endpointId),
    state: sanitizeText(item.state),
    peakValue: Number(item.peakValue) || 0,
    isMuted: Boolean(item.isMuted),
    processId: Number(item.processId) || 0,
    processName: sanitizeText(item.processName),
    executablePath: sanitizeText(item.executablePath),
    sessionIdentifier: sanitizeText(item.sessionIdentifier),
    sessionInstanceIdentifier: sanitizeText(item.sessionInstanceIdentifier),
    displayName: sanitizeText(item.displayName),
    iconPath: sanitizeText(item.iconPath)
  };
}

function parseWasapiSnapshotOutput(stdout) {
  const rawOutput = sanitizeText(stdout);
  if (!rawOutput) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawOutput);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => normalizeWasapiSession(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function isTrackableMusicSession(session) {
  if (!session) {
    return false;
  }

  if (sanitizeText(session.playbackStatus) !== SMTC_PLAYBACK_STATUS_PLAYING) {
    return false;
  }

  if (findMusicAppProfile(session)) {
    return true;
  }

  if (sanitizeText(session.playbackType) !== SMTC_PLAYBACK_TYPE_MUSIC) {
    return false;
  }

  return !isBrowserSourceAppUserModelId(session.sourceAppUserModelId);
}

function isLikelyMusicApp(entry) {
  const tokens = [
    normalizeComparableToken(entry?.appName),
    normalizeComparableToken(entry?.label),
    normalizeComparableToken(entry?.displayName),
    normalizeComparableToken(entry?.processName),
    getExecutableToken(entry?.executablePath),
    getSourceAppUserModelIdToken(entry?.sourceAppUserModelId)
  ].filter(Boolean);

  return tokens.some((token) => (
    token.includes('music')
    || token.includes('spotify')
    || token.includes('foobar')
    || token.includes('aimp')
    || token.includes('cloudmusic')
    || token.includes('qqmusic')
    || token.includes('kugou')
    || token.includes('kuwo')
    || token.includes('musicbee')
    || token.includes('applemusic')
    || token.includes('音乐')
    || token.includes('网易云')
    || token.includes('酷狗')
    || token.includes('酷我')
  ));
}

function isTrackableWasapiSession(session) {
  if (!session) {
    return false;
  }

  if (sanitizeText(session.state) !== AUDIO_SESSION_STATE_ACTIVE) {
    return false;
  }

  if (!Number(session.processId)) {
    return false;
  }

  if (findMusicAppProfile(session)) {
    return true;
  }

  if (isBrowserSourceAppUserModelId(session.processName)) {
    return false;
  }

  return isLikelyMusicApp(session);
}

function buildPlaybackIdentity(entry) {
  const profile = findMusicAppProfile(entry);
  if (profile) {
    return {
      key: `music:${profile.id}`,
      label: profile.displayLabel,
      appName: profile.displayLabel
    };
  }

  const identitySource = sanitizeText(
    entry.executablePath
      || entry.sourceAppUserModelId
      || entry.processName
      || entry.displayName
      || entry.appName
      || entry.label
  );

  if (!identitySource) {
    return null;
  }

  const label = sanitizeText(
    entry.displayName
      || entry.processName
      || entry.appName
      || entry.label
      || humanizeMusicAppName(identitySource),
    '音乐播放'
  );

  return {
    key: `music:${hashString(identitySource.toLowerCase())}`,
    label,
    appName: label
  };
}

function buildPlaybackCandidateFromSmtc(session) {
  if (!isTrackableMusicSession(session)) {
    return null;
  }

  const identity = buildPlaybackIdentity({
    sourceAppUserModelId: session.sourceAppUserModelId,
    appName: humanizeMusicAppName(session.sourceAppUserModelId)
  });
  if (!identity) {
    return null;
  }

  return {
    ...identity,
    provider: 'smtc',
    subtitle: buildMediaSubtitle({
      title: session.title,
      artist: session.artist,
      fallback: identity.label
    }),
    executablePath: '',
    sourceAppUserModelId: sanitizeText(session.sourceAppUserModelId),
    mediaTitle: sanitizeText(session.title),
    mediaArtist: sanitizeText(session.artist),
    mediaAlbumTitle: sanitizeText(session.albumTitle),
    playbackStatus: sanitizeText(session.playbackStatus),
    playbackType: sanitizeText(session.playbackType),
    processId: 0,
    processName: '',
    audioSessionState: '',
    audioPeakValue: 0,
    audioIsMuted: false,
    audioEndpointId: '',
    audioSessionIdentifier: '',
    audioSessionInstanceIdentifier: ''
  };
}

function buildPlaybackCandidateFromWasapi(session) {
  if (!isTrackableWasapiSession(session)) {
    return null;
  }

  const identity = buildPlaybackIdentity({
    appName: session.displayName || session.processName,
    label: session.displayName,
    displayName: session.displayName,
    processName: session.processName,
    executablePath: session.executablePath,
    sourceAppUserModelId: session.processName
  });
  if (!identity) {
    return null;
  }

  const fallbackSubtitle = sanitizeText(session.displayName || session.processName || identity.label);
  return {
    ...identity,
    provider: 'wasapi',
    subtitle: fallbackSubtitle,
    executablePath: sanitizeText(session.executablePath),
    sourceAppUserModelId: sanitizeText(session.processName),
    mediaTitle: '',
    mediaArtist: '',
    mediaAlbumTitle: '',
    playbackStatus: '',
    playbackType: '',
    processId: Number(session.processId) || 0,
    processName: sanitizeText(session.processName),
    audioSessionState: sanitizeText(session.state),
    audioPeakValue: Number(session.peakValue) || 0,
    audioIsMuted: Boolean(session.isMuted),
    audioEndpointId: sanitizeText(session.endpointId),
    audioSessionIdentifier: sanitizeText(session.sessionIdentifier),
    audioSessionInstanceIdentifier: sanitizeText(session.sessionInstanceIdentifier)
  };
}

function mergePlaybackCandidate(target, source) {
  const providers = new Set([...(target.providers || []), ...(source.providers || []), source.provider].filter(Boolean));
  const next = {
    ...target,
    ...source,
    providers: [...providers].sort()
  };

  next.key = target.key || source.key;
  next.label = target.label || source.label;
  next.appName = target.appName || source.appName || next.label;
  next.subtitle = target.subtitle || source.subtitle || next.label;
  next.sourceAppUserModelId = target.sourceAppUserModelId || source.sourceAppUserModelId || '';
  next.mediaTitle = target.mediaTitle || source.mediaTitle || '';
  next.mediaArtist = target.mediaArtist || source.mediaArtist || '';
  next.mediaAlbumTitle = target.mediaAlbumTitle || source.mediaAlbumTitle || '';
  next.playbackStatus = target.playbackStatus || source.playbackStatus || '';
  next.playbackType = target.playbackType || source.playbackType || '';
  next.executablePath = target.executablePath || source.executablePath || '';
  next.processId = target.processId || source.processId || 0;
  next.processName = target.processName || source.processName || '';
  next.audioSessionState = target.audioSessionState || source.audioSessionState || '';
  next.audioPeakValue = Math.max(Number(target.audioPeakValue) || 0, Number(source.audioPeakValue) || 0);
  next.audioIsMuted = typeof target.audioIsMuted === 'boolean'
    ? target.audioIsMuted
    : Boolean(source.audioIsMuted);
  next.audioEndpointId = target.audioEndpointId || source.audioEndpointId || '';
  next.audioSessionIdentifier = target.audioSessionIdentifier || source.audioSessionIdentifier || '';
  next.audioSessionInstanceIdentifier = target.audioSessionInstanceIdentifier || source.audioSessionInstanceIdentifier || '';

  if (source.provider === 'smtc') {
    next.sourceAppUserModelId = source.sourceAppUserModelId || target.sourceAppUserModelId;
    next.mediaTitle = source.mediaTitle || target.mediaTitle;
    next.mediaArtist = source.mediaArtist || target.mediaArtist;
    next.mediaAlbumTitle = source.mediaAlbumTitle || target.mediaAlbumTitle;
    next.playbackStatus = source.playbackStatus || target.playbackStatus;
    next.playbackType = source.playbackType || target.playbackType;
    next.subtitle = source.subtitle || next.subtitle;
  }

  if (source.provider === 'wasapi') {
    next.executablePath = source.executablePath || target.executablePath;
    next.processId = source.processId || target.processId || 0;
    next.processName = source.processName || target.processName;
    next.audioSessionState = source.audioSessionState || target.audioSessionState;
    next.audioPeakValue = Math.max(Number(target.audioPeakValue) || 0, Number(source.audioPeakValue) || 0);
    next.audioIsMuted = (target.providers || []).includes('wasapi')
      ? Boolean(target.audioIsMuted && source.audioIsMuted)
      : Boolean(source.audioIsMuted);
    next.audioEndpointId = source.audioEndpointId || target.audioEndpointId;
    next.audioSessionIdentifier = source.audioSessionIdentifier || target.audioSessionIdentifier;
    next.audioSessionInstanceIdentifier = source.audioSessionInstanceIdentifier || target.audioSessionInstanceIdentifier;
  }

  next.trackingSource = next.providers.length > 1 ? 'hybrid' : (next.providers[0] || '');
  next.trackingMode = 'playback';
  return next;
}

function fusePlaybackCandidates({ smtcSessions, wasapiSessions }) {
  const candidates = new Map();

  for (const session of smtcSessions || []) {
    const candidate = buildPlaybackCandidateFromSmtc(session);
    if (!candidate) {
      continue;
    }

    const existing = candidates.get(candidate.key);
    candidates.set(candidate.key, existing ? mergePlaybackCandidate(existing, candidate) : {
      ...candidate,
      providers: [candidate.provider],
      trackingMode: 'playback',
      trackingSource: candidate.provider,
      audioIsMuted: false
    });
  }

  for (const session of wasapiSessions || []) {
    const candidate = buildPlaybackCandidateFromWasapi(session);
    if (!candidate) {
      continue;
    }

    const existing = candidates.get(candidate.key);
    candidates.set(candidate.key, existing ? mergePlaybackCandidate(existing, candidate) : {
      ...candidate,
      providers: [candidate.provider],
      trackingMode: 'playback',
      trackingSource: candidate.provider
    });
  }

  return [...candidates.values()];
}

class PowerShellMediaSessionBridge {
  constructor({ command, parseSnapshot, timeout, maxBuffer }) {
    this.sessions = [];
    this.pendingPoll = null;
    this.disabled = process.platform !== 'win32';
    this.lastSuccessAt = 0;
    this.command = command;
    this.parseSnapshot = parseSnapshot;
    this.timeout = timeout;
    this.maxBuffer = maxBuffer;
  }

  getSessions() {
    return this.sessions.map((session) => ({ ...session }));
  }

  async poll() {
    if (this.disabled) {
      return this.getSessions();
    }

    if (this.pendingPoll) {
      return this.pendingPoll;
    }

    this.pendingPoll = this.fetchSessions()
      .then((sessions) => {
        this.sessions = sessions;
        this.lastSuccessAt = Date.now();
        return this.getSessions();
      })
      .catch((error) => {
        if (error && error.code === 'ENOENT') {
          this.disabled = true;
        }

        if (!this.lastSuccessAt || (Date.now() - this.lastSuccessAt) > (POLL_INTERVAL_MS * 2)) {
          this.sessions = [];
        }

        return this.getSessions();
      })
      .finally(() => {
        this.pendingPoll = null;
      });

    return this.pendingPoll;
  }

  async fetchSessions() {
    const result = await execFileAsync(
      WINDOWS_POWERSHELL_PATH,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', this.command],
      {
        windowsHide: true,
        timeout: this.timeout,
        maxBuffer: this.maxBuffer
      }
    );

    return this.parseSnapshot(result.stdout);
  }
}

class SmtcSessionBridge extends PowerShellMediaSessionBridge {
  constructor() {
    super({
      command: SMTC_SNAPSHOT_COMMAND,
      parseSnapshot: parseSmtcSnapshotOutput,
      timeout: SMTC_COMMAND_TIMEOUT_MS,
      maxBuffer: SMTC_MAX_BUFFER_BYTES
    });
  }
}

class WasapiSessionBridge extends PowerShellMediaSessionBridge {
  constructor() {
    super({
      command: WASAPI_SNAPSHOT_COMMAND,
      parseSnapshot: parseWasapiSnapshotOutput,
      timeout: WASAPI_COMMAND_TIMEOUT_MS,
      maxBuffer: WASAPI_MAX_BUFFER_BYTES
    });
  }
}

class PlaybackSessionFusionService {
  constructor() {
    this.smtcSessionBridge = new SmtcSessionBridge();
    this.wasapiSessionBridge = new WasapiSessionBridge();
  }

  async poll() {
    const [smtcSessions, wasapiSessions] = await Promise.all([
      this.smtcSessionBridge.poll(),
      this.wasapiSessionBridge.poll()
    ]);

    return fusePlaybackCandidates({ smtcSessions, wasapiSessions });
  }
}

function spawnMediaSessionHelper(helperPath) {
  return fork(helperPath, [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true
  });
}

class HelperBackedPlaybackSessionFusionService {
  constructor({
    helperPath = MEDIA_SESSION_HELPER_PATH,
    restartDelayMs = MEDIA_HELPER_RESTART_DELAY_MS,
    spawnHelper = spawnMediaSessionHelper
  } = {}) {
    this.helperPath = helperPath;
    this.restartDelayMs = restartDelayMs;
    this.spawnHelper = spawnHelper;
    this.child = null;
    this.latestSnapshot = [];
    this.latestUpdatedAt = 0;
    this.restartTimer = null;
    this.disabled = process.platform !== 'win32';
    this.disposed = false;
    this.starting = false;
  }

  start() {
    if (this.disabled || this.disposed || this.child || this.starting) {
      return;
    }

    this.starting = true;
    try {
      const child = this.spawnHelper(this.helperPath);
      this.child = child;
      child.on('message', (message) => {
        this.handleHelperMessage(message);
      });
      child.once('exit', () => {
        this.child = null;
        if (!this.disposed) {
          this.scheduleRestart();
        }
      });
      child.once('error', () => {
        if (!this.disposed) {
          this.scheduleRestart();
        }
      });
    } catch {
      this.scheduleRestart();
    } finally {
      this.starting = false;
    }
  }

  handleHelperMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'snapshot') {
      this.latestSnapshot = clonePlaybackCandidateList(message.snapshot);
      this.latestUpdatedAt = Number(message.updatedAt) || Date.now();
    }
  }

  scheduleRestart() {
    if (this.disabled || this.disposed || this.restartTimer) {
      return;
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, this.restartDelayMs);
  }

  async poll() {
    this.start();
    return clonePlaybackCandidateList(this.latestSnapshot);
  }

  async dispose() {
    this.disposed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const child = this.child;
    this.child = null;
    if (!child) {
      return;
    }

    await new Promise((resolve) => {
      let finished = false;
      const finalize = () => {
        if (finished) {
          return;
        }

        finished = true;
        resolve();
      };

      child.once('exit', finalize);
      try {
        child.send({ type: 'shutdown' });
      } catch {
        finalize();
        return;
      }

      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore kill failures
        }
        finalize();
      }, 800);
    });
  }
}

function mergeIntoMap(map, item) {
  const existing = map[item.key];
  if (!existing) {
    map[item.key] = cloneStoredItem(item);
    return;
  }

  mergeStoredItems(existing, item);
}

function inferSiteHostFromTitle(item, siteCandidates) {
  const title = sanitizeText(item.windowTitle || item.subtitle || '').toLowerCase();
  if (!title || !siteCandidates.length) {
    return '';
  }

  let bestCandidate = null;
  let bestScore = 0;

  for (const candidate of siteCandidates) {
    const rootDomain = sanitizeText(candidate.host).toLowerCase();
    const displayName = getDomainDisplayName(rootDomain).toLowerCase();
    const aliases = [rootDomain, displayName, sanitizeText(candidate.label).toLowerCase()].filter(Boolean);
    let score = 0;

    for (const alias of aliases) {
      if (!alias) {
        continue;
      }

      if (title.includes(alias)) {
        score = Math.max(score, alias === rootDomain ? 3 : 2);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate ? bestCandidate.host : '';
}

function migrateDay(day) {
  const sourceItems = Object.values(day?.items || {}).map((item) => cloneStoredItem(item));
  const nextItems = {};
  let changed = false;

  for (const item of sourceItems) {
    if (isBrowserUsageItem(item) && hasWebsiteMetadata(item)) {
      const siteItem = buildSiteEntry(item);
      if (siteItem) {
        const canonicalItem = canonicalizeEntry(siteItem);
        mergeIntoMap(nextItems, canonicalItem);
        if (item.key !== canonicalItem.key || item.kind !== canonicalItem.kind || item.host !== canonicalItem.host || item.label !== canonicalItem.label) {
          changed = true;
        }
        continue;
      }
    }

    const canonicalItem = canonicalizeEntry(item);
    mergeIntoMap(nextItems, canonicalItem);
    if (canonicalItem.key !== item.key || canonicalItem.kind !== item.kind || canonicalItem.label !== item.label) {
      changed = true;
    }
  }

  const siteCandidates = Object.values(nextItems).filter((item) => Boolean(item.host));
  for (const item of Object.values(nextItems)) {
    if (!isBrowserUsageItem(item) || item.kind !== 'app' || hasWebsiteMetadata(item)) {
      continue;
    }

    const inferredHost = inferSiteHostFromTitle(item, siteCandidates.filter((candidate) => {
      if (item.browserFamily && candidate.browserFamily) {
        return item.browserFamily === candidate.browserFamily;
      }

      return true;
    }));

    if (!inferredHost) {
      continue;
    }

    const siteItem = buildSiteEntry(item, inferredHost);
    if (!siteItem) {
      continue;
    }

    const canonicalItem = canonicalizeEntry(siteItem);

    delete nextItems[item.key];
    mergeIntoMap(nextItems, canonicalItem);
    changed = true;
  }

  const totalMs = Object.values(nextItems).reduce((sum, item) => sum + (Number(item.totalMs) || 0), 0);
  if ((Number(day?.totalMs) || 0) !== totalMs) {
    changed = true;
  }

  return {
    totalMs,
    items: nextItems,
    changed
  };
}

function migrateUsageData(rawData) {
  const parsed = rawData && typeof rawData === 'object' ? rawData : {};
  const result = createEmptyData();
  let changed = Number(parsed.version) !== DATA_VERSION;

  for (const [dayKey, day] of Object.entries(parsed.days || {})) {
    const migratedDay = migrateDay(day);
    result.days[dayKey] = {
      totalMs: migratedDay.totalMs,
      items: migratedDay.items
    };
    changed ||= migratedDay.changed;
  }

  return { data: result, changed };
}

async function migrateUsageDataFile(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return { data: createEmptyData(), changed: false };
  }

  const migrated = migrateUsageData(parsed);
  if (migrated.changed) {
    await fs.writeFile(filePath, JSON.stringify(migrated.data, null, 2), 'utf8');
  }

  return migrated;
}

class UsageTracker {
  constructor({ userDataPath, onDataChanged }) {
    this.userDataPath = userDataPath;
    this.onDataChanged = onDataChanged;
    this.dataFilePath = path.join(userDataPath, 'usage-data.json');
    this.data = createEmptyData();
    this.currentEntry = null;
    this.currentPlaybackEntries = new Map();
    this.timer = null;
    this.saveTimer = null;
    this.httpServer = null;
    this.browserEvents = new BrowserEventCache();
    this.playbackSessionFusionService = new HelperBackedPlaybackSessionFusionService();
    this.entryHints = new Map();
    this.serializedDayCache = new Map();
    this.sortedDayKeysCache = [];
    this.sortedDayKeysDirty = true;
  }

  async init() {
    await this.load();
    await this.startBrowserBridge();
    this.playbackSessionFusionService.start();
    await this.pollActiveWindow();
    this.timer = setInterval(() => {
      this.pollActiveWindow().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  async dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.commitCurrentEntry(Date.now());
    this.commitPlaybackEntries(Date.now());
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }

    if (this.playbackSessionFusionService && typeof this.playbackSessionFusionService.dispose === 'function') {
      await this.playbackSessionFusionService.dispose();
    }

    await this.save();
  }

  async load() {
    try {
      const fileContent = await fs.readFile(this.dataFilePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      const migrated = migrateUsageData(parsed);
      this.data = migrated.data;
      this.resetDerivedCaches();
      if (migrated.changed) {
        await this.save();
      }
    } catch {
      this.data = createEmptyData();
      this.resetDerivedCaches();
    }
  }

  scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.save().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  async save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.writeFile(this.dataFilePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async startBrowserBridge() {
    this.httpServer = http.createServer((request, response) => {
      const origin = request.headers.origin;
      const writeJson = (statusCode, payload, extraHeaders = {}) => {
        response.writeHead(statusCode, getBridgeResponseHeaders(origin, {
          'Content-Type': 'application/json',
          ...extraHeaders
        }));
        response.end(JSON.stringify(payload));
      };

      if (request.method === 'OPTIONS') {
        if (!isAllowedBridgeOrigin(origin)) {
          response.writeHead(403, { Vary: 'Origin' });
          response.end();
          return;
        }

        response.writeHead(204, {
          ...getBridgeResponseHeaders(origin),
          'Access-Control-Allow-Headers': `Content-Type, ${BRIDGE_SHARED_HEADER_NAME}`,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Max-Age': '600'
        });
        response.end();
        return;
      }

      if (
        request.method !== 'POST'
        || ![BRIDGE_ENDPOINT_BROWSER_EVENT, BRIDGE_ENDPOINT_EXTENSION_HEARTBEAT].includes(request.url)
      ) {
        writeJson(404, { ok: false });
        return;
      }

      if (!isBridgeRequestAuthorized(request.headers)) {
        writeJson(403, { ok: false });
        request.resume();
        return;
      }

      const contentLength = Number(request.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > MAX_BRIDGE_REQUEST_BYTES) {
        writeJson(413, { ok: false });
        request.resume();
        return;
      }

      const chunks = [];
      let receivedBytes = 0;
      let completed = false;

      request.on('data', (chunk) => {
        if (completed) {
          return;
        }

        receivedBytes += chunk.length;
        if (receivedBytes > MAX_BRIDGE_REQUEST_BYTES) {
          completed = true;
          writeJson(413, { ok: false });
          request.destroy();
          return;
        }

        chunks.push(chunk);
      });

      request.on('error', () => {
        if (completed) {
          return;
        }

        completed = true;
        writeJson(400, { ok: false });
      });

      request.on('end', () => {
        if (completed) {
          return;
        }

        completed = true;
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('invalid bridge payload');
          }

          if (request.url === BRIDGE_ENDPOINT_EXTENSION_HEARTBEAT) {
            this.browserEvents.upsertHeartbeat(payload);
          } else {
            this.browserEvents.upsert(payload);
          }

          writeJson(200, { ok: true });
          Promise.resolve(this.emitDataChanged()).catch(() => {});
        } catch {
          writeJson(400, { ok: false });
        }
      });
    });

    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
        this.httpServer.removeListener('error', reject);
        resolve();
      });
    });
  }

  async pollActiveWindow() {
    const now = Date.now();
    this.commitCurrentEntry(now);
    this.commitPlaybackEntries(now);

    const [activeWindow, playbackSessions] = await Promise.all([
      getActiveWindow().catch(() => null),
      this.playbackSessionFusionService.poll()
    ]);
    const playbackChanged = this.replacePlaybackEntries(playbackSessions, now);
    const normalized = this.normalizeWindow(activeWindow, now);
    const nextEntry = this.shouldSuppressForegroundEntry(normalized) ? null : normalized;
    const previousEntryKey = this.currentEntry ? this.currentEntry.key : null;
    this.currentEntry = nextEntry;

    if (nextEntry || this.currentPlaybackEntries.size || playbackChanged || previousEntryKey !== (nextEntry ? nextEntry.key : null)) {
      this.emitDataChanged();
    }
  }

  normalizeWindow(activeWindow, now) {
    if (!activeWindow || !activeWindow.owner) {
      return null;
    }

    const appName = sanitizeText(activeWindow.owner.name, 'Unknown App');
    const windowTitle = sanitizeText(activeWindow.title, appName);
    const executablePath = sanitizeText(activeWindow.owner.path || '');
    const browserFamily = getBrowserFamily(appName);
    const musicProfile = findMusicAppProfile({ appName, executablePath });

    if (browserFamily) {
      const browserEvent = this.browserEvents.getFresh(browserFamily);
      if (browserEvent) {
        const groupedDomain = browserEvent.rootDomain || browserEvent.host;
        const pageKey = `site:${hashString(groupedDomain)}`;
        return canonicalizeEntry({
          key: pageKey,
          kind: 'site',
          appName,
          browserFamily,
          pageTitle: browserEvent.pageTitle,
          windowTitle,
          url: browserEvent.url,
          host: groupedDomain,
          path: browserEvent.path,
          label: browserEvent.displayName || groupedDomain,
          subtitle: browserEvent.pageTitle || groupedDomain,
          color: getColorFromKey(pageKey),
          startedAt: now,
          lastSeenAt: now,
          executablePath
        });
      }
    }

    if (musicProfile) {
      const musicKey = `music:${musicProfile.id}`;
      const entry = {
        key: musicKey,
        kind: 'app',
        appName: musicProfile.displayLabel,
        browserFamily: null,
        pageTitle: '',
        windowTitle,
        url: '',
        host: '',
        path: '',
        label: musicProfile.displayLabel,
        subtitle: windowTitle,
        color: getColorFromKey(musicKey),
        startedAt: now,
        lastSeenAt: now,
        executablePath,
        trackingMode: 'foreground',
        trackingSource: 'foreground'
      };
      this.rememberEntryHint(entry);
      return entry;
    }

    const appKey = `app:${toIdSegment(appName)}:${hashString(`${appName}|${executablePath}`)}`;
    const entry = canonicalizeEntry({
      key: appKey,
      kind: 'app',
      appName,
      browserFamily: browserFamily || null,
      pageTitle: '',
      windowTitle,
      url: '',
      host: '',
      path: '',
      label: appName,
      subtitle: windowTitle,
      color: getColorFromKey(appKey),
      startedAt: now,
      lastSeenAt: now,
      executablePath,
      trackingMode: 'foreground',
      trackingSource: 'foreground'
    });
    this.rememberEntryHint(entry);
    return entry;
  }

  commitCurrentEntry(now) {
    if (this.commitLiveEntry(this.currentEntry, now)) {
      this.scheduleSave();
    }
  }

  commitPlaybackEntries(now) {
    let changed = false;
    for (const entry of this.currentPlaybackEntries.values()) {
      changed = this.commitLiveEntry(entry, now) || changed;
    }

    if (changed) {
      this.scheduleSave();
    }
  }

  commitLiveEntry(entry, now) {
    if (!entry) {
      return false;
    }

    const startedAt = entry.lastSeenAt || entry.startedAt;
    if (!startedAt || now <= startedAt) {
      entry.lastSeenAt = now;
      return false;
    }

    this.allocateDuration(entry, startedAt, now);
    entry.lastSeenAt = now;
    return true;
  }

  replacePlaybackEntries(playbackSessions, now) {
    const previousState = JSON.stringify(
      [...this.currentPlaybackEntries.values()]
        .map((entry) => [entry.key, entry.mediaTitle || '', entry.mediaArtist || '', entry.trackingSource || '', entry.processName || ''])
        .sort((left, right) => left[0].localeCompare(right[0]))
    );

    const nextEntries = new Map();
    for (const session of playbackSessions) {
      const entry = this.createPlaybackEntryFromCandidate(session, now);
      if (!entry) {
        continue;
      }
      nextEntries.set(entry.key, entry);
    }

    this.currentPlaybackEntries = nextEntries;
    for (const entry of this.currentPlaybackEntries.values()) {
      this.rememberEntryHint(entry);
    }

    const nextState = JSON.stringify(
      [...this.currentPlaybackEntries.values()]
        .map((entry) => [entry.key, entry.mediaTitle || '', entry.mediaArtist || '', entry.trackingSource || '', entry.processName || ''])
        .sort((left, right) => left[0].localeCompare(right[0]))
    );

    return previousState !== nextState;
  }

  createPlaybackEntryFromCandidate(candidate, now) {
    if (!candidate || !candidate.key) {
      return null;
    }

    const entryHint = this.entryHints.get(candidate.key) || {};
    const label = sanitizeText(
      entryHint.label || entryHint.appName || candidate.label || candidate.appName,
      '音乐播放'
    );
    const subtitle = sanitizeText(candidate.subtitle, label);

    return {
      key: candidate.key,
      kind: 'app',
      label,
      subtitle,
      appName: sanitizeText(entryHint.appName || candidate.appName || label, label),
      browserFamily: null,
      pageTitle: '',
      windowTitle: subtitle || label,
      url: '',
      host: '',
      path: '',
      executablePath: sanitizeText(candidate.executablePath || entryHint.executablePath),
      color: getColorFromKey(candidate.key),
      startedAt: now,
      lastSeenAt: now,
      trackingMode: 'playback',
      trackingSource: sanitizeText(candidate.trackingSource),
      sourceAppUserModelId: sanitizeText(candidate.sourceAppUserModelId),
      mediaTitle: sanitizeText(candidate.mediaTitle),
      mediaArtist: sanitizeText(candidate.mediaArtist),
      mediaAlbumTitle: sanitizeText(candidate.mediaAlbumTitle),
      playbackStatus: sanitizeText(candidate.playbackStatus),
      playbackType: sanitizeText(candidate.playbackType),
      processId: Number(candidate.processId) || 0,
      processName: sanitizeText(candidate.processName),
      audioSessionState: sanitizeText(candidate.audioSessionState),
      audioPeakValue: Number(candidate.audioPeakValue) || 0,
      audioIsMuted: Boolean(candidate.audioIsMuted),
      audioEndpointId: sanitizeText(candidate.audioEndpointId),
      audioSessionIdentifier: sanitizeText(candidate.audioSessionIdentifier),
      audioSessionInstanceIdentifier: sanitizeText(candidate.audioSessionInstanceIdentifier)
    };
  }

  createPlaybackEntryFromSession(session, now) {
    const candidate = buildPlaybackCandidateFromSmtc(session) || buildPlaybackCandidateFromWasapi(session);
    return this.createPlaybackEntryFromCandidate(candidate, now);
  }

  shouldSuppressForegroundEntry(entry) {
    if (!entry || !entry.key) {
      return false;
    }

    return this.currentPlaybackEntries.has(entry.key);
  }

  rememberEntryHint(entry) {
    if (!entry || !entry.key) {
      return;
    }

    const existing = this.entryHints.get(entry.key) || {};
    this.entryHints.set(entry.key, {
      label: sanitizeText(entry.label, existing.label || ''),
      appName: sanitizeText(entry.appName, existing.appName || ''),
      executablePath: sanitizeText(entry.executablePath, existing.executablePath || '')
    });
  }

  allocateDuration(entry, startTimestamp, endTimestamp) {
    let cursor = startTimestamp;
    while (cursor < endTimestamp) {
      const currentDate = new Date(cursor);
      const dayBoundary = new Date(currentDate);
      dayBoundary.setHours(24, 0, 0, 0);
      const sliceEnd = Math.min(endTimestamp, dayBoundary.getTime());
      const durationMs = sliceEnd - cursor;
      this.applyDuration(entry, currentDate, durationMs);
      cursor = sliceEnd;
    }
  }

  applyDuration(entry, date, durationMs) {
    const dayKey = getDayKey(date);
    const day = this.ensureDay(dayKey);
    const item = this.ensureItem(day, entry);

    day.totalMs += durationMs;
    item.totalMs += durationMs;
    item.lastSeenAt = Date.now();
    this.serializedDayCache.delete(dayKey);

    let remaining = durationMs;
    let cursor = new Date(date);

    while (remaining > 0) {
      const hour = cursor.getHours();
      const nextHour = new Date(cursor);
      nextHour.setMinutes(60, 0, 0);
      const sliceMs = Math.min(remaining, nextHour.getTime() - cursor.getTime());
      item.hourly[hour] += sliceMs;
      remaining -= sliceMs;
      cursor = nextHour;
    }
  }

  ensureDay(dayKey) {
    if (!this.data.days[dayKey]) {
      this.data.days[dayKey] = { totalMs: 0, items: {} };
      this.sortedDayKeysDirty = true;
    }

    return this.data.days[dayKey];
  }

  ensureItem(day, entry) {
    if (!day.items[entry.key]) {
      day.items[entry.key] = {
        key: entry.key,
        kind: entry.kind,
        label: entry.label,
        subtitle: entry.subtitle,
        appName: entry.appName,
        browserFamily: entry.browserFamily,
        pageTitle: entry.pageTitle,
        windowTitle: entry.windowTitle,
        url: entry.url,
        host: entry.host,
        path: entry.path,
        executablePath: entry.executablePath,
        trackingMode: entry.trackingMode,
        trackingSource: entry.trackingSource,
        sourceAppUserModelId: entry.sourceAppUserModelId,
        mediaTitle: entry.mediaTitle,
        mediaArtist: entry.mediaArtist,
        mediaAlbumTitle: entry.mediaAlbumTitle,
        playbackStatus: entry.playbackStatus,
        playbackType: entry.playbackType,
        processId: entry.processId,
        processName: entry.processName,
        audioSessionState: entry.audioSessionState,
        audioPeakValue: entry.audioPeakValue,
        audioIsMuted: entry.audioIsMuted,
        audioEndpointId: entry.audioEndpointId,
        audioSessionIdentifier: entry.audioSessionIdentifier,
        audioSessionInstanceIdentifier: entry.audioSessionInstanceIdentifier,
        totalMs: 0,
        hourly: new Array(24).fill(0),
        color: entry.color,
        lastSeenAt: Date.now()
      };
    }

    const item = day.items[entry.key];
    item.label = entry.label;
    item.subtitle = entry.subtitle;
    item.appName = entry.appName;
    item.browserFamily = entry.browserFamily;
    item.pageTitle = entry.pageTitle;
    item.windowTitle = entry.windowTitle;
    item.url = entry.url;
    item.host = entry.host;
    item.path = entry.path;
    item.executablePath = entry.executablePath;
    item.trackingMode = entry.trackingMode || item.trackingMode || '';
    item.trackingSource = entry.trackingSource || item.trackingSource || '';
    item.sourceAppUserModelId = entry.sourceAppUserModelId || item.sourceAppUserModelId || '';
    item.mediaTitle = entry.mediaTitle || item.mediaTitle || '';
    item.mediaArtist = entry.mediaArtist || item.mediaArtist || '';
    item.mediaAlbumTitle = entry.mediaAlbumTitle || item.mediaAlbumTitle || '';
    item.playbackStatus = entry.playbackStatus || item.playbackStatus || '';
    item.playbackType = entry.playbackType || item.playbackType || '';
    item.processId = Number(entry.processId) || item.processId || 0;
    item.processName = entry.processName || item.processName || '';
    item.audioSessionState = entry.audioSessionState || item.audioSessionState || '';
    item.audioPeakValue = Math.max(Number(entry.audioPeakValue) || 0, Number(item.audioPeakValue) || 0);
    item.audioIsMuted = typeof entry.audioIsMuted === 'boolean' ? entry.audioIsMuted : item.audioIsMuted;
    item.audioEndpointId = entry.audioEndpointId || item.audioEndpointId || '';
    item.audioSessionIdentifier = entry.audioSessionIdentifier || item.audioSessionIdentifier || '';
    item.audioSessionInstanceIdentifier = entry.audioSessionInstanceIdentifier || item.audioSessionInstanceIdentifier || '';
    item.color = entry.color;
    return item;
  }

  getSortedDayKeys() {
    if (this.sortedDayKeysDirty) {
      this.sortedDayKeysCache = Object.keys(this.data.days).sort();
      this.sortedDayKeysDirty = false;
    }

    return this.sortedDayKeysCache;
  }

  resetDerivedCaches() {
    this.serializedDayCache.clear();
    this.sortedDayKeysCache = [];
    this.sortedDayKeysDirty = true;
  }

  getSerializedDay(dayKey) {
    if (this.serializedDayCache.has(dayKey)) {
      return this.serializedDayCache.get(dayKey);
    }

    const day = this.data.days[dayKey] || { totalMs: 0, items: {} };
    const serialized = {
      totalMs: day.totalMs,
      hourly: this.mergeDayHourly(day),
      items: Object.values(day.items)
        .sort((left, right) => right.totalMs - left.totalMs)
        .map((item) => cloneItem(item))
    };

    this.serializedDayCache.set(dayKey, serialized);
    return serialized;
  }

  getSnapshot() {
    const dayKeys = this.getSortedDayKeys();
    const latestDayKey = dayKeys[dayKeys.length - 1] || getDayKey(new Date());
    const recentDays = dayKeys.slice(-7);
    const serializedDays = Object.fromEntries(
      dayKeys.map((dayKey) => [dayKey, this.getSerializedDay(dayKey)])
    );
    const currentDay = serializedDays[latestDayKey] || { totalMs: 0, hourly: new Array(24).fill(0), items: [] };

    const weeklyMap = new Map();
    let weeklyTotalMs = 0;

    for (const dayKey of recentDays) {
      const day = serializedDays[dayKey];
      weeklyTotalMs += day.totalMs;
      for (const item of day.items) {
        const existing = weeklyMap.get(item.key);
        if (!existing) {
          weeklyMap.set(item.key, {
            ...cloneItem(item),
            totalMs: item.totalMs,
            byDay: { [dayKey]: item.totalMs }
          });
        } else {
          existing.totalMs += item.totalMs;
          existing.byDay[dayKey] = item.totalMs;
          existing.hourly = existing.hourly.map((value, index) => value + item.hourly[index]);
          existing.label = item.label;
          existing.subtitle = item.subtitle;
          existing.url = item.url || existing.url;
          existing.host = item.host || existing.host;
          existing.pageTitle = item.pageTitle || existing.pageTitle;
          existing.appName = item.appName || existing.appName;
          existing.executablePath = item.executablePath || existing.executablePath;
          existing.trackingMode = item.trackingMode || existing.trackingMode;
          existing.trackingSource = item.trackingSource || existing.trackingSource;
          existing.sourceAppUserModelId = item.sourceAppUserModelId || existing.sourceAppUserModelId;
          existing.mediaTitle = item.mediaTitle || existing.mediaTitle;
          existing.mediaArtist = item.mediaArtist || existing.mediaArtist;
          existing.mediaAlbumTitle = item.mediaAlbumTitle || existing.mediaAlbumTitle;
          existing.playbackStatus = item.playbackStatus || existing.playbackStatus;
          existing.playbackType = item.playbackType || existing.playbackType;
          existing.processId = item.processId || existing.processId || 0;
          existing.processName = item.processName || existing.processName;
          existing.audioSessionState = item.audioSessionState || existing.audioSessionState;
          existing.audioPeakValue = Math.max(Number(existing.audioPeakValue) || 0, Number(item.audioPeakValue) || 0);
          existing.audioIsMuted = typeof item.audioIsMuted === 'boolean' ? item.audioIsMuted : existing.audioIsMuted;
          existing.audioEndpointId = item.audioEndpointId || existing.audioEndpointId;
          existing.audioSessionIdentifier = item.audioSessionIdentifier || existing.audioSessionIdentifier;
          existing.audioSessionInstanceIdentifier = item.audioSessionInstanceIdentifier || existing.audioSessionInstanceIdentifier;
        }
      }
    }
    const weeklyItems = [...weeklyMap.values()].sort((left, right) => right.totalMs - left.totalMs);

    return {
      meta: {
        latestDayKey,
        currentEntryKey: this.currentEntry ? this.currentEntry.key : null,
        currentPlaybackEntryKeys: [...this.currentPlaybackEntries.keys()],
        bridgeUrl: `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}${BRIDGE_ENDPOINT_BROWSER_EVENT}`,
        browserExtensionStatus: this.browserEvents.getExtensionStatus()
      },
      daily: {
        availableDays: dayKeys,
        days: serializedDays,
        selectedDayKey: latestDayKey,
        totalMs: currentDay.totalMs,
        hourly: [...currentDay.hourly],
        items: currentDay.items
      },
      weekly: {
        dayKeys: recentDays,
        totalMs: weeklyTotalMs,
        averageMs: recentDays.length ? Math.round(weeklyTotalMs / recentDays.length) : 0,
        dailyTotals: recentDays.map((dayKey) => ({ dayKey, totalMs: serializedDays[dayKey].totalMs })),
        items: weeklyItems
      }
    };
  }

  mergeDayHourly(day) {
    const hourly = new Array(24).fill(0);
    for (const item of Object.values(day.items)) {
      for (let index = 0; index < 24; index += 1) {
        hourly[index] += item.hourly[index];
      }
    }

    return hourly;
  }

  getItemDetail(itemKey) {
    const dayKeys = this.getSortedDayKeys();
    const perDay = [];
    const currentDayKey = dayKeys[dayKeys.length - 1] || getDayKey(new Date());
    let latestItem = null;
    let todayHourly = new Array(24).fill(0);

    for (const dayKey of dayKeys) {
      const item = this.data.days[dayKey].items[itemKey];
      if (item) {
        latestItem = item;
        perDay.push({ dayKey, totalMs: item.totalMs });
        if (dayKey === currentDayKey) {
          todayHourly = [...item.hourly];
        }
      }
    }

    if (!latestItem) {
      return null;
    }

    const lastSevenDays = perDay.slice(-7);
    const totalMs = perDay.reduce((sum, day) => sum + day.totalMs, 0);

    return {
      ...cloneItem(latestItem),
      totalMs,
      todayHourly,
      lastSevenDays,
      averageMs: lastSevenDays.length
        ? Math.round(lastSevenDays.reduce((sum, day) => sum + day.totalMs, 0) / lastSevenDays.length)
        : 0
    };
  }

  async emitDataChanged() {
    if (typeof this.onDataChanged === 'function') {
      await this.onDataChanged();
    }
  }
}

module.exports = {
  UsageTracker,
  PlaybackSessionFusionService,
  HelperBackedPlaybackSessionFusionService,
  migrateUsageData,
  migrateUsageDataFile,
  LOOPBACK_PORT,
  LOOPBACK_HOST,
  BRIDGE_SHARED_HEADER_NAME,
  BRIDGE_SHARED_HEADER_VALUE,
  MAX_BRIDGE_REQUEST_BYTES,
  __testables: {
    getDayKey,
    getRootDomain,
    isAllowedBridgeOrigin,
    isBridgeRequestAuthorized,
    buildMediaSubtitle,
    findMusicAppProfile,
    isTrackableMusicSession,
    isTrackableWasapiSession,
    isBrowserSourceAppUserModelId,
    parseSmtcSnapshotOutput,
    parseWasapiSnapshotOutput,
    buildPlaybackCandidateFromSmtc,
    buildPlaybackCandidateFromWasapi,
    fusePlaybackCandidates,
    clonePlaybackCandidateList,
    HelperBackedPlaybackSessionFusionService,
    BrowserEventCache
  }
};
