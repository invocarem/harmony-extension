const webpack = require('webpack');
const config = require('./webpack.config.js');
webpack(config, (err, stats) => {
  if (err) {
    console.error(err);
    return;
  }
  if (stats.hasErrors()) {
    console.log(stats.toJson().errors[0]);
  }
});
