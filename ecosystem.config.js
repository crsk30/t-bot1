module.exports = {
  apps: [
    {
      name: 'algo-node-gateway',
      script: 'server.js',
      cwd: './backend-node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        PYTHON_API_URL: 'http://127.0.0.1:8000'
      }
    },
    {
      name: 'algotrader-fastapi',
      script: 'uvicorn',
      args: 'main:app --host 127.0.0.1 --port 8000',
      cwd: './backend-python',
      interpreter: './venv/bin/python',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
