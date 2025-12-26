const path = require('path');

module.exports = {
  target: 'web',
  mode: 'development',
  entry: './src/webview/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'main.js',
    libraryTarget: 'var',
    library: 'webview'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: 'tsconfig.webview.json'
          }
        }
      }
    ]
  },
  devtool: 'source-map'
};

