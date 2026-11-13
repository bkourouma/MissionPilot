import Link from "next/link";
import {
  libelleStatutVeille,
  tonaliteScoreVeille,
  tonaliteStatutVeille,
  type ResultatVeille,
} from "../../lib/appels-offres-veille";
import { hrefFiche } from "../../lib/appels-offres";
import { formaterDate } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { creerTraduire } from "@missionpilot/shared";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { VeilleActions } from "./VeilleActions";

/**
 * Avis de la veille (AO-01) : score de rapprochement du moteur, raisons en français, sources où
 * l'avis a été vu et actions. L'adresse de l'avis est un lien : le serveur ne la visite jamais.
 */
export async function VeilleResultats({
  resultats,
  gerer,
}: {
  resultats: readonly ResultatVeille[];
  gerer: boolean;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  return (
    <Tableau
      legende={t("Avis de la veille", "Monitoring notices")}
      lignes={resultats}
      cleLigne={(r) => r.id}
      messageVide={t(
        "Aucun avis : activez une source puis collectez, ou importez un fichier.",
        "No notices: enable a source then collect, or import a file.",
      )}
      colonnes={[
        {
          cle: "titre",
          entete: t("Avis", "Notice"),
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
                  {t("Limite", "Deadline")} {formaterDate(r.date_limite, "UTC", langue)}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          cle: "sources",
          entete: t("Vu dans", "Seen in"),
          rendu: (r) => (
            <span className="mp-texte-petit">
              {(r.sources ?? []).join(", ") || "—"}
              {(r.nb_occurrences ?? 0) > 1
                ? ` (${r.nb_occurrences} ${t("occurrences", "occurrences")})`
                : ""}
            </span>
          ),
        },
        {
          cle: "score",
          entete: t("Rapprochement", "Match"),
          rendu: (r) => (
            <div className="mp-pile">
              <BadgeStatut tonalite={tonaliteScoreVeille(r.score_rapprochement)}>
                {r.score_rapprochement}/100
              </BadgeStatut>
              <details>
                <summary>{t("Pourquoi ce score ?", "Why this score?")}</summary>
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
          entete: t("Statut", "Status"),
          rendu: (r) => (
            <div className="mp-pile">
              <BadgeStatut tonalite={tonaliteStatutVeille(r.statut)}>
                {libelleStatutVeille(r.statut, langue)}
              </BadgeStatut>
              {r.fiche_id ? (
                <Link href={hrefFiche(r.fiche_id)} className="mp-lien-ligne">
                  {t("Ouvrir la fiche", "Open the record")}
                </Link>
              ) : null}
            </div>
          ),
        },
        ...(gerer
          ? [
              {
                cle: "actions",
                entete: t("Actions", "Actions"),
                rendu: (r: ResultatVeille) => <VeilleActions id={r.id} statut={r.statut} />,
              },
            ]
          : []),
      ]}
    />
  );
}
