const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

console.log("🚀 Script start ho gayi hai...");

const numbers = fs.readFileSync('numbers.txt', 'utf-8')
    .split('\n')
    .map(n => n.trim().replace(/[^0-9]/g, ''))
    .filter(n => n.length > 5 && n.length < 16);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Files load karo
let validNumbers = [];
let invalidNumbers = [];
let skippedNumbers = []; // <-- NAYA: Jihna nu skip karna hai

if (fs.existsSync('valid.txt')) validNumbers = fs.readFileSync('valid.txt', 'utf-8').split('\n').filter(n => n);
if (fs.existsSync('invalid.txt')) invalidNumbers = fs.readFileSync('invalid.txt', 'utf-8').split('\n').filter(n => n);
if (fs.existsSync('skip.txt')) skippedNumbers = fs.readFileSync('skip.txt', 'utf-8').split('\n').filter(n => n);

// Oh numbers filter karo jo pehla check ho chuke ne ya skip ho chuke ne
const checkedSet = new Set([...validNumbers, ...invalidNumbers, ...skippedNumbers]);
const remainingNumbers = numbers.filter(n => !checkedSet.has(n));

console.log(`⏳ Check karan lyi bache numbers: ${remainingNumbers.length}`);
console.log(`🚫 Skip kite hoye numbers: ${skippedNumbers.length}`);

async function connectToWhatsApp() {
    console.log("🔌 WhatsApp naal connect karan di koshish kar reha haan...");
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys_fast');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '110.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n📸 QR Code scan karo (WhatsApp > Linked Devices):\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Connection closed. Reconnecting in 10s...');
                await delay(10000);
                connectToWhatsApp();
            } else {
                console.log('❌ Logged out. Please scan QR again.');
            }
        } else if (connection === 'open') {
            console.log(`✅ WhatsApp Connected! Checking numbers...`);
            await checkNumbersBatch(sock);
        }
    });
}

async function checkNumbersBatch(sock) {
    const BATCH_SIZE = 5; 
    const totalBatches = Math.ceil(remainingNumbers.length / BATCH_SIZE);
    
    for (let i = 0; i < remainingNumbers.length; i += BATCH_SIZE) {
        const batch = remainingNumbers.slice(i, i + BATCH_SIZE);
        const jids = batch.map(num => `${num}@s.whatsapp.net`);
        const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;

        try {
            console.log(`\n[*] Checking Batch ${currentBatchNum}/${totalBatches} (${batch.length} numbers)...`);
            
            const results = await sock.onWhatsApp(...jids);

            for (let j = 0; j < batch.length; j++) {
                const phoneNumber = batch[j];
                const result = results.find(r => r.jid === jids[j]);
                
                if (result && result.exists) {
                    validNumbers.push(phoneNumber);
                    console.log(`  ✅ ${phoneNumber} -> REGISTERED`);
                } else {
                    invalidNumbers.push(phoneNumber);
                    console.log(`  ❌ ${phoneNumber} -> NOT REGISTERED`);
                }
            }

            // Save progress
            fs.writeFileSync('valid.txt', validNumbers.join('\n'));
            fs.writeFileSync('invalid.txt', invalidNumbers.join('\n'));

            // Delay 8 to 12 seconds
            if (i + BATCH_SIZE < remainingNumbers.length) {
                const randomDelay = Math.floor(Math.random() * 4000) + 8000; 
                await delay(randomDelay);
            }

        } catch (error) {
            console.error(`⚠️ Batch Error:`, error.message);
            
            if (error.message.includes('Connection Closed') || error.message.includes('428') || error.message.includes('stream:error')) {
                console.log('🔌 Socket dropped. Auto-saving progress and waiting 30s...');
                
                // Bache hoye numbers nu save karo taaki data na jaye
                const unchecked = remainingNumbers.slice(i);
                fs.writeFileSync('pending.txt', unchecked.join('\n'));
                
                await delay(30000);
                connectToWhatsApp(); // Reconnect
                return; // Loop stop karo, reconnect ton baad wapas shuru hoga
            } 
            else if (error.message.includes('rate-overlimit') || error.message.includes('429')) {
                console.log('🛑 Rate limit hit! Waiting 60 seconds...');
                await delay(60000);
                i -= BATCH_SIZE; 
            } 
            else {
                console.log('⚠️ Unknown error, skipping batch after 10s...');
                await delay(10000);
            }
        }
    }

    console.log('\n--- ✅ CHECK COMPLETE ---');
    console.log(`Total Valid: ${validNumbers.length}`);
    console.log(`Total Invalid: ${invalidNumbers.length}`);
    process.exit(0); 
}

if (remainingNumbers.length === 0) {
    console.log("All numbers are already checked or skipped.");
} else {
    connectToWhatsApp();
}
