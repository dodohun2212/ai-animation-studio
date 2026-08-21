Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class AiWindowLayout
{
    public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr handle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr handle, StringBuilder title, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr handle, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr handle, int command);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(
        IntPtr handle,
        int x,
        int y,
        int width,
        int height,
        bool repaint
    );
}
'@

function Find-AiWindows {
    $result = @{}
    $codexWindows = [System.Collections.Generic.List[System.IntPtr]]::new()
    $callback = [AiWindowLayout+EnumWindowsProc] {
        param([IntPtr] $handle, [IntPtr] $parameter)

        if (-not [AiWindowLayout]::IsWindowVisible($handle)) {
            return $true
        }

        $className = [System.Text.StringBuilder]::new(256)
        [void] [AiWindowLayout]::GetClassName($handle, $className, $className.Capacity)
        if ($className.ToString() -ne 'CASCADIA_HOSTING_WINDOW_CLASS') {
            return $true
        }

        $title = [System.Text.StringBuilder]::new(512)
        [void] [AiWindowLayout]::GetWindowText($handle, $title, $title.Capacity)
        $text = $title.ToString()

        if ($text -match '^(GPT-5\.6 SOL - MAIN|main|AI-Animation-Studio)$') {
            $result.Main = $handle
        } elseif ($text -match '^(CLAUDE - FRONTEND|claude|frontend)$') {
            $result.Frontend = $handle
        } elseif ($text -match '^(GPT-5\.6 TERRA - BACKEND|backend|AI-Animation-Studio-b.*)$') {
            $result.Backend = $handle
        } elseif ($text -match '^(C:\\WINDOWS\\system32\\cmd\.exe|Windows PowerShell)$') {
            $codexWindows.Add($handle)
        }

        return $true
    }

    [void] [AiWindowLayout]::EnumWindows($callback, [IntPtr]::Zero)

    # The npm Codex launcher changes both Codex titles to cmd.exe. Windows
    # enumerates top-level windows in Z order: Backend is launched last and is
    # first, while Main is launched first and is last.
    if (-not $result.Backend -and $codexWindows.Count -ge 1) {
        $result.Backend = $codexWindows[0]
    }
    if (-not $result.Main -and $codexWindows.Count -ge 2) {
        $result.Main = $codexWindows[$codexWindows.Count - 1]
    }

    return $result
}

$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $windows = Find-AiWindows
    if ($windows.Main -and $windows.Frontend -and $windows.Backend) {
        break
    }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)

if (-not ($windows.Main -and $windows.Frontend -and $windows.Backend)) {
    Write-Warning 'AI windows opened, but automatic layout could not identify all three windows.'
    exit 0
}

$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$columnWidth = [Math]::Floor($area.Width / 2)
$rowHeight = [Math]::Floor($area.Height / 3)
$lastRowHeight = $area.Height - ($rowHeight * 2)

foreach ($handle in @($windows.Main, $windows.Frontend, $windows.Backend)) {
    [void] [AiWindowLayout]::ShowWindowAsync($handle, 9)
}

[void] [AiWindowLayout]::MoveWindow(
    $windows.Main,
    $area.X,
    $area.Y,
    $columnWidth,
    $rowHeight,
    $true
)
[void] [AiWindowLayout]::MoveWindow(
    $windows.Frontend,
    $area.X,
    $area.Y + $rowHeight,
    $columnWidth,
    $rowHeight,
    $true
)
[void] [AiWindowLayout]::MoveWindow(
    $windows.Backend,
    $area.X,
    $area.Y + ($rowHeight * 2),
    $columnWidth,
    $lastRowHeight,
    $true
)
