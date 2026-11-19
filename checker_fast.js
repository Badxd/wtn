const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');

const PHONE_NUMBER = "91XXXXXXXXXX"; // <--- APNA NUMBER PAAO (agar pehla nahi kitta)

console.log("🚀 Script start ho gayi hai...");

const numbers = fs.readFileSync('numbers.txt', 'utf-8')
    .split('\n')
    .map(n => n.trim().replace(/[^0-9]/g, ''))
    .filter(n => n.length > 5 && n.length < 16);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let validNumbers = [];
let invalidNumbers = [];
if (fs.existsSync('valid.txt')) {
    validNumbers = fs.readFileSync('valid.txt', 'utf-8').split('\n').filter(n => n);
}
if (fs.existsSync('invalid.txt')) {
    invalidNumbers = fs.readFileSync('invalid.txt', 'utf-8').split('\n').filter(n => n);
}

const checkedSet = new Set([...validNumbers, ...invalidNumbers]);
const remainingNumbers = numbers.filter(n => !checkedSet.has(n));

console.log(`⏳ Check karan lyi bache numbers: ${remainingNumbers.length}`);

// Global variables for connection management
let sock = null;
let isConnected = false;
let reconnectResolve = null;

// Function to wait until connected
function waitForConnection() {
    return new Promise((resolve) => {
        if (isConnected) return resolve();
        reconnectResolve = resolve;
    });
}

async function connectToWhatsApp() {
    console.log("🔌 WhatsApp naal connect karan di koshish kar reha haan...");
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys_fast');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '110.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                console.log(`\n🔑 Requesting Pairing Code for ${PHONE_NUMBER}...`);
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log(`\n🔑 YOUR PAIR CODE: ${code}\n`);
            } catch (error) {
                console.error("❌ Pair code request fail:", error.message);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                console.log('🔄 Connection closed. Reconnecting in 10s...');
                await delay(10000);
                connectToWhatsApp();
            } else {
                console.log('❌ Logged out. Please restart script.');
                process.exit(1);
            }
        } else if (connection === 'open') {
            isConnected = true;
            console.log(`\n✅ WhatsApp Connected Successfully!`);
            if (reconnectResolve) {
                reconnectResolve(); // Resume the loop if it was waiting
                reconnectResolve = null;
            } else {
                // First time connection, start checking
                await checkNumbersBatch();
            }
        }
    });
}

async function checkNumbersBatch() {
    const BATCH_SIZE = 5; 
    const totalBatches = Math.ceil(remainingNumbers.length / BATCH_SIZE);
    
    for (let i = 0; i < remainingNumbers.length; i += BATCH_SIZE) {
        // Wait if disconnected
        if (!isConnected) {
            console.log("⏳ Waiting for connection to resume...");
            await waitForConnection();
        }

        const batch = remainingNumbers.slice(i, i + BATCH_SIZE);
        const jids = batch.map(num => `${num}@s.whatsapp.net`);
        const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;

        try {
            console.log(`[*] Checking Batch ${currentBatchNum}/${totalBatches} (${batch.length} numbers)...`);
            
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

            fs.writeFileSync('valid.txt', validNumbers.join('\n'));
            fs.writeFileSync('invalid.txt', invalidNumbers.join('\n'));

            // Delay vada kitta hai taaki WhatsApp block na kare (8 to 12 seconds)
            if (i + BATCH_SIZE < remainingNumbers.length) {
                const randomDelay = Math.floor(Math.random() * 4000) + 8000; 
                await delay(randomDelay);
            }

        } catch (error) {
            console.error(`⚠️ Batch Error on ${currentBatchNum}:`, error.message);
            
            // Je Connection Closed aayi hai, ta 30 second ruk ke wapas ohi batch try karo
            if (error.message.includes('Connection Closed') || error.message.includes('428') || error.message.includes('stream:error')) {
                console.log('🔌 Socket dropped. Waiting 30s for reconnect...');
                isConnected = false;
                await delay(30000);
                
                if (!isConnected) {
                    await waitForConnection();
                }
                
                i -= BATCH_SIZE; // Retry the exact same batch
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
    console.log("All numbers are already checked.");
} else {
    connectToWhatsApp();
}
