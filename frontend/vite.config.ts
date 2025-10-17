import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-friendly config:
// - Exposes dev server on 0.0.0.0 (for Docker)
// - Proxies /api/* -> backend app (Docker service name: app), removing /api prefix
export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        strictPort: true,
        watch: {
            // Reliable file-watching inside containers
            usePolling: true
        },
        proxy: {
            '/api': {
                target: 'http://app:3000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '')
            }
        }
    },
    preview: {
        port: 5173
    }
});
