# Test helper (not used by the app): describes the Blender window of a process as JSON.
# {found, visible, caption, toolwindow, taskbar, owner, ownerTitle, x, y, w, h}
param([int]$BlenderPid)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class BC {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  public static IntPtr Find(uint pid) { IntPtr f = IntPtr.Zero; long best = -1; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().Contains("Blender")) { R r; GetWindowRect(h, out r); long a = (long)(r.Rt - r.L) * (r.B - r.T); if (a > best) { best = a; f = h; } } } return true; }, IntPtr.Zero); return f; }
  public static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
}
"@
[BC]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$h = [BC]::Find([uint32]$BlenderPid)
if ($h -eq [IntPtr]::Zero) { '{"found":false}'; exit 0 }
$r = New-Object BC+R; [BC]::GetWindowRect($h, [ref]$r) | Out-Null
$st = [long][BC]::GetWindowLongPtr($h, -16); $ex = [long][BC]::GetWindowLongPtr($h, -20)
$owner = [BC]::GetWindow($h, 4)
$o = @{ found = $true; visible = [BC]::IsWindowVisible($h); caption = (($st -band 0x00C00000L) -ne 0); toolwindow = (($ex -band 0x80L) -ne 0); taskbar = (($ex -band 0x40000L) -ne 0); owner = [string]$owner; ownerTitle = $(if ($owner -ne [IntPtr]::Zero) { [BC]::Title($owner) } else { '' }); x = $r.L; y = $r.T; w = $r.Rt - $r.L; h = $r.B - $r.T }
$o | ConvertTo-Json -Compress
