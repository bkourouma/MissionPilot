import Link from "next/link";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";
import { formaterDateHeure } from "../../lib/format";
import {
  formaterDateJour,
  libelleParticipation,
  libellePartie,
  type ParticipationApi,
  type PartieParticipation,
} from "../../lib/dossier-groupes";
import "./groupe.css";

function Partie({ p }: { p: PartieParticipation }) {
  return p.visible ? (
    <Link href={`/dossiers/${p.id}`} className="mp-lien-ligne">
      {p.nom}
    </Link>
  ) : (
    <>{libellePartie(p)}</>
  );
}

/**
 * Historique complet des participations du dossier (détenteur ou filiale), du plus récent au
 * plus ancien. Ajout seul : rien ne se modifie ni ne se supprime ; une fin de détention est un
 * nouvel enregistrement à 0 %.
 */
export function HistoriqueParticipations({
  participations,
}: {
  participations: readonly ParticipationApi[];
}) {
  return (
    <Carte titre="Historique des participations" niveauTitre={2}>
      <Tableau<ParticipationApi>
        legende="Historique des participations (ajout seul, du plus récent au plus ancien)"
        lignes={participations}
        cleLigne={(p) => p.id}
        messageVide="Aucune participation enregistrée pour ce dossier."
        colonnes={[
          {
            cle: "date_effet",
            entete: "Date d'effet",
            rendu: (p) => formaterDateJour(p.date_effet),
          },
          { cle: "detenteur", entete: "Détenteur", rendu: (p) => <Partie p={p.detenteur} /> },
          { cle: "filiale", entete: "Filiale", rendu: (p) => <Partie p={p.filiale} /> },
          {
            cle: "points_base",
            entete: "Participation",
            alignement: "droite",
            rendu: (p) =>
              p.fin_de_detention ? (
                <BadgeStatut tonalite="neutre">{libelleParticipation(p)}</BadgeStatut>
              ) : (
                libelleParticipation(p)
              ),
          },
          { cle: "motif", entete: "Motif", rendu: (p) => p.motif ?? "—" },
          {
            cle: "cree_par",
            entete: "Saisi par",
            rendu: (p) => `${p.cree_par.nom}, le ${formaterDateHeure(p.cree_le)}`,
          },
        ]}
      />
    </Carte>
  );
}
