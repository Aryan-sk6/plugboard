// The AI programs Plugboard can use: how to find them, check sign-in, sign in, install, and ask them things.
import { findClaude, type Launch } from './claude.ts';
import { findCodex } from './codex.ts';
import { claudeAdapter, codexAdapter, type Adapter } from './runner.ts';

export type ProviderId = 'claude' | 'codex';

export interface Provider {
  id: ProviderId;
  /** Name shown to people. */
  label: string;
  /** The kind of account needed, in plain words. */
  plan: string;
  find(): Promise<Launch | null>;
  statusArgs: string[];
  /** Reads the status command's exit code and output. */
  isSignedIn(code: number | null, output: string): boolean;
  loginArgs: string[];
  /** Only sign-in links on these sites are shown to the user. */
  loginSites: RegExp;
  /** Official installer, if there is one we can run for the user. */
  installCommand?(platform?: NodeJS.Platform): { cmd: string; args: string[] };
  /** Shown when we can't install it for them. */
  installHelp: { text: string; url: string };
  adapter: Adapter;
  /** Extra plain-language note shown on the connect screen. */
  notice?: string;
}

/** Anthropic's official install command for this computer (from code.claude.com/docs/en/setup). */
export function installCommand(platform = process.platform): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'irm https://claude.ai/install.ps1 | iex'] };
  return { cmd: 'bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] };
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    plan: 'a paid Claude plan (Pro, Max or higher)',
    find: findClaude,
    statusArgs: ['auth', 'status', '--json'],
    isSignedIn(_code, output) {
      try {
        return JSON.parse(output).loggedIn === true;
      } catch {
        return false;
      }
    },
    loginArgs: ['auth', 'login', '--claudeai'],
    loginSites: /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)\//i,
    installCommand,
    installHelp: { text: 'Install Claude Code from Anthropic, then come back here.', url: 'https://code.claude.com/docs/en/setup' },
    adapter: claudeAdapter,
  },
  codex: {
    id: 'codex',
    label: 'ChatGPT',
    plan: 'a ChatGPT account that includes Codex (for example Plus or Pro)',
    find: findCodex,
    statusArgs: ['login', 'status'],
    isSignedIn: (code, output) => code === 0 && !/not logged in/i.test(output),
    loginArgs: ['login'],
    loginSites: /^https:\/\/([a-z0-9-]+\.)*(openai\.com|chatgpt\.com)\//i,
    installHelp: { text: "Plugboard can't install ChatGPT's Codex for you. Install the Codex app or program from OpenAI, then come back here. This page notices by itself.", url: 'https://developers.openai.com/codex' },
    adapter: codexAdapter,
    notice:
      "ChatGPT mode: Plugboard asks Codex to answer in read-only mode with its extra tools switched off as far as possible. " +
      "Codex can't be made completely text-only the way Claude can, so only use helpers you trust. Answers appear all at once when they are ready.",
  },
};

export function isProviderId(v: unknown): v is ProviderId {
  return v === 'claude' || v === 'codex';
}
