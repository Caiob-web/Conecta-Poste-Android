// api/index.js
const serverless = require("serverless-http");
const expressApp = require("../server");      // seu server.js exportando 'app'
module.exports = serverless(expressApp);
