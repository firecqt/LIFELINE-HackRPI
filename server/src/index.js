import 'dotenv/config';
import { app } from './server.js';
import * as IPC from './ipc.js';
import * as DB from './db.js';
import * as Stream from './stream.js';

async function start() {
    await DB.connect();
    IPC.openClient();

    const port = Number(process.env.PORT ?? 3000);
    const server = app.listen(port, () => {
        console.log(`App live on port ${port}`);
    });
    Stream.start(server);

    // Function to handle graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\nReceived ${signal}. Closing server, IPC client and database...`);
        
        // 1. Close WebSockets and the frame subscriber (open sockets would keep the HTTP server open),
        //    then stop accepting new HTTP requests
        Stream.close();
        server.close(async () => {
            console.log('HTTP server closed.');

            // 2. Close the IPC client connection
            try {
                IPC.closeClient();
                console.log('IPC client closed successfully.');
            } catch (err) {
                console.error('Error closing IPC client:', err);
            }

            // 3. Close the MongoDB connection
            try {
                await DB.close();
                console.log('MongoDB connection closed.');
            } catch (err) {
                console.error('Error closing MongoDB connection:', err);
            }
            
            process.exit(0);
        });

        // Force exit if things hang for more than 5 seconds
        setTimeout(() => {
            console.error('Could not close connections in time, forcefully shutting down');
            process.exit(1);
        }, 5000);
    };

    // Listen for termination signals (Ctrl+C, kill, etc.)
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
    console.error('Failed to start application:', err);
    process.exit(1);
});