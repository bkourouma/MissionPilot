import Link from "next/link";
import {
  libelleStatutVeille,
  tonaliteScoreVeille,
  tonaliteStatutVeille,
  type ResultatVeille,
} from "../../lib/appels-offres-veille";
import { hrefFiche } from "../../lib/appels-offres";
import { formaterDate } from "../../lib/format";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { VeilleActions } from "./VeilleActions";

/**
 * Avis de la veille (AO-01) : score de rapprochement du moteur, raisons en français, sources où
 * l'avis a été vu et actions. L'adresse de l'avis est un lien : le serveur ne la visite jamais.
 */
export function VeilleResultats({
  resultats,
  gerer,
}: {
  resultats: readonly ResultatVeille[];
  gerer: boolean;
}) {
  return (
    <Tableau
      legende="Avis de la veille"
      lignes={resultats}
      cleLigne={(r) => r.id}
      messageVide="Aucun avis : activez une source puis collectez, ou importez un fichier."
      colonnes={[
        {
          cle: "titre",
          entete: "Avis",
          rendu: (r) => (
            <div className="mp-pile">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="mp-lien-ligne">
                  {r.titre}
                </a>
              ) : (
                <strong>{r.titre}</strong>
              )}
              <span className="mp-texte-doux mp-texte-petit">
                {[r.reference, r.bailleur, r.pays, r.secteur].filter(Boolean).join(" · ") || "—"}
              </span>
              {r.date_limite ? (
                <span className="mp-texte-doux mp-texte-petit">
                  Limite {formaterDate(r.date_limite)}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          cle: "sources",
          entete: "Vu dans",
          rendu: (r) => (
            <span className="mp-texte-petit">
              {(r.sources ?? []).join(", ") || "—"}
              {(r.nb_occurrences ?? 0) > 1 ? ` (${r.nb_occurrences} occurrences)` : ""}
            </span>
          ),
        },
        {
          cle: "score",
          entete: "Rapprochement",
          rendu: (r) => (
            <div className="mp-pile">
              <BadgeStatut tonalite={tonaliteScoreVeille(r.score_rapprochement)}>
                {r.score_rapprochement}/100
              </BadgeStatut>
              <details>
                <summary>Pourquoi ce score ?</summary>
                <ul className="mp-ao__liste-simple">
                  {r.rapprochement.raisons.map((raison) => (
                    <li key={raison} className="mp-texte-petit">
                      {raison}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ),
        },
        {
          cle: "statut",
          entete: "Statut",
          rendu: (r) => (
            <div className="mp-pile">
              <BadgeStatut tonalite={tonaliteStatutVeille(r.statut)}>
                {libelleStatutVeille(r.statut)}
              </BadgeStatut>
              {r.fiche_id ? (
                <Link href={hrefFiche(r.fiche_id)} className="mp-lien-ligne">
                  Ouvrir la fiche
                </Link>
              ) : null}
            </div>
          ),
        },
        ...(gerer
          ? [
              {
                cle: "actions",
                entete: "Actions",
                rendu: (r: ResultatVeille) => <VeilleActions id={r.id} statut={r.statut} />,
              },
            ]
          : []),
      ]}
    />
  );
}
