"use client";

import { useState } from "react";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  libelleObjet,
  libelleTypeGuichet,
  mentionGuichetsAValider,
  messageAucunGuichet,
  messageListeTronquee,
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
  const t = useT();
  const langue = useLangue();
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
      setErreur(messageErreur(e, langue));
      return false;
    }
  }

  return (
    <div className="mp-pile">
      <Alerte tonalite="info" annonce="aucune">
        <p>{mentionGuichetsAValider(langue)}</p>
      </Alerte>
      {tronque ? (
        <Alerte tonalite="attention" annonce="status" titre={t("Liste tronquée", "Truncated list")}>
          <p>{messageListeTronquee(guichets.length, langue)}</p>
        </Alerte>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger" titre={t("Action impossible", "Action failed")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {peutGerer ? (
        creation ? (
          <Carte titre={t("Nouveau guichet", "New funding source")} niveauTitre={2}>
            <FormulaireGuichet onTermine={termine} onAnnuler={() => setCreation(false)} />
          </Carte>
        ) : (
          <div>
            <Bouton icone="plus" onClick={() => setCreation(true)}>
              {t("Nouveau guichet", "New funding source")}
            </Bouton>
          </div>
        )
      ) : null}

      {guichets.length === 0 ? (
        <EtatVide titre={messageAucunGuichet(langue)} icone="monnaie">
          {peutGerer ? (
            <p>
              {t(
                "Ajoutez les guichets que votre cabinet suit.",
                "Add the funding sources your firm follows.",
              )}
            </p>
          ) : null}
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
                      {g.actif ? t("Actif", "Active") : t("Désactivé", "Disabled")}
                    </BadgeStatut>
                    <BadgeStatut tonalite="attention">
                      {t("À valider par un expert", "Pending expert approval")}
                    </BadgeStatut>
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
                        <dt>{t("Type", "Type")}</dt>
                        <dd>{libelleTypeGuichet(g.type, langue) ?? g.type}</dd>
                      </div>
                      <div>
                        <dt>{t("Pays", "Countries")}</dt>
                        <dd>{joindreRestrictions(g.pays, langue)}</dd>
                      </div>
                      <div>
                        <dt>{t("Secteurs", "Sectors")}</dt>
                        <dd>{joindreRestrictions(g.secteurs, langue)}</dd>
                      </div>
                      <div>
                        <dt>{t("Filières", "Value chains")}</dt>
                        <dd>{joindreRestrictions(g.filieres, langue)}</dd>
                      </div>
                      <div>
                        <dt>{t("Tailles", "Sizes")}</dt>
                        <dd>{joindreRestrictions(g.tailles, langue)}</dd>
                      </div>
                      <div>
                        <dt>{t("Objets", "Purposes")}</dt>
                        <dd>
                          {joindreRestrictions(
                            g.objets.map((o) => libelleObjet(o, langue) ?? o),
                            langue,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("Devises", "Currencies")}</dt>
                        <dd>{joindreRestrictions(g.devises, langue)}</dd>
                      </div>
                      <div>
                        <dt>{t("Montants", "Amounts")}</dt>
                        <dd>{formaterBornesGuichet(g, langue)}</dd>
                      </div>
                      <div>
                        <dt>{t("Date limite", "Deadline")}</dt>
                        <dd>
                          {g.date_limite
                            ? formaterDate(g.date_limite, "UTC", langue)
                            : t("Aucune", "None")}
                        </dd>
                      </div>
                    </dl>
                    {g.description ? <p>{g.description}</p> : null}
                    {g.url ? (
                      <p>
                        <a href={g.url} target="_blank" rel="noopener noreferrer">
                          {t("Site du guichet (nouvel onglet)", "Funding source website (new tab)")}
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
                          {t("Modifier", "Edit")}
                        </Bouton>
                        {g.actif ? (
                          <BoutonConfirmation
                            libelle={t("Désactiver", "Disable")}
                            ariaLabel={t(
                              `Désactiver le guichet ${g.nom}`,
                              `Disable funding source ${g.nom}`,
                            )}
                            question={t(
                              `Désactiver « ${g.nom} » ? Il sera exclu du rapprochement.`,
                              `Disable "${g.nom}"? It will be excluded from matching.`,
                            )}
                            libelleConfirmation={t("Oui, désactiver", "Yes, disable")}
                            texteChargement={t("Désactivation…", "Disabling…")}
                            action={() => basculer(g, false)}
                          />
                        ) : (
                          <Bouton variante="secondaire" onClick={() => void basculer(g, true)}>
                            {t("Réactiver", "Reactivate")}
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
