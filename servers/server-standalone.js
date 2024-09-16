import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'path';
import { exec } from 'child_process';
import { createClient } from 'redis';
import fs from 'fs';
import { parse } from 'json2csv';

// Usé el de la doc, funcionó y no me interesé en probar otras opciones
// https://grpc.io/docs/languages/node/basics/#loading-service-descriptors-from-proto-files
const PROTO_PATH = path.join('.', 'dns.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDefinition).main;

const redisClient = await createClient({
  socket: {
    host: 'redis',
    port: 7000
  }
}).on('error', err => console.log('Redis Client Error', err))
  .connect();

function resolveDomainWithDig(domain) {
  return new Promise((resolve, reject) => {
    exec(`dig +short ${domain}`, (error, stdout) => {
      if (error) {
        console.log("Promise error: ", error)
        reject('Not found');
      } else {
        const ip = stdout.trim() || 'Not found';
        resolve(ip);
      }
    });
  });
}

const metrics = {
  hits: 0,
  misses: 0,
  totalRequests: 0,
  responseTimes: []
};

async function getDNSRecord(call, callback) {
  const domain = call.request.domain;

  metrics.totalRequests++;

  const startTime = Date.now();
  const ip = await redisClient.get(domain);
  if(ip){
    metrics.hits++;
    // console.log(`HIT para el dominio: ${domain}`);
    callback(null, { ip })
  } else {
    // console.log(`MISS para el dominio: ${domain}`);
    metrics.misses++;
    try {
      const ip = await resolveDomainWithDig(domain);

      await redisClient.set(domain, ip);

      callback(null, { ip });
    } catch (err) {
      callback(null, { ip: 'Not found' });
    }
  }

  const endTime = Date.now();
  metrics.responseTimes.push(endTime - startTime);

  // TODO Magic Number Hardcoded.
  if(metrics.totalRequests == 50_000) writeMetricsToCSV();
}

const server = new grpc.Server();
server.addService(proto.DNSServer.service, {
  GetDNSRecord: getDNSRecord, 
});

const PORT = 'dns-server:50051';

server.bindAsync(PORT, grpc.ServerCredentials.createInsecure(), (err, _) => {
  if (err) {
    console.error('Failed to bind server:', err);
    return;
  }
  console.log(`Server running at http://${PORT}`);
});

function writeMetricsToCSV() {
  const averageResponseTime = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
  const stdDevResponseTime = Math.sqrt(metrics.responseTimes.reduce((a, b) => a + Math.pow(b - averageResponseTime, 2), 0) / metrics.responseTimes.length);
  const hitRate = metrics.hits / metrics.totalRequests;
  const missRate = metrics.misses / metrics.totalRequests;

  const data = [{
    'Total Requests': metrics.totalRequests,
    'Hits': metrics.hits,
    'Misses': metrics.misses,
    'Hit Rate': hitRate,
    'Miss Rate': missRate,
    'Average Response Time (ms)': averageResponseTime,
    'Std Dev Response Time (ms)': stdDevResponseTime
  }];

  const csv = parse(data);

  fs.writeFileSync('/app/metrics/metrics-standalone.csv', csv);
  console.log('Metrics saved to metrics-standalone.csv');
}
