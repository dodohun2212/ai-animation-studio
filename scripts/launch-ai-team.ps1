param(
    [Parameter(Mandatory)] [string] $MainDir,
    [Parameter(Mandatory)] [string] $FrontDir,
    [Parameter(Mandatory)] [string] $BackendDir,
    [Parameter(Mandatory)] [string] $CodexCommand,
    [Parameter(Mandatory)] [string] $ClaudeCommand
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class WindowLayout
{
    public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr handle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr handle, StringBuilder className, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr handle, StringBuilder title, int maxCount);

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

function Get-VisibleWindows {
    $handles = [System.Collections.Generic.HashSet[System.IntPtr]]::new()
    $callback = [WindowLayout+EnumWindowsProc] {
        param([IntPtr] $handle, [IntPtr] $parameter)

        $className = [System.Text.StringBuilder]::new(256)
        [void] [WindowLayout]::GetClassName($handle, $className, $className.Capacity)
        if (
            [WindowLayout]::IsWindowVisible($handle) -and
            $className.ToString() -eq 'CASCADIA_HOSTING_WINDOW_CLASS'
        ) {
            [void] $handles.Add($handle)
        }
        return $true
    }
    [void] [WindowLayout]::EnumWindows($callback, [IntPtr]::Zero)
    return ,$handles
}

function Start-TeamWindow {
    param(
        [Parameter(Mandatory)] [string] $Directory,
        [Parameter(Mandatory)] [string] $Command,
        [Parameter(Mandatory)] [string] $Title
    )

    $before = Get-VisibleWindows
    $escapedDirectory = $Directory.Replace("'", "''")
    $script = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location -LiteralPath '$escapedDirectory'; $Command"

    Start-Process powershell.exe -ArgumentList @(
        '-NoLogo',
        '-NoExit',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        $script
    ) | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 200
        $after = Get-VisibleWindows
        $newWindow = $after | Where-Object { -not $before.Contains($_) } | Select-Object -First 1
    } until ($null -ne $newWindow -or [DateTime]::UtcNow -ge $deadline)

    return $newWindow
}

function Get-TeamWindowsByTitle {
    $windows = @{}
    $callback = [WindowLayout+EnumWindowsProc] {
        param([IntPtr] $handle, [IntPtr] $parameter)

        if (-not [WindowLayout]::IsWindowVisible($handle)) {
            return $true
        }

        $title = [System.Text.StringBuilder]::new(512)
        [void] [WindowLayout]::GetWindowText($handle, $title, $title.Capacity)
        $text = $title.ToString()

        if ($text -eq 'GPT-5.6 SOL - MAIN' -or $text -eq 'AI-Animation-Studio') {
            $windows.Main = $handle
        } elseif ($text -eq 'CLAUDE - FRONTEND' -or $text -eq 'claude') {
            $windows.Front = $handle
        } elseif (
            $text -eq 'GPT-5.6 TERRA - BACKEND' -or
            $text -like 'AI-Animation-Studio-b*'
        ) {
            $windows.Backend = $handle
        }
        return $true
    }
    [void] [WindowLayout]::EnumWindows($callback, [IntPtr]::Zero)
    return $windows
}

$mainCommand = "& '$($CodexCommand.Replace("'", "''"))' -m 'gpt-5.6-sol'"
$frontCommand = "& '$($ClaudeCommand.Replace("'", "''"))'"
$backendCommand = "& '$($CodexCommand.Replace("'", "''"))' -m 'gpt-5.6-terra'"

$mainWindow = Start-TeamWindow -Directory $MainDir -Command $mainCommand -Title 'GPT-5.6 SOL - MAIN'
$frontWindow = Start-TeamWindow -Directory $FrontDir -Command $frontCommand -Title 'CLAUDE - FRONTEND'
$backendWindow = Start-TeamWindow -Directory $BackendDir -Command $backendCommand -Title 'GPT-5.6 TERRA - BACKEND'

# Codex and Claude can replace the initial terminal title after startup.
# Resolve those final titles before arranging the windows.
Start-Sleep -Seconds 2
$teamWindows = Get-TeamWindowsByTitle
if ($teamWindows.Main) { $mainWindow = $teamWindows.Main }
if ($teamWindows.Front) { $frontWindow = $teamWindows.Front }
if ($teamWindows.Backend) { $backendWindow = $teamWindows.Backend }

$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$leftWidth = [Math]::Floor($area.Width / 2)
$rightWidth = $area.Width - $leftWidth
$topHeight = [Math]::Floor($area.Height / 2)
$bottomHeight = $area.Height - $topHeight

if ($null -ne $mainWindow) {
    [void] [WindowLayout]::MoveWindow($mainWindow, $area.X, $area.Y, $leftWidth, $area.Height, $true)
}
if ($null -ne $frontWindow) {
    [void] [WindowLayout]::MoveWindow($frontWindow, $area.X + $leftWidth, $area.Y, $rightWidth, $topHeight, $true)
}
if ($null -ne $backendWindow) {
    [void] [WindowLayout]::MoveWindow($backendWindow, $area.X + $leftWidth, $area.Y + $topHeight, $rightWidth, $bottomHeight, $true)
}

if ($null -eq $mainWindow -or $null -eq $frontWindow -or $null -eq $backendWindow) {
    Write-Warning 'Some terminal windows could not be positioned automatically.'
}
