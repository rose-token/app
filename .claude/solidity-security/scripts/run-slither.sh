#!/bin/bash
# run-slither.sh - Run Slither and format output for Claude analysis

set -e

CONTRACT_PATH="${1:-./contracts}"
OUTPUT_FILE="${2:-slither-output.json}"

# Check if slither is installed
if ! command -v slither &> /dev/null; then
    echo "Installing slither-analyzer..."
    pip install slither-analyzer --break-system-packages -q
fi

echo "🔍 Running Slither on: $CONTRACT_PATH"
echo "---"

# Run Slither with JSON output
# Continue even if slither returns non-zero (it does when findings exist)
slither "$CONTRACT_PATH" \
    --json "$OUTPUT_FILE" \
    --exclude-dependencies \
    --exclude-optimization \
    2>&1 || true

# Check if output was created
if [ -f "$OUTPUT_FILE" ]; then
    echo "✅ Analysis complete: $OUTPUT_FILE"
    
    # Quick summary
    if command -v jq &> /dev/null; then
        HIGH=$(jq '[.results.detectors[] | select(.impact == "High")] | length' "$OUTPUT_FILE" 2>/dev/null || echo "?")
        MEDIUM=$(jq '[.results.detectors[] | select(.impact == "Medium")] | length' "$OUTPUT_FILE" 2>/dev/null || echo "?")
        LOW=$(jq '[.results.detectors[] | select(.impact == "Low")] | length' "$OUTPUT_FILE" 2>/dev/null || echo "?")
        INFO=$(jq '[.results.detectors[] | select(.impact == "Informational")] | length' "$OUTPUT_FILE" 2>/dev/null || echo "?")
        
        echo ""
        echo "📊 Summary:"
        echo "   High: $HIGH"
        echo "   Medium: $MEDIUM"
        echo "   Low: $LOW"
        echo "   Info: $INFO"
    fi
else
    echo "❌ Slither failed to produce output"
    exit 1
fi
