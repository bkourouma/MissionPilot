"use client";

import { useRef, useState } from "react";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut, type TonaliteStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { api, messageErreur } from "../../lib/api";
import {
  clePropositionTemps,
  LIBELLE_CONFIANCE,
  LIBELLE_MOTIF_ECARTE,
  LIBELLE_SOURCE,
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
      setEtat({ phase: "erreur", message: messageErreur(e) });
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
          texteChargement="Recherche…"
          onClick={proposer}
        >
          Pré-remplir
        </Bouton>
      </div>
      {etat.phase === "erreur" ? (
        <Alerte tonalite="danger" titre="Proposition indisponible">
          <p>{etat.message}</p>
        </Alerte>
      ) : null}
      {etat.phase === "applique" ? (
        <Alerte tonalite="succes" titre="Proposition appliquée à la grille">
          <p>
            {`${etat.appliquees} case(s) remplie(s)${
              etat.conservees > 0 ? `, ${etat.conservees} déjà renseignée(s) conservée(s)` : ""
            }. Relisez et ajustez la grille : le brouillon est sauvegardé automatiquement, mais la feuille n'est soumise que lorsque vous la soumettez.`}
          </p>
        </Alerte>
      ) : null}
      {etat.phase === "proposition" ? (
        <section className="mp-carte" aria-labelledby="titre-preremplissage">
          <header className="mp-carte__entete">
            <h2 id="titre-preremplissage" className="mp-carte__titre" ref={refTitre} tabIndex={-1}>
              Proposition de saisie
            </h2>
          </header>
          <div className="mp-pile">
            <p className="mp-texte-doux">
              Établie depuis vos affectations et votre activité sur la plateforme (aucun agenda
              n&apos;est connecté). Cochez ce que vous confirmez : rien n&apos;est appliqué à la
              grille avant votre confirmation, et la feuille n&apos;est soumise que par vous.
            </p>
            {!etat.reponse.feuille_modifiable ? (
              <Alerte tonalite="info" annonce="aucune" titre="Feuille non modifiable">
                <p>Cette feuille est soumise, validée ou verrouillée : aucune proposition.</p>
              </Alerte>
            ) : etat.reponse.propositions.length === 0 ? (
              <p role="status">Rien à proposer pour cette semaine.</p>
            ) : (
              <ul className="mp-pile" aria-label="Lignes proposées">
                {etat.reponse.propositions.map((p) => {
                  const cle = clePropositionTemps(p);
                  return (
                    <li key={cle}>
                      <CaseACocher
                        libelle={`${libelleJourLong(p.date)} — ${p.tache_libelle ?? "Tâche"} (${p.mission_intitule ?? "Mission"}) : ${formaterValeur(unite === "heure" ? p.heures : p.jours, unite)}`}
                        aide={
                          <>
                            <BadgeStatut tonalite={TONALITE[p.confiance]} sansIcone>
                              {LIBELLE_CONFIANCE[p.confiance]}
                            </BadgeStatut>{" "}
                            {LIBELLE_SOURCE[p.source]}. {p.raisons.join(" ")}
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
                {`Non proposé : ${etat.reponse.ecartees
                  .map(
                    (e) =>
                      `${libelleJourLong(e.date)} (${LIBELLE_MOTIF_ECARTE[e.motif] ?? e.motif})`,
                  )
                  .join(", ")}.`}
              </p>
            ) : null}
            {(etat.reponse.activite_ignoree ?? 0) > 0 ? (
              <p className="mp-texte-doux">
                {`${etat.reponse.activite_ignoree} activité(s) sur des tâches qui ne vous sont pas affectées : ignorée(s).`}
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
                Appliquer à la grille
              </Bouton>
              <Bouton variante="discret" onClick={() => setEtat({ phase: "repos" })}>
                Ignorer
              </Bouton>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
