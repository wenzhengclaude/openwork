!macro customInit
  Delete "$SMPROGRAMS\OpenWork.lnk"
  Delete "$SMPROGRAMS\Open One.lnk"
  Delete "$DESKTOP\OpenWork.lnk"
  Delete "$DESKTOP\Open One.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\OpenWork.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Open One.lnk"
!macroend

!macro customUnInstall
  StrCpy $1 ""
  FileOpen $0 "$APPDATA\com.differentai.openwork\windows-brand-shortcut.txt" r
  IfErrors +3
    FileRead $0 $1
    FileClose $0
  ${If} $1 != ""
    Delete "$1"
  ${EndIf}
  Delete "$APPDATA\com.differentai.openwork\windows-brand-shortcut.txt"
!macroend
