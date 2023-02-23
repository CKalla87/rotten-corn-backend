import express, { Express } from 'express';

import { RottenCornServer } from './setupServer';

class Application {
    public initialize(): void {
        const app: Express = express();
        const server: RottenCornServer = new RottenCornServer(app);
        server.start();
    }
}

const application: Application = new Application();
application.initialize();