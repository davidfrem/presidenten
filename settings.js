export const SETTINGS_KEY = "presidenten.settings";

export const defaultSettings = {
  playerName: "Jij",
  botSkill: "beginner"
};

export function loadSettings() {
  if (typeof localStorage === "undefined") return { ...defaultSettings };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return normalizeSettings({ ...defaultSettings, ...stored });
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(nextSettings) {
  const settings = normalizeSettings({ ...defaultSettings, ...nextSettings });
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Keep using the returned settings when Safari blocks storage.
    }
  }
  return settings;
}

export function hasStoredSettings() {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

export function normalizeBotSkill(skill) {
  if (skill === "normal") return "beginner";
  return ["beginner", "medium", "expert"].includes(skill) ? skill : defaultSettings.botSkill;
}

export function normalizePlayerName(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 18);
  return clean || defaultSettings.playerName;
}

function normalizeSettings(settings) {
  return {
    playerName: normalizePlayerName(settings.playerName),
    botSkill: normalizeBotSkill(settings.botSkill)
  };
}
