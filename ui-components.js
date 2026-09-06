export function createCardElement(card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card${card.red ? " red" : ""}`;
  button.dataset.cardId = card.id;
  button.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${card.suit}</span>`;
  return button;
}

export function renderPileCards(node, cards, activeCardIds = new Set()) {
  node.innerHTML = "";
  [...cards].reverse().forEach((card) => {
    const item = document.createElement("span");
    item.className = `pile-card${card.red ? " red" : ""}${activeCardIds.has(card.id) ? " latest-play" : ""}`;
    item.innerHTML = `<span class="pile-card-rank">${card.rank}</span><span class="pile-card-suit">${card.suit}</span>`;
    node.append(item);
  });
}

export function createBadge(className, text) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = text;
  return badge;
}
