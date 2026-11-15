"use client";

import { useRef, useState } from "react";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut, type TonaliteStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { api, messageErreur } from "../../lib/api";
import {
  clePropositionTemps,
  LIBELLE_CONFIANCE,
  LIBELLE_CONFIANCE_EN,
  LIBELLE_MOTIF_ECARTE,
  LIBELLE_MOTIF_ECARTE_EN,
  LIBELLE_SOURCE,
  LIBELLE_SOURCE_EN,
  selectionParDefaut,
  type ConfianceProposition,
  type PropositionTemps,
  type ReponsePreRemplissage,
} from "../../lib/preremplissage";
import { libelleJourLong } from "../../lib/semaine";
import { formaterValeur, type UniteSaisie } from "../../lib/temps";

const TONALITE: Record<ConfianceProposition, TonaliteStatut> = {
  haute: "succes",
  moyenne: "neutre",
  faible: "attention",
};

export interface PreRemplissageProps {
  /** Lundi de la semaine affichée. */
  semaine: string;
  unite: UniteSaisie;
  /** Reçoit les propositions retenues ; le parent met la grille à jour (sans rien enregistrer). */
  onAppliquer: (retenues: PropositionTemps[]) => { appliquees: number; conservees: number };
}

/**
 * « Pré-remplir » (AUT-09) : demande une proposition de saisie pour la semaine, l'affiche avec sa
 * source et sa confiance, et n'agit sur la grille qu'à la confirmation du consultant. La
 * proposition n'est jamais enregistrée par ce composant : la feuille se sauvegarde et se soumet
 * ensuite comme d'habitude, après relecture.
 */
export function PreRemplissage({ semaine, unite, onAppliquer }: PreRemplissageProps) {
  const t = useT();
  const langue = useLangue();
  const en = langue === "en";
  const [etat, setEtat] = useState<
    | { phase: "repos" }
    | { phase: "chargement" }
    | { phase: "erreur"; message: string }
    | { phase: "proposition"; reponse: ReponsePreRemplissage }
    | { phase: "applique"; appliquees: number; conservees: number }
  >({ phase: "repos" });
  const [retenues, setRetenues] = useState<Set<string>>(new Set());
  const refTitre = useRef<HTMLHeadingElement>(null);

  async function proposer() {
    setEtat({ phase: "chargement" });
    try {
      const reponse = await api.get<ReponsePreRemplissage>(
        `/api/temps/preremplissage?semaine=${encodeURIComponent(semaine)}`,
      );
      setRetenues(selectionParDefaut(reponse.propositions));
      setEtat({ phase: "proposition", reponse });
      queueMicrotask(() => refTitre.current?.focus());
    } catch (e) {
      setEtat({ phase: "erreur", message: messageErreur(e, langue) });
    }
  }

  function basculer(cle: string, coche: boolean) {
    setRetenues((avant) => {
      const suivant = new Set(avant);
      if (coche) suivant.add(cle);
      else suivant.delete(cle);
      return suivant;
    });
  }

  return (
    <div className="mp-pile">
      <div className="mp-ligne-action">
        <Bouton
          variante="secondaire"
          icone="horloge"
          chargement={etat.phase === "chargement"}
          texteChargement={t("Recherche…", "Searching…")}
          onClick={proposer}
        >
          {t("Pré-remplir", "Pre-fill")}
        </Bouton>
      </div>
      {etat.phase === "erreur" ? (
        <Alerte tonalite="danger" titre={t("Proposition indisponible", "Suggestion unavailable")}>
          <p>{etat.message}</p>
        </Alerte>
      ) : null}
      {etat.phase === "applique" ? (
        <Alerte
          tonalite="succes"
          titre={t("Proposition appliquée à la grille", "Suggestion applied to the grid")}
        >
          <p>
            {t(
              `${etat.appliquees} case(s) remplie(s)${
                etat.conservees > 0 ? `, ${etat.conservees} déjà renseignée(s) conservée(s)` : ""
              }. Relisez et ajustez la grille : le brouillon est sauvegardé automatiquement, mais la feuille n'est soumise que lorsque vous la soumettez.`,
              `${etat.appliquees} cell(s) filled${
                etat.conservees > 0 ? `, ${etat.conservees} already filled cell(s) kept` : ""
              }. Review and adjust the grid: the draft is saved automatically, but the timesheet is only submitted when you submit it.`,
            )}
          </p>
        </Alerte>
      ) : null}
      {etat.phase === "proposition" ? (
        <section className="mp-carte" aria-labelledby="titre-preremplissage">
          <header className="mp-carte__entete">
            <h2 id="titre-preremplissage" className="mp-carte__titre" ref={refTitre} tabIndex={-1}>
              {t("Proposition de saisie", "Entry suggestion")}
            </h2>
          </header>
          <div className="mp-pile">
            <p className="mp-texte-doux">
              {t(
                "Établie depuis vos affectations et votre activité sur la plateforme (aucun agenda n'est connecté). Cochez ce que vous confirmez : rien n'est appliqué à la grille avant votre confirmation, et la feuille n'est soumise que par vous.",
                "Based on your assignments and your activity on the platform (no calendar is connected). Tick what you confirm: nothing is applied to the grid before your confirmation, and the timesheet is only submitted by you.",
              )}
            </p>
            {!etat.reponse.feuille_modifiable ? (
              <Alerte
                tonalite="info"
                annonce="aucune"
                titre={t("Feuille non modifiable", "Timesheet cannot be edited")}
              >
                <p>
                  {t(
                    "Cette feuille est soumise, validée ou verrouillée : aucune proposition.",
                    "This timesheet is submitted, approved or locked: no suggestion.",
                  )}
                </p>
              </Alerte>
            ) : etat.reponse.propositions.length === 0 ? (
              <p role="status">
                {t("Rien à proposer pour cette semaine.", "Nothing to suggest for this week.")}
              </p>
            ) : (
              <ul className="mp-pile" aria-label={t("Lignes proposées", "Suggested rows")}>
                {etat.reponse.propositions.map((p) => {
                  const cle = clePropositionTemps(p);
                  return (
                    <li key={cle}>
                      <CaseACocher
                        libelle={`${libelleJourLong(p.date, langue)} — ${p.tache_libelle ?? t("Tâche", "Task")} (${p.mission_intitule ?? t("Mission", "Engagement")}) : ${formaterValeur(unite === "heure" ? p.heures : p.jours, unite, langue)}`}
                        aide={
                          <>
                            <BadgeStatut tonalite={TONALITE[p.confiance]} sansIcone>
                              {(en ? LIBELLE_CONFIANCE_EN : LIBELLE_CONFIANCE)[p.confiance]}
                            </BadgeStatut>{" "}
                            {(en ? LIBELLE_SOURCE_EN : LIBELLE_SOURCE)[p.source]}.{" "}
                            {p.raisons.join(" ")}
                          </>
                        }
                        checked={retenues.has(cle)}
                        onChange={(e) => basculer(cle, e.target.checked)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {etat.reponse.ecartees.length > 0 ? (
              <p className="mp-texte-doux">
                {`${t("Non proposé : ", "Not suggested: ")}${etat.reponse.ecartees
                  .map(
                    (e) =>
                      `${libelleJourLong(e.date, langue)} (${(en ? LIBELLE_MOTIF_ECARTE_EN : LIBELLE_MOTIF_ECARTE)[e.motif] ?? e.motif})`,
                  )
                  .join(", ")}.`}
              </p>
            ) : null}
            {(etat.reponse.activite_ignoree ?? 0) > 0 ? (
              <p className="mp-texte-doux">
                {t(
                  `${etat.reponse.activite_ignoree} activité(s) sur des tâches qui ne vous sont pas affectées : ignorée(s).`,
                  `${etat.reponse.activite_ignoree} activity(ies) on tasks not assigned to you: ignored.`,
                )}
              </p>
            ) : null}
            <div className="mp-ligne-action">
              <Bouton
                icone="succes"
                disabled={!etat.reponse.feuille_modifiable || retenues.size === 0}
                onClick={() => {
                  const choisies = etat.reponse.propositions.filter((p) =>
                    retenues.has(clePropositionTemps(p)),
                  );
                  setEtat({ phase: "applique", ...onAppliquer(choisies) });
                }}
              >
                {t("Appliquer à la grille", "Apply to the grid")}
              </Bouton>
              <Bouton variante="discret" onClick={() => setEtat({ phase: "repos" })}>
                {t("Ignorer", "Dismiss")}
              </Bouton>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
