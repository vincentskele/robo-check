document.getElementById('verificationForm').addEventListener('submit', async function(e) {
    e.preventDefault();
  
    // Get user input
    const discordId = document.getElementById('discordId').value.trim();
    const twitterHandle = document.getElementById('twitterHandle').value.trim();
    const walletAddress = document.getElementById('walletAddress').value.trim();

    // Basic validation
    if (!discordId || !twitterHandle || !walletAddress) {
        document.getElementById('verificationResult').innerHTML = `<p style="color: red;">❌ All fields are required.</p>`;
        return;
    }

    // Send POST request to the payment request endpoint
    try {
        const response = await fetch('/payment-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ discordId, twitterHandle, walletAddress })
        });

        if (!response.ok) {
            document.getElementById('verificationResult').innerHTML = `<p style="color: red;">❌ Error: ${response.statusText}</p>`;
            return;
        }

        const data = await response.json();

        // Display the payment details on the page
        document.getElementById('verificationResult').innerHTML = `
            <p>✅ <strong>Verification Generated</strong></p>
            <p>Amount to send: <strong>${data.amount} SOL</strong></p>
            <p>Send to wallet: <strong>${data.receivingAddress}</strong></p>
            <p>Expires at: <strong>${new Date(data.expiresAt).toLocaleString()}</strong></p>
            <p style="color: blue;">Please send the exact amount to the provided wallet address before expiration.</p>
        `;

    } catch (error) {
        document.getElementById('verificationResult').innerHTML = `<p style="color: red;">❌ An error occurred: ${error.message}</p>`;
    }
});
