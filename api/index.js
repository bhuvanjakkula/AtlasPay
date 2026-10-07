import server from '../sandbox/server.mjs';

export default function handler(req, res) {
  server.emit('request', req, res);
}
