"use client";

import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import {
  cheminActionSuivi,
  cheminTerminerSession,
  cheminVu,
  formaterDuree,
  libelleKind,
  texteParcours,
  type ElementRevue,
  type Parcours,
  type SessionRevue,
  type TempsRevue,
} from "../../lib/qualite";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { RetourAction } from "./RetourAction";
import { useActionQualite } from "./useActionQualite";

export interface ParcoursRevueGuideeProps {
  suiviId: string;
  /** Le parcours n'est ouvert que pendant la revue et jusqu'à la signature. */
  ouvert: boolean;
  elements: ElementRevue[];
  parcours: Parcours;
  temps: TempsRevue;
  /** Identifiant de l'utilisateur courant : sa session ouverte, s'il en a une. */
  utilisateurId: string;
}

const ORDRE: ElementRevue["kind"][] = ["assertion_fragile", "chiffre", "recommandation"];

/**
 * Revue guidée (QUA-03) : les assertions fragiles, puis les chiffres, puis les recommandations.
 * Chaque relecteur marque lui-même ce qu'il a parcouru ; sa validation est refusée par l'API
 * tant qu'un élément obligatoire lui reste. Le temps de revue est mesuré par sessions.
 */
export function ParcoursRevueGuidee({
  suiviId,
  ouvert,
  elements,
  parcours,
  temps,
  utilisateurId,
}: ParcoursRevueGuideeProps) {
  const t = useT();
  const langue = useLangue();
  const a = useActionQualite();
  const sessionOuverte: SessionRevue | undefined = temps.sessions.find(
    (s) => s.utilisateur_id === utilisateurId && s.fin === null,
  );

  return (
    <div className="mp-qualite__section">
      <RetourAction
        erreur={a.erreur}
        succes={a.succes}
        violations={a.violations}
        refAlerte={a.refAlerte}
        titreErreur={t("Parcours impossible", "Review path unavailable")}
      />
      <div className="mp-qualite-progres">
        <progress
          value={parcours.vus}
          max={Math.max(parcours.obligatoires, 1)}
          aria-label={t(
            "Éléments obligatoires que vous avez parcourus",
            "Mandatory items you have reviewed",
          )}
        />
        <p>
          <strong>{texteParcours(parcours, langue)}</strong>
          {parcours.complet ? null : (
            <span className="mp-texte-doux">
              {" "}
              {t(
                `— encore ${parcours.restants} à parcourir avant de valider.`,
                `— ${parcours.restants} more to review before approving.`,
              )}
            </span>
          )}
        </p>
      </div>

      {ouvert ? (
        <div className="mp-qualite__actions-ligne">
          {sessionOuverte ? (
            <Bouton
              variante="secondaire"
              chargement={a.enCours}
              texteChargement={t("Arrêt…", "Stopping…")}
              onClick={() =>
                a.agir(
                  () => api.post(cheminTerminerSession(sessionOuverte.id)),
                  t(
                    "Session de revue terminée : le temps passé est enregistré.",
                    "Review session ended: the time spent is recorded.",
                  ),
                )
              }
            >
              {t("Terminer ma session de revue", "End my review session")}
            </Bouton>
          ) : (
            <Bouton
              variante="secondaire"
              chargement={a.enCours}
              texteChargement={t("Démarrage…", "Starting…")}
              onClick={() =>
                a.agir(
                  () => api.post(cheminActionSuivi(suiviId, "sessions")),
                  t("Session de revue démarrée.", "Review session started."),
                )
              }
            >
              {t("Démarrer une session de revue", "Start a review session")}
            </Bouton>
          )}
          <p className="mp-texte-doux mp-texte-petit">
            {temps.synthese.sessions === 0
              ? t("Aucune session de revue terminée.", "No review session completed.")
              : t(
                  `${temps.synthese.sessions} session(s) terminée(s), ${formaterDuree(temps.synthese.totalSecondes)} au total.`,
                  `${temps.synthese.sessions} session(s) completed, ${formaterDuree(temps.synthese.totalSecondes)} in total.`,
                )}
            {sessionOuverte
              ? t(
                  ` Session ouverte depuis ${formaterDateHeure(sessionOuverte.debut, undefined, langue)}.`,
                  ` Session open since ${formaterDateHeure(sessionOuverte.debut, undefined, langue)}.`,
                )
              : ""}
          </p>
        </div>
      ) : null}

      {elements.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucun élément à parcourir n'a été déposé pour ce livrable : les modules plans, rapports et preuves y déposent leurs assertions fragiles, leurs chiffres et leurs recommandations.",
            "No item to review has been added for this deliverable: the plans, reports and evidence modules add their weak assertions, figures and recommendations here.",
          )}
        </p>
      ) : (
        ORDRE.map((kind) => {
          const groupe = elements.filter((e) => e.kind === kind);
          if (groupe.length === 0) return null;
          return (
            <section
              key={kind}
              aria-label={libelleKind(kind, langue)}
              className="mp-qualite__groupe"
            >
              <h3 className="mp-qualite__sous-titre">
                {libelleKind(kind, langue)} ({groupe.length})
              </h3>
              <ul className="mp-liste-lignes">
                {groupe.map((e) => (
                  <li key={e.id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <span>{e.libelle}</span>
                      <span className="mp-texte-doux mp-texte-petit">
                        {e.obligatoire
                          ? t("Obligatoire", "Mandatory")
                          : t("Facultatif", "Optional")}
                        {e.source
                          ? ` · ${t("Source", "Source")} : ${e.source}`
                          : kind === "chiffre"
                            ? ` · ${t("Source non indiquée", "Source not specified")}`
                            : ""}
                      </span>
                    </div>
                    {e.vu_par_moi ? (
                      <BadgeStatut tonalite="succes">{t("Parcouru", "Reviewed")}</BadgeStatut>
                    ) : ouvert ? (
                      <Bouton
                        variante="secondaire"
                        chargement={a.enCours}
                        texteChargement="…"
                        aria-label={t(
                          `Marquer comme parcouru : ${e.libelle}`,
                          `Mark as reviewed: ${e.libelle}`,
                        )}
                        onClick={() => a.agir(() => api.post(cheminVu(suiviId, e.id)))}
                      >
                        {t("Marquer comme parcouru", "Mark as reviewed")}
                      </Bouton>
                    ) : (
                      <BadgeStatut tonalite="neutre">
                        {t("Non parcouru", "Not reviewed")}
                      </BadgeStatut>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
