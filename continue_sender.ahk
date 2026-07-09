#Requires AutoHotkey v2.0
#SingleInstance Force

; ── CONFIG ───────────────────────────────────────────────────────
TRIGGER_FILE   := "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\continue_trigger.txt"
VSCODE_COMMAND := "Claude Code: Focus input"
; ─────────────────────────────────────────────────────────────────

SetTimer(CheckTrigger, 3000)

CheckTrigger() {
    global TRIGGER_FILE, VSCODE_COMMAND
    if FileExist(TRIGGER_FILE) {
        FileDelete(TRIGGER_FILE)
        Sleep(2000)
        SendContinue(VSCODE_COMMAND)
    }
}

SendContinue(cmd) {
    if !WinExist("ahk_exe Code.exe")
        return

    WinActivate("ahk_exe Code.exe")
    if !WinWaitActive("ahk_exe Code.exe",, 5)
        return

    Sleep(400)
    Send("^+p")
    Sleep(500)
    SendInput(cmd)
    Sleep(400)
    Send("{Enter}")
    Sleep(800)
    SendInput("continue{Enter}")
}
