function UglifyFiles($sourceDirectory, $outputDirectory) {
    if (-not (Test-Path -Path $outputDirectory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $outputDirectory
    }

    Get-ChildItem "$sourceDirectory\*.js" | ForEach-Object {
        $fileName = $_.Name
        $outputFileName = Join-Path $outputDirectory $fileName
        uglifyjs $_.FullName -o $outputFileName
    }
}

UglifyFiles ".\lib-unminified" ".\lib"
UglifyFiles ".\scripts-unminified" ".\scripts"
UglifyFiles ".\test-unminified" ".\test"
