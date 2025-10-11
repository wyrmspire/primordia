// This is a CJS file because pm2 works best with CommonJS.
module.exports = {
  apps : [{
    name   : "primordia-api",
    script : "./src/api/index.js",
    interpreter: "node",
    interpreter_args: "--require dotenv/config"
  }, {
    name   : "primordia-worker",
    script : "./src/worker/index.js",
    interpreter: "node",
    interpreter_args: "--require dotenv/config"
  }]
}
