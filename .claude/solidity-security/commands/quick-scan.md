---
name: quick-scan
description: Fast Slither scan with minimal output - just high/medium findings
arguments:
  - name: path
    description: Path to contracts (default: ./contracts)
    required: false
---

# Quick Security Scan

Fast scan showing only high and medium severity issues.

## Steps

1. Run Slither with severity filter:
   ```bash
   slither ${path:-./contracts} --json /tmp/slither-quick.json --exclude-dependencies --exclude-low --exclude-informational 2>&1 || true
   ```

2. Parse JSON and output summary table:
   | Severity | Detector | Location | Description |
   |----------|----------|----------|-------------|
   | High     | ...      | ...      | ...         |

3. If no findings: "✅ No high/medium issues detected"

4. If findings exist, list top 5 most critical with one-line descriptions.

## Output
Keep it brief - this is for quick CI checks or pre-commit validation.
