"use client";

import { useState } from "react";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { EtatVide } from "../ui/EtatListe";
import { api, messageErreur } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import {
  formaterBornesGuichet,
  joindreRestrictions,
  MENTION_GUICHETS_A_VALIDER,
  MESSAGE_AUCUN_GUICHET,
  messageListeTronquee,
  OBJET_LIBELLES,
  TYPE_GUICHET_LIBELLES,
  type Guichet,
} from "../../lib/services-candidats";
import { FormulaireGuichet } from "./FormulaireGuichet";

export interface GestionGuichetsProps {
  guichets: readonly Guichet[];
  /** Vrai si l'API n'a renvoyé que les premiers guichets (limite de la page). */
  tronque?: boolean;
  /** `services_candidats.gerer` : créer, modifier, désactiver. */
  peutGerer: boolean;
}

/** Liste des guichets du cabinet, avec création, modification et (dés)activation. */
export function GestionGuichets({ guichets, tronque = false, peutGerer }: GestionGuichetsProps) {
  const { rafraichir } = useRafraichir();
  const [creation, setCreation] = useState(false);
  const [edition, setEdition] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const termine = () => {
    setCreation(false);
    setEdition(null);
  };

  async function basculer(g: Guichet, actif: boolean): Promise<boolean> {
    setErreur(null);
    try {
      await api.patch(`/api/guichets-financement/${encodeURIComponent(g.id)}`, { actif });
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    }
  }

  return (
    <div className="mp-pile">
      <Alerte tonalite="info" annonce="aucune">
        <p>{MENTION_GUICHETS_A_VALIDER}</p>
      </Alerte>
      {tronque ? (
        <Alerte tonalite="attention" annonce="status" titre="Liste tronquée">
          <p>{messageListeTronquee(guichets.length)}</p>
        </Alerte>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger" titre="Action impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {peutGerer ? (
        creation ? (
          <Carte titre="Nouveau guichet" niveauTitre={2}>
            <FormulaireGuichet onTermine={termine} onAnnuler={() => setCreation(false)} />
          </Carte>
        ) : (
          <div>
            <Bouton icone="plus" onClick={() => setCreation(true)}>
              Nouveau guichet
            </Bouton>
          </div>
        )
      ) : null}

      {guichets.length === 0 ? (
        <EtatVide titre={MESSAGE_AUCUN_GUICHET} icone="monnaie">
          {peutGerer ? <p>Ajoutez les guichets que votre cabinet suit.</p> : null}
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {guichets.map((g) => (
            <li key={g.id}>
              <Carte
                niveauTitre={3}
                titre={g.nom}
                actions={
                  <>
                    <BadgeStatut tonalite={g.actif ? "succes" : "neutre"}>
                      {g.actif ? "Actif" : "Désactivé"}
                    </BadgeStatut>
                    <BadgeStatut tonalite="attention">À valider par un expert</BadgeStatut>
                  </>
                }
              >
                {edition === g.id ? (
                  <FormulaireGuichet
                    guichet={g}
                    onTermine={termine}
                    onAnnuler={() => setEdition(null)}
                  />
                ) : (
                  <div className="mp-pile">
                    <dl className="mp-liste-def mp-liste-def--compacte">
                      <div>
                        <dt>Type</dt>
                        <dd>{TYPE_GUICHET_LIBELLES[g.type] ?? g.type}</dd>
                      </div>
                      <div>
                        <dt>Pays</dt>
                        <dd>{joindreRestrictions(g.pays)}</dd>
                      </div>
                      <div>
                        <dt>Secteurs</dt>
                        <dd>{joindreRestrictions(g.secteurs)}</dd>
                      </div>
                      <div>
                        <dt>Filières</dt>
                        <dd>{joindreRestrictions(g.filieres)}</dd>
                      </div>
                      <div>
                        <dt>Tailles</dt>
                        <dd>{joindreRestrictions(g.tailles)}</dd>
                      </div>
                      <div>
                        <dt>Objets</dt>
                        <dd>{joindreRestrictions(g.objets.map((o) => OBJET_LIBELLES[o] ?? o))}</dd>
                      </div>
                      <div>
                        <dt>Devises</dt>
                        <dd>{joindreRestrictions(g.devises)}</dd>
                      </div>
                      <div>
                        <dt>Montants</dt>
                        <dd>{formaterBornesGuichet(g)}</dd>
                      </div>
                      <div>
                        <dt>Date limite</dt>
                        <dd>{g.date_limite ? formaterDate(g.date_limite) : "Aucune"}</dd>
                      </div>
                    </dl>
                    {g.description ? <p>{g.description}</p> : null}
                    {g.url ? (
                      <p>
                        <a href={g.url} target="_blank" rel="noopener noreferrer">
                          Site du guichet (nouvel onglet)
                        </a>
                      </p>
                    ) : null}
                    {peutGerer ? (
                      <div className="mp-actions-formulaire">
                        <Bouton
                          variante="secondaire"
                          icone="crayon"
                          onClick={() => setEdition(g.id)}
                        >
                          Modifier
                        </Bouton>
                        {g.actif ? (
                          <BoutonConfirmation
                            libelle="Désactiver"
                            ariaLabel={`Désactiver le guichet ${g.nom}`}
                            question={`Désactiver « ${g.nom} » ? Il sera exclu du rapprochement.`}
                            libelleConfirmation="Oui, désactiver"
                            texteChargement="Désactivation…"
                            action={() => basculer(g, false)}
                          />
                        ) : (
                          <Bouton variante="secondaire" onClick={() => void basculer(g, true)}>
                            Réactiver
                          </Bouton>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </Carte>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
