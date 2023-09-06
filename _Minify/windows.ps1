<#
.SYNOPSIS
   MinifyJSFiles function minimizes JavaScript files from a source directory and saves them to an output directory using Terser.

.DESCRIPTION
   The MinifyJSFiles function checks if the output directory exists, creates it if it does not exist, and then minimizes all .js files
   from the source directory, saving them with the same names in the output directory.

.PARAMETER SourceDirectory
   The source directory containing the unminimized JavaScript files.

.PARAMETER OutputDirectory
   The output directory where the minimized files will be saved.
#>

function MinifyJSFiles {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory=$true)]
        [string]$SourceDirectory,

        [Parameter(Mandatory=$true)]
        [string]$OutputDirectory
    )

    try {
        # Check if the source directory exists
        if (-not (Test-Path -Path $SourceDirectory -PathType Container)) {
            throw "Source directory does not exist: $SourceDirectory"
        }

        # Remove the existing output directory if it exists
        if (Test-Path -Path $OutputDirectory -PathType Container) {
            Remove-Item -Path $OutputDirectory -Recurse -Force
        }

        # Create the output directory
        New-Item -ItemType Directory -Force -Path $OutputDirectory

        # Minimize JavaScript files from the source directory and save them to the output directory using Terser
        Get-ChildItem "$SourceDirectory\*.js" | ForEach-Object {
            $FileName = $_.Name
            $OutputFileName = Join-Path $OutputDirectory $FileName
            npx terser $_.FullName -o $OutputFileName --mangle --ecma 2023 --format quote_style=1 --toplevel
        }
    }
    catch {
        Write-Error "An error occurred: $_"
    }
}

# Minimize files in the specified directories
MinifyJSFiles -SourceDirectory ".\lib-unminified" -OutputDirectory ".\lib"
MinifyJSFiles -SourceDirectory ".\scripts-unminified" -OutputDirectory ".\scripts"
MinifyJSFiles -SourceDirectory ".\test-unminified" -OutputDirectory ".\test"
