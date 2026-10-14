import Link from "next/link";
import type { RedCreancierResume } from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import {
  hrefCreancierRed,
  libelleCategorieCreancier,
  libelleStatutAccord,
  tonaliteStatutAccord,
} from "../../lib/redressement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";

/**
 * Registre des créanciers : encours restant, échu, accord et sa prochaine échéance, tels que
 * l'API les calcule (la situation est recalculée à chaque lecture, jamais stockée).
 */
export function ListeCreanciers({
  missionId,
  elements,
  devise,
}: {
  missionId: string;
  elements: RedCreancierResume[];
  devise: Devise;
}) {
  return (
    <Tableau
      legende="Registre des créanciers"
      messageVide="Aucun créancier enregistré."
      colonnes={[
        {
          cle: "nom",
          entete: "Créancier",
          rendu: (c: RedCreancierResume) => (
            <>
              <Link href={hrefCreancierRed(missionId, c.id)}>{c.nom}</Link>
              {c.actif ? null : <span className="mp-texte-doux"> (inactif)</span>}
            </>
          ),
        },
        {
          cle: "categorie",
          entete: "Catégorie",
          rendu: (c) => libelleCategorieCreancier(c.categorie),
        },
        { cle: "garanti", entete: "Garanti", rendu: (c) => (c.garanti ? "Oui" : "Non") },
        {
          cle: "encours",
          entete: "Encours restant",
          alignement: "droite",
          rendu: (c) => (
            <span className="mp-red-valeur">
              {formaterMontantMineur(c.situation.encours_restant, devise)}
            </span>
          ),
        },
        {
          cle: "echu",
          entete: "Échu",
          alignement: "droite",
          rendu: (c) => (
            <span className="mp-red-valeur">{formaterMontantMineur(c.situation.echu, devise)}</span>
          ),
        },
        {
          cle: "accord",
          entete: "Accord",
          rendu: (c) =>
            c.situation.accord ? (
              <BadgeStatut tonalite={tonaliteStatutAccord(c.situation.accord.statut)}>
                {libelleStatutAccord(c.situation.accord.statut)}
              </BadgeStatut>
            ) : (
              "—"
            ),
        },
        {
          cle: "prochaine",
          entete: "Prochaine échéance",
          rendu: (c) => {
            const p = c.situation.accord?.prochaine_non_soldee;
            return p
              ? `${formaterDate(p.date)} : ${formaterMontantMineur(p.montant_restant, devise)}`
              : "—";
          },
        },
      ]}
      lignes={elements}
      cleLigne={(c) => c.id}
    />
  );
}
