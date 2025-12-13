---
name: solidity-audit
description: Run comprehensive Solidity security audit using Slither + AI analysis
arguments:
  - name: path
    description: Path to contracts directory or specific .sol file (default: ./contracts)
    required: false
---

# Solidity Security Audit

Run a comprehensive security audit on Solidity smart contracts.

## Steps

1. **Check Slither installation**
   ```bash
   which slither || pip install slither-analyzer --break-system-packages
   ```

2. **Run Slither analysis**
   ```bash
   slither ${path:-./contracts} --json slither-output.json --exclude-dependencies 2>&1 || true
   ```

3. **Parse and analyze findings**
   Read `slither-output.json` and categorize by severity:
   - **High**: Reentrancy, unchecked external calls, unprotected selfdestruct, arbitrary send
   - **Medium**: Missing access control, state variable shadowing, dangerous delegatecall
   - **Low**: Unused returns, missing zero-address checks, floating pragma
   - **Info**: Naming conventions, optimization suggestions

4. **Check for DeFi/Governance-specific vulnerabilities**
   Manually review for:
   - Flash loan attack vectors
   - Oracle manipulation risks
   - Governance manipulation (vote buying, delegation attacks)
   - Front-running vulnerabilities (sandwich attacks)
   - Timestamp dependence in voting/staking logic
   - Centralization risks (admin keys, upgradability)
   - Economic exploits (inflation attacks, rounding errors)

5. **Generate report**
   Create a markdown report with:
   - Executive summary
   - Critical/High findings with code locations
   - Medium findings
   - Low/Informational items
   - Recommendations for each issue
   - Gas optimization suggestions

## Output Format

```markdown
# Security Audit Report
**Contract(s)**: [names]
**Date**: [date]
**Tools**: Slither [version], Manual Review

## Summary
- Critical: X
- High: X  
- Medium: X
- Low: X

## Critical Findings
### [C-1] Title
**Location**: `Contract.sol:L123`
**Description**: ...
**Recommendation**: ...

[continue for all findings...]
```

## Notes
- If Slither fails (missing dependencies, compilation errors), report the error and attempt manual analysis
- Always check for Rose Protocol-specific patterns: reputation gaming, treasury drainage, governance manipulation
- Cross-reference with known vulnerability databases (SWC Registry)
