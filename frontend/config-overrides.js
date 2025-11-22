module.exports = function override(config) {
  const fallback = config.resolve.fallback || {};
  Object.assign(fallback, {
    "stream": require.resolve("stream-browserify"),
    "assert": require.resolve("assert"),
    "http": require.resolve("stream-http"),
    "https": require.resolve("https-browserify"),
    "os": require.resolve("os-browserify"),
    "url": require.resolve("url"),
    "buffer": require.resolve("buffer"),
    "process": require.resolve("process/browser"),
    "crypto": false, // Use browser's native crypto
    "zlib": false,
    "path": false,
    "fs": false,
    // Stub out React Native dependencies that aren't needed for web
    "@react-native-async-storage/async-storage": false,
    "react-native": false,
  });
  config.resolve.fallback = fallback;

  // Fix for ESM modules requiring fully specified imports
  config.module.rules.push({
    test: /\.m?js$/,
    resolve: {
      fullySpecified: false,
    },
  });

  // Handle ESM-only packages like openapi-fetch (used by WalletConnect)
  config.module.rules.push({
    test: /\.js$/,
    include: /node_modules/,
    type: 'javascript/auto',
    resolve: {
      fullySpecified: false,
    },
  });

  config.plugins = (config.plugins || []).concat([
    new (require('webpack')).ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    })
  ]);

  // Ignore warnings for optional dependencies and React Native modules
  config.ignoreWarnings = [
    /Failed to parse source map/,
    /Critical dependency: the request of a dependency is an expression/,
    /@react-native-async-storage\/async-storage/,
    /react-native/,
    /openapi-fetch/,
    /Can't resolve 'encoding'/,
    /punycode/,
  ];

  config.output.filename = 'static/js/[name].[contenthash:8].[fullhash:8].js';
  config.output.chunkFilename = 'static/js/[name].[contenthash:8].[fullhash:8].chunk.js';

  const miniCssExtractPlugin = config.plugins.find(
    plugin => plugin.constructor.name === 'MiniCssExtractPlugin'
  );
  if (miniCssExtractPlugin) {
    miniCssExtractPlugin.options.filename = 'static/css/[name].[contenthash:8].[fullhash:8].css';
    miniCssExtractPlugin.options.chunkFilename = 'static/css/[name].[contenthash:8].[fullhash:8].chunk.css';
  }

  return config;
};
