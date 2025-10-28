# Rose Token Webhook Server

This Express.js server handles Alchemy webhook events to automatically merge GitHub pull requests when tasks are approved on-chain.

## Features

- **Frontend Serving**: Serves the built React frontend as static files
- **Webhook Processing**: Receives POST requests from Alchemy when `TaskApproved` events are emitted
- **Event Decoding**: Parses smart contract event data to extract GitHub PR URLs
- **Automatic PR Merging**: Uses GitHub API to automatically merge approved PRs
- **Comprehensive Logging**: Logs all webhook activity for debugging

## Architecture

```
┌─────────────┐
│   Alchemy   │
│   Webhook   │
└──────┬──────┘
       │ POST /webhook/task-approved
       ▼
┌─────────────────────┐
│   Express Server    │
│   (server.js)       │
├─────────────────────┤
│ 1. Receive webhook  │
│ 2. Decode event     │
│ 3. Parse PR URL     │
│ 4. Merge PR         │
└──────┬──────────────┘
       │
       ▼
┌─────────────┐
│  GitHub API │
│  (Octokit)  │
└─────────────┘
```

## Smart Contract Event

The `RoseMarketplace` contract emits this event when a task is approved:

```solidity
event TaskApproved(
    uint256 indexed taskId,
    address indexed worker,
    string githubPrUrl
);
```

## Handling Contract Address Updates on Redeploy

**Important**: The marketplace contract address changes every time you redeploy. This requires coordination between the Alchemy webhook and the server.

### Approach 1: Update Alchemy Webhook After Each Deploy (Recommended for Production)

**Pros**: Most secure - only events from your specific contract are processed
**Cons**: Requires manual Alchemy webhook update after each deployment

**Workflow:**
1. Deploy contract → get new address from `deployment-output.json`
2. Update Alchemy webhook configuration with new contract address:
   - Go to Alchemy dashboard → Your webhook
   - Update "Address" field with new contract address from `deployment-output.json`
3. Restart server (it will auto-load new address from `deployment-output.json`)

The server will automatically read the contract address from `deployment-output.json` and verify that webhook events match.

### Approach 2: Watch All Activity + Server-Side Filtering (Easier for Development)

**Pros**: No Alchemy reconfiguration needed after redeploys
**Cons**: Server receives more webhook traffic (events from all contracts)

**Setup:**
1. Configure Alchemy webhook as "Address Activity" webhook **WITHOUT** specifying a contract address
   - Or use "Custom Webhook" with broader filters
2. Server automatically reads contract address from `deployment-output.json`
3. Server filters out events from wrong contracts
4. On redeploy:
   - Just restart the server (picks up new `deployment-output.json`)
   - No Alchemy configuration change needed

**Configuration:**
```env
# No MARKETPLACE_ADDRESS needed - auto-reads from deployment-output.json
GITHUB_TOKEN=ghp_...
```

### How the Server Finds the Contract Address

The server uses this priority order:

1. **Environment Variable** (if set): `MARKETPLACE_ADDRESS=0x...`
2. **Deployment Artifact** (automatic): Reads `deployment-output.json`
3. **No Verification** (warning mode): Accepts events from any contract

**Example `deployment-output.json`:**
```json
{
  "roseMarketplace": "0x1234...abcd",
  "roseToken": "0x5678...efgh",
  "timestamp": "2025-10-28T00:00:00.000Z"
}
```

The server automatically reads `roseMarketplace` from this file on startup.

### Recommended Development Workflow

1. **Initial Deployment:**
   ```bash
   npm run deploy:sepolia
   # Creates deployment-output.json with contract addresses
   ```

2. **Start Webhook Server:**
   ```bash
   npm start
   # Server loads marketplace address from deployment-output.json
   # Logs: "📄 Loaded marketplace address from deployment-output.json"
   ```

3. **Configure Alchemy:**
   - **Option A** (production): Set specific contract address from `deployment-output.json`
   - **Option B** (development): Use address activity webhook without filtering

4. **After Redeployment:**
   ```bash
   # Deploy new version
   npm run deploy:sepolia
   # deployment-output.json is updated with NEW address

   # Restart server to pick up new address
   npm start
   # Server automatically loads new address

   # Option A users: Update Alchemy webhook with new address
   # Option B users: No Alchemy changes needed
   ```

### Verification in Server Logs

When webhook is received, server logs show verification:

**If address matches:**
```
Contract address: 0x1234...abcd
✅ Marketplace address: 0x1234...abcd
   (Contract address verification ENABLED)
```

**If address doesn't match:**
```
Contract address: 0x5678...efgh
❌ Contract address mismatch!
   Expected: 0x1234...abcd
   Received: 0x5678...efgh
Skipping event from unexpected contract address
```

**If not configured:**
```
⚠️  WARNING: MARKETPLACE_ADDRESS not configured - accepting events from ANY contract
   Set MARKETPLACE_ADDRESS environment variable to enable verification
```

## Installation

### 1. Install Dependencies

```bash
npm install
```

This installs:
- `express` - Web server framework
- `@octokit/rest` - GitHub API client
- `ethers` - Ethereum library for event decoding
- `dotenv` - Environment variable management

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:

```env
# Server port (default: 3000)
PORT=3000

# GitHub personal access token
# Create at: https://github.com/settings/tokens
# Required scopes: repo (full control)
GITHUB_TOKEN=ghp_your_token_here

# Optional: Alchemy webhook secret for signature verification
ALCHEMY_WEBHOOK_SECRET=your_secret_here
```

### 3. Create GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name: "Rose Token Webhook Server"
4. Select scopes:
   - ✅ **repo** (Full control of private repositories)
5. Generate token and copy it to your `.env` file

**Important**: Keep this token secure! Anyone with this token can access your repositories.

## Running the Server

### Development Mode (with auto-reload)

```bash
npm run dev
```

Uses `nodemon` to automatically restart the server when code changes.

### Production Mode

```bash
npm start
```

Runs the server directly with Node.js.

### Test Server

```bash
# Start server in one terminal
npm start

# In another terminal, run tests
node test-server.js
```

## Endpoints

### `GET /health`

Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-28T00:00:00.000Z",
  "service": "rose-token-webhook-server"
}
```

### `POST /webhook/task-approved`

Receives Alchemy webhook events for `TaskApproved` events.

**Expected Payload:**
```json
{
  "webhookId": "wh_...",
  "id": "whevt_...",
  "createdAt": "2025-10-27T...",
  "type": "ADDRESS_ACTIVITY",
  "event": {
    "network": "ETH_SEPOLIA",
    "activity": [
      {
        "fromAddress": "0x...",
        "toAddress": "0x...",
        "blockNum": "0x...",
        "hash": "0x...",
        "log": {
          "address": "YOUR_CONTRACT_ADDRESS",
          "topics": ["0x...", "0x..."],
          "data": "0x..."
        }
      }
    ]
  }
}
```

**Response:**
- Always returns `200 OK` (prevents Alchemy retries on permanent failures)
- Check server logs for processing details

### `GET /*`

Serves the React frontend (all unmatched routes return `index.html`).

## Deployment

### Railway Deployment

1. **Connect Repository:**
   - Go to [railway.app](https://railway.app)
   - Create new project from GitHub repo
   - Railway auto-detects Node.js

2. **Set Environment Variables:**
   - Go to project settings → Variables
   - Add `GITHUB_TOKEN` with your personal access token
   - `PORT` is automatically set by Railway

3. **Deploy:**
   - Railway auto-deploys on every git push to main branch
   - Your server will be available at: `https://your-app.railway.app`

### Other Platforms (Render, Heroku, etc.)

Similar process:
1. Connect GitHub repository
2. Set `GITHUB_TOKEN` environment variable
3. Platform will use `npm start` command automatically

## Alchemy Webhook Configuration

Once your server is deployed, configure Alchemy to send webhooks:

1. **Create Alchemy App:**
   - Go to [alchemy.com](https://www.alchemy.com)
   - Create app for Sepolia testnet

2. **Create Webhook:**
   - Go to "Notify" → "Create Webhook"
   - Select "Address Activity"
   - Enter your RoseMarketplace contract address
   - Set webhook URL: `https://your-app.railway.app/webhook/task-approved`
   - Optional: Filter for `TaskApproved` event

3. **Test Webhook:**
   - Approve a task on-chain
   - Check your server logs for webhook processing
   - Verify PR was merged on GitHub

## How It Works

### Event Processing Flow

1. **Alchemy Detects Event:**
   - RoseMarketplace emits `TaskApproved(taskId, worker, githubPrUrl)`
   - Alchemy detects the event and sends webhook

2. **Server Receives Webhook:**
   - POST request arrives at `/webhook/task-approved`
   - Server logs full payload for debugging

3. **Decode Event Data:**
   - Uses ethers.js to decode the log data
   - Extracts: `taskId`, `worker`, `githubPrUrl`

4. **Parse GitHub PR URL:**
   - Regex extracts: `owner`, `repo`, `pull_number`
   - Example: `https://github.com/emmadorably/rose-token/pull/123`
     - owner: `emmadorably`
     - repo: `rose-token`
     - pull_number: `123`

5. **Check PR Status:**
   - Fetches PR from GitHub API
   - Verifies PR is open and mergeable
   - Checks for conflicts

6. **Merge PR:**
   - Calls GitHub merge API with commit message:
     ```
     Merged via Rose Token on-chain approval

     Task approved on-chain.
     Worker: 0x1234...
     Automatic merge triggered by Rose Token smart contract approval event.
     ```

7. **Log Result:**
   - Logs success or failure
   - Returns `200 OK` to Alchemy

### Error Handling

The server handles these error cases gracefully:

- **Invalid PR URL format**: Logs error, skips merge
- **PR already merged**: Logs success (idempotent)
- **PR has conflicts**: Logs error, cannot merge
- **PR is closed**: Logs error, cannot merge
- **Insufficient GitHub permissions**: Logs error
- **Network errors**: Logs error, retries on transient failures

All errors return `200 OK` to Alchemy to prevent webhook retries on permanent failures.

## Testing Locally with ngrok

To test webhooks locally before deploying:

1. **Start Server Locally:**
   ```bash
   npm start
   ```

2. **Expose Localhost with ngrok:**
   ```bash
   ngrok http 3000
   ```

   Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

3. **Configure Alchemy Webhook:**
   - Set webhook URL to: `https://abc123.ngrok.io/webhook/task-approved`

4. **Approve Task on Testnet:**
   - Create and approve a task on Sepolia
   - Watch server logs for webhook processing

5. **Verify PR Merged:**
   - Check GitHub to confirm PR was merged automatically

## Logging

The server provides comprehensive logging:

```
=== Webhook received ===
Timestamp: 2025-10-28T00:00:00.000Z
Webhook ID: wh_xyz123
Event type: ADDRESS_ACTIVITY
Full payload: { ... }

--- Processing activity ---
Transaction hash: 0xabc...
Block number: 0x123456

Decoded event data:
  Task ID: 42
  Worker: 0x1234...
  GitHub PR URL: https://github.com/user/repo/pull/123

Parsed PR details:
  Owner: user
  Repo: repo
  PR Number: 123

Attempting to merge PR: user/repo#123
PR state: open, mergeable: true, merged: false
PR merged successfully

✓ SUCCESS: PR merged successfully
=== Webhook processing complete ===
```

## GitHub PR URL Format

Expected format:
```
https://github.com/{owner}/{repo}/pull/{number}
```

Examples:
- ✅ `https://github.com/emmadorably/rose-token/pull/123`
- ✅ `http://github.com/user/repo/pull/1`
- ❌ `https://github.com/user/repo/issues/123` (issues not supported)
- ❌ `invalid-url`

## Security Considerations

1. **GitHub Token Security:**
   - Never commit `.env` file to git (already in `.gitignore`)
   - Use environment variables in production
   - Rotate token if compromised

2. **Webhook Verification:**
   - Optional: Implement Alchemy signature verification
   - Add `ALCHEMY_WEBHOOK_SECRET` to verify requests are from Alchemy

3. **Rate Limiting:**
   - Consider adding rate limiting for webhook endpoint
   - Prevents abuse if webhook URL is discovered

4. **PR Merge Permissions:**
   - GitHub token has full repo access
   - Server can merge any PR in accessible repos
   - Only approve tasks with valid PR URLs

## Troubleshooting

### Server Won't Start

**Check for port conflicts:**
```bash
lsof -i :3000
# Kill process if needed
kill -9 <PID>
```

**Verify dependencies installed:**
```bash
npm install
```

### Webhook Not Received

**Check Alchemy configuration:**
- Verify webhook URL is correct
- Ensure contract address is correct
- Check webhook is active and not paused

**Check server logs:**
```bash
# If deployed on Railway
railway logs

# If running locally
# Check terminal output
```

### PR Not Merging

**Check GitHub token permissions:**
- Token must have `repo` scope
- Token user must have write access to repository

**Check PR status:**
- PR must be open (not closed or already merged)
- PR must not have merge conflicts
- Required checks must be passing (if configured)

**Check server logs for error details:**
```
✗ FAILED: PR has conflicts and cannot be merged
```

## Dependencies

- **express** (^4.18.2): Web server framework
- **@octokit/rest** (^20.0.2): GitHub API client
- **ethers** (^6.9.0): Ethereum library for event decoding
- **dotenv** (^16.5.0): Environment variable management
- **nodemon** (^3.0.2): Development auto-reload (devDependency)

## File Structure

```
rose-token/
├── server.js                 # Main webhook server
├── test-server.js            # Test script for local testing
├── package.json              # Dependencies and scripts
├── .env.example              # Environment variable template
├── .env                      # Local environment variables (git-ignored)
├── WEBHOOK_SERVER.md         # This file
└── frontend/build/           # Built React frontend (served by server)
```

## Next Steps

1. **Deploy to Railway:** Follow deployment instructions above
2. **Configure Alchemy:** Set up webhook with deployed URL
3. **Test End-to-End:** Create and approve a task, verify PR merges
4. **Monitor Logs:** Watch for any errors or issues
5. **Optional Enhancements:**
   - Add webhook signature verification
   - Implement rate limiting
   - Add metrics/monitoring
   - Set up alerts for merge failures

## Support

For issues or questions:
- Check server logs for error details
- Verify GitHub token has correct permissions
- Test webhook endpoint with `test-server.js`
- Review Alchemy webhook delivery logs

---

**Last Updated**: October 2024
**Node Version**: 18.x
**Network**: Sepolia (chainId: 11155111)
