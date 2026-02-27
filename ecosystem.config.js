// ecosystem.config.js — PM2 Process Manager Configuration
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 start ecosystem.config.js --env production
//   pm2 reload ecosystem.config.js --env production

module.exports = {
  apps: [
    {
      name: 'satubooster-telephony',
      script: 'src/index.js',

      // Restart policy
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,

      // Memory / CPU limits
      max_memory_restart: '512M',

      // Log files
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Kill timeout (wait before forcing stop)
      kill_timeout: 5000,

      // Environment: Development
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },

      // Environment: Production
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
