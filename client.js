import grpc from '@grpc/grpc-js';
import fs from 'fs'
import protoLoader from '@grpc/proto-loader';
import path from 'path';

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

const client = new proto.DNSServer('dns-server:50051', grpc.credentials.createInsecure());

const file = fs.readFileSync('3rd_lev_domains.csv', 'utf8');
let domains = file.split('\n').map(line => line.trim()).filter(domain => domain);


const QUERIES_QTY = 50_000
for (let i = 0; i < QUERIES_QTY; i++) {
  let random_number = Math.floor(Math.random() * (domains.length))
  let domain = domains[random_number]

  client.GetDNSRecord({ domain }, (error, response) => {
    if (error) {
      console.error(`Error for domain ${domain}:`, error);
    } else {
      console.log(`DNS Record for domain ${domain}:`, response.ip);
    }
  });
}

