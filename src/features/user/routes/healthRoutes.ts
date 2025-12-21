import { Router, Request, Response } from 'express';
import express from 'express';
import HTTP_STATUS from 'http-status-codes';
import { config } from '@root/config';
import axios from 'axios';
import moment from 'moment';

class HealthRoutes {
  private router: Router;

  constructor() {
    this.router = express.Router();
  }

  public routes(): Router {
    this.router.get('/health', async (req: Request, res: Response) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mongoose = require('mongoose');
      const dbStatus = mongoose.connection.readyState;
      // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
      const dbStatusText = dbStatus === 1 ? 'connected' : dbStatus === 2 ? 'connecting' : dbStatus === 3 ? 'disconnecting' : 'disconnected';
      
      const healthInfo = {
        status: 'healthy',
        processId: process.pid,
        timestamp: moment().format('LL'),
        database: {
          status: dbStatusText,
          readyState: dbStatus
        }
      };
      
      // If database is not connected, return 503 (Service Unavailable)
      if (dbStatus !== 1) {
        return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
          ...healthInfo,
          status: 'unhealthy',
          message: `Database is ${dbStatusText}. Login will not work until database is connected.`
        });
      }
      
      res.status(HTTP_STATUS.OK).json(healthInfo);
    });

    this.router.get('/env', (req: Request, res: Response) => {
      res.status(HTTP_STATUS.OK).send(`This is the ${config.NODE_ENV} environment.`);
    });

    this.router.get('/instance', async (req: Request, res: Response) => {
      try {
        if (config.EC2_URL) {
          const response = await axios({
            method: 'get',
            url: config.EC2_URL,
            timeout: 2000
          });
          res.status(HTTP_STATUS.OK).send(`Server is running on EC2 instance with id ${response.data} and process id ${process.pid} on ${moment().format('LL')}`);
        } else {
          res.status(HTTP_STATUS.OK).send(`Server is running locally with process id ${process.pid} on ${moment().format('LL')}`);
        }
      } catch (error) {
        res.status(HTTP_STATUS.OK).send(`Server is running locally with process id ${process.pid} on ${moment().format('LL')}`);
      }
    });

    this.router.get('/fibo/:num', async (req: Request, res: Response) => {
      const { num } = req.params;
      const start: number = performance.now();
      const result: number = this.fibo(parseInt(num, 10));
      const end: number = performance.now();
      try {
        if (config.EC2_URL) {
          const response = await axios({
            method: 'get',
            url: config.EC2_URL,
            timeout: 2000
          });
          res.status(HTTP_STATUS.OK).send(
            `Fibonacci series of ${num} is ${result} and it took ${end - start}ms with EC2 instance of ${response.data} and process id ${process.pid} on ${moment().format('LL')}`
          );
        } else {
          res.status(HTTP_STATUS.OK).send(
            `Fibonacci series of ${num} is ${result} and it took ${end - start}ms running locally with process id ${process.pid} on ${moment().format('LL')}`
          );
        }
      } catch (error) {
        res.status(HTTP_STATUS.OK).send(
          `Fibonacci series of ${num} is ${result} and it took ${end - start}ms running locally with process id ${process.pid} on ${moment().format('LL')}`
        );
      }
    });

    return this.router;
  }

  private fibo(data: number): number {
    if (data < 2) {
      return 1;
    } else {
      return this.fibo(data - 2) + this.fibo(data - 1);
    }
  }
}

export const healthRoutes: HealthRoutes = new HealthRoutes();

