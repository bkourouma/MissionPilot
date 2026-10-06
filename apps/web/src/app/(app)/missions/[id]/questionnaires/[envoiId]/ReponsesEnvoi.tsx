"use client";

import { useRef, useState } from "react";
import { AffichageReponses } from "../../../../../../components/questionnaires/AffichageReponses";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Bouton } from "../../../../../../components/ui/Bouton";
import { EtatVide } from "../../../../../../components/ui/EtatListe";
import { Squelette } from "../../../../../../components/ui/Squelette";
import { api, messageErreur } from "../../../../../../lib/api";
import { formaterDateHeure } from "../../../../../../lib/format";
import {
  messageQuestionnaire,
  type ReponsesEnvoi as Reponses,
} from "../../../../../../lib/questionnaires";
import type { Definition } from "../../../../../../lib/questionnaires-definition";

type Etat =
  | { phase: "ferme" }
  | { phase: "chargement" }
  | { phase: "erreur"; message: string }
  | { phase: "pret"; reponses: Reponses };

/**
 * Réponses SOUMISES d'un envoi, lues à la demande (l'API ne sert jamais un brouillon du
 * client). Elles ne vivent que dans l'état de la page : « Masquer » les efface, rien n'est
 * conservé dans le navigateur.
 */
export function ReponsesEnvoi({
  envoiId,
  definition,
  soumises,
}: {
  envoiId: string;
  definition: Definition;
  soumises: number;
}) {
  const [etat, setEtat] = useState<Etat>({ phase: "ferme" });
  const refTitre = useRef<HTMLHeadingElement>(null);

  async function afficher() {
    setEtat({ phase: "chargement" });
    try {
      const reponses = await api.get<Reponses>(
        `/api/questionnaires/envois/${encodeURIComponent(envoiId)}/reponses`,
      );
      setEtat({ phase: "pret", reponses });
      requestAnimationFrame(() => refTitre.current?.focus());
    } catch (e) {
      setEtat({ phase: "erreur", message: messageQuestionnaire(e) ?? messageErreur(e) });
    }
  }

  return (
    <section className="mp-pile" aria-labelledby="titre-reponses">
      <h3 id="titre-reponses" ref={refTitre} tabIndex={-1} className="mp-section__titre">
        {`Réponses soumises (${soumises})`}
      </h3>
      <p className="mp-texte-doux mp-texte-petit">
        Seules les réponses soumises sont lisibles. D'une saisie en cours, le cabinet ne voit que la
        progression ; les réponses affichées ne sont conservées ni dans le navigateur ni hors de
        cette page.
      </p>
      {soumises === 0 ? (
        <EtatVide titre="Aucune réponse soumise pour l'instant." icone="bulle" />
      ) : etat.phase === "ferme" ? (
        <div>
          <Bouton variante="secondaire" icone="oeil" onClick={() => void afficher()}>
            Afficher les réponses soumises
          </Bouton>
        </div>
      ) : etat.phase === "chargement" ? (
        <Squelette lignes={5} libelle="Chargement des réponses soumises…" />
      ) : etat.phase === "erreur" ? (
        <div className="mp-pile">
          <Alerte tonalite="danger" titre="Les réponses n'ont pas pu être chargées.">
            <p>{etat.message}</p>
          </Alerte>
          <div>
            <Bouton variante="secondaire" onClick={() => void afficher()}>
              Réessayer
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="mp-pile mp-pile--large">
          <div>
            <Bouton variante="discret" icone="fermer" onClick={() => setEtat({ phase: "ferme" })}>
              Masquer les réponses
            </Bouton>
          </div>
          {etat.reponses.elements.length === 0 ? (
            <EtatVide titre="Aucune réponse soumise pour l'instant." icone="bulle" />
          ) : (
            etat.reponses.elements.map((r, i) => (
              <article key={r.id} className="mp-carte" aria-labelledby={`reponse-${i}`}>
                <div className="mp-carte__entete">
                  <h4 id={`reponse-${i}`} className="mp-carte__titre">
                    {r.repondant
                      ? `${r.repondant.nom}${r.repondant.fonction ? ` · ${r.repondant.fonction}` : ""}`
                      : "Réponse partagée"}
                  </h4>
                </div>
                <p className="mp-texte-doux mp-texte-petit">
                  {`Soumise le ${formaterDateHeure(r.soumise_le)}${
                    r.soumise_par_nom && (!r.repondant || r.soumise_par_nom !== r.repondant.nom)
                      ? ` par ${r.soumise_par_nom}`
                      : ""
                  }`}
                </p>
                <AffichageReponses
                  definition={definition}
                  reponses={r.reponses ?? {}}
                  idBase={`reponse-${i}`}
                />
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
