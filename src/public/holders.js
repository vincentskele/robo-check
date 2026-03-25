const holderListEl = document.getElementById('holderList');
const holderCountEl = document.getElementById('holderCount');
const holderSearchEl = document.getElementById('holderSearch');
const holderSortEl = document.getElementById('holderSort');
const detailTitleEl = document.getElementById('detailTitle');
const detailSubtitleEl = document.getElementById('detailSubtitle');
const detailBodyEl = document.getElementById('detailBody');

let allHolders = [];
let activeIndex = null;
let sortMode = 'alpha';
const titleOrder = [
  'commander',
  'spy',
  'pilot',
  'monitor',
  'prospector',
  'guard',
  'squad leader',
  'administrator',
  'drone',
];

const safeText = (value, fallback = 'Unknown') => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
};

const holderLabel = (holder) => {
  if (holder.twitterHandle) {
    return `@${holder.twitterHandle}`;
  }
  if (holder.discordId) {
    return `Discord ${holder.discordId}`;
  }
  return holder.walletAddress;
};

const getSortedHolders = (holders) => {
  const copy = [...holders];
  if (sortMode === 'count') {
    return copy.sort((a, b) => (b.tokens?.length || 0) - (a.tokens?.length || 0));
  }
  return copy.sort((a, b) => {
    const aLabel = holderLabel(a).toLowerCase();
    const bLabel = holderLabel(b).toLowerCase();
    return aLabel.localeCompare(bLabel);
  });
};

const createDiscordLink = (discordId) => {
  const link = document.createElement('a');
  link.href = `https://discord.com/users/${discordId}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `Discord ${discordId}`;
  return link;
};

const createTwitterLink = (handle) => {
  const link = document.createElement('a');
  link.href = `https://twitter.com/${handle}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `@${handle}`;
  return link;
};

const renderHolderList = (holders) => {
  holderListEl.innerHTML = '';

  if (!holders.length) {
    holderListEl.innerHTML = '<div class="empty-state"><p>No verified holders found.</p></div>';
    return;
  }

  holders.forEach((holder, index) => {
    const card = document.createElement('div');
    card.className = 'holder-card';
    if (index === activeIndex) {
      card.classList.add('active');
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'holder-name';
    nameEl.textContent = holderLabel(holder);

    const metaEl = document.createElement('div');
    metaEl.className = 'holder-meta';
    const tokenCount = holder.tokens ? holder.tokens.length : 0;
    metaEl.textContent = `${tokenCount} Solarian${tokenCount === 1 ? '' : 's'}`;

    card.appendChild(nameEl);
    card.appendChild(metaEl);

    card.addEventListener('click', () => {
      activeIndex = index;
      renderHolderList(holders);
      renderHolderDetails(holder);
    });

    holderListEl.appendChild(card);
  });
};

const renderAttributes = (attributes = []) => {
  if (!Array.isArray(attributes) || !attributes.length) {
    const empty = document.createElement('div');
    empty.className = 'token-attr';
    empty.textContent = 'No attributes';
    return [empty];
  }
  return attributes.map((attr) => {
    const pill = document.createElement('div');
    pill.className = 'token-attr';
    const label = attr.trait_type ? `${attr.trait_type}: ` : '';
    pill.textContent = `${label}${safeText(attr.value, 'N/A')}`;
    return pill;
  });
};

const renderHolderDetails = (holder) => {
  detailTitleEl.textContent = holderLabel(holder);
  detailSubtitleEl.textContent = `${holder.tokens?.length || 0} Solarian${holder.tokens?.length === 1 ? '' : 's'} in wallet`;

  detailBodyEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'detail-header';

  const idsEl = document.createElement('div');
  idsEl.className = 'muted';
  if (holder.discordId) {
    idsEl.appendChild(createDiscordLink(holder.discordId));
  }
  if (holder.discordId && holder.twitterHandle) {
    const spacer = document.createElement('span');
    spacer.textContent = ' · ';
    idsEl.appendChild(spacer);
  }
  if (holder.twitterHandle) {
    idsEl.appendChild(createTwitterLink(holder.twitterHandle));
  }
  if (!holder.discordId && !holder.twitterHandle) {
    idsEl.textContent = 'No linked IDs';
  }

  header.appendChild(idsEl);
  detailBodyEl.appendChild(header);

  const tokensGrid = document.createElement('div');
  tokensGrid.className = 'tokens-grid';

  const tokens = Array.isArray(holder.tokens) ? holder.tokens : [];
  if (!tokens.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No Solarians found in this wallet.';
    detailBodyEl.appendChild(empty);
    return;
  }

  const normalizeTitle = (value) => safeText(value, '').toLowerCase().trim();
  const grouped = {};
  tokens.forEach((token) => {
    const attrs = Array.isArray(token?.metadata?.attributes) ? token.metadata.attributes : [];
    const titleAttr = attrs.find((attr) => normalizeTitle(attr.trait_type) === 'title');
    const titleValue = normalizeTitle(titleAttr?.value) || 'unknown';
    if (!grouped[titleValue]) grouped[titleValue] = [];
    grouped[titleValue].push(token);
  });

  const orderedTitles = [
    ...titleOrder.filter((title) => grouped[title]?.length),
    ...Object.keys(grouped).filter((title) => !titleOrder.includes(title)),
  ];

  const summaryBar = document.createElement('div');
  summaryBar.className = 'title-summary-bar';
  orderedTitles.forEach((titleKey) => {
    const pill = document.createElement('div');
    pill.className = 'title-count-pill';
    pill.textContent = `${titleKey} (${grouped[titleKey].length})`;
    summaryBar.appendChild(pill);
  });
  detailBodyEl.appendChild(summaryBar);

  orderedTitles.forEach((titleKey) => {
    const section = document.createElement('details');
    section.className = 'title-section';
    section.open = true;

    const summary = document.createElement('summary');
    summary.className = 'title-summary';
    summary.textContent = `${titleKey} (${grouped[titleKey].length})`;
    section.appendChild(summary);

    const sectionGrid = document.createElement('div');
    sectionGrid.className = 'tokens-grid';

    grouped[titleKey].forEach((token) => {
      const card = document.createElement('div');
      card.className = 'token-card';

      const image = document.createElement('img');
      image.className = 'token-image';
      image.alt = safeText(token?.metadata?.name, 'Solarian');
      if (token?.metadata?.image) {
        image.src = token.metadata.image;
      }

      const meta = document.createElement('div');
      meta.className = 'token-meta';

      const name = document.createElement('div');
      name.className = 'token-title';
      name.textContent = safeText(token?.metadata?.name, 'Solarian');

      const symbol = document.createElement('div');
      symbol.className = 'holder-meta';
      symbol.textContent = safeText(token?.metadata?.symbol, 'SLR');

      const mint = document.createElement('div');
      mint.className = 'token-mint';
      mint.textContent = safeText(token?.mint, 'Unknown mint');

      meta.appendChild(name);
      meta.appendChild(symbol);
      meta.appendChild(mint);

      const attrs = document.createElement('div');
      attrs.className = 'token-attrs';
      renderAttributes(token?.metadata?.attributes).forEach((pill) => attrs.appendChild(pill));

      card.appendChild(image);
      card.appendChild(meta);
      card.appendChild(attrs);

      sectionGrid.appendChild(card);
    });

    section.appendChild(sectionGrid);
    detailBodyEl.appendChild(section);
  });
};

const applySearch = () => {
  const query = holderSearchEl.value.trim().toLowerCase();
  const filtered = allHolders.filter((holder) => {
    const searchSpace = [holder.twitterHandle, holder.discordId, holder.walletAddress]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchSpace.includes(query);
  });
  activeIndex = null;
  renderHolderList(getSortedHolders(filtered));

  if (!filtered.length) {
    detailTitleEl.textContent = 'No matches';
    detailSubtitleEl.textContent = 'Try a different search.';
    detailBodyEl.innerHTML = '<div class="empty-state"><p>No holders match your search.</p></div>';
  }
};

const loadHolders = async () => {
  try {
    const response = await fetch('/api/holders');
    if (!response.ok) {
      throw new Error('Failed to load holders');
    }
    const data = await response.json();
    allHolders = Array.isArray(data) ? data : [];
    holderCountEl.textContent = `${allHolders.length} verified holder${allHolders.length === 1 ? '' : 's'}`;
    renderHolderList(getSortedHolders(allHolders));
  } catch (error) {
    holderCountEl.textContent = 'Unable to load holders.';
    holderListEl.innerHTML = '<div class="empty-state"><p>Could not fetch holders data.</p></div>';
    console.error(error);
  }
};

holderSearchEl.addEventListener('input', applySearch);
holderSortEl.addEventListener('change', () => {
  sortMode = holderSortEl.value;
  applySearch();
});

loadHolders();
