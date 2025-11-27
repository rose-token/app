require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          },
          viaIR: true
        }
      },
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          },
          viaIR: true
        }
      }
    ]
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    localhost: {
      url: "http://127.0.0.1:8545/",
      chainId: 1337,
    },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 421614,
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 42161,
    },
    tenderly: {
      url: "https://virtual.mainnet.us-west.rpc.tenderly.co/47607c89-e50a-4805-a15c-7d2c55d351f3",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 1,
      gasPrice: "auto"
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY,
      arbitrumOne: process.env.ARBISCAN_API_KEY
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        }
      },
      {
        network: "tenderly",
        chainId: 1,
        urls: {
          apiURL: "https://dashboard.tenderly.co/explorer/vnet/6e9729a9-2365-49cd-aaa0-4a07f31753d2/transactions",
          browserURL: "https://dashboard.tenderly.co/explorer/vnet/6e9729a9-2365-49cd-aaa0-4a07f31753d2/transactions"
        }
      }
    ]
  },
  sourcify: {
    enabled: false
  }
};
