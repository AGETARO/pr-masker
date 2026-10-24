# PR Masker - Lightweight Local Web Server (PowerShell)
# No Node.js or Python required!

$port = 3000
$url = "http://localhost:$port/"
$folder = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
    $listener.Start()
} catch {
    $port = 8080
    $url = "http://localhost:$port/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($url)
    $listener.Start()
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " PR Masker - Local Development & Testing Server" -ForegroundColor Green
Write-Host " URL: $url" -ForegroundColor Yellow
Write-Host " Root Directory: $folder" -ForegroundColor Gray
Write-Host " Press Ctrl+C in this console to stop the server." -ForegroundColor DarkGray
Write-Host "==========================================================" -ForegroundColor Cyan

# Open default browser automatically
Start-Process $url

$mimeMap = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".mjs"  = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".webp" = "image/webp"
    ".svg"  = "image/svg+xml"
    ".wasm" = "application/wasm"
    ".ico"  = "image/x-icon"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # CORS Headers for local development
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Cross-Origin-Opener-Policy", "same-origin")
        $response.AddHeader("Cross-Origin-Embedder-Policy", "credentialless")

        $relPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($relPath)) {
            $relPath = "index.html"
        }

        # Handle API endpoint: /api/generate
        if ($request.Url.LocalPath -eq "/api/generate" -and $request.HttpMethod -eq "POST") {
            $apiKey = $env:GEMINI_API_KEY
            if ([string]::IsNullOrEmpty($apiKey)) {
                $apiKey = $env:GOOGLE_API_KEY
            }

            if ([string]::IsNullOrEmpty($apiKey)) {
                $response.StatusCode = 503
                $response.ContentType = "application/json; charset=utf-8"
                $errJson = '{"error":"GEMINI_API_KEY is not set in environment. Falling back to smart template.","fallback":true}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.OutputStream.Close()
                continue
            }

            try {
                $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                $reqBodyText = $reader.ReadToEnd()
                $reqObj = $reqBodyText | ConvertFrom-Json

                $base64Data = $reqObj.image
                if ($base64Data -match ',') {
                    $base64Data = ($base64Data -split ',')[1]
                }

                $tonePrompts = @{
                    "friendly" = "親しみやすく活気があり、笑顔やポジティブなエネルギーが伝わるカジュアルなSNS（X/Instagram）向け"
                    "formal"   = "誠実で信頼感があり、プレスリリースや公式Facebook、社内報に適した丁寧なビジネス向け"
                    "event"    = "イベントやセミナーが大盛況で活気にあふれている様子を伝える熱意と感謝の文面"
                    "recruit"  = "職場の温かい雰囲気やオープンな社風をアピールし、求職者に響く採用・チーム紹介向け"
                }

                $tone = if ($reqObj.tone -and $tonePrompts.ContainsKey($reqObj.tone)) { $reqObj.tone } else { "friendly" }
                $targetTone = $tonePrompts[$tone]
                $kw = if ($reqObj.keyword) { $reqObj.keyword.Trim() } else { "" }
                $kwPrompt = if ($kw) { "「$kw」というキーワードを自然に含めてください。" } else { "画像から読み取れるテーマに合致させてください。" }

                $systemPrompt = @"
あなたはプロの広報・SNSマーケターです。
添付された画像の内容（人物の表情、人数、場所の雰囲気、行われている活動）を分析し、広報用の投稿文を日本語で作成してください。

【厳格な要件】
1. 文字数は「100文字程度（85文字〜110文字以内）」に厳密に収めてください。
2. トーン＆マナー：$targetTone
3. キーワード：$kwPrompt
4. 最後に文脈に合うハッシュタグを2〜3個付与してください（ハッシュタグを含めて115文字以内に収めてください）。
5. 挨拶や前置き、文字数の注記は一切含めず、投稿文のみを出力してください。
"@

                $model = if ($env:GEMINI_MODEL) { $env:GEMINI_MODEL } else { "gemini-2.5-flash" }
                $geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/$($model):generateContent?key=$apiKey"

                $mime = if ($reqObj.mimeType) { $reqObj.mimeType } else { "image/jpeg" }
                $payload = @{
                    contents = @(
                        @{
                            parts = @(
                                @{ text = $systemPrompt },
                                @{
                                    inlineData = @{
                                        mimeType = $mime
                                        data = $base64Data
                                    }
                                }
                            )
                        }
                    )
                    generationConfig = @{
                        temperature = 0.7
                        maxOutputTokens = 250
                    }
                } | ConvertTo-Json -Depth 5

                $geminiRes = Invoke-RestMethod -Uri $geminiUrl -Method Post -Body $payload -ContentType "application/json; charset=utf-8"
                $outputText = $geminiRes.candidates[0].content.parts[0].text.Trim()

                $resObj = @{
                    success = $true
                    text = $outputText
                    model = $model
                } | ConvertTo-Json

                $response.StatusCode = 200
                $response.ContentType = "application/json; charset=utf-8"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($resObj)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $response.StatusCode = 500
                $response.ContentType = "application/json; charset=utf-8"
                $errJson = @{ error = $_.Exception.Message; fallback = $true } | ConvertTo-Json
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $response.OutputStream.Close()
            continue
        }

        # Normalize path
        $relPath = $relPath -replace '/', '\'
        $filePath = Join-Path $folder $relPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = "application/octet-stream"
            if ($mimeMap.ContainsKey($ext)) {
                $mime = $mimeMap[$ext]
            }

            $response.ContentType = $mime
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relPath")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }

        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
