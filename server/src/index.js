import { app } from './server.js';
import * as IPC from './ipc.js';

async function start() {
    IPC.openClient();

    const port = Number(process.env.PORT ?? 3000);
    const server = app.listen(port, () => {
        console.log(`App live on port ${port}`);
    });

    // Function to handle graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\nReceived ${signal}. Closing server and IPC client...`);
        
        // 1. Stop accepting new HTTP requests
        server.close(async () => {
            console.log('HTTP server closed.');
            
            // 2. Safely close your IPC client connection
            try {
                IPC.closeClient();
                console.log('IPC client closed successfully.');
            } catch (err) {
                console.error('Error closing IPC client:', err);
            }
            
            process.exit(0);
        });

        // Force exit if things hang for more than 5 seconds
        setTimeout(() => {
            console.error('Could not close connections in time, forcefully shutting down');
            process.exit(1);
        }, 5000);
    };

    // Listen for termination signals (Ctrl+C, Docker stop, etc.)
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
    console.error('Failed to start application:', err);
    process.exit(1);
});