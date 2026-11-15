"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../../../../../components/formulaires/useRafraichir";
import type { StatutProposition } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { useT } from "../../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../../lib/api";
import type { ActionStatut, Proposition } from "../../../../../lib/propositions";

export interface ActionsPropositionProps {
  propositionId: string;
  statut: StatutProposition;
  /** Changements de statut permis à l'utilisateur (déjà filtrés par rôle). */
  actions: ActionStatut[];
  /** Opportunité encore ouverte : une nouvelle version peut être créée. */
  nouvelleVersion: boolean;
  tauxManquants: string[];
}

/** Cycle brouillon → à valider → validée → envoyée → acceptée / refusée, et nouvelle version. */
export function ActionsProposition({
  propositionId,
  statut,
  actions,
  nouvelleVersion,
  tauxManquants,
}: ActionsPropositionProps) {
  const router = useRouter();
  const t = useT();
  const AIDE: Partial<Record<StatutProposition, string>> = {
    brouillon: t(
      "Ajustez l'équipe et les jours, puis soumettez la proposition à un associé.",
      "Adjust the team and days, then submit the proposal to a partner.",
    ),
    a_valider: t(
      "Un associé valide la proposition, ou la renvoie en brouillon.",
      "A partner approves the proposal, or sends it back to draft.",
    ),
    validee: t(
      "Envoyez la proposition au client, puis enregistrez sa réponse.",
      "Send the proposal to the client, then record its response.",
    ),
    envoyee: t("Enregistrez la réponse du client.", "Record the client's response."),
    acceptee: t(
      "Le client a accepté : créez la mission depuis cette proposition.",
      "The client accepted: create the engagement from this proposal.",
    ),
    refusee: t(
      "Le client a refusé cette version : créez-en une nouvelle si la négociation continue.",
      "The client declined this version: create a new one if the negotiation continues.",
    ),
  };
  const { rafraichir } = useRafraichir();
  const f = useFormulaire<never>();
  const [attente, marquerAttente] = useAttenteRafraichissement(statut);
  const chemin = `/api/propositions/${encodeURIComponent(propositionId)}`;
  const changer = (cible: StatutProposition) =>
    f.envoyer({ ok: true, charge: { statut: cible } }, (c) => api.post(`${chemin}/statut`, c), {
      succes: t("Statut mis à jour.", "Status updated."),
      apres: marquerAttente,
    });
  const bloqueValidation = tauxManquants.length > 0;

  if (actions.length === 0 && !nouvelleVersion) return null;
  return (
    <Carte titre={t("Étapes de la proposition", "Proposal steps")}>
      <div className="mp-pile">
        {AIDE[statut] ? <p className="mp-texte-doux">{AIDE[statut]}</p> : null}
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Action impossible", "Action failed")}
        />
        {attente ? (
          <p className="mp-texte-doux" role="status">
            {t("Mise à jour de la page…", "Updating the page…")}
          </p>
        ) : (
          <div className="mp-barre-actions">
            {actions.map((a) =>
              a.cible === "validee" && bloqueValidation ? (
                <Bouton key={a.cible} disabled aria-describedby="aide-validation">
                  {a.libelle}
                </Bouton>
              ) : a.confirmer ? (
                <BoutonConfirmation
                  key={a.cible}
                  libelle={a.libelle}
                  variante={a.cible === "refusee" ? "secondaire" : "primaire"}
                  question={
                    a.cible === "validee"
                      ? t(
                          "Valider cette proposition ? Elle ne sera plus modifiable.",
                          "Approve this proposal? It can no longer be edited.",
                        )
                      : a.cible === "acceptee"
                        ? t(
                            "Enregistrer l'acceptation du client ? L'opportunité sera marquée gagnée.",
                            "Record the client's acceptance? The opportunity will be marked as won.",
                          )
                        : t(
                            "Enregistrer le refus du client pour cette version ?",
                            "Record the client's refusal for this version?",
                          )
                  }
                  libelleConfirmation={t("Oui, confirmer", "Yes, confirm")}
                  texteChargement={t("Enregistrement…", "Saving…")}
                  action={() => changer(a.cible)}
                />
              ) : (
                <Bouton
                  key={a.cible}
                  variante={a.cible === "brouillon" ? "secondaire" : "primaire"}
                  chargement={f.enCours}
                  texteChargement={t("Enregistrement…", "Saving…")}
                  onClick={() => changer(a.cible)}
                >
                  {a.libelle}
                </Bouton>
              ),
            )}
            {nouvelleVersion ? (
              <Bouton
                variante="secondaire"
                icone="copie"
                disabled={f.enCours}
                onClick={() =>
                  f.envoyer(
                    { ok: true, charge: null },
                    () => api.post<Proposition>(`${chemin}/nouvelle-version`),
                    {
                      rafraichir: false,
                      apres: (p) => {
                        router.push(`/pipeline/propositions/${p.id}`);
                        rafraichir();
                      },
                    },
                  )
                }
              >
                {t("Nouvelle version", "New version")}
              </Bouton>
            ) : null}
          </div>
        )}
        {bloqueValidation && actions.some((a) => a.cible === "validee") ? (
          <p id="aide-validation" className="mp-champ__aide">
            {t(
              `Validation impossible : taux de vente manquant pour ${tauxManquants.join(", ")}.`,
              `Approval impossible: selling rate missing for ${tauxManquants.join(", ")}.`,
            )}
          </p>
        ) : null}
      </div>
    </Carte>
  );
}
