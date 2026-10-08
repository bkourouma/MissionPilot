"use client";

import { useRouter } from "next/navigation";
import type { StatutProposition } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
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

const AIDE: Partial<Record<StatutProposition, string>> = {
  brouillon: "Ajustez l'équipe et les jours, puis soumettez la proposition à un associé.",
  a_valider: "Un associé valide la proposition, ou la renvoie en brouillon.",
  validee: "Envoyez la proposition au client, puis enregistrez sa réponse.",
  envoyee: "Enregistrez la réponse du client.",
  acceptee: "Le client a accepté : créez la mission depuis cette proposition.",
  refusee: "Le client a refusé cette version : créez-en une nouvelle si la négociation continue.",
};

/** Cycle brouillon → à valider → validée → envoyée → acceptée / refusée, et nouvelle version. */
export function ActionsProposition({
  propositionId,
  statut,
  actions,
  nouvelleVersion,
  tauxManquants,
}: ActionsPropositionProps) {
  const router = useRouter();
  const f = useFormulaire<never>();
  const [attente, marquerAttente] = useAttenteRafraichissement(statut);
  const chemin = `/api/propositions/${encodeURIComponent(propositionId)}`;
  const changer = (cible: StatutProposition) =>
    f.envoyer({ ok: true, charge: { statut: cible } }, (c) => api.post(`${chemin}/statut`, c), {
      succes: "Statut mis à jour.",
      apres: marquerAttente,
    });
  const bloqueValidation = tauxManquants.length > 0;

  if (actions.length === 0 && !nouvelleVersion) return null;
  return (
    <Carte titre="Étapes de la proposition">
      <div className="mp-pile">
        {AIDE[statut] ? <p className="mp-texte-doux">{AIDE[statut]}</p> : null}
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Action impossible"
        />
        {attente ? (
          <p className="mp-texte-doux" role="status">
            Mise à jour de la page…
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
                      ? "Valider cette proposition ? Elle ne sera plus modifiable."
                      : a.cible === "acceptee"
                        ? "Enregistrer l'acceptation du client ? L'opportunité sera marquée gagnée."
                        : "Enregistrer le refus du client pour cette version ?"
                  }
                  libelleConfirmation="Oui, confirmer"
                  texteChargement="Enregistrement…"
                  action={() => changer(a.cible)}
                />
              ) : (
                <Bouton
                  key={a.cible}
                  variante={a.cible === "brouillon" ? "secondaire" : "primaire"}
                  chargement={f.enCours}
                  texteChargement="Enregistrement…"
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
                        router.refresh();
                      },
                    },
                  )
                }
              >
                Nouvelle version
              </Bouton>
            ) : null}
          </div>
        )}
        {bloqueValidation && actions.some((a) => a.cible === "validee") ? (
          <p id="aide-validation" className="mp-champ__aide">
            {`Validation impossible : taux de vente manquant pour ${tauxManquants.join(", ")}.`}
          </p>
        ) : null}
      </div>
    </Carte>
  );
}
