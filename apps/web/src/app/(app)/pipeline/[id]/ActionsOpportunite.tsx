"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { EtapeOpportunite } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Select } from "../../../../components/ui/Select";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import {
  ETAPE_LIBELLES,
  etapeSuivante,
  OPTIONS_ETAPES,
  validerIssue,
} from "../../../../lib/pipeline";

export interface ActionsOpportuniteProps {
  opportuniteId: string;
  etape: EtapeOpportunite;
  /** Sans proposition ni mission : la suppression est permise. */
  supprimable: boolean;
}

/** Changement d'étape, issue (gagnée / perdue avec motif) et suppression d'une opportunité ouverte. */
export function ActionsOpportunite({ opportuniteId, etape, supprimable }: ActionsOpportuniteProps) {
  const router = useRouter();
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
      { succes: "Étape mise à jour." },
    );
  }

  async function declarerPerte(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await fIssue.envoyer(validerIssue("perdue", motif), (c) => api.post(`${chemin}/issue`, c), {
      succes: "Opportunité marquée perdue.",
    });
  }

  return (
    <Carte titre="Faire avancer l'opportunité">
      <div className="mp-pile">
        <form
          className="mp-formulaire mp-formulaire--ligne"
          noValidate
          onSubmit={changerEtape}
          aria-label="Changer d'étape"
        >
          <RetourFormulaire
            erreur={fEtape.erreurGlobale}
            succes={fEtape.succes}
            refAlerte={fEtape.refAlerte}
            titreErreur="Changement d'étape impossible"
          />
          <div className="mp-ligne-action">
            <Select
              libelle="Étape"
              name="etape"
              options={OPTIONS_ETAPES}
              value={nouvelleEtape}
              onChange={(e) => setNouvelleEtape(e.target.value)}
              aide={`Étape actuelle : ${ETAPE_LIBELLES[etape]}.`}
            />
            <Bouton
              type="submit"
              variante="secondaire"
              disabled={nouvelleEtape === etape}
              chargement={fEtape.enCours}
              texteChargement="Mise à jour…"
            >
              Changer d&apos;étape
            </Bouton>
          </div>
        </form>

        <div className="mp-pile">
          <p className="mp-champ__libelle">Issue</p>
          <RetourFormulaire
            erreur={fIssue.erreurGlobale}
            succes={fIssue.succes}
            refAlerte={fIssue.refAlerte}
            titreErreur="Clôture impossible"
          />
          <div className="mp-barre-actions">
            <BoutonConfirmation
              libelle="Marquer gagnée"
              icone="succes"
              question="Marquer cette opportunité gagnée ? Elle sera close et ne se modifiera plus."
              libelleConfirmation="Oui, gagnée"
              texteChargement="Enregistrement…"
              action={() =>
                fIssue.envoyer(validerIssue("gagnee", ""), (c) => api.post(`${chemin}/issue`, c))
              }
            />
            <Bouton
              variante="secondaire"
              icone="danger"
              aria-expanded={perte}
              onClick={() => setPerte((v) => !v)}
            >
              Marquer perdue
            </Bouton>
          </div>
          {perte ? (
            <form
              ref={fIssue.refFormulaire}
              className="mp-formulaire mp-sous-formulaire"
              noValidate
              onSubmit={declarerPerte}
              aria-label="Déclarer l'opportunité perdue"
            >
              <ZoneTexte
                libelle="Motif de la perte"
                name="motif_perte"
                required
                maxLength={1000}
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                erreur={fIssue.erreurs.motif_perte}
                aide="Obligatoire : prix, concurrent retenu, projet abandonné…"
              />
              <div className="mp-actions-formulaire">
                <Bouton
                  type="submit"
                  variante="danger"
                  chargement={fIssue.enCours}
                  texteChargement="Enregistrement…"
                >
                  Confirmer la perte
                </Bouton>
                <Bouton variante="discret" onClick={() => setPerte(false)}>
                  Annuler
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
              titreErreur="Suppression impossible"
            />
            <div>
              <BoutonConfirmation
                libelle="Supprimer l'opportunité"
                variante="discret"
                icone="corbeille"
                question="Supprimer définitivement cette opportunité ? Elle n'a encore aucune proposition."
                libelleConfirmation="Oui, supprimer"
                texteChargement="Suppression…"
                action={() =>
                  fSuppr.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin), {
                    rafraichir: false,
                    apres: () => {
                      router.push("/pipeline");
                      router.refresh();
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
