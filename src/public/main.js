document.addEventListener("DOMContentLoaded", function () {
    console.log("✅ DOM fully loaded. Initializing script...");

    let vanityAddress = "";

    // ✅ Fetch the VANITY_ADDRESS from the backend
    async function fetchVanityAddress() {
        try {
            const response = await fetch('/api/address');
            const data = await response.json();
            vanityAddress = data.address; // Store vanity address
        } catch (error) {
            console.error("❌ Error fetching vanity address:", error);
        }
    }

    // Fetch the address before handling form submissions
    fetchVanityAddress();

    // ✅ Handle form submission
    const verificationForm = document.getElementById('verificationForm');
    if (!verificationForm) {
        console.error("❌ Error: 'verificationForm' element not found in the DOM!");
        return;
    }

    verificationForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const submitButton = this.querySelector("button");
        submitButton.disabled = true; // Prevent multiple submissions

        const discordId = document.getElementById('discordId').value.trim();
        const twitterHandle = document.getElementById('twitterHandle').value.trim();
        const walletAddress = document.getElementById('walletAddress').value.trim();
        const resultBox = document.getElementById('verificationResult');

        // Validation Patterns
        const discordIdPattern = /^\d{18}$/; // Exactly 18 digits
        const twitterPattern = /^[A-Za-z0-9_]{1,15}$/; // Alphanumeric + underscore, max 15 chars
        const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // Base58 encoding, 32-44 chars

        // Validation Checks
        if (!discordIdPattern.test(discordId)) {
            resultBox.innerHTML = `<p>❌ Invalid Discord ID. Must be exactly 18 digits.</p>`;
            submitButton.disabled = false;
            return;
        }

        if (!twitterPattern.test(twitterHandle)) {
            resultBox.innerHTML = `<p>❌ Invalid Twitter Username. Only letters, numbers, and underscores allowed (max 15 chars).</p>`;
            submitButton.disabled = false;
            return;
        }

        if (!solanaAddressPattern.test(walletAddress)) {
            resultBox.innerHTML = `<p>❌ Invalid Solana Wallet Address. Must be 32-44 characters long and base58 encoded.</p>`;
            submitButton.disabled = false;
            return;
        }

        try {
            const response = await fetch('/payment-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discordId, twitterHandle, walletAddress })
            });

            if (!response.ok) {
                const errorText = await response.text();
                resultBox.innerHTML = `<p>❌ Error: ${errorText || response.statusText}</p>`;
                submitButton.disabled = false;
                return;
            }

            const data = await response.json();

            // ✅ Use VANITY_ADDRESS if available, otherwise use RECEIVING_ADDRESS
            const displayAddress = vanityAddress || data.receivingAddress;

            resultBox.innerHTML = `
                <p> <strong>Verification Generated</strong></p>
                <p>Amount to send: <strong>${data.amount} SOL</strong></p>
                <p>Send to wallet: <strong>${displayAddress}</strong></p>
                <p>Expires at: <strong>${new Date(data.expiresAt).toLocaleString()}</strong></p>
                <p>Please send the exact amount to the provided wallet address before expiration.</p>
            `;

        } catch (error) {
            resultBox.innerHTML = `<p>❌ An error occurred: ${error.message}</p>`;
            console.error("❌ Verification Error:", error);
        }

        submitButton.disabled = false;

        // ✅ WebSocket connection to listen for payment confirmations
const socket = new WebSocket("ws://localhost:4000");

socket.addEventListener("open", () => {
    console.log("✅ WebSocket connected. Listening for payment confirmations...");
});

socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);

    if (data.status === "confirmed" && data.walletAddress) {
        const resultBox = document.getElementById('verificationResult');
        resultBox.innerHTML = `
            <p>✅ <strong>Confirmed!</strong></p>
            <p>Your transaction of <strong>${data.amount} SOL</strong> has been successfully received.</p>
            <p>Thank you for completing the verification! Please allow 15-45 for roles to show up</p>
        `;
    }
});

socket.addEventListener("close", () => {
    console.log("❌ WebSocket connection closed.");
});

socket.addEventListener("error", (error) => {
    console.error("❌ WebSocket Error:", error);
});

    });
});
