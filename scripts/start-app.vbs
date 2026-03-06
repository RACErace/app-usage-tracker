Dim shell
Dim fso
Dim scriptDir
Dim appRoot
Dim nodePath
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appRoot = fso.GetParentFolderName(scriptDir)
nodePath = "C:\Program Files\nodejs\node.exe"

If Not fso.FileExists(nodePath) Then
  nodePath = "node"
End If

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & fso.BuildPath(scriptDir, "start-detached.js") & Chr(34)
shell.CurrentDirectory = appRoot
shell.Run command, 0, False