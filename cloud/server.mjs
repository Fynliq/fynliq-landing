import http from 'node:http';
import { readConfig, createGateway } from './gateway.mjs';

let config;
try { config = readConfig(); }
catch (error) { console.error('Gateway configuration error:', error.message); process.exit(1); }
const server = http.createServer(createGateway(config));
server.requestTimeout = 35000;
server.headersTimeout = 15000;
server.listen(config.port, config.bind, () => console.info('AI gateway listening on ' + config.bind + ':' + config.port));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
