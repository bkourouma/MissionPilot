"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  RED_REPONSES_URGENCE,
  type RedReponseUrgence,
  type RedUrgenceVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminUrgences,
  libelleDomaine,
  libelleReponse,
  messageRedressement,
  TEXTE_URGENCE_INTRO,
  TEXTE_URGENCE_INTRO_EN,
} from "../../lib/redressement";
import {
  compterReponses,
  corpsUrgenceDepuisFormulaire,
  grouperQuestions,
  libelleCompteur,
  type ChampUrgence,
  type GrilleUrgence,
} from "../../lib/redressement-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ResultatUrgence } from "./ResultatUrgence";

/**
 * Questionnaire d'urgence (RED-01) : 15 questions en 5 domaines, une fiche par domaine, quatre
 * boutons radio par question. Le compteur est annoncé poliment ; la durée passée sur la page est
 * envoyée avec les réponses. Les voyants et pourcentages sont ceux du moteur. Le résultat de
 * l'évaluation reste en état local : la page ne doit PAS donner de `key` à ce composant (le
 * rafraîchissement qui suit l'envoi le remonterait et effacerait le résultat et le formulaire).
 */
export function QuestionnaireUrgence({
  dossierId,
  grille,
  derniere,
}: {
  dossierId: string;
  grille: GrilleUrgence;
  derniere: RedUrgenceVue | null;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampUrgence>();
  const [reponses, setReponses] = useState<Record<string, RedReponseUrgence | undefined>>({});
  const [commentaire, setCommentaire] = useState("");
  const [resultat, setResultat] = useState<RedUrgenceVue | null>(null);
  const debut = useRef<number | null>(null);
  useEffect(() => {
    debut.current = Date.now();
  }, []);

  const total = grille.length;
  const repondues = compterReponses(reponses);
  const groupes = grouperQuestions(grille);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const duree = debut.current === null ? null : Math.round((Date.now() - debut.current) / 1000);
    await f.envoyer(
      corpsUrgenceDepuisFormulaire(reponses, duree, commentaire, grille, langue),
      (charge) => api.post<RedUrgenceVue>(cheminUrgences(dossierId), charge),
      {
        succes: t("Évaluation enregistrée.", "Assessment saved."),
        messageSpecifique: (e) => messageRedressement(e, langue),
        apres: (r) => setResultat(r),
      },
    );
  }

  return (
    <div className="mp-red-section">
      <p className="mp-texte-doux">{t(TEXTE_URGENCE_INTRO, TEXTE_URGENCE_INTRO_EN)}</p>
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={soumettre}
        aria-label={t("Questionnaire d'urgence", "Urgency questionnaire")}
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Évaluation impossible", "Could not assess")}
        />
        <p className="mp-texte-doux" role="status" aria-live="polite">
          {libelleCompteur(repondues, total, langue)}
        </p>
        {f.erreurs.reponses ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.reponses}</p>
          </Alerte>
        ) : null}
        {derniere ? (
          <div className="mp-actions-formulaire">
            <Bouton
              variante="secondaire"
              onClick={() => {
                const reprises: Record<string, RedReponseUrgence> = {};
                for (const q of grille) {
                  const r = derniere.reponses[q.code];
                  if (r !== undefined) reprises[q.code] = r;
                }
                setReponses(reprises);
              }}
            >
              {t(
                "Reprendre les réponses de la dernière évaluation",
                "Reuse the answers of the latest assessment",
              )}
            </Bouton>
          </div>
        ) : null}

        {groupes.map((g) => (
          <fieldset key={g.domaine} className="mp-red-fiche">
            <legend>{libelleDomaine(g.domaine, langue)}</legend>
            {g.questions.map((q) => (
              <fieldset key={q.code} className="mp-red-question">
                <legend>{q.libelle}</legend>
                <div className="mp-red-question__choix">
                  {RED_REPONSES_URGENCE.map((r) => (
                    <label key={r} className="mp-red-radio">
                      <input
                        type="radio"
                        name={`question-${q.code}`}
                        value={r}
                        checked={reponses[q.code] === r}
                        onChange={() => setReponses((x) => ({ ...x, [q.code]: r }))}
                      />
                      <span>{libelleReponse(r, langue)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </fieldset>
        ))}

        <ZoneTexte
          libelle={t("Commentaire (facultatif)", "Comment (optional)")}
          maxLength={2000}
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          erreur={f.erreurs.commentaire}
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            chargement={f.enCours}
            texteChargement={t("Évaluation…", "Assessing…")}
          >
            {t("Évaluer", "Assess")}
          </Bouton>
        </div>
      </form>

      {resultat ? (
        <Carte titre={t("Résultat de l'évaluation", "Assessment result")}>
          <ResultatUrgence resultat={resultat.resultat} />
        </Carte>
      ) : null}
    </div>
  );
}
