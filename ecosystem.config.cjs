module.exports = {
  apps: [
    {
      name: 'herenow-api',
      cwd: __dirname,
      script: 'apps/api/dist/apps/api/src/server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      time: true,
      restart_delay: 3000,
      kill_timeout: 10000,
      max_memory_restart: '512M',
    },
  ],
};
