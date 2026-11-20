param([Parameter(Mandatory = $true)][string]$Wav)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Speech
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo('zh-CN')
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToWaveFile($Wav)
  # Call Recognize exactly once. Some SAPI builds block forever instead of
  # returning null once the wave file is exhausted, so do not loop.
  $result = $engine.Recognize()
  $text = ''
  if ($null -ne $result -and $result.Text) { $text = $result.Text.Trim() }
  @{ ok = $true; text = $text } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
