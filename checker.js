const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');

// File vicho numbers read karo
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

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys_fast');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '110.0.0'], // Bot detection avoid karan lyi
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Connection closed. Reconnecting in 5s...');
                await delay(5000);
                connectToWhatsApp();
            } else {
                console.log('❌ Logged out. Please scan QR again.');
            }
        } else if (connection === 'open') {
            console.log(`✅ WhatsApp Connected! Checking ${remainingNumbers.length} numbers...`);
            await checkNumbersBatch(sock);
        }
    });
}

async function checkNumbersBatch(sock) {
    // 50 nahi, 5 numbers ek vaar vich (WhatsApp limit)
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

            // Save progress after every batch (Crash hove ta vi data bachega)
            fs.writeFileSync('valid.txt', validNumbers.join('\n'));
            fs.writeFileSync('invalid.txt', invalidNumbers.join('\n'));

            // Smart delay: 3 to 6 seconds
            if (i + BATCH_SIZE < remainingNumbers.length) {
                const randomDelay = Math.floor(Math.random() * 3000) + 3000; 
                await delay(randomDelay);
            }

        } catch (error) {
            console.error(`⚠️ Batch Error on ${currentBatchNum}:`, error.message);
            
            // Je rate limit lag gayi, ta 60 second ruko te ohi batch fer toh try karo
            if (error.message.includes('rate-overlimit') || error.message.includes('429')) {
                console.log('🛑 Rate limit hit! Waiting 60 seconds...');
                await delay(60000);
                i -= BATCH_SIZE; // Retry same batch
            } 
            // Je connection drop ho geya
            else if (error.message.includes('Connection Closed') || error.message.includes('stream:error')) {
                console.log('🔌 Socket dropped. Restarting socket...');
                throw error; // Upar wala reconnect handle karega
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
    console.log('Data saved to valid.txt and invalid.txt');
    process.exit(0); // Kaam khatam, exit ho jao
}

// Start
if (remainingNumbers.length === 0) {
    console.log("All numbers are already checked.");
} else {
    connectToWhatsApp();
}
