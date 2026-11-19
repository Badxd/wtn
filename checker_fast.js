const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');

// ==========================================
// ⚠️ ITHE APNA WHATSAPP NUMBER PAAO
// Country code naal, bina + ya 00 de.
// India lyi: 91XXXXXXXXXX
// ==========================================
const PHONE_NUMBER = "919646191598"; // <--- EH BADAL

console.log("🚀 Script start ho gayi hai...");

const numbers = fs.readFileSync('numbers.txt', 'utf-8')
    .split('\n')
    .map(n => n.trim().replace(/[^0-9]/g, ''))
    .filter(n => n.length > 5 && n.length < 16);

console.log(`📁 Total numbers file vich: ${numbers.length}`);

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

async function connectToWhatsApp() {
    console.log("🔌 WhatsApp naal connect karan di koshish kar reha haan...");
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys_fast');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '110.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    // Agar session pehla save nahi hoya, ta Pair Code request karo
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                console.log(`\n🔑 Requesting Pairing Code for ${PHONE_NUMBER}...`);
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                
                console.log(`\n=========================================`);
                console.log(`🔑 YOUR PAIR CODE: ${code}`);
                console.log(`=========================================`);
                console.log(`📱 WhatsApp kholo -> Linked Devices -> Link with phone number`);
                console.log(`⌨️  Eh code enter karo: ${code}\n`);
            } catch (error) {
                console.error("❌ Pair code request fail ho geya:", error.message);
                console.log("💡 Tip: Number sahi format vich hai? (e.g. 91XXXXXXXXXX)");
            }
        }, 3000); // 3 second wait karo socket connect hon lyi
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Connection closed. Reconnecting in 5s...');
                await delay(5000);
                connectToWhatsApp();
            } else {
                console.log('❌ Logged out. Please run the script again to get a new code.');
            }
        } else if (connection === 'open') {
            console.log(`\n✅ WhatsApp Connected Successfully!`);
            console.log(`🚀 Checking ${remainingNumbers.length} numbers shuru ho rahi hai...\n`);
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

            if (i + BATCH_SIZE < remainingNumbers.length) {
                const randomDelay = Math.floor(Math.random() * 3000) + 3000; 
                await delay(randomDelay);
            }

        } catch (error) {
            console.error(`⚠️ Batch Error on ${currentBatchNum}:`, error.message);
            
            if (error.message.includes('rate-overlimit') || error.message.includes('429')) {
                console.log('🛑 Rate limit hit! Waiting 60 seconds...');
                await delay(60000);
                i -= BATCH_SIZE; 
            } 
            else if (error.message.includes('Connection Closed') || error.message.includes('stream:error')) {
                console.log('🔌 Socket dropped. Restarting socket...');
                throw error; 
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
    process.exit(0); 
}

if (remainingNumbers.length === 0) {
    console.log("All numbers are already checked.");
} else {
    connectToWhatsApp();
            }
