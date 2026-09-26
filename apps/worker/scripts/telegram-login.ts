/**
 * Conecta a CONTA DEDICADA que lê outros grupos/canais (não use o seu número pessoal).
 * Pede telefone, código e senha de 2 etapas; no fim mostra TELEGRAM_USER_SESSION para o .env.
 *
 *   docker compose exec -it worker npm run telegram:login -w @cupons/worker
 */
import '../src/env.js';
import { createInterface } from 'node:readline/promises';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH ?? '';
if (!apiId || !apiHash) {
  console.error('Preencha TELEGRAM_API_ID e TELEGRAM_API_HASH no .env (my.telegram.org → API development tools).');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
await client.start({
  phoneNumber: () => rl.question('Telefone da conta dedicada (com +55): '),
  phoneCode: () => rl.question('Código recebido no Telegram: '),
  password: () => rl.question('Senha de 2 etapas (Enter se não tiver): '),
  onError: (err) => console.error('Erro:', err.message),
});
const me = await client.getMe();
console.log(`\nConectado como ${'firstName' in me ? me.firstName : ''} (@${'username' in me ? me.username : '—'}).`);
console.log('\nColoque no .env (é uma credencial — trate como senha):\n');
console.log(`TELEGRAM_USER_SESSION="${client.session.save() as unknown as string}"\n`);
console.log('Depois: docker compose up -d --force-recreate worker api');
rl.close();
await client.disconnect();
process.exit(0);
