const path = require('path');
const webpack = require('webpack');

module.exports = {
  target: 'node',
  mode: 'development',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  plugins: [
    // Ignore webview modules completely - they're compiled separately
    new webpack.IgnorePlugin({
      checkResource(resource, context) {
        // Ignore any imports from webview directory
        if (/src[\\/]webview/.test(context) || /src[\\/]webview/.test(resource)) {
          return true;
        }
        return false;
      }
    })
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: (modulePath) => {
          // Convert to string for regex matching
          const pathStr = modulePath.toString();
          const normalizedPath = pathStr.replace(/\\/g, '/');
          
          // Exclude node_modules
          if (/node_modules/.test(normalizedPath)) {
            return true;
          }
          
          // Exclude webview directory and all its subdirectories
          // Must match src/webview/ to avoid matching webviewManager.ts
          if (/src\/webview\//.test(normalizedPath)) {
            return true;
          }
          
          // Exclude test files
          if (/__tests__/.test(normalizedPath) || /\.(test|spec)\.ts$/.test(normalizedPath)) {
            return true;
          }
          
          return false;
        },
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.json'),
            compilerOptions: {
              lib: ['ES2020'], // Don't include DOM types for extension build
            },
            // Don't report errors for excluded files
            reportFiles: [
              'src/**/*.{ts,tsx}',
              '!src/webview/**/*',
              '!src/__tests__/**/*'
            ]
          }
        }
      }
    ]
  }
};
