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

        if (!discordId || !twitterHandle || !walletAddress) {
            resultBox.innerHTML = `<p style="color: red;">❌ All fields are required.</p>`;
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
                resultBox.innerHTML = `<p style="color: red;">❌ Error: ${errorText || response.statusText}</p>`;
                submitButton.disabled = false;
                return;
            }

            const data = await response.json();

            // ✅ Use VANITY_ADDRESS if available, otherwise use RECEIVING_ADDRESS
            const displayAddress = vanityAddress || data.receivingAddress;

            resultBox.innerHTML = `
                <p>✅ <strong>Verification Generated</strong></p>
                <p>Amount to send: <strong>${data.amount} SOL</strong></p>
                <p>Send to wallet: <strong>${displayAddress}</strong></p>
                <p>Expires at: <strong>${new Date(data.expiresAt).toLocaleString()}</strong></p>
                <p>Please send the exact amount to the provided wallet address before expiration.</p>
            `;

        } catch (error) {
            resultBox.innerHTML = `<p style="color: red;">❌ An error occurred: ${error.message}</p>`;
            console.error("❌ Verification Error:", error);
        }

        submitButton.disabled = false;
    });
});
