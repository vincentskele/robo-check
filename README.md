cat > README.md <<EOL
# 🚀 Robo Check

Robo Check is a **Solana transaction listener** that verifies **incoming SOL payments** and stores verified transactions.
It then checks the verified wallets for NFTs from the defined mintlist and assigns role accordingly in discord.
It also serves a front end for UI.

---

## 🛠️ Installation

```sh
git clone https://github.com/vincentskele/robo-check
cd robo-check
cp .env.example .env
```
Set up your env

```
npm i
npm start
```

