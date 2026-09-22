import { TerminalCommandEntry } from './types';

/** Ein Hinweis, wie er im Output-Kanal erscheint. */
export interface Advice {
  /** Ein Satz, der die Situation benennt. */
  summary: string;
  /** Optionaler nächster Schritt / Befehl. */
  detail?: string;
}

/**
 * Schnittstelle für den Berater. Die Regel-Implementierung unten ist der
 * Platzhalter; ein LLM-Berater (Azure MCP Server / Modell-Endpoint) implementiert
 * dieselbe Methode und bekommt denselben Kontext: den letzten Befehl plus Verlauf.
 */
export interface Advisor {
  advise(
    entry: TerminalCommandEntry,
    history: readonly TerminalCommandEntry[],
  ): Promise<Advice | undefined>;
}

interface Rule {
  /** Wird gegen Ausgabe und Kommandozeile geprüft. */
  pattern: RegExp;
  /** 'failure' = nur bei Exit-Code != 0, 'success' = nur bei 0, 'always' = immer. */
  when: 'failure' | 'success' | 'always';
  /** Zusätzliche Bedingung, z. B. "gar keine Ausgabe". */
  guard?: (entry: TerminalCommandEntry) => boolean;
  build: (entry: TerminalCommandEntry) => Advice;
}

const RULES: Rule[] = [
  {
    pattern: /AADSTS\d+|Please run ['"]?az login|az login to (re)?authenticate/i,
    when: 'failure',
    build: () => ({
      summary: 'Die Anmeldung ist abgelaufen oder der Token passt nicht zum Tenant.',
      detail: 'az login  — danach die richtige Subscription setzen: az account set -s <Sub-ID>',
    }),
  },
  {
    pattern: /AuthorizationFailed|does not have authorization|Forbidden|insufficient privileges/i,
    when: 'failure',
    build: () => ({
      summary: 'Fehlende Berechtigung (RBAC) auf diesem Scope.',
      detail: 'Vorhandene Rollen prüfen: az role assignment list --assignee <ObjectId> --all -o table',
    }),
  },
  {
    pattern: /ResourceGroupNotFound|could not be found.*resource group|resource group .* not found/i,
    when: 'failure',
    build: () => ({
      summary: 'Die Resource Group existiert nicht in der aktiven Subscription.',
      detail: 'Prüfen: az group list -o table  und  az account show (welche Subscription ist aktiv?)',
    }),
  },
  {
    pattern: /SubscriptionNotFound|The subscription .* could not be found|Please run ['"]?az account set/i,
    when: 'failure',
    build: () => ({
      summary: 'Die Subscription ist für diesen Login nicht sichtbar.',
      detail: 'az account list -o table  — dann az account set -s <Name-oder-ID>',
    }),
  },
  {
    pattern: /MissingSubscriptionRegistration|is not registered to use namespace|not registered/i,
    when: 'failure',
    build: () => ({
      summary: 'Der Resource Provider ist in dieser Subscription nicht registriert.',
      detail: 'az provider register --namespace <Namespace>  (Status: az provider show -n <Namespace> --query registrationState)',
    }),
  },
  {
    pattern: /unrecognized arguments|invalid choice|az: error: argument|expected one argument|the following arguments are required/i,
    when: 'failure',
    build: (entry) => ({
      summary: 'Der Befehl passt nicht zur CLI-Syntax (Parameter oder Subkommando falsch).',
      detail: `Hilfe direkt zur Gruppe: ${commandGroup(entry.command)} -h`,
    }),
  },
  {
    pattern: /.*/,
    when: 'failure',
    guard: (entry) => entry.output.trim().length === 0,
    build: (entry) => ({
      summary: `Befehl endete mit Exit-Code ${entry.exitCode ?? '?'}, aber ohne Ausgabe.`,
      detail: 'Bei az deutet das oft auf einen abgebrochenen Login oder eine falsche Subscription hin — mit --debug erneut laufen lassen.',
    }),
  },
  {
    pattern: /.*/,
    when: 'failure',
    build: (entry) => ({
      summary: `Exit-Code ${entry.exitCode ?? '?'} — die CLI hat den Befehl abgelehnt.`,
      detail: 'Ausgabe oben prüfen, oder mit --debug / -h erneut laufen lassen.',
    }),
  },
  {
    pattern: /az login/i,
    when: 'success',
    build: () => ({
      summary: 'Anmeldung erfolgreich.',
      detail: 'Kontext festzurren: az account show  /  az account set -s <Sub-ID>',
    }),
  },
];

/**
 * Regelbasierter Berater: erkennt die häufigen az-Fehlerbilder ohne Modellaufruf.
 * Bewusst still bei erfolgreichen Befehlen (außer `az login`), damit das Terminal
 * nicht zugemüllt wird.
 */
export class RuleBasedAdvisor implements Advisor {
  async advise(entry: TerminalCommandEntry): Promise<Advice | undefined> {
    const haystack = `${entry.command}\n${entry.output}`;
    const failures = entry.exitCode === undefined || entry.exitCode !== 0;

    for (const rule of RULES) {
      if (rule.when === 'failure' && !failures) {
        continue;
      }
      if (rule.when === 'success' && failures) {
        continue;
      }
      if (!rule.pattern.test(haystack)) {
        continue;
      }
      if (rule.guard && !rule.guard(entry)) {
        continue;
      }
      return rule.build(entry);
    }
    return undefined;
  }
}

/** "az vm list -o table" -> "az vm list" (nur der Kommandopfad, ohne Argumente). */
export function commandGroup(command: string): string {
  const tokens = command.trim().split(/\s+/);
  const parts = [tokens[0] ?? ''];
  for (const token of tokens.slice(1)) {
    if (token.startsWith('-')) {
      break;
    }
    parts.push(token);
  }
  return parts.join(' ');
}
