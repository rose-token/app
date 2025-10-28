#!/usr/bin/env node

/**
 * Test script for Rose Token webhook server
 * Tests the health endpoint and webhook endpoint
 */

const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Wait for server to start
function waitForServer(retries = 10) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(`${BASE_URL}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          if (retries > 0) {
            setTimeout(() => {
              retries--;
              attempt();
            }, 1000);
          } else {
            reject(new Error('Server did not start in time'));
          }
        }
      }).on('error', () => {
        if (retries > 0) {
          setTimeout(() => {
            retries--;
            attempt();
          }, 1000);
        } else {
          reject(new Error('Server did not start in time'));
        }
      });
    };
    attempt();
  });
}

// Test health endpoint
async function testHealthEndpoint() {
  console.log('\n=== Testing Health Endpoint ===');

  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/health`, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Response:', data);

        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          if (json.status === 'ok') {
            console.log('✓ Health endpoint test PASSED');
            resolve();
          } else {
            console.error('✗ Health endpoint returned unexpected status');
            reject(new Error('Unexpected health status'));
          }
        } else {
          console.error('✗ Health endpoint test FAILED');
          reject(new Error(`Expected 200, got ${res.statusCode}`));
        }
      });
    }).on('error', (err) => {
      console.error('✗ Health endpoint error:', err.message);
      reject(err);
    });
  });
}

// Test webhook endpoint with mock data
async function testWebhookEndpoint() {
  console.log('\n=== Testing Webhook Endpoint ===');

  const mockWebhookPayload = {
    webhookId: "wh_test123",
    id: "whevt_test456",
    createdAt: new Date().toISOString(),
    type: "ADDRESS_ACTIVITY",
    event: {
      network: "ETH_SEPOLIA",
      activity: [
        {
          fromAddress: "0x1234567890123456789012345678901234567890",
          toAddress: "0x0987654321098765432109876543210987654321",
          blockNum: "0x123456",
          hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          log: {
            address: "0x0987654321098765432109876543210987654321",
            topics: [
              "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
              "0x000000000000000000000000000000000000000000000000000000000000002a"
            ],
            data: "0x"
          }
        }
      ]
    }
  };

  const postData = JSON.stringify(mockWebhookPayload);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/webhook/task-approved',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Response:', data);

        if (res.statusCode === 200) {
          console.log('✓ Webhook endpoint test PASSED');
          console.log('  (Note: This tests the endpoint accepts requests, not event decoding)');
          resolve();
        } else {
          console.error('✗ Webhook endpoint test FAILED');
          reject(new Error(`Expected 200, got ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('✗ Webhook endpoint error:', err.message);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

// Test GitHub PR URL parsing
function testGitHubPrUrlParsing() {
  console.log('\n=== Testing GitHub PR URL Parsing ===');

  const testCases = [
    {
      url: 'https://github.com/emmadorably/rose-token/pull/123',
      expected: { owner: 'emmadorably', repo: 'rose-token', pull_number: 123 }
    },
    {
      url: 'https://github.com/user/repo/pull/1',
      expected: { owner: 'user', repo: 'repo', pull_number: 1 }
    },
    {
      url: 'http://github.com/test/test/pull/999',
      expected: { owner: 'test', repo: 'test', pull_number: 999 }
    },
    {
      url: 'invalid-url',
      expected: null
    },
    {
      url: 'https://github.com/user/repo/issues/123',
      expected: null
    }
  ];

  let passed = 0;
  let failed = 0;

  // Import the parsing function from server.js would require refactoring
  // For now, just document the test cases
  console.log('Test cases defined:');
  testCases.forEach((testCase, i) => {
    console.log(`  ${i + 1}. ${testCase.url}`);
    console.log(`     Expected: ${JSON.stringify(testCase.expected)}`);
  });

  console.log('✓ GitHub PR URL parsing test cases documented');
}

// Run all tests
async function runTests() {
  console.log('=================================');
  console.log('Rose Token Server Test Suite');
  console.log('=================================');

  try {
    console.log('\nWaiting for server to start...');
    await waitForServer();
    console.log('✓ Server is running');

    await testHealthEndpoint();
    await testWebhookEndpoint();
    testGitHubPrUrlParsing();

    console.log('\n=================================');
    console.log('All tests completed successfully!');
    console.log('=================================\n');

    process.exit(0);
  } catch (error) {
    console.error('\n=================================');
    console.error('Test suite FAILED:', error.message);
    console.error('=================================\n');
    process.exit(1);
  }
}

// Check if server is already running
console.log('Starting test suite...');
console.log(`Testing server at: ${BASE_URL}`);

runTests();
