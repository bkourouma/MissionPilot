import Link from "next/link";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";
import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import type { Langue } from "@missionpilot/shared";
import {
  formaterDateJour,
  libelleParticipation,
  libellePartie,
  type ParticipationApi,
  type PartieParticipation,
} from "../../lib/dossier-groupes";
import "./groupe.css";

function Partie({ p, langue }: { p: PartieParticipation; langue: Langue }) {
  return p.visible ? (
    <Link href={`/dossiers/${p.id}`} className="mp-lien-ligne">
      {p.nom}
    </Link>
  ) : (
    <>{libellePartie(p, langue)}</>
  );
}

/**
 * Historique complet des participations du dossier (détenteur ou filiale), du plus récent au
 * plus ancien. Ajout seul : rien ne se modifie ni ne se supprime ; une fin de détention est un
 * nouvel enregistrement à 0 %.
 */
export async function HistoriqueParticipations({
  participations,
}: {
  participations: readonly ParticipationApi[];
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  return (
    <Carte titre={t("Historique des participations", "Holdings history")} niveauTitre={2}>
      <Tableau<ParticipationApi>
        legende={t(
          "Historique des participations (ajout seul, du plus récent au plus ancien)",
          "Holdings history (append-only, most recent first)",
        )}
        lignes={participations}
        cleLigne={(p) => p.id}
        messageVide={t(
          "Aucune participation enregistrée pour ce dossier.",
          "No holdings recorded for this file.",
        )}
        colonnes={[
          {
            cle: "date_effet",
            entete: t("Date d'effet", "Effective date"),
            rendu: (p) => formaterDateJour(p.date_effet),
          },
          {
            cle: "detenteur",
            entete: t("Détenteur", "Holder"),
            rendu: (p) => <Partie p={p.detenteur} langue={langue} />,
          },
          {
            cle: "filiale",
            entete: t("Filiale", "Subsidiary"),
            rendu: (p) => <Partie p={p.filiale} langue={langue} />,
          },
          {
            cle: "points_base",
            entete: t("Participation", "Holding"),
            alignement: "droite",
            rendu: (p) =>
              p.fin_de_detention ? (
                <BadgeStatut tonalite="neutre">{libelleParticipation(p, langue)}</BadgeStatut>
              ) : (
                libelleParticipation(p, langue)
              ),
          },
          { cle: "motif", entete: t("Motif", "Reason"), rendu: (p) => p.motif ?? "—" },
          {
            cle: "cree_par",
            entete: t("Saisi par", "Entered by"),
            rendu: (p) =>
              `${p.cree_par.nom}${t(", le ", ", on ")}${formaterDateHeure(p.cree_le, undefined, langue)}`,
          },
        ]}
      />
    </Carte>
  );
}
