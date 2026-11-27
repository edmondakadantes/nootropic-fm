import type { ReactNode } from 'react';
import {
  BarChart3,
  Crown,
  Download,
  FlaskConical,
  Headphones,
  Moon,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import type { UserProfile } from '../../shared/types';
import type { ResolvedThemeMode } from '../lib/circadianTheme';
import { buildShowcaseUrl } from '../lib/domainRouting';
import { NeuralFingerprintSigil } from './NeuralFingerprintPass';

export type AppPrimaryTab = 'studio' | 'memory' | 'studylab';

interface AppShellProps {
  activeTab: AppPrimaryTab;
  onSelectTab: (tab: AppPrimaryTab) => void;
  onLogoClick: () => void;
  isZenLocked: boolean;
  hasMinimizedPlayer: boolean;
  privacyStatusLabel: 'Local-Only' | 'Synced';
  isPro: boolean;
  profile: UserProfile | null;
  syncCode: string | null;
  themeMode: ResolvedThemeMode;
  onSetThemeMode: (mode: ResolvedThemeMode) => void;
  onOpenSystemDrawer: () => void;
  onOpenSoundSystems: () => void;
  onOpenProModal: () => void;
  onOpenPrivacyModal: () => void;
  installPromptAvailable: boolean;
  onInstallApp: () => void;
  miniPlayerSlot?: ReactNode;
  children: ReactNode;
}

const PRIMARY_TABS: Array<{
  id: AppPrimaryTab;
  label: string;
  hint: string;
  icon: typeof SlidersHorizontal;
}> = [
  { id: 'studio', label: 'Studio', hint: 'Sessions & Focus', icon: SlidersHorizontal },
  { id: 'memory', label: 'Memory', hint: 'N-of-1 & Brain', icon: BarChart3 },
  { id: 'studylab', label: 'Study Lab', hint: 'PubMed / DOI DSP', icon: FlaskConical },
];

export function AppShell({
  activeTab,
  onSelectTab,
  onLogoClick,
  isZenLocked,
  hasMinimizedPlayer,
  privacyStatusLabel,
  isPro,
  profile,
  syncCode,
  themeMode,
  onSetThemeMode,
  onOpenSystemDrawer,
  onOpenSoundSystems,
  onOpenProModal,
  onOpenPrivacyModal,
  installPromptAvailable,
  onInstallApp,
  miniPlayerSlot,
  children,
}: AppShellProps) {
  const isDay = themeMode === 'daylight';
  const mainBottomPad = isZenLocked
    ? 'pb-8'
    : hasMinimizedPlayer
      ? 'pb-40 lg:pb-24'
      : 'pb-24 lg:pb-10';

  const systemPillBg = isPro
    ? 'border-emerald-400/50 bg-emerald-500/12 text-[#34D399]'
    : privacyStatusLabel === 'Synced'
      ? 'border-emerald-400/40 bg-emerald-500/[0.09] text-[#F3F1EC]'
      : 'border-white/15 bg-[#131518] text-[#D4D4CE]';

  return (
    <div className="relative z-10 flex min-h-dvh flex-1 flex-col lg:flex-row">
      {/* Desktop Left Sidebar Rail (collapses gracefully in Zen Focus Lock) */}
      <aside
        aria-label="Desktop Studio Rail"
        className={`hidden lg:flex lg:shrink-0 lg:flex-col lg:justify-between lg:border-r lg:border-white/[0.08] lg:bg-[#0B0C0E]/90 lg:backdrop-blur-xl transition-all duration-200 ${
          isZenLocked ? 'lg:w-[76px] lg:px-2.5 lg:py-4' : 'lg:w-[228px] lg:px-4 lg:py-5'
        }`}
      >
        <div className="space-y-6">
          <button
            type="button"
            onClick={onLogoClick}
            className={`group flex w-full items-center gap-2.5 text-left ${
              isZenLocked ? 'justify-center' : ''
            }`}
            title="Return to Studio Home"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[#131518] text-[#34D399] transition group-hover:border-white/30">
              <Radio className="h-4 w-4" />
            </div>
            {!isZenLocked && (
              <div className="min-w-0">
                <div className="font-display text-base font-bold leading-none tracking-tight text-[#F3F1EC]">
                  nootropic<span className="text-[#34D399]">.fm</span>
                </div>
                <div className="mt-0.5 font-mono-tech text-[9.5px] uppercase tracking-[0.15em] text-[#34D399]/85">
                  Tune your mind
                </div>
              </div>
            )}
          </button>

          <nav aria-label="Primary Desktop Navigation" className="space-y-1.5">
            {PRIMARY_TABS.map(({ id, label, hint, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectTab(id)}
                  aria-current={active ? 'page' : undefined}
                  title={label}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    isZenLocked ? 'justify-center px-0' : ''
                  } ${
                    active
                      ? 'border-emerald-400/55 bg-emerald-500/12 text-[#F3F1EC]'
                      : 'border-transparent text-[#A3A39E] hover:bg-white/[0.05] hover:text-[#F3F1EC]'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-[#34D399]' : 'text-[#8E8E88]'
                    }`}
                  />
                  {!isZenLocked && (
                    <div className="min-w-0">
                      <div className="text-xs font-semibold leading-tight">{label}</div>
                      <div className="mt-0.5 truncate text-[10px] text-[#8E8E88]">{hint}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2 border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={onOpenSoundSystems}
            title="Sound Systems · Earbuds Pro Hardware Lab"
            className={`flex w-full items-center gap-2.5 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.08] px-3 py-2.5 text-xs font-medium text-[#34D399] transition hover:border-emerald-400/60 hover:bg-emerald-500/15 ${
              isZenLocked ? 'justify-center px-0' : ''
            }`}
          >
            <Headphones className="h-4 w-4 shrink-0 text-[#34D399]" />
            {!isZenLocked && <span>Sound Systems · Earbuds</span>}
          </button>

          <button
            type="button"
            onClick={onOpenProModal}
            title={isPro ? 'NootropicFM Pro Active' : 'Start 7-Day Free Trial'}
            className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
              isZenLocked ? 'justify-center px-0' : ''
            } ${
              isPro
                ? 'border-emerald-400/40 bg-emerald-500/12 text-[#34D399] hover:bg-emerald-500/20'
                : 'border-amber-400/35 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'
            }`}
          >
            <Crown className="h-4 w-4 shrink-0" />
            {!isZenLocked && <span>{isPro ? 'PRO Active' : 'Go Pro · 7-Day Trial'}</span>}
          </button>

          {installPromptAvailable && !isZenLocked && (
            <button
              type="button"
              onClick={onInstallApp}
              className="flex w-full items-center gap-2.5 rounded-xl border border-white/12 bg-[#131518] px-3 py-2 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC]"
            >
              <Download className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
              <span>Install App</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar (Mobile hidden in Zen Focus Lock; Desktop shows crisp status strip when unlocked) */}
        {!isZenLocked && (
          <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0A0B0C]/90 backdrop-blur-xl">
            <div className="mx-auto flex h-[54px] max-w-5xl items-center justify-between gap-2 px-3 sm:px-6">
              {/* Mobile Logo (hidden lg+ because Sidebar Rail holds brand mark) */}
              <button
                type="button"
                onClick={onLogoClick}
                className="group flex shrink-0 items-center gap-2 text-left lg:hidden"
                title="Return to Studio Home"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[#131518] text-[#34D399]">
                  <Radio className="h-4 w-4" />
                </div>
                <div className="whitespace-nowrap">
                  <div className="font-display text-sm font-bold leading-none tracking-tight text-[#F3F1EC]">
                    nootropic<span className="text-[#34D399]">.fm</span>
                  </div>
                  <div className="mt-0.5 font-mono-tech text-[9px] uppercase tracking-[0.14em] text-[#34D399]/85">
                    Tune your mind
                  </div>
                </div>
              </button>

              {/* Desktop Status Strip */}
              <div className="hidden items-center gap-2 lg:flex">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#131518] px-2.5 py-1 font-mono-tech text-[10.5px] font-medium text-[#D4D4CE]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#34D399]" />
                  {isDay ? 'Daylight Lab · 48 kHz' : 'Night Melatonin-Safe · 48 kHz'}
                </span>
                <button
                  type="button"
                  onClick={onOpenSoundSystems}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/[0.08] px-2.5 py-1 font-mono-tech text-[10.5px] font-semibold text-[#34D399] transition hover:border-emerald-400/60"
                >
                  <Headphones className="h-3 w-3" />
                  In-Ear Buds Only
                </button>
              </div>

              {/* Right Utility Cluster: Day/Night Segmented Switch + Go Pro pill (desktop) + Single System Pill */}
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <div
                  role="group"
                  aria-label="Display Mode"
                  className="inline-flex shrink-0 items-center rounded-lg border border-white/12 bg-[#131518] p-0.5 text-[11px] font-semibold"
                >
                  <button
                    type="button"
                    onClick={() => onSetThemeMode('daylight')}
                    aria-pressed={themeMode === 'daylight'}
                    aria-label="Daylight Mode"
                    title="Daylight Mode: crisp cool-slate acoustic lab + full daytime clarity"
                    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 transition sm:px-2 ${
                      themeMode === 'daylight'
                        ? 'bg-[#22252A] text-[#F3F1EC]'
                        : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">Day</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetThemeMode('night')}
                    aria-pressed={themeMode === 'night'}
                    aria-label="Night Mode"
                    title="Night Mode: obsidian studio + melatonin-safe nocturnal silk filter (-2.8 dB > 3.2 kHz)"
                    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 transition sm:px-2 ${
                      themeMode === 'night'
                        ? 'bg-emerald-500/15 text-[#34D399]'
                        : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">Night</span>
                  </button>
                </div>

                {!isPro && (
                  <button
                    type="button"
                    onClick={onOpenProModal}
                    className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-amber-400/35 bg-amber-400/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/20 sm:inline-flex"
                  >
                    <Crown className="h-3.5 w-3.5 shrink-0" />
                    <span>Go Pro</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="system-pill-trigger"
                  onClick={onOpenSystemDrawer}
                  aria-label="Open System, Sync & Privacy Drawer"
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition hover:border-emerald-400/60 ${systemPillBg}`}
                >
                  {profile ? (
                    <NeuralFingerprintSigil seed={syncCode || profile.id} size={18} />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-[#34D399]" />
                  )}
                  <span>{isPro ? 'PRO' : privacyStatusLabel}</span>
                  <span aria-hidden="true" className="text-[10px] opacity-75">
                    ▾
                  </span>
                </button>
              </div>
            </div>
          </header>
        )}

        {/* Main Content Canvas */}
        <main
          className={`relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6 ${mainBottomPad} ${
            isZenLocked ? 'flex flex-col justify-center py-4 sm:py-7' : 'py-6 sm:py-9'
          }`}
        >
          {children}
        </main>

        {/* Compliance & Official Channels Footer (shown outside Zen Focus Lock) */}
        {!isZenLocked && (
          <footer className="relative z-10 border-t border-white/[0.06] px-4 pb-24 pt-5 text-center text-[11px] text-[#8E8E88] lg:pb-6">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
              <span>
                nootropic.fm · Tune your mind · Psychoacoustic cognitive wellness, focus, and
                relaxation audio (not a medical device). Not intended to diagnose, treat, cure, or
                prevent any medical condition. Listeners 18+.
              </span>
              <span className="text-[#8E8E88]">
                Samples: Salamander Grand Piano &amp; FluidR3 GM (CC-BY 3.0)
              </span>
              <button
                type="button"
                onClick={onOpenSoundSystems}
                className="inline-flex items-center gap-1 font-semibold text-[#34D399] underline-offset-2 hover:underline"
              >
                <Headphones className="h-3 w-3" />
                NootropicFM Sound Systems (Earbuds Only)
              </button>
              <button
                type="button"
                onClick={onOpenPrivacyModal}
                className="inline-flex items-center gap-1 font-medium text-[#D4D4CE] underline-offset-2 hover:text-[#34D399] hover:underline"
              >
                <ShieldCheck className="h-3 w-3" />
                Privacy, Credits &amp; Delete My Data
              </button>
              <a
                href="/privacy/"
                className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
              >
                Privacy Policy
              </a>
              <a
                href="/terms/"
                className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
              >
                Terms
              </a>
              <a
                href={buildShowcaseUrl()}
                className="font-semibold text-[#34D399] underline-offset-2 hover:underline"
              >
                Hardware &amp; Science ↗
              </a>
              <a
                href="https://www.nootropic.fm/science/"
                className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
              >
                Science Atlas
              </a>
              <a
                href="https://www.nootropic.fm/compare/"
                className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
              >
                DSP vs. Playlists
              </a>
              <a
                href="https://www.nootropic.fm/contact/"
                className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
              >
                Departments
              </a>
              <a
                href="/delete-data/"
                className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
              >
                Delete Data
              </a>
              <span>
                General:{' '}
                <a
                  href="mailto:hello@nootropic.fm"
                  className="text-[#34D399] underline-offset-2 hover:underline"
                >
                  hello@nootropic.fm
                </a>
              </span>
              <span>
                Research:{' '}
                <a
                  href="mailto:research@nootropic.fm"
                  className="text-[#34D399] underline-offset-2 hover:underline"
                >
                  research@nootropic.fm
                </a>
              </span>
              <span>
                Support:{' '}
                <a
                  href="mailto:support@nootropic.fm"
                  className="text-[#34D399] underline-offset-2 hover:underline"
                >
                  support@nootropic.fm
                </a>
              </span>
              <span>
                Privacy:{' '}
                <a
                  href="mailto:privacy@nootropic.fm"
                  className="text-[#34D399] underline-offset-2 hover:underline"
                >
                  privacy@nootropic.fm
                </a>
              </span>
              <span>
                Founders:{' '}
                <a
                  href="mailto:founders@nootropic.fm"
                  className="text-[#34D399] underline-offset-2 hover:underline"
                >
                  founders@nootropic.fm
                </a>
              </span>
            </div>
          </footer>
        )}
      </div>

      {/* Persistent Docked MiniPlayerBar (when audio session is minimized) */}
      {hasMinimizedPlayer && miniPlayerSlot}

      {/* Mobile Bottom Tab Bar (3 primary destinations, >=48px targets, hidden in Zen Focus Lock) */}
      {!isZenLocked && (
        <nav
          aria-label="Studio Mobile Navigation"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[#0A0B0C]/90 backdrop-blur-xl lg:hidden"
        >
          <div className="mx-auto grid max-w-md grid-cols-3 gap-1 px-2 py-1.5">
            {PRIMARY_TABS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectTab(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-1 text-[11px] font-semibold transition ${
                    active
                      ? 'border-emerald-400/55 bg-emerald-500/12 text-[#F3F1EC]'
                      : 'border-transparent text-[#8E8E88] hover:text-[#F3F1EC]'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-[#34D399]' : 'text-[#8E8E88]'
                    }`}
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
