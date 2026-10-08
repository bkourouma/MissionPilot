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
        titreErreur="Parcours impossible"
      />
      <div className="mp-qualite-progres">
        <progress
          value={parcours.vus}
          max={Math.max(parcours.obligatoires, 1)}
          aria-label="Éléments obligatoires que vous avez parcourus"
        />
        <p>
          <strong>{texteParcours(parcours)}</strong>
          {parcours.complet ? null : (
            <span className="mp-texte-doux">
              {" "}
              — encore {parcours.restants} à parcourir avant de valider.
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
              texteChargement="Arrêt…"
              onClick={() =>
                a.agir(
                  () => api.post(cheminTerminerSession(sessionOuverte.id)),
                  "Session de revue terminée : le temps passé est enregistré.",
                )
              }
            >
              Terminer ma session de revue
            </Bouton>
          ) : (
            <Bouton
              variante="secondaire"
              chargement={a.enCours}
              texteChargement="Démarrage…"
              onClick={() =>
                a.agir(
                  () => api.post(cheminActionSuivi(suiviId, "sessions")),
                  "Session de revue démarrée.",
                )
              }
            >
              Démarrer une session de revue
            </Bouton>
          )}
          <p className="mp-texte-doux mp-texte-petit">
            {temps.synthese.sessions === 0
              ? "Aucune session de revue terminée."
              : `${temps.synthese.sessions} session(s) terminée(s), ${formaterDuree(temps.synthese.totalSecondes)} au total.`}
            {sessionOuverte
              ? ` Session ouverte depuis ${formaterDateHeure(sessionOuverte.debut)}.`
              : ""}
          </p>
        </div>
      ) : null}

      {elements.length === 0 ? (
        <p className="mp-texte-doux">
          Aucun élément à parcourir n&apos;a été déposé pour ce livrable : les modules plans,
          rapports et preuves y déposent leurs assertions fragiles, leurs chiffres et leurs
          recommandations.
        </p>
      ) : (
        ORDRE.map((kind) => {
          const groupe = elements.filter((e) => e.kind === kind);
          if (groupe.length === 0) return null;
          return (
            <section key={kind} aria-label={libelleKind(kind)} className="mp-qualite__groupe">
              <h3 className="mp-qualite__sous-titre">
                {libelleKind(kind)} ({groupe.length})
              </h3>
              <ul className="mp-liste-lignes">
                {groupe.map((e) => (
                  <li key={e.id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <span>{e.libelle}</span>
                      <span className="mp-texte-doux mp-texte-petit">
                        {e.obligatoire ? "Obligatoire" : "Facultatif"}
                        {e.source
                          ? ` · Source : ${e.source}`
                          : kind === "chiffre"
                            ? " · Source non indiquée"
                            : ""}
                      </span>
                    </div>
                    {e.vu_par_moi ? (
                      <BadgeStatut tonalite="succes">Parcouru</BadgeStatut>
                    ) : ouvert ? (
                      <Bouton
                        variante="secondaire"
                        chargement={a.enCours}
                        texteChargement="…"
                        aria-label={`Marquer comme parcouru : ${e.libelle}`}
                        onClick={() => a.agir(() => api.post(cheminVu(suiviId, e.id)))}
                      >
                        Marquer comme parcouru
                      </Bouton>
                    ) : (
                      <BadgeStatut tonalite="neutre">Non parcouru</BadgeStatut>
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
