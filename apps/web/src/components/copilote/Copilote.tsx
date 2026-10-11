"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { reponseCopiloteSchema, resultatActionCopiloteSchema } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  actionDe,
  ajouterErreur,
  ajouterQuestion,
  ajouterReponse,
  CHEMIN_MESSAGES,
  cheminAnnulation,
  cheminConfirmation,
  corpsMessage,
  estSuggestionComplete,
  etatApresErreur,
  LONGUEUR_MESSAGE_MAX,
  libelleCompteur,
  majAction,
  MENTION_CONFIDENTIALITE,
  messageErreurCopilote,
  validerSaisie,
  type EntreeCopilote,
  type EntreeFil,
} from "../../lib/copilote";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { CarteAction } from "./CarteAction";
import { ReponseVue } from "./ReponseVue";

/*
 * Copilote conversationnel (AGT-08). Le fil vit dans l'état du navigateur : rien n'est conservé
 * côté serveur. Les propriétés reçues de la page serveur sont sérialisables (aucune fonction).
 * Accessibilité : le fil est une région `log` (annonce polie des ajouts), le focus revient au
 * champ de saisie après chaque réponse, et une proposition d'action porte son propre résultat.
 */

export interface CopiloteProps {
  suggestions: string[];
  /** Mission affichée à l'écran (`?mission=`), transmise comme contexte ; sinon null. */
  missionId: string | null;
}

export function Copilote({ suggestions, missionId }: CopiloteProps) {
  const [fil, setFil] = useState<EntreeFil[]>([]);
  const [saisie, setSaisie] = useState("");
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const compteur = useRef(0);
  const champ = useRef<HTMLTextAreaElement>(null);
  const fin = useRef<HTMLDivElement>(null);
  const prochainId = useCallback(() => {
    compteur.current += 1;
    return `e${compteur.current}`;
  }, []);

  // Fait défiler le fil vers la dernière entrée.
  useEffect(() => {
    fin.current?.scrollIntoView?.({ block: "nearest" });
  }, [fil]);

  const envoyer = useCallback(
    async (brut: string) => {
      if (envoi) return;
      const v = validerSaisie(brut);
      if (!v.ok) {
        setErreurSaisie(v.erreur);
        champ.current?.focus();
        return;
      }
      setErreurSaisie(null);
      setSaisie("");
      setEnvoi(true);
      setFil((f) => ajouterQuestion(f, prochainId(), v.texte));
      try {
        const brutReponse = await api.post<unknown>(
          CHEMIN_MESSAGES,
          corpsMessage(v.texte, missionId),
        );
        const lu = reponseCopiloteSchema.safeParse(brutReponse);
        if (!lu.success) throw new Error("Réponse illisible.");
        setFil((f) => ajouterReponse(f, prochainId(), lu.data));
      } catch (e) {
        setFil((f) => ajouterErreur(f, prochainId(), messageErreurCopilote(e)));
        // La question n'est pas perdue : elle revient dans le champ pour être renvoyée.
        setSaisie(v.texte);
      } finally {
        setEnvoi(false);
        champ.current?.focus();
      }
    },
    [envoi, missionId, prochainId],
  );

  const decider = useCallback(async (entree: EntreeCopilote, confirmer: boolean) => {
    const action = actionDe(entree);
    if (!action) return;
    setFil((f) => majAction(f, entree.id, { etatAction: "en_cours", erreurAction: null }));
    try {
      const brut = await api.post<unknown>(
        confirmer ? cheminConfirmation(action.action_id) : cheminAnnulation(action.action_id),
      );
      const resultat = resultatActionCopiloteSchema.parse(brut);
      setFil((f) =>
        majAction(f, entree.id, {
          etatAction: resultat.statut === "confirmee" ? "confirmee" : "annulee",
          resultat,
        }),
      );
    } catch (e) {
      setFil((f) =>
        majAction(f, entree.id, {
          etatAction: etatApresErreur(e),
          erreurAction: messageErreurCopilote(e),
        }),
      );
    }
  }, []);

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    void envoyer(saisie);
  };

  // Entrée envoie, Maj+Entrée saute une ligne.
  const touche = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void envoyer(saisie);
    }
  };

  const choisir = (texte: string) => {
    if (estSuggestionComplete(texte)) {
      void envoyer(texte);
    } else {
      setSaisie(texte);
      setErreurSaisie(null);
      champ.current?.focus();
    }
  };

  return (
    <div className="mp-copilote">
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={envoi}
        aria-label="Conversation avec le copilote"
      >
        {fil.length === 0 ? (
          <p>
            Posez une question sur votre activité : tâches, feuilles de temps, missions, KPI,
            factures échues, recherche. Le copilote répond dans vos droits et ne modifie rien sans
            votre confirmation.
          </p>
        ) : (
          <ol className="mp-copilote__fil">
            {fil.map((e) => (
              <li key={e.id} className={`mp-copilote__entree mp-copilote__entree--${e.auteur}`}>
                {e.auteur === "utilisateur" ? (
                  <>
                    <span className="mp-copilote__auteur">Vous</span>
                    <div className="mp-copilote__bulle">{e.texte}</div>
                  </>
                ) : e.auteur === "erreur" ? (
                  <Alerte tonalite="danger" titre="Le copilote n'a pas pu répondre">
                    <p>{e.texte}</p>
                  </Alerte>
                ) : (
                  <>
                    <span className="mp-copilote__auteur">Copilote</span>
                    <div className="mp-copilote__bulle">
                      <ReponseVue reponse={e.reponse} />
                      {e.etatAction && e.reponse.action ? (
                        <CarteAction
                          action={e.reponse.action}
                          etat={e.etatAction}
                          resultat={e.resultat}
                          erreur={e.erreurAction}
                          onConfirmer={() => void decider(e, true)}
                          onAnnuler={() => void decider(e, false)}
                        />
                      ) : null}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={fin} />
      </div>
      {envoi ? (
        <p className="mp-copilote__attente" role="status">
          Le copilote prépare sa réponse…
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <section aria-label="Suggestions de questions">
          <ul className="mp-copilote__suggestions">
            {suggestions.map((s) => (
              <li key={s}>
                <Bouton variante="secondaire" onClick={() => choisir(s)} disabled={envoi}>
                  {s}
                </Bouton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="mp-copilote__formulaire" onSubmit={soumettre} noValidate>
        <ZoneTexte
          ref={champ}
          libelle="Votre question"
          rows={2}
          value={saisie}
          maxLength={LONGUEUR_MESSAGE_MAX}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={touche}
          erreur={erreurSaisie ?? undefined}
          aide="Entrée pour envoyer, Maj+Entrée pour passer à la ligne."
          autoComplete="off"
        />
        <div className="mp-copilote__pied-saisie">
          <span className="mp-copilote__compteur">{libelleCompteur(saisie.length)}</span>
          <Bouton type="submit" chargement={envoi} texteChargement="Envoi…" icone="envoyer">
            Envoyer
          </Bouton>
        </div>
      </form>
      <p className="mp-copilote__mention">{MENTION_CONFIDENTIALITE}</p>
    </div>
  );
}
