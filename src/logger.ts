import pino from 'pino';
import { config } from './config.js';

/** Single shared structured logger — no `console.log` in application code. */
export const logger = pino({ level: config.logLevel });
