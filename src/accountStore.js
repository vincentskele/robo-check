const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const verifiedFile = path.join(dataDir, 'verified.json');
const holdersFile = path.join(dataDir, 'holders.json');

function ensureJsonFile(filePath, defaultValue = []) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

function readJsonFile(filePath, fallback = []) {
  try {
    ensureJsonFile(filePath, fallback);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw ? JSON.parse(raw) : fallback;
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : (parsed || fallback);
  } catch (error) {
    console.error(`❌ Error reading ${filePath}:`, error);
    return Array.isArray(fallback) ? [...fallback] : fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeDiscordId(discordId) {
  return String(discordId || '').trim();
}

function normalizeWalletAddress(walletAddress) {
  return String(walletAddress || '').trim().toLowerCase();
}

function normalizeTwitterHandle(twitterHandle) {
  return String(twitterHandle || '').trim().replace(/^@+/, '');
}

function normalizeVerifiedEntry(entry = {}) {
  const discordId = normalizeDiscordId(entry.discordId);
  const walletAddress = String(entry.walletAddress || '').trim();
  if (!discordId || !walletAddress) return null;

  const verifiedAt = Number(entry.verifiedAt) || 0;
  const updatedAt = Number(entry.updatedAt) || verifiedAt || Date.now();
  const linkedAt = Number(entry.linkedAt) || verifiedAt || updatedAt;
  const unlinkedAt = Number(entry.unlinkedAt) || null;

  return {
    ...entry,
    discordId,
    twitterHandle: normalizeTwitterHandle(entry.twitterHandle) || null,
    walletAddress,
    verified: entry.verified !== false,
    linked: entry.linked !== false && !unlinkedAt,
    isPrimary: Boolean(entry.isPrimary),
    verifiedAt,
    updatedAt,
    linkedAt,
    unlinkedAt,
  };
}

function readVerifiedEntries() {
  return readJsonFile(verifiedFile, [])
    .map((entry) => normalizeVerifiedEntry(entry))
    .filter(Boolean);
}

function writeVerifiedEntries(entries) {
  writeJsonFile(
    verifiedFile,
    (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeVerifiedEntry(entry))
      .filter(Boolean)
  );
}

function isActiveVerifiedEntry(entry) {
  return Boolean(entry?.verified && entry?.linked && !entry?.unlinkedAt);
}

function buildVerifiedAccountIndex(entries = readVerifiedEntries()) {
  const accounts = new Map();

  entries.forEach((entry) => {
    if (!isActiveVerifiedEntry(entry)) return;

    const discordId = normalizeDiscordId(entry.discordId);
    if (!discordId) return;

    if (!accounts.has(discordId)) {
      accounts.set(discordId, {
        discordId,
        twitterHandle: entry.twitterHandle || null,
        walletsByKey: new Map(),
      });
    }

    const account = accounts.get(discordId);
    if (entry.twitterHandle) {
      account.twitterHandle = entry.twitterHandle;
    }

    const walletKey = normalizeWalletAddress(entry.walletAddress);
    const existing = account.walletsByKey.get(walletKey);
    if (!existing || (Number(entry.updatedAt) || 0) >= (Number(existing.updatedAt) || 0)) {
      account.walletsByKey.set(walletKey, {
        walletAddress: entry.walletAddress,
        isPrimary: Boolean(entry.isPrimary),
        verifiedAt: entry.verifiedAt || null,
        updatedAt: entry.updatedAt || null,
        linkedAt: entry.linkedAt || null,
      });
    }
  });

  accounts.forEach((account, discordId) => {
    const wallets = [...account.walletsByKey.values()].sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
    });

    if (!wallets.length) {
      accounts.delete(discordId);
      return;
    }

    let primaryWallet = wallets.find((wallet) => wallet.isPrimary) || wallets[0];
    wallets.forEach((wallet) => {
      wallet.isPrimary = wallet.walletAddress === primaryWallet.walletAddress;
    });
    primaryWallet = wallets.find((wallet) => wallet.isPrimary) || wallets[0];

    account.wallets = wallets;
    account.walletAddress = primaryWallet?.walletAddress || null;
    account.primaryWalletAddress = primaryWallet?.walletAddress || null;
    account.walletCount = wallets.length;
    delete account.walletsByKey;
  });

  return accounts;
}

function getAccountByDiscordId(discordId, entries = readVerifiedEntries()) {
  const normalizedDiscordId = normalizeDiscordId(discordId);
  if (!normalizedDiscordId) return null;
  return buildVerifiedAccountIndex(entries).get(normalizedDiscordId) || null;
}

function findAccountByWalletAddress(walletAddress, entries = readVerifiedEntries()) {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (!normalizedWallet) return null;

  const accounts = buildVerifiedAccountIndex(entries);
  for (const account of accounts.values()) {
    if (account.wallets.some((wallet) => normalizeWalletAddress(wallet.walletAddress) === normalizedWallet)) {
      return account;
    }
  }
  return null;
}

function upsertVerifiedWallet(payload) {
  const discordId = normalizeDiscordId(payload?.discordId);
  const walletAddress = String(payload?.walletAddress || '').trim();
  if (!discordId || !walletAddress) {
    throw new Error('discordId and walletAddress are required.');
  }

  const normalizedWallet = normalizeWalletAddress(walletAddress);
  const normalizedTwitter = normalizeTwitterHandle(payload?.twitterHandle) || null;
  const entries = readVerifiedEntries();
  const sameDiscordActiveCount = entries.filter(
    (entry) => normalizeDiscordId(entry.discordId) === discordId && isActiveVerifiedEntry(entry)
  ).length;

  let updated = false;
  const nextEntries = entries.map((entry) => {
    if (normalizeWalletAddress(entry.walletAddress) !== normalizedWallet) return entry;

    updated = true;
    return normalizeVerifiedEntry({
      ...entry,
      ...payload,
      discordId,
      twitterHandle: normalizedTwitter || entry.twitterHandle || null,
      walletAddress,
      verified: true,
      linked: true,
      isPrimary: payload?.isPrimary === true || (!findAccountByWalletAddress(walletAddress, entries) && sameDiscordActiveCount === 0),
      linkedAt: entry.linkedAt || entry.verifiedAt || payload?.verifiedAt || Date.now(),
      verifiedAt: Number(payload?.verifiedAt) || Number(entry.verifiedAt) || Date.now(),
      updatedAt: Date.now(),
      unlinkedAt: null,
    });
  });

  if (!updated) {
    nextEntries.push(normalizeVerifiedEntry({
      ...payload,
      discordId,
      twitterHandle: normalizedTwitter,
      walletAddress,
      verified: true,
      linked: true,
      isPrimary: sameDiscordActiveCount === 0,
      linkedAt: Number(payload?.verifiedAt) || Date.now(),
      verifiedAt: Number(payload?.verifiedAt) || Date.now(),
      updatedAt: Date.now(),
      unlinkedAt: null,
    }));
  }

  const activeWalletsForDiscord = nextEntries.filter(
    (entry) => normalizeDiscordId(entry.discordId) === discordId && isActiveVerifiedEntry(entry)
  );
  const hasPrimary = activeWalletsForDiscord.some((entry) => entry.isPrimary);
  if (!hasPrimary && activeWalletsForDiscord.length) {
    const latestEntry = activeWalletsForDiscord.sort(
      (left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0)
    )[0];
    nextEntries.forEach((entry) => {
      if (
        normalizeDiscordId(entry.discordId) === discordId &&
        normalizeWalletAddress(entry.walletAddress) === normalizeWalletAddress(latestEntry.walletAddress)
      ) {
        entry.isPrimary = true;
      }
    });
  }

  writeVerifiedEntries(nextEntries);
  return getAccountByDiscordId(discordId, nextEntries);
}

function setPrimaryWallet(discordId, walletAddress) {
  const normalizedDiscordId = normalizeDiscordId(discordId);
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (!normalizedDiscordId || !normalizedWallet) {
    throw new Error('discordId and walletAddress are required.');
  }

  let found = false;
  const nextEntries = readVerifiedEntries().map((entry) => {
    if (normalizeDiscordId(entry.discordId) !== normalizedDiscordId || !isActiveVerifiedEntry(entry)) {
      return entry;
    }

    const isMatch = normalizeWalletAddress(entry.walletAddress) === normalizedWallet;
    if (isMatch) found = true;
    return {
      ...entry,
      isPrimary: isMatch,
      updatedAt: isMatch ? Date.now() : entry.updatedAt,
    };
  });

  if (!found) {
    throw new Error('Wallet not found for this Discord account.');
  }

  writeVerifiedEntries(nextEntries);
  return getAccountByDiscordId(discordId, nextEntries);
}

function unlinkWallet(discordId, walletAddress) {
  const normalizedDiscordId = normalizeDiscordId(discordId);
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (!normalizedDiscordId || !normalizedWallet) {
    throw new Error('discordId and walletAddress are required.');
  }

  let found = false;
  const now = Date.now();
  const nextEntries = readVerifiedEntries().map((entry) => {
    if (
      normalizeDiscordId(entry.discordId) === normalizedDiscordId &&
      normalizeWalletAddress(entry.walletAddress) === normalizedWallet &&
      isActiveVerifiedEntry(entry)
    ) {
      found = true;
      return {
        ...entry,
        linked: false,
        isPrimary: false,
        updatedAt: now,
        unlinkedAt: now,
      };
    }
    return entry;
  });

  if (!found) {
    throw new Error('Wallet not found for this Discord account.');
  }

  const remaining = nextEntries.filter(
    (entry) => normalizeDiscordId(entry.discordId) === normalizedDiscordId && isActiveVerifiedEntry(entry)
  );
  if (remaining.length === 1) {
    remaining[0].isPrimary = true;
    remaining[0].updatedAt = now;
  }

  writeVerifiedEntries(nextEntries);
  return getAccountByDiscordId(discordId, nextEntries);
}

function updateTwitterHandle(discordId, twitterHandle) {
  const normalizedDiscordId = normalizeDiscordId(discordId);
  const normalizedTwitter = normalizeTwitterHandle(twitterHandle) || null;
  if (!normalizedDiscordId) {
    throw new Error('discordId is required.');
  }

  let touched = false;
  const nextEntries = readVerifiedEntries().map((entry) => {
    if (normalizeDiscordId(entry.discordId) !== normalizedDiscordId || !isActiveVerifiedEntry(entry)) {
      return entry;
    }

    touched = true;
    return {
      ...entry,
      twitterHandle: normalizedTwitter,
      updatedAt: Date.now(),
    };
  });

  if (!touched) {
    throw new Error('No linked wallets were found for this Discord account.');
  }

  writeVerifiedEntries(nextEntries);
  return getAccountByDiscordId(discordId, nextEntries);
}

function readHolders() {
  return readJsonFile(holdersFile, []);
}

module.exports = {
  dataDir,
  holdersFile,
  readHolders,
  readJsonFile,
  readVerifiedEntries,
  writeVerifiedEntries,
  verifiedFile,
  normalizeDiscordId,
  normalizeTwitterHandle,
  normalizeWalletAddress,
  isActiveVerifiedEntry,
  buildVerifiedAccountIndex,
  getAccountByDiscordId,
  findAccountByWalletAddress,
  upsertVerifiedWallet,
  setPrimaryWallet,
  unlinkWallet,
  updateTwitterHandle,
};
