# Puts the real Blender window INSIDE the app (Windows). Started by server/blender.js with the Blender process id.
# The Blender window loses its title bar and taskbar button, becomes an owned window of the app's Chrome window,
# and is kept exactly over the side panel's Blender area: it follows the app window when it moves, hides with it
# when it minimizes, and never shows anywhere else. The user works in the real Blender, with the real mouse and
# keyboard; nothing is mirrored or forwarded.
#   out:  H <hwnd>                                   Blender's window was found
#         W <hwnd> <x> <y> <w> <h>                   the app window it is now owned by
#         P <x> <y> <w> <h>                          Blender was placed (physical pixels)
#         E <message>                                a problem; "E host closed" / "E window closed" end the session
#   in (one JSON object per line):
#         {"k":"place","title":"Supercomputer","dpr":1.25,"sx":..,"sy":..,"ow":..,"oh":..,"vw":..,"vh":..,"x":..,"y":..,"w":..,"h":..}
#              title = the page title (finds the app window), sx/sy/ow/oh = window.screenX/Y, outerWidth/Height,
#              vw/vh = innerWidth/Height, x/y/w/h = the panel area in CSS px of the viewport. All CSS px except dpr.
#         {"k":"show"}  {"k":"hide"}  {"k":"quit"}
param([int]$BlenderPid)
$ErrorActionPreference = 'Continue'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class BW {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PT p);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  public static IntPtr FindBlender(uint pid) { IntPtr f = IntPtr.Zero; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); R r; GetWindowRect(h, out r); if (sb.ToString().Contains("Blender") && r.Rt - r.L >= 400 && r.B - r.T >= 200) { f = h; return false; } } return true; }, IntPtr.Zero); return f; }
  // The app window: a visible Chrome/Edge top-level window whose title holds the page title; with a hint rect, the closest one.
  public static IntPtr FindHost(string title, int hx, int hy, int hw, int hh) {
    IntPtr best = IntPtr.Zero; long bestD = long.MaxValue;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512); var cb = new StringBuilder(128); GetClassName(h, cb, 128);
      if (!cb.ToString().StartsWith("Chrome_WidgetWin") || !sb.ToString().Contains(title)) return true;
      R r; GetWindowRect(h, out r);
      long d = hw > 0 ? Math.Abs((long)r.L - hx) + Math.Abs((long)r.T - hy) + Math.Abs((long)(r.Rt - r.L) - hw) + Math.Abs((long)(r.B - r.T) - hh) : 0;
      if (d < bestD) { bestD = d; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
"@
[BW]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null     # per-monitor v2: every coordinate below is physical pixels
function Out($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Rect($h) { $r = New-Object BW+R; [BW]::GetWindowRect($h, [ref]$r) | Out-Null; return $r }

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 240 -and $hwnd -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 100; $hwnd = [BW]::FindBlender([uint32]$BlenderPid) }
if ($hwnd -eq [IntPtr]::Zero) { Out "E Blender window not found"; exit 2 }
Out "H $hwnd"

# ---- the window becomes a frameless tool window (no caption, no sizing border, no taskbar button)
$GWL_STYLE = -16; $GWL_EXSTYLE = -20; $GWLP_HWNDPARENT = -8
function Strip {
  $st = [long][BW]::GetWindowLongPtr($hwnd, $GWL_STYLE)
  $st = $st -band (-bnot 0x00C00000L) -band (-bnot 0x00040000L) -band (-bnot 0x00020000L) -band (-bnot 0x00010000L) -band (-bnot 0x00080000L)
  [BW]::SetWindowLongPtr($hwnd, $GWL_STYLE, [IntPtr]$st) | Out-Null
  $ex = [long][BW]::GetWindowLongPtr($hwnd, $GWL_EXSTYLE)
  $ex = ($ex -band (-bnot 0x00040000L)) -bor 0x00000080L
  [BW]::SetWindowLongPtr($hwnd, $GWL_EXSTYLE, [IntPtr]$ex) | Out-Null
  [BW]::SetWindowPos($hwnd, [IntPtr]0, 0, 0, 0, 0, 0x0020 -bor 0x0001 -bor 0x0002 -bor 0x0004 -bor 0x0010) | Out-Null   # FRAMECHANGED
}
Strip
[BW]::ShowWindow($hwnd, 0) | Out-Null     # hidden until the page says where it goes

# ---- stdin reader on a background runspace: lines land in a synchronized queue
$queue = [System.Collections.Queue]::Synchronized((New-Object System.Collections.Queue))
$rs = [runspacefactory]::CreateRunspace(); $rs.Open(); $rs.SessionStateProxy.SetVariable('q', $queue)
$ps = [powershell]::Create(); $ps.Runspace = $rs
$null = $ps.AddScript({ $in = [Console]::In; while ($true) { $l = $in.ReadLine(); if ($null -eq $l) { $q.Enqueue('{"k":"quit"}'); break }; if ($l) { $q.Enqueue($l) } } })
$null = $ps.BeginInvoke()

$script:hostWin = [IntPtr]::Zero; $script:rel = $null; $script:visible = $false; $script:last = ''; $script:quit = $false

function Place($ev) {
  $dpr = [double]$ev.dpr; if ($dpr -le 0) { $dpr = 1.0 }
  # screenX/outerWidth are OS-scaled CSS px, not browser-zoomed ones: the hint uses the OS scale (screen width in
  # device px over the page's screen.width) so a zoomed page still points at the right window
  $os = $dpr; if ([double]$ev.sw -gt 0) { $sw = [BW]::GetSystemMetrics(0); if ($sw -gt 0) { $os = $sw / [double]$ev.sw } }
  $hx = [int]([double]$ev.sx * $os); $hy = [int]([double]$ev.sy * $os); $hw = [int]([double]$ev.ow * $os); $hh = [int]([double]$ev.oh * $os)
  $title = [string]$ev.title; if (-not $title) { $title = 'Supercomputer' }
  $h = [IntPtr]::Zero
  if ($script:hostWin -ne [IntPtr]::Zero -and [BW]::IsWindow($script:hostWin) -and [BW]::IsWindowVisible($script:hostWin)) {
    $sb = New-Object System.Text.StringBuilder 512; [BW]::GetWindowText($script:hostWin, $sb, 512) | Out-Null
    if ($sb.ToString().Contains($title)) { $h = $script:hostWin }     # the app window we already live in: keep it
  }
  if ($h -eq [IntPtr]::Zero) { $h = [BW]::FindHost($title, $hx, $hy, $hw, $hh) }
  if ($h -eq [IntPtr]::Zero) { Out "E app window not found"; return }
  if ($h -ne $script:hostWin) {
    $script:hostWin = $h
    Strip
    [BW]::SetWindowLongPtr($script:hwnd, $GWLP_HWNDPARENT, $h) | Out-Null
    $r = Rect $h; Out "W $h $($r.L) $($r.T) $($r.Rt - $r.L) $($r.B - $r.T)"
  }
  # the viewport sits at the bottom of the app window's client area (the app's own title bar is above it)
  $script:rel = @{ x = [double]$ev.x * $dpr; y = [double]$ev.y * $dpr; w = [double]$ev.w * $dpr; h = [double]$ev.h * $dpr; vh = [double]$ev.vh * $dpr; vw = [double]$ev.vw * $dpr }
  $script:last = ''
  Track
}
function Track {
  if ($script:hostWin -eq [IntPtr]::Zero -or $null -eq $script:rel) { return }
  if (-not [BW]::IsWindow($script:hostWin)) { Out "E host closed"; $script:quit = $true; return }
  if ([BW]::IsIconic($script:hostWin)) { return }     # owned windows hide with a minimized owner on their own
  $cr = New-Object BW+R; [BW]::GetClientRect($script:hostWin, [ref]$cr) | Out-Null
  $pt = New-Object BW+PT; [BW]::ClientToScreen($script:hostWin, [ref]$pt) | Out-Null
  $cw = $cr.Rt - $cr.L; $ch = $cr.B - $cr.T
  if ($cw -lt 50 -or $ch -lt 50) { return }
  $top = $pt.Y + $ch - $script:rel.vh; $left = $pt.X + ($cw - $script:rel.vw) / 2.0
  $x = [int][Math]::Round($left + $script:rel.x); $y = [int][Math]::Round($top + $script:rel.y)
  $w = [int][Math]::Round($script:rel.w); $hh = [int][Math]::Round($script:rel.h)
  $key = "$x $y $w $hh $($script:visible)"
  if ($key -eq $script:last) { return }
  $script:last = $key
  if ($w -lt 40 -or $hh -lt 40 -or -not $script:visible) { [BW]::ShowWindow($script:hwnd, 0) | Out-Null; return }
  [BW]::SetWindowPos($script:hwnd, [IntPtr]0, $x, $y, $w, $hh, 0x0010 -bor 0x0040) | Out-Null     # NOACTIVATE | SHOWWINDOW
  Out "P $x $y $w $hh"
}
function Handle($ev) {
  switch ($ev.k) {
    'place' { Place $ev }
    'show'  { $script:visible = $true; $script:last = ''; Track }
    'hide'  { $script:visible = $false; $script:last = ''; [BW]::ShowWindow($script:hwnd, 0) | Out-Null }
    'quit'  { $script:quit = $true }
  }
}

while (-not $script:quit) {
  while ($queue.Count -gt 0) { $line = $queue.Dequeue(); try { $ev = $line | ConvertFrom-Json; Handle $ev } catch { Out "E $($_.Exception.Message)" } }
  if (-not [BW]::IsWindow($hwnd)) { Out "E window closed"; break }
  Track
  Start-Sleep -Milliseconds 40
}
