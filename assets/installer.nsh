!macro customInstall
  File /oname=$PLUGINSDIR\update-user-path.ps1 "${BUILD_RESOURCES_DIR}\update-user-path.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action Add -PathEntry "$INSTDIR"'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    File /oname=$PLUGINSDIR\update-user-path.ps1 "${BUILD_RESOURCES_DIR}\update-user-path.ps1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action Remove -PathEntry "$INSTDIR"'
  ${endIf}
!macroend
