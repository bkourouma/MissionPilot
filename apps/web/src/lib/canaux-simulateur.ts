/** Sous-module de `canaux.ts` : simulateur de développement. */
import { creerTraduire, type Langue, type MessageSimulateurApi } from "@missionpilot/shared";
import type { Resultat } from "./saisie";
import { listeDepuis } from "./canaux-chemins";
import { validerNumeroSaisi } from "./canaux-numeros";

// --- Simulateur (développement) --------------------------------------------------------------

export type TypeEntrantSimule = "texte" | "vocal" | "statut";

export const OPTIONS_TYPE_ENTRANT: readonly { valeur: TypeEntrantSimule; libelle: string }[] = [
  { valeur: "texte", libelle: "Message écrit" },
  { valeur: "vocal", libelle: "Message vocal de test" },
  { valeur: "statut", libelle: "Statut d'un message envoyé" },
];

export const optionsTypeEntrant = (
  langue: Langue = "fr",
): readonly { valeur: TypeEntrantSimule; libelle: string }[] => {
  const t = creerTraduire(langue);
  return [
    { valeur: "texte", libelle: t("Message écrit", "Written message") },
    { valeur: "vocal", libelle: t("Message vocal de test", "Test voice message") },
    { valeur: "statut", libelle: t("Statut d'un message envoyé", "Status of a sent message") },
  ];
};

export const STATUTS_RECUS_SIMULES = [
  { valeur: "envoye", libelle: "Envoyé" },
  { valeur: "livre", libelle: "Livré" },
  { valeur: "lu", libelle: "Lu" },
  { valeur: "echec", libelle: "Échec" },
] as const;

export const libelleStatutRecuSimule = (valeur: string, langue: Langue = "fr"): string => {
  const en: Record<string, string> = {
    envoye: "Sent",
    livre: "Delivered",
    lu: "Read",
    echec: "Failed",
  };
  const x = STATUTS_RECUS_SIMULES.find((s) => s.valeur === valeur);
  return langue === "en" ? (en[valeur] ?? valeur) : (x?.libelle ?? valeur);
};

export interface SaisieEntrantSimule {
  type: TypeEntrantSimule;
  numero: string;
  texte: string;
  idExterne: string;
  statut: string;
}

export type ChampEntrantSimule = "numero" | "texte" | "idExterne" | "statut";

export type ChargeEntrantSimule =
  | { type: "message"; numero: string; texte: string }
  | { type: "message"; numero: string; audio_texte: string }
  | { type: "statut"; id_externe: string; statut: string };

/** Corps de `POST /api/canaux/simulateur/entrant` (aucun vrai audio : conteneur de test fabriqué par l'API). */
export function validerEntrantSimule(
  s: SaisieEntrantSimule,
  langue: Langue = "fr",
): Resultat<ChargeEntrantSimule, ChampEntrantSimule> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampEntrantSimule, string>> = {};
  if (s.type === "statut") {
    const id = s.idExterne.trim();
    if (id === "" || id.length > 100) {
      erreurs.idExterne = t(
        "Choisissez le message envoyé concerné.",
        "Choose the sent message concerned.",
      );
    }
    if (!STATUTS_RECUS_SIMULES.some((x) => x.valeur === s.statut)) {
      erreurs.statut = t("Choisissez un statut.", "Choose a status.");
    }
    if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
    return { ok: true, charge: { type: "statut", id_externe: id, statut: s.statut } };
  }
  const numero = validerNumeroSaisi(s.numero, langue);
  if (!numero.ok) erreurs.numero = numero.erreurs.numero;
  const texte = s.texte.trim();
  const limite = s.type === "texte" ? 4096 : 2000;
  if (texte === "")
    erreurs.texte = t("Saisissez le contenu du message.", "Enter the message content.");
  else if (texte.length > limite) {
    erreurs.texte = t(
      `Le message ne doit pas dépasser ${limite} caractères.`,
      `The message must not exceed ${limite} characters.`,
    );
  }
  if (!numero.ok || Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return s.type === "texte"
    ? { ok: true, charge: { type: "message", numero: numero.charge.numero, texte } }
    : { ok: true, charge: { type: "message", numero: numero.charge.numero, audio_texte: texte } };
}

/** Messages « envoyés » du simulateur, du plus récent au plus ancien. */
export function messagesSimulateur(corps: unknown): MessageSimulateurApi[] {
  return [...listeDepuis<MessageSimulateurApi>(corps)].sort((a, b) =>
    a.instant < b.instant ? 1 : a.instant > b.instant ? -1 : 0,
  );
}

/** Le simulateur n'existe qu'en mode simulé local : 404 de l'API = « non disponible ». */
export const simulateurIndisponible = (e: { statut: number }) => e.statut === 404;
