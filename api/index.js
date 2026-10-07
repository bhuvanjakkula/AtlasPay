import server from '../sandbox/server.mjs';

export default async function handler(req, res) {
  return new Promise((resolve) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    server.emit('request', req, res);
  });
}
