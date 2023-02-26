import express, { Express } from 'express';
import { RottenCornServer } from './setupServer';
import databaseConnection from './setupDatabase';

class Application {
    public initialize(): void {
        databaseConnection();
        const app: Express = express();
        const server: RottenCornServer = new RottenCornServer(app);
        server.start();
    }
}

const application: Application = new Application();
application.initialize();