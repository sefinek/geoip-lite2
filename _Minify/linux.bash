#!/bin/bash

# Function to minimize JavaScript files
function MinifyJSFiles {
    SourceDirectory="$1"
    OutputDirectory="$2"

    # Check if the source directory exists
    if [ ! -d "$SourceDirectory" ]; then
        echo "Source directory does not exist: $SourceDirectory"
        return 1
    fi

    # Remove the existing output directory if it exists
    if [ -d "$OutputDirectory" ]; then
        rm -rf "$OutputDirectory"
    fi

    # Create the output directory
    mkdir -p "$OutputDirectory"

    # Minimize JavaScript files from the source directory and save them to the output directory using Terser
    for file in "$SourceDirectory"/*.js; do
        FileName=$(basename "$file")
        OutputFileName="$OutputDirectory/$FileName"
        npx terser "$file" -o "$OutputFileName" --mangle --ecma 2023 --compress --format quote_style=1 --toplevel --timings --passes=2
    done
}

# Minimize files in the specified directories
MinifyJSFiles "./lib-unminified" "./lib"
MinifyJSFiles "./utils-unminified" "./utils"
MinifyJSFiles "./test-unminified" "./test"
