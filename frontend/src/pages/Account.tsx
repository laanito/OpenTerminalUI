import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ProfileCompletionRing } from "../components/home/ProfileCompletionRing";
import { CountryFlag } from "../components/common/CountryFlag";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useAuth } from "../contexts/AuthContext";
import { useSettingsStore, type DisplayCurrency } from "../store/settingsStore";
import {
  COUNTRY_MARKETS,
  COUNTRY_DEFAULT_MARKET,
  type AccountAggregatorSettings,
  type AccountConnectionSettings,
  type AccountExportBundle,
  type AccountProfile,
  type AccountSessionActivityItem,
  type AccountShortcutCard,
  type AccountShortcutTone,
  type CountryCode,
  type MarketCode,
} from "../types";

const PROFILE_STORAGE_KEY = "ot.account.profile";
const CONNECTED_STORAGE_KEY = "ot.account.connected";
const AGGREGATORS_STORAGE_KEY = "ot.account.aggregators";

const INPUT_CLASS_NAME =
  "mt-1 min-h-11 min-w-0 w-full rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-text outline-none transition-colors focus:border-terminal-accent";

const COUNTRY_NAME: Record<CountryCode, string> = {
  IN: "India",
  US: "United States",
  EU: "Europe",
  CRYPTO: "Crypto",
};

const SHORTCUTS: readonly AccountShortcutCard[] = [
  {
    id: "workstation",
    label: "Workstation",
    detail: "Linked charts, replay, multi-timeframe studies.",
    keycap: "6",
    to: "/equity/chart-workstation",
    tone: "accent",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    detail: "Risk, holdings, and allocation diagnostics.",
    keycap: "F3",
    to: "/equity/portfolio",
    tone: "success",
  },
  {
    id: "alerts",
    label: "Alerts",
    detail: "Channel state, routing, and trigger inventory.",
    keycap: "A",
    to: "/equity/alerts",
    tone: "info",
  },
  {
    id: "settings",
    label: "Desk Settings",
    detail: "Theme, runtime mode, and environment controls.",
    keycap: "F6",
    to: "/equity/settings",
    tone: "warn",
  },
] as const;

const PROFILE_COMPLETION_FIELDS: ReadonlyArray<{
  key: keyof AccountProfile;
  label: string;
  isComplete: (profile: AccountProfile) => boolean;
}> = [
  { key: "firstName", label: "First Name", isComplete: (profile) => Boolean(profile.firstName.trim()) },
  { key: "lastName", label: "Last Name", isComplete: (profile) => Boolean(profile.lastName.trim()) },
  { key: "displayName", label: "Display Name", isComplete: (profile) => Boolean(profile.displayName.trim()) },
  { key: "phone", label: "Phone", isComplete: (profile) => Boolean(profile.phone.trim()) },
  { key: "location", label: "Location", isComplete: (profile) => Boolean(profile.location.trim()) },
  { key: "deskFocus", label: "Desk Focus", isComplete: (profile) => Boolean(profile.deskFocus.trim()) },
  { key: "bio", label: "Bio", isComplete: (profile) => Boolean(profile.bio.trim()) },
  { key: "avatarDataUrl", label: "Avatar", isComplete: (profile) => Boolean(profile.avatarDataUrl) },
] as const;

function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function buildDefaultProfile(): AccountProfile {
  return {
    firstName: "",
    lastName: "",
    displayName: "",
    dateOfBirth: "",
    phone: "",
    timezone: getLocalTimezone(),
    location: "",
    deskFocus: "",
    riskProfile: "moderate",
    tradingStyle: "hybrid",
    notificationMode: "balanced",
    securityTier: "elevated",
    bio: "",
    avatarDataUrl: "",
  };
}

function buildDefaultConnected(
  selectedCountry: CountryCode,
  selectedMarket: MarketCode,
  displayCurrency: DisplayCurrency,
): AccountConnectionSettings {
  return {
    brokerName: "Primary Broker",
    accountAlias: "Main Trading",
    preferredCountry: selectedCountry,
    preferredExchange: selectedMarket,
    defaultCurrency: displayCurrency,
  };
}

function buildDefaultAggregators(): AccountAggregatorSettings {
  return {
    marketDataApiKey: "",
    executionApiKey: "",
    newsApiKey: "",
    webhookUrl: "",
  };
}

function initials(profile: AccountProfile, email: string): string {
  const first = profile.firstName.trim().charAt(0);
  const last = profile.lastName.trim().charAt(0);
  if (first || last) return `${first}${last}`.toUpperCase();
  const display = profile.displayName.trim();
  if (display) {
    const bits = display.split(/\s+/).filter(Boolean);
    if (bits.length >= 2) return `${bits[0].charAt(0)}${bits[1].charAt(0)}`.toUpperCase();
    return display.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0] || "";
  return (local.slice(0, 2) || "U").toUpperCase();
}

function loadLocalState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function shortcutToneClass(tone: AccountShortcutTone): string {
  if (tone === "success") return "border-terminal-pos/60 hover:border-terminal-pos hover:bg-terminal-pos/10";
  if (tone === "warn") return "border-terminal-warn/60 hover:border-terminal-warn hover:bg-terminal-warn/10";
  if (tone === "info") return "border-terminal-border hover:border-terminal-accent hover:bg-terminal-bg";
  return "border-terminal-accent/60 hover:border-terminal-accent hover:bg-terminal-accent/10";
}

function formatTimestamp(value: number | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

function deriveLatestAction(activity: {
  savedAt: number | null;
  exportedAt: number | null;
  resetAt: number | null;
}): string {
  const entries = [
    { kind: "Save", at: activity.savedAt },
    { kind: "Export", at: activity.exportedAt },
    { kind: "Reset", at: activity.resetAt },
  ].filter((entry): entry is { kind: string; at: number } => typeof entry.at === "number");

  if (!entries.length) return "Editing draft";
  entries.sort((left, right) => right.at - left.at);
  return `${entries[0].kind} @ ${new Date(entries[0].at).toLocaleTimeString()}`;
}

function configuredIntegrations(aggregators: AccountAggregatorSettings): number {
  return Object.values(aggregators).filter((value) => value.trim().length > 0).length;
}

function buildExportBundle(
  user: { email: string; role: string },
  profile: AccountProfile,
  connected: AccountConnectionSettings,
  aggregators: AccountAggregatorSettings,
): AccountExportBundle {
  return {
    exportedAt: new Date().toISOString(),
    user: {
      email: user.email,
      role: user.role,
    },
    profile,
    connected,
    aggregators,
  };
}

export function AccountPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const selectedCountry = useSettingsStore((state) => state.selectedCountry);
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const realtimeMode = useSettingsStore((state) => state.realtimeMode);
  const themeVariant = useSettingsStore((state) => state.themeVariant);
  const hudOverlayEnabled = useSettingsStore((state) => state.hudOverlayEnabled);
  const setSelectedCountry = useSettingsStore((state) => state.setSelectedCountry);
  const setSelectedMarket = useSettingsStore((state) => state.setSelectedMarket);
  const setDisplayCurrency = useSettingsStore((state) => state.setDisplayCurrency);

  const [profile, setProfile] = useState<AccountProfile>(() =>
    loadLocalState<AccountProfile>(PROFILE_STORAGE_KEY, buildDefaultProfile()),
  );
  const [connected, setConnected] = useState<AccountConnectionSettings>(() =>
    loadLocalState<AccountConnectionSettings>(
      CONNECTED_STORAGE_KEY,
      buildDefaultConnected(selectedCountry, selectedMarket, displayCurrency),
    ),
  );
  const [aggregators, setAggregators] = useState<AccountAggregatorSettings>(() =>
    loadLocalState<AccountAggregatorSettings>(AGGREGATORS_STORAGE_KEY, buildDefaultAggregators()),
  );
  const [message, setMessage] = useState<{ text: string; tone: "success" | "warn" } | null>(null);
  const [activity, setActivity] = useState<{
    savedAt: number | null;
    exportedAt: number | null;
    resetAt: number | null;
  }>({
    savedAt: null,
    exportedAt: null,
    resetAt: null,
  });
  const messageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current != null) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const exchanges = COUNTRY_MARKETS[connected.preferredCountry];
    if (!exchanges.includes(connected.preferredExchange)) {
      setConnected((current) => ({
        ...current,
        preferredExchange: COUNTRY_DEFAULT_MARKET[current.preferredCountry],
      }));
    }
  }, [connected.preferredCountry, connected.preferredExchange]);

  const setFlashMessage = (text: string, tone: "success" | "warn") => {
    if (messageTimerRef.current != null) {
      window.clearTimeout(messageTimerRef.current);
    }
    setMessage({ text, tone });
    messageTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      messageTimerRef.current = null;
    }, 2500);
  };

  const updateProfile = <K extends keyof AccountProfile>(field: K, value: AccountProfile[K]) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const updateConnected = <K extends keyof AccountConnectionSettings>(
    field: K,
    value: AccountConnectionSettings[K],
  ) => {
    setConnected((current) => ({ ...current, [field]: value }));
  };

  const updateAggregators = <K extends keyof AccountAggregatorSettings>(
    field: K,
    value: AccountAggregatorSettings[K],
  ) => {
    setAggregators((current) => ({ ...current, [field]: value }));
  };

  if (!user) {
    return (
      <div className="space-y-3 p-3">
        <TerminalPanel title="Account" subtitle="User details">
          <div className="text-xs text-terminal-muted">No authenticated user.</div>
        </TerminalPanel>
      </div>
    );
  }

  const availableExchanges = COUNTRY_MARKETS[connected.preferredCountry];
  const identityName =
    profile.displayName.trim() ||
    [profile.firstName.trim(), profile.lastName.trim()].filter(Boolean).join(" ") ||
    user.email.split("@")[0];
  const userInitials = initials(profile, user.email);
  const missingFields = PROFILE_COMPLETION_FIELDS.filter((field) => !field.isComplete(profile)).map((field) => field.label);
  const completionSummary = {
    value: Math.round(((PROFILE_COMPLETION_FIELDS.length - missingFields.length) / PROFILE_COMPLETION_FIELDS.length) * 100),
    missingFields,
    completed: PROFILE_COMPLETION_FIELDS.length - missingFields.length,
    total: PROFILE_COMPLETION_FIELDS.length,
  };
  const integrationCount = configuredIntegrations(aggregators);
  const persistedSlots = [PROFILE_STORAGE_KEY, CONNECTED_STORAGE_KEY, AGGREGATORS_STORAGE_KEY].filter((key) =>
    Boolean(localStorage.getItem(key)),
  ).length;
  const sessionActivityItems: AccountSessionActivityItem[] = [
    { id: "auth", label: "Authenticated identity", value: user.email, detail: `Role ${user.role} · ${profile.timezone}`, tone: "info" },
    { id: "desk", label: "Draft market preferences", value: `${COUNTRY_NAME[connected.preferredCountry]} / ${connected.preferredExchange}`, detail: `${connected.defaultCurrency} display preference · ${connected.accountAlias}`, tone: "info" },
    { id: "integrations", label: "Local integration fields", value: `${integrationCount}/4 filled`, detail: "Stored values are not a connection or permission check.", tone: "info" },
    { id: "activity", label: "Latest action in this session", value: deriveLatestAction(activity), detail: `${persistedSlots}/3 saved browser records · last save ${formatTimestamp(activity.savedAt)}`, tone: "info" },
  ];

  const onAvatarUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      updateProfile("avatarDataUrl", result);
    };
    reader.readAsDataURL(file);
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    localStorage.setItem(CONNECTED_STORAGE_KEY, JSON.stringify(connected));
    localStorage.setItem(AGGREGATORS_STORAGE_KEY, JSON.stringify(aggregators));

    setSelectedCountry(connected.preferredCountry);
    setSelectedMarket(connected.preferredExchange);
    setDisplayCurrency(connected.defaultCurrency);

    setActivity((current) => ({ ...current, savedAt: Date.now() }));
    setFlashMessage("Account details saved.", "success");
    } catch { setFlashMessage("Could not save account details in this browser. Your draft is retained.", "warn"); }

  };

  const onExport = () => {
    if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
      setFlashMessage("Export is unavailable in this browser.", "warn");
      return;
    }

    const payload = buildExportBundle(user, profile, connected, aggregators);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ot-account-${payload.exportedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setActivity((current) => ({ ...current, exportedAt: Date.now() }));
    setFlashMessage("Profile bundle exported.", "success");
  };

  const onResetDraft = () => {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    localStorage.removeItem(CONNECTED_STORAGE_KEY);
    localStorage.removeItem(AGGREGATORS_STORAGE_KEY);

    setProfile(buildDefaultProfile());
    setConnected(buildDefaultConnected(selectedCountry, selectedMarket, displayCurrency));
    setAggregators(buildDefaultAggregators());
    setActivity((current) => ({ ...current, resetAt: Date.now() }));
    setFlashMessage("Draft reset to defaults.", "warn");
  };

  return (
    <main aria-label="Account workspace" className="min-w-0 space-y-3 p-3 text-sm [overflow-wrap:anywhere]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-terminal-text">Account</h1><p className="mt-1 text-sm text-terminal-muted">Your signed-in identity and browser-local profile.</p></div>
        <TerminalButton type="button" onClick={() => navigate(-1)} aria-label="Go back">Back</TerminalButton>
      </header>
      <section aria-label="Signed-in identity" className="flex min-w-0 flex-wrap items-center gap-4 rounded border border-terminal-border bg-terminal-panel p-3">
        {profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="Profile" className="h-16 w-16 rounded-full object-cover" /> : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-terminal-border text-xl text-terminal-accent">{userInitials}</span>}
        <div className="min-w-0 flex-1"><h2 className="break-words text-lg text-terminal-text">{identityName}</h2><p className="break-words text-sm text-terminal-muted">{user.email}</p><p className="mt-1 text-xs text-terminal-muted">Authenticated role: {user.role} · theme {themeVariant} · retrieval preference {realtimeMode} · HUD {hudOverlayEnabled ? "on" : "off"}</p></div>
      </section>
      <form onSubmit={onSave} className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2"><TerminalButton type="submit" variant="accent" aria-label="Save account details">Save account details</TerminalButton><span className="text-xs text-terminal-muted">Saved in this browser; market preferences also update the terminal selectors.</span></div>
        {message && <p role={message.tone === "success" ? "status" : "alert"} className={`rounded border border-terminal-border p-3 text-sm ${message.tone === "success" ? "text-terminal-pos" : "text-terminal-warning"}`}>{message.text}</p>}
        <TerminalPanel title="Profile Dossier" subtitle="Optional local details; profile preferences do not change account permissions or enforce risk controls">
          <div className="grid min-w-0 grid-cols-1 gap-3 text-sm md:grid-cols-2 lg:grid-cols-3">
            <label className="block min-w-0">
              First Name
              <input
                className={INPUT_CLASS_NAME}
                value={profile.firstName}
                onChange={(event) => updateProfile("firstName", event.target.value)}
              />
            </label>
            <label className="block min-w-0">
              Last Name
              <input
                className={INPUT_CLASS_NAME}
                value={profile.lastName}
                onChange={(event) => updateProfile("lastName", event.target.value)}
              />
            </label>
            <label className="block min-w-0">
              Display Name
              <input
                className={INPUT_CLASS_NAME}
                value={profile.displayName}
                onChange={(event) => updateProfile("displayName", event.target.value)}
                placeholder="Desk-visible identity"
              />
            </label>
            <label className="block min-w-0">
              Date of Birth
              <input
                type="date"
                className={INPUT_CLASS_NAME}
                value={profile.dateOfBirth}
                onChange={(event) => updateProfile("dateOfBirth", event.target.value)}
              />
            </label>
            <label className="block min-w-0">
              Phone
              <input
                className={INPUT_CLASS_NAME}
                value={profile.phone}
                onChange={(event) => updateProfile("phone", event.target.value)}
                placeholder="+1 555 123 9876"
              />
            </label>
            <label className="block min-w-0">
              Timezone
              <input
                className={INPUT_CLASS_NAME}
                value={profile.timezone}
                onChange={(event) => updateProfile("timezone", event.target.value)}
              />
            </label>
            <label className="block min-w-0">
              Location
              <input
                className={INPUT_CLASS_NAME}
                value={profile.location}
                onChange={(event) => updateProfile("location", event.target.value)}
                placeholder="San Francisco, CA"
              />
            </label>
            <label className="block min-w-0">
              Desk Focus
              <input
                className={INPUT_CLASS_NAME}
                value={profile.deskFocus}
                onChange={(event) => updateProfile("deskFocus", event.target.value)}
                placeholder="Macro, growth, event-driven"
              />
            </label>
            <label className="block min-w-0">
              Risk Profile
              <select
                className={INPUT_CLASS_NAME}
                value={profile.riskProfile}
                onChange={(event) => updateProfile("riskProfile", event.target.value as AccountProfile["riskProfile"])}
              >
                <option value="conservative">Conservative</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label className="block min-w-0">
              Trading Style
              <select
                className={INPUT_CLASS_NAME}
                value={profile.tradingStyle}
                onChange={(event) => updateProfile("tradingStyle", event.target.value as AccountProfile["tradingStyle"])}
              >
                <option value="discretionary">Discretionary</option>
                <option value="systematic">Systematic</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </label>
            <label className="block min-w-0">
              Notification Mode
              <select
                className={INPUT_CLASS_NAME}
                value={profile.notificationMode}
                onChange={(event) =>
                  updateProfile("notificationMode", event.target.value as AccountProfile["notificationMode"])
                }
              >
                <option value="quiet">Quiet</option>
                <option value="balanced">Balanced</option>
                <option value="priority">Priority</option>
              </select>
            </label>
            <label className="block min-w-0">
              Security Tier
              <select
                className={INPUT_CLASS_NAME}
                value={profile.securityTier}
                onChange={(event) => updateProfile("securityTier", event.target.value as AccountProfile["securityTier"])}
              >
                <option value="standard">Standard</option>
                <option value="elevated">Elevated</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            <label className="md:col-span-2 lg:col-span-3">
              Profile Image
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  aria-label="Profile Image"
                  accept="image/*"
                  className={`${INPUT_CLASS_NAME} max-w-full`}
                  onChange={onAvatarUpload}
                />
                <TerminalButton
                  type="button"
                  size="lg"
                  onClick={() => updateProfile("avatarDataUrl", "")}
                  aria-label="Remove profile image"
                >
                  Remove
                </TerminalButton>
              </div>
            </label>
            <label className="md:col-span-2 lg:col-span-3">
              Bio
              <textarea
                className={`${INPUT_CLASS_NAME} h-24 resize-none`}
                value={profile.bio}
                onChange={(event) => updateProfile("bio", event.target.value)}
                placeholder="Trading mandate, operating style, and escalation notes."
              />
            </label>
          </div>

        </TerminalPanel>
        <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Market preferences and broker labels</summary><p className="my-3 text-xs text-terminal-muted">Broker names and aliases are local labels, not linked brokerage accounts. Save applies the market and display-currency preferences.</p>
          <div className="space-y-3 text-xs">
            <label className="block min-w-0">
              Broker Name
              <input
                className={INPUT_CLASS_NAME}
                value={connected.brokerName}
                onChange={(event) => updateConnected("brokerName", event.target.value)}
              />
            </label>
            <label className="block min-w-0">
              Account Alias
              <input
                className={INPUT_CLASS_NAME}
                value={connected.accountAlias}
                onChange={(event) => updateConnected("accountAlias", event.target.value)}
              />
            </label>
            <label className="block min-w-0">
              Preferred Country
              <select
                className={INPUT_CLASS_NAME}
                value={connected.preferredCountry}
                onChange={(event) => updateConnected("preferredCountry", event.target.value as CountryCode)}
              >
                <option value="IN">IN - India</option>
                <option value="US">US - United States</option>
                <option value="EU">EU - Europe</option><option value="CRYPTO">Crypto</option>
              </select>
            </label>
            <label className="block min-w-0">
              Preferred Exchange
              <select
                className={INPUT_CLASS_NAME}
                value={connected.preferredExchange}
                onChange={(event) => updateConnected("preferredExchange", event.target.value as MarketCode)}
              >
                {availableExchanges.map((exchange) => (
                  <option key={exchange} value={exchange}>
                    {exchange}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              Default Currency
              <select
                className={INPUT_CLASS_NAME}
                value={connected.defaultCurrency}
                onChange={(event) =>
                  updateConnected("defaultCurrency", event.target.value as AccountConnectionSettings["defaultCurrency"])
                }
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </label>

            <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-3">
              <div className="text-xs uppercase tracking-[0.14em] text-terminal-muted">Selected market profile</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-terminal-text">
                <CountryFlag countryCode={connected.preferredCountry} size="lg" />
                <span>{COUNTRY_NAME[connected.preferredCountry]}</span>
                <span className="text-terminal-muted">|</span>
                <span className="text-terminal-accent">{connected.preferredExchange}</span>
                <span className="text-terminal-muted">|</span>
                <span>{connected.defaultCurrency}</span>
              </div>
            </div>
          </div>

        </details>
        <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Legacy local integration fields · {integrationCount}/4 filled</summary><p className="my-3 text-xs text-terminal-muted">These fields are browser-local records. Entering a key does not configure a provider, execution connection or automation access. Use terminal Settings for supported configuration. Exports include these values.</p>
          <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <label className="block min-w-0">
              Market Data API Key
              <input
                type="password"
                className={INPUT_CLASS_NAME}
                value={aggregators.marketDataApiKey}
                onChange={(event) => updateAggregators("marketDataApiKey", event.target.value)}
                placeholder="Enter market data key"
              />
            </label>
            <label className="block min-w-0">
              Execution API Key
              <input
                type="password"
                className={INPUT_CLASS_NAME}
                value={aggregators.executionApiKey}
                onChange={(event) => updateAggregators("executionApiKey", event.target.value)}
                placeholder="Enter execution key"
              />
            </label>
            <label className="block min-w-0">
              News API Key
              <input
                type="password"
                className={INPUT_CLASS_NAME}
                value={aggregators.newsApiKey}
                onChange={(event) => updateAggregators("newsApiKey", event.target.value)}
                placeholder="Enter news key"
              />
            </label>
            <label className="block min-w-0">
              Webhook URL
              <input
                className={INPUT_CLASS_NAME}
                value={aggregators.webhookUrl}
                onChange={(event) => updateAggregators("webhookUrl", event.target.value)}
                placeholder="https://example.com/hooks/trading"
              />
            </label>
          </div>

        </details>
        <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Profile completion and session activity</summary><div className="mt-3 grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[220px_minmax(0,1fr)]"><div><ProfileCompletionRing value={completionSummary.value} size={96} strokeWidth={6} label="Identity completion" missingFields={completionSummary.missingFields} /><p className="mt-2 text-xs text-terminal-muted">{completionSummary.completed}/{completionSummary.total} optional identity fields filled.</p></div><section aria-label="Session Activity" className="space-y-3"><h2 className="text-sm">Session Activity</h2>{sessionActivityItems.map(item => <div key={item.id} className="min-w-0 rounded border border-terminal-border p-3"><h3 className="text-xs text-terminal-muted">{item.label}</h3><p className="mt-1 text-sm">{item.value}</p><p className="mt-1 text-xs text-terminal-muted">{item.detail}</p></div>)}</section></div></details>
        <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Export, reset and sign out</summary><p className="my-3 text-xs text-terminal-muted">Export downloads the current profile, routing labels and integration values. Reset clears the three Account browser records and restores defaults; it does not delete your server account.</p><div className="flex flex-wrap gap-2"><TerminalButton type="button" onClick={onExport} aria-label="Export profile bundle">Export profile bundle</TerminalButton><TerminalButton type="button" onClick={onResetDraft} aria-label="Reset account draft">Reset local profile</TerminalButton><TerminalButton type="button" variant="danger" onClick={() => { logout(); navigate("/login"); }} aria-label="Logout">Logout</TerminalButton></div></details>
      </form>
      <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Shortcut Panel</summary><div className="mt-3">
            <div className="grid gap-2">
              {SHORTCUTS.map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  className={`flex items-center justify-between rounded-sm border bg-terminal-bg/45 px-3 py-2 text-left transition-colors ${shortcutToneClass(shortcut.tone)}`}
                  onClick={() => navigate(shortcut.to)}
                  aria-label={`Open ${shortcut.label}`}
                >
                  <div>
                    <div className="text-xs text-terminal-text">{shortcut.label}</div>
                    <div className="mt-1 text-xs text-terminal-muted">{shortcut.detail}</div>
                  </div>
                  <span className="rounded-sm border border-terminal-border bg-terminal-panel px-1.5 py-0.5 text-xs uppercase tracking-[0.14em] text-terminal-accent">
                    {shortcut.keycap}
                  </span>
                </button>
              ))}
            </div>

      </div></details>
    </main>
  );
}
