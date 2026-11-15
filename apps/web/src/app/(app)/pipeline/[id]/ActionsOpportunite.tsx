"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import type { EtapeOpportunite } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Select } from "../../../../components/ui/Select";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import { libelleEtape, etapeSuivante, optionsEtapes, validerIssue } from "../../../../lib/pipeline";

export interface ActionsOpportuniteProps {
  opportuniteId: string;
  etape: EtapeOpportunite;
  /** Sans proposition ni mission : la suppression est permise. */
  supprimable: boolean;
}

/** Changement d'étape, issue (gagnée / perdue avec motif) et suppression d'une opportunité ouverte. */
export function ActionsOpportunite({ opportuniteId, etape, supprimable }: ActionsOpportuniteProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const chemin = `/api/opportunites/${encodeURIComponent(opportuniteId)}`;
  const [nouvelleEtape, setNouvelleEtape] = useState<string>(etapeSuivante(etape) ?? etape);
  const [perte, setPerte] = useState(false);
  const [motif, setMotif] = useState("");
  const fEtape = useFormulaire<never>();
  const fIssue = useFormulaire<"motif_perte">();
  const fSuppr = useFormulaire<never>();

  async function changerEtape(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await fEtape.envoyer(
      nouvelleEtape === etape
        ? { ok: false, erreurs: {} }
        : { ok: true, charge: { etape: nouvelleEtape } },
      (c) => api.post(`${chemin}/etape`, c),
      { succes: t("Étape mise à jour.", "Stage updated.") },
    );
  }

  async function declarerPerte(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await fIssue.envoyer(
      validerIssue("perdue", motif, langue),
      (c) => api.post(`${chemin}/issue`, c),
      {
        succes: t("Opportunité marquée perdue.", "Opportunity marked as lost."),
      },
    );
  }

  return (
    <Carte titre={t("Faire avancer l'opportunité", "Move the opportunity forward")}>
      <div className="mp-pile">
        <form
          className="mp-formulaire mp-formulaire--ligne"
          noValidate
          onSubmit={changerEtape}
          aria-label={t("Changer d'étape", "Change stage")}
        >
          <RetourFormulaire
            erreur={fEtape.erreurGlobale}
            succes={fEtape.succes}
            refAlerte={fEtape.refAlerte}
            titreErreur={t("Changement d'étape impossible", "Stage change failed")}
          />
          <div className="mp-ligne-action">
            <Select
              libelle={t("Étape", "Stage")}
              name="etape"
              options={optionsEtapes(langue)}
              value={nouvelleEtape}
              onChange={(e) => setNouvelleEtape(e.target.value)}
              aide={t(
                `Étape actuelle : ${libelleEtape(etape, "fr")}.`,
                `Current stage: ${libelleEtape(etape, "en")}.`,
              )}
            />
            <Bouton
              type="submit"
              variante="secondaire"
              disabled={nouvelleEtape === etape}
              chargement={fEtape.enCours}
              texteChargement={t("Mise à jour…", "Updating…")}
            >
              {t("Changer d'étape", "Change stage")}
            </Bouton>
          </div>
        </form>

        <div className="mp-pile">
          <p className="mp-champ__libelle">{t("Issue", "Outcome")}</p>
          <RetourFormulaire
            erreur={fIssue.erreurGlobale}
            succes={fIssue.succes}
            refAlerte={fIssue.refAlerte}
            titreErreur={t("Clôture impossible", "Closing failed")}
          />
          <div className="mp-barre-actions">
            <BoutonConfirmation
              libelle={t("Marquer gagnée", "Mark as won")}
              icone="succes"
              question={t(
                "Marquer cette opportunité gagnée ? Elle sera close et ne se modifiera plus.",
                "Mark this opportunity as won? It will be closed and can no longer be edited.",
              )}
              libelleConfirmation={t("Oui, gagnée", "Yes, won")}
              texteChargement={t("Enregistrement…", "Saving…")}
              action={() =>
                fIssue.envoyer(validerIssue("gagnee", "", langue), (c) =>
                  api.post(`${chemin}/issue`, c),
                )
              }
            />
            <Bouton
              variante="secondaire"
              icone="danger"
              aria-expanded={perte}
              onClick={() => setPerte((v) => !v)}
            >
              {t("Marquer perdue", "Mark as lost")}
            </Bouton>
          </div>
          {perte ? (
            <form
              ref={fIssue.refFormulaire}
              className="mp-formulaire mp-sous-formulaire"
              noValidate
              onSubmit={declarerPerte}
              aria-label={t("Déclarer l'opportunité perdue", "Declare the opportunity lost")}
            >
              <ZoneTexte
                libelle={t("Motif de la perte", "Reason for the loss")}
                name="motif_perte"
                required
                maxLength={1000}
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                erreur={fIssue.erreurs.motif_perte}
                aide={t(
                  "Obligatoire : prix, concurrent retenu, projet abandonné…",
                  "Required: price, competitor selected, project abandoned…",
                )}
              />
              <div className="mp-actions-formulaire">
                <Bouton
                  type="submit"
                  variante="danger"
                  chargement={fIssue.enCours}
                  texteChargement={t("Enregistrement…", "Saving…")}
                >
                  {t("Confirmer la perte", "Confirm the loss")}
                </Bouton>
                <Bouton variante="discret" onClick={() => setPerte(false)}>
                  {t("Annuler", "Cancel")}
                </Bouton>
              </div>
            </form>
          ) : null}
        </div>

        {supprimable ? (
          <div className="mp-pile">
            <RetourFormulaire
              erreur={fSuppr.erreurGlobale}
              refAlerte={fSuppr.refAlerte}
              titreErreur={t("Suppression impossible", "Deletion failed")}
            />
            <div>
              <BoutonConfirmation
                libelle={t("Supprimer l'opportunité", "Delete the opportunity")}
                variante="discret"
                icone="corbeille"
                question={t(
                  "Supprimer définitivement cette opportunité ? Elle n'a encore aucune proposition.",
                  "Permanently delete this opportunity? It has no proposal yet.",
                )}
                libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
                texteChargement={t("Suppression…", "Deleting…")}
                action={() =>
                  fSuppr.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin), {
                    rafraichir: false,
                    apres: () => {
                      router.push("/pipeline");
                      rafraichir();
                    },
                  })
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </Carte>
  );
}
